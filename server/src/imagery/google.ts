import type { LatLon } from '@earthnow/shared';
import { ImageryError, fetchProvider, type FoundPano, type ImageryProvider } from './types.ts';

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
      const res = await fetchProvider('google', fetchImpl, url);
      if (!res.ok) throw new ImageryError(`google: HTTP ${res.status}`, res.status === 429 || res.status >= 500 ? 'retryable' : 'request');
      const body = (await res.json()) as {
        status: string;
        pano_id?: string;
        location?: { lat: number; lng: number };
        copyright?: string;
        error_message?: string;
      };
      // https://developers.google.com/maps/documentation/streetview/metadata#status-codes
      if (body.status === 'ZERO_RESULTS' || body.status === 'NOT_FOUND') return null;
      if (body.status === 'REQUEST_DENIED') throw new ImageryError(`google: ${body.error_message ?? 'request denied'}`, 'auth');
      if (body.status === 'OVER_QUERY_LIMIT' || body.status === 'UNKNOWN_ERROR') throw new ImageryError(`google: ${body.status}`, 'retryable');
      if (body.status !== 'OK') throw new ImageryError(`google: ${body.status} ${body.error_message ?? ''}`, 'request');
      if (!body.pano_id || !body.location) return null;
      if (!/google/i.test(body.copyright ?? '')) return null;
      return { lat: body.location.lat, lon: body.location.lng, panoId: body.pano_id, credit: body.copyright ?? '© Google' };
    },
  };
}
