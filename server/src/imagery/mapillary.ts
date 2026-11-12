import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { haversineKm, type LatLon } from '@earthnow/shared';
import { ImageryError, fetchProvider, type FoundPano, type ImageryProvider } from './types.ts';

/**
 * Mapillary. Imagery is CC BY-SA 4.0: the reveal names the photographer.
 * Only 360° panoramas are used so players can look around.
 *
 * 360° panoramas are a small share of Mapillary's images, so a blind search
 * of the Graph API `images` endpoint mostly comes back empty, and boxes big
 * enough to find something time out (HTTP 500 "reduce the amount of data").
 * The coverage vector tiles do this well:
 *   1. z12 `sequence` layer (about 10 km per tile): the nearest point of a
 *      panorama sequence within the radius.
 *   2. z14 `image` layer around that point: the nearest panorama image.
 *   3. Graph API entity lookup: exact position and the photographer's name.
 * Tiles are cached, so nearby searches cost little.
 */
const TILES = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';
const GRAPH = 'https://graph.mapillary.com';
const SEQ_Z = 12;
const IMG_Z = 14;
/** At most this many z12 tiles per search; 4×4 covers a 5 km radius up to about 70° latitude. */
const MAX_SEQ_TILES = 16;

interface Pt {
  lat: number;
  lon: number;
}
interface PanoImage extends Pt {
  id: string;
  seq: string;
}
interface MlyEntity {
  id: string;
  is_pano?: boolean;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  creator?: { username?: string };
}

function tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function tileY(lat: number, z: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}

/** Small LRU over promises, so concurrent searches share one fetch per tile. */
class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string, make: () => V): V {
    const hit = this.m.get(k);
    if (hit !== undefined) {
      this.m.delete(k);
      this.m.set(k, hit);
      return hit;
    }
    const v = make();
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return v;
  }
  drop(k: string) {
    this.m.delete(k);
  }
}

export function mapillaryProvider(token: string, fetchImpl: typeof fetch = fetch): ImageryProvider {
  const seqCache = new Lru<Promise<Pt[]>>(256);
  const imgCache = new Lru<Promise<PanoImage[]>>(128);

  function check(res: Response, what: string) {
    if (res.status === 401 || res.status === 403) throw new ImageryError(`mapillary: token rejected (${res.status}, ${what})`, 'auth');
    if (res.status === 429 || res.status >= 500) throw new ImageryError(`mapillary: HTTP ${res.status} (${what})`, 'retryable');
    if (!res.ok) throw new ImageryError(`mapillary: HTTP ${res.status} (${what})`, 'request');
  }

  /** Decode the features of one layer of a tile into lon/lat points. */
  async function tile<T>(z: number, x: number, y: number, layer: string, pick: (props: Record<string, unknown>, pts: Pt[]) => T[]): Promise<T[]> {
    // The tile server takes the token only as a query parameter (the header is refused).
    // Error messages never include the URL, so the token stays out of logs.
    const url = new URL(`${TILES}/${z}/${x}/${y}`);
    url.searchParams.set('access_token', token);
    const res = await fetchProvider('mapillary', fetchImpl, url);
    if (res.status === 404 || res.status === 204) return [];
    check(res, `tile ${z}/${x}/${y}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) return [];
    const l = new VectorTile(new Pbf(buf)).layers[layer];
    if (!l) return [];
    const n = 2 ** z;
    const out: T[] = [];
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      if (!f.properties.is_pano) continue;
      const pts: Pt[] = [];
      for (const ring of f.loadGeometry())
        for (const p of ring) {
          const lon = ((x + p.x / l.extent) / n) * 360 - 180;
          const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + p.y / l.extent)) / n))) * 180) / Math.PI;
          pts.push({ lat, lon });
        }
      out.push(...pick(f.properties, pts));
    }
    return out;
  }

  function cached<T>(cache: Lru<Promise<T[]>>, key: string, load: () => Promise<T[]>): Promise<T[]> {
    const p = cache.get(key, load);
    // A failed fetch must not stay cached.
    p.catch(() => cache.drop(key));
    return p;
  }

  const seqTile = (x: number, y: number) => cached(seqCache, `${x}/${y}`, () => tile(SEQ_Z, x, y, 'sequence', (_, pts) => pts));
  const imgTile = (x: number, y: number) =>
    cached(imgCache, `${x}/${y}`, () => tile(IMG_Z, x, y, 'image', (props, pts) => pts.slice(0, 1).map((p) => ({ ...p, id: String(props.id), seq: String(props.sequence_id ?? '') }))));

  function nearest<T extends Pt>(p: LatLon, items: T[], maxKm: number): T | null {
    let best: T | null = null;
    let bestD = maxKm;
    for (const it of items) {
      const d = haversineKm(p, it);
      if (d <= bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  return {
    id: 'mapillary',
    async findPano(p: LatLon, radiusM: number): Promise<FoundPano | null> {
      const km = radiusM / 1000;
      const dLat = km / 111.32;
      const dLon = km / (111.32 * Math.max(0.05, Math.cos((p.lat * Math.PI) / 180)));
      // 1. Nearest panorama-sequence point within the radius.
      let x0 = tileX(p.lon - dLon, SEQ_Z);
      let x1 = tileX(p.lon + dLon, SEQ_Z);
      let y0 = tileY(p.lat + dLat, SEQ_Z);
      let y1 = tileY(p.lat - dLat, SEQ_Z);
      while ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_SEQ_TILES) {
        // Larger radius: search the block around the point only.
        if (x1 - x0 >= y1 - y0) [x0, x1] = [x0 + 1, x1 - 1];
        else [y0, y1] = [y0 + 1, y1 - 1];
      }
      const jobs: Promise<Pt[]>[] = [];
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(seqTile(((x % 4096) + 4096) % 4096, y));
      const seqPt = nearest(p, (await Promise.all(jobs)).flat(), km);
      if (!seqPt) return null;
      // 2. Nearest panorama image to that point (sequence lines are simplified at z12).
      const img = nearest(seqPt, await imgTile(tileX(seqPt.lon, IMG_Z), tileY(seqPt.lat, IMG_Z)), 1);
      if (!img) return null;
      // 3. Exact position and the photographer, for the reveal credit.
      const url = new URL(`${GRAPH}/${img.id}`);
      url.searchParams.set('fields', 'id,is_pano,computed_geometry,geometry,creator');
      const res = await fetchProvider('mapillary', fetchImpl, url, { headers: { Authorization: `OAuth ${token}` } });
      // Tiles lag behind deletions and privacy changes; the Graph API then answers
      // 400 "does not exist" or 404. That image is simply not usable.
      if (res.status === 400 || res.status === 404) return null;
      check(res, 'image');
      const e = (await res.json()) as MlyEntity;
      const c = e.computed_geometry?.coordinates ?? e.geometry?.coordinates;
      if (!c || e.is_pano === false) return null;
      const who = e.creator?.username;
      return { lat: c[1], lon: c[0], panoId: e.id, credit: `${who ? `${who} · ` : ''}Mapillary, CC BY-SA 4.0` };
    },
  };
}
