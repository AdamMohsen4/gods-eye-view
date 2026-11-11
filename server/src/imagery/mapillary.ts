import { haversineKm, type LatLon } from '@earthnow/shared';
import type { FoundPano, ImageryProvider } from './types.ts';

interface MlyImage {
  id: string;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  compass_angle?: number;
  creator?: { username?: string };
}

/**
 * Mapillary Graph API. Imagery is CC BY-SA 4.0: the reveal names the
 * photographer. Only 360° panoramas are used so players can look around.
 */
export function mapillaryProvider(token: string, fetchImpl: typeof fetch = fetch): ImageryProvider {
  return {
    id: 'mapillary',
    async findPano(p: LatLon, radiusM: number): Promise<FoundPano | null> {
      const r = Math.min(radiusM, 1500);
      const dLat = r / 111_320;
      const dLon = r / (111_320 * Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)));
      const bbox = [p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat].map((n) => n.toFixed(6)).join(',');
      const url = new URL('https://graph.mapillary.com/images');
      url.searchParams.set('access_token', token);
      url.searchParams.set('fields', 'id,computed_geometry,geometry,compass_angle,creator');
      url.searchParams.set('bbox', bbox);
      url.searchParams.set('is_pano', 'true');
      url.searchParams.set('limit', '25');
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 || res.status === 403) throw new Error(`mapillary: token rejected (${res.status})`);
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: MlyImage[] };
      let best: FoundPano | null = null;
      let bestD = Infinity;
      for (const img of body.data ?? []) {
        const c = img.computed_geometry?.coordinates ?? img.geometry?.coordinates;
        if (!c) continue;
        const q = { lat: c[1], lon: c[0] };
        const d = haversineKm(p, q);
        if (d < bestD) {
          bestD = d;
          const who = img.creator?.username;
          best = { ...q, panoId: img.id, credit: `${who ? `${who} · ` : ''}Mapillary, CC BY-SA 4.0` };
        }
      }
      return best;
    },
  };
}
