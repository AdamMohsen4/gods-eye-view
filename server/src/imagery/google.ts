import type { LatLon } from '@earthnow/shared';
import type { FoundPano, ImageryProvider } from './types.ts';

/**
 * Google Street View metadata endpoint (no charge per request). Only
 * official Google coverage is accepted; user-uploaded photospheres are
 * skipped because they are often indoors or mislocated.
 */
export function googleProvider(key: string, fetchImpl: typeof fetch = fetch): ImageryProvider {
  return {
    id: 'google',
    async findPano(p: LatLon, radiusM: number): Promise<FoundPano | null> {
      const url = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
      url.searchParams.set('location', `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`);
      url.searchParams.set('radius', String(Math.round(radiusM)));
      url.searchParams.set('source', 'outdoor');
      url.searchParams.set('key', key);
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        status: string;
        pano_id?: string;
        location?: { lat: number; lng: number };
        copyright?: string;
        error_message?: string;
      };
      if (body.status === 'REQUEST_DENIED') throw new Error(`google: ${body.error_message ?? 'request denied'}`);
      if (body.status !== 'OK' || !body.pano_id || !body.location) return null;
      if (!/google/i.test(body.copyright ?? '')) return null;
      return { lat: body.location.lat, lon: body.location.lng, panoId: body.pano_id, credit: body.copyright ?? '© Google' };
    },
  };
}
