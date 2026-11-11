import type { LatLon } from './types.ts';

export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function isLatLon(p: unknown): p is LatLon {
  const q = p as LatLon | null;
  return (
    !!q &&
    typeof q === 'object' &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lon) &&
    q.lat >= -90 &&
    q.lat <= 90 &&
    q.lon >= -180 &&
    q.lon <= 180
  );
}

/** Great-circle distance in km. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point reached travelling `distanceKm` from `from` on bearing `bearingDeg`. */
export function destination(from: LatLon, bearingDeg: number, distanceKm: number): LatLon {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = bearingDeg * D2R;
  const φ1 = from.lat * D2R;
  const λ1 = from.lon * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * R2D, lon: normalizeLon(λ2 * R2D) };
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Bounding-box diagonal of a set of points in km (the map's "size"). */
export function spreadKm(points: LatLon[]): number {
  if (points.length < 2) return 0;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return haversineKm({ lat: minLat, lon: minLon }, { lat: maxLat, lon: maxLon });
}

export function formatDistance(km: number | null): string {
  if (km === null) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
}
