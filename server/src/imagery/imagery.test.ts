import Pbf from 'pbf';
import { describe, expect, it } from 'vitest';
import { googleProvider } from './google.ts';
import { mapillaryProvider } from './mapillary.ts';
import { ImageryError } from './types.ts';

/** A fetch that records requests and answers with a canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const f = (async (url: URL, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}


// ---- A minimal Mapbox Vector Tile encoder, enough for the coverage layers. ----
type TileFeature = { props: Record<string, string | number | boolean>; pts: [number, number][] };
const EXTENT = 4096;
const zig = (n: number) => (n << 1) ^ (n >> 31);
function lonLatToTile(lon: number, lat: number, z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n;
  return [Math.round((fx - x) * EXTENT), Math.round((fy - y) * EXTENT)];
}
function tileOf(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)];
}
function encodeTile(layer: string, z: number, x: number, y: number, feats: { props: TileFeature['props']; at: [number, number][] }[]): Uint8Array {
  const pbf = new Pbf();
  pbf.writeMessage(3, (_: unknown, p: Pbf) => {
    p.writeVarintField(15, 2);
    p.writeStringField(1, layer);
    const keys: string[] = [];
    const values: (string | number | boolean)[] = [];
    const idx = <T>(arr: T[], v: T) => (arr.includes(v) ? arr.indexOf(v) : arr.push(v) - 1);
    for (const f of feats) {
      const pts = f.at.map(([lon, lat]) => lonLatToTile(lon, lat, z, x, y));
      p.writeMessage(2, (_: unknown, q: Pbf) => {
        const tags: number[] = [];
        for (const [k, v] of Object.entries(f.props)) tags.push(idx(keys, k), idx(values, v));
        q.writePackedVarint(2, tags);
        q.writeVarintField(3, pts.length > 1 ? 2 : 1);
        const geom: number[] = [];
        let cx = 0;
        let cy = 0;
        pts.forEach(([px, py], i) => {
          if (i === 0) geom.push(1 | (1 << 3));
          if (i === 1) geom.push(2 | ((pts.length - 1) << 3));
          geom.push(zig(px - cx), zig(py - cy));
          cx = px;
          cy = py;
        });
        q.writePackedVarint(4, geom);
      }, null);
    }
    for (const k of keys) p.writeStringField(3, k);
    for (const v of values)
      p.writeMessage(4, (_: unknown, q: Pbf) => {
        if (typeof v === 'string') q.writeStringField(1, v);
        else if (typeof v === 'boolean') q.writeBooleanField(7, v);
        else q.writeVarintField(5, v);
      }, null);
    p.writeVarintField(5, EXTENT);
  }, null);
  return pbf.finish();
}

const STOCKHOLM = { lat: 59.3293, lon: 18.0686 };

/** Fake Mapillary: coverage tiles built from a list of panoramas, plus the Graph entity endpoint. */
function fakeMapillary(images: { id: string; lon: number; lat: number; pano: boolean; seq?: string; user?: string }[], override?: (url: URL) => Response | undefined) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const f = (async (url: URL, init?: RequestInit) => {
    calls.push({ url, init });
    const o = override?.(url);
    if (o) return o;
    if (url.hostname === 'tiles.mapillary.com') {
      const [z, x, y] = url.pathname.split('/').slice(-3).map(Number) as [number, number, number];
      const inTile = images.filter((i) => tileOf(i.lon, i.lat, z).join() === `${x},${y}`);
      const props = (i: (typeof images)[number]) => ({ id: i.id, is_pano: i.pano, sequence_id: i.seq ?? `s-${i.id}` });
      const body =
        z === 12
          ? encodeTile('sequence', z, x, y, inTile.map((i) => ({ props: { ...props(i), image_id: i.id }, at: [[i.lon, i.lat], [i.lon + 0.0001, i.lat]] })))
          : encodeTile('image', z, x, y, inTile.map((i) => ({ props: props(i), at: [[i.lon, i.lat]] })));
      return new Response(body, { status: 200 });
    }
    const id = url.pathname.slice(1);
    const img = images.find((i) => i.id === id);
    if (!img) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ id, is_pano: img.pano, computed_geometry: { type: 'Point', coordinates: [img.lon, img.lat] }, creator: img.user ? { username: img.user } : undefined }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('mapillary provider (coverage tiles + Graph API)', () => {
  it('finds the nearest 360° panorama, ignoring flat photos, and credits the photographer', async () => {
    const { f, calls } = fakeMapillary([
      { id: 'flat', lon: 18.0687, lat: 59.3293, pano: false },
      { id: 'near', lon: 18.07, lat: 59.33, pano: true, user: 'kim' },
      { id: 'far', lon: 18.09, lat: 59.335, pano: true },
    ]);
    const found = await mapillaryProvider('MLY|tok', f).findPano(STOCKHOLM, 1000);
    expect(found).toEqual({ lat: 59.33, lon: 18.07, panoId: 'near', credit: 'kim · Mapillary, CC BY-SA 4.0' });
    const tiles = calls.filter((c) => c.url.hostname === 'tiles.mapillary.com');
    expect(tiles.map((c) => c.url.pathname.split('/').at(-3))).toEqual(expect.arrayContaining(['12', '14']));
    // Tiles take the token as a query parameter; the Graph API gets it in the header.
    expect(tiles[0]!.url.searchParams.get('access_token')).toBe('MLY|tok');
    const graph = calls.find((c) => c.url.hostname === 'graph.mapillary.com')!;
    expect(graph.url.pathname).toBe('/near');
    expect(graph.url.searchParams.get('access_token')).toBeNull();
    expect((graph.init!.headers as Record<string, string>).Authorization).toBe('OAuth MLY|tok');
  });

  it('respects the radius and returns null without a Graph call when nothing is in range', async () => {
    const { f, calls } = fakeMapillary([{ id: 'p', lon: 18.12, lat: 59.33, pano: true }]); // ~3 km east
    expect(await mapillaryProvider('t', f).findPano(STOCKHOLM, 1000)).toBeNull();
    expect(calls.some((c) => c.url.hostname === 'graph.mapillary.com')).toBe(false);
    expect(await mapillaryProvider('t', f).findPano(STOCKHOLM, 5000)).toMatchObject({ panoId: 'p' });
  });

  it('skips an image the tiles list but the Graph API no longer has', async () => {
    for (const code of [400, 404]) {
      const { f } = fakeMapillary([{ id: 'gone', lon: 18.07, lat: 59.33, pano: true }], (u) => (u.hostname === 'graph.mapillary.com' ? new Response('{"error":{"message":"does not exist"}}', { status: code }) : undefined));
      expect(await mapillaryProvider('t', f).findPano(STOCKHOLM, 1000)).toBeNull();
    }
  });

  it('caps the tiles fetched for a huge radius and caches tiles between searches', async () => {
    const { f, calls } = fakeMapillary([]);
    const m = mapillaryProvider('t', f);
    await m.findPano({ lat: 67.85, lon: 20.22 }, 50_000);
    expect(calls.length).toBeLessThanOrEqual(16);
    const n = calls.length;
    await m.findPano({ lat: 67.85, lon: 20.22 }, 50_000);
    expect(calls.length).toBe(n);
  });

  it('throws typed errors for failures and does not cache a failed tile', async () => {
    const status = (code: number) => () => fakeMapillary([], (u) => (u.hostname === 'tiles.mapillary.com' ? new Response('x', { status: code }) : undefined)).f;
    await expect(mapillaryProvider('t', status(401)()).findPano(STOCKHOLM, 500)).rejects.toMatchObject({ kind: 'auth' });
    await expect(mapillaryProvider('t', status(500)()).findPano(STOCKHOLM, 500)).rejects.toMatchObject({ kind: 'retryable' });
    await expect(mapillaryProvider('t', status(429)()).findPano(STOCKHOLM, 500)).rejects.toMatchObject({ kind: 'retryable' });
    await expect(mapillaryProvider('t', status(400)()).findPano(STOCKHOLM, 500)).rejects.toBeInstanceOf(ImageryError);
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(mapillaryProvider('t', boom).findPano(STOCKHOLM, 500)).rejects.toMatchObject({ kind: 'retryable' });
    // An error message never carries the tile URL (which holds the token).
    await mapillaryProvider('SECRET', status(500)()).findPano(STOCKHOLM, 500).catch((e: Error) => expect(e.message).not.toContain('SECRET'));

    let fail = true;
    const { f } = fakeMapillary([{ id: 'p', lon: 18.07, lat: 59.33, pano: true }], (u) => (fail && u.hostname === 'tiles.mapillary.com' ? new Response('x', { status: 503 }) : undefined));
    const m = mapillaryProvider('t', f);
    await expect(m.findPano(STOCKHOLM, 1000)).rejects.toMatchObject({ kind: 'retryable' });
    fail = false;
    expect(await m.findPano(STOCKHOLM, 1000)).toMatchObject({ panoId: 'p' });
  });
});

describe('google provider (Street View metadata contract)', () => {
  it('sends location, radius, source=outdoor and key; accepts official coverage', async () => {
    const { f, calls } = fakeFetch(200, { status: 'OK', pano_id: 'CAoSabc', location: { lat: 59.33, lng: 18.07 }, copyright: '© 2025 Google' });
    const found = await googleProvider('key', f).findPano(STOCKHOLM, 300);
    expect(found).toEqual({ lat: 59.33, lon: 18.07, panoId: 'CAoSabc', credit: '© 2025 Google' });
    const u = calls[0]!.url;
    expect(u.pathname).toBe('/maps/api/streetview/metadata');
    expect(u.searchParams.get('source')).toBe('outdoor');
    expect(u.searchParams.get('radius')).toBe('300');
    expect(u.searchParams.get('location')).toBe('59.329300,18.068600');
  });

  it('maps every documented status', async () => {
    const run = (body: unknown, status = 200) => googleProvider('k', fakeFetch(status, body).f).findPano(STOCKHOLM, 100);
    expect(await run({ status: 'ZERO_RESULTS' })).toBeNull();
    expect(await run({ status: 'NOT_FOUND' })).toBeNull();
    expect(await run({ status: 'OK', pano_id: 'x', location: { lat: 1, lng: 1 }, copyright: '© Jane Doe' })).toBeNull();
    await expect(run({ status: 'REQUEST_DENIED', error_message: 'bad key' })).rejects.toMatchObject({ kind: 'auth' });
    await expect(run({ status: 'OVER_QUERY_LIMIT' })).rejects.toMatchObject({ kind: 'retryable' });
    await expect(run({ status: 'UNKNOWN_ERROR' })).rejects.toMatchObject({ kind: 'retryable' });
    await expect(run({ status: 'INVALID_REQUEST' })).rejects.toMatchObject({ kind: 'request' });
    await expect(run({}, 503)).rejects.toMatchObject({ kind: 'retryable' });
  });
});
