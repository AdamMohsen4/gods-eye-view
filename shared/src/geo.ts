import type { LatLon } from './types.ts';

export const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** WGS84 ellipsoid. */
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export function isLatLon(p: unknown): p is LatLon {
  const q = p as LatLon | null;
  return (
    !!q &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lon) &&
    q.lat >= -90 &&
    q.lat <= 90 &&
    q.lon >= -180 &&
    q.lon <= 180
  );
}

/** Great-circle distance in km (haversine; matches upstream geoDistance.js). */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Point reached travelling `distanceKm` from `from` on initial bearing `bearingDeg`. */
export function destination(from: LatLon, bearingDeg: number, distanceKm: number): LatLon {
  const δ = distanceKm / EARTH_RADIUS_KM;
  const θ = bearingDeg * D2R;
  const φ1 = from.lat * D2R;
  const λ1 = from.lon * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * R2D, lon: normalizeLon(λ2 * R2D) };
}

export function initialBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const Δλ = (b.lon - a.lon) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Geodetic (deg, metres above ellipsoid) → ECEF metres. */
export function geodeticToEcef(p: LatLon, heightM: number): [number, number, number] {
  const φ = p.lat * D2R;
  const λ = p.lon * D2R;
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(φ) ** 2);
  return [
    (N + heightM) * Math.cos(φ) * Math.cos(λ),
    (N + heightM) * Math.cos(φ) * Math.sin(λ),
    (N * (1 - WGS84_E2) + heightM) * Math.sin(φ),
  ];
}

/** ECEF metres → geodetic (Bowring's method, sub-metre accuracy). */
export function ecefToGeodetic([x, y, z]: [number, number, number]): LatLon & { heightM: number } {
  const b = WGS84_A * (1 - WGS84_F);
  const ep2 = (WGS84_A ** 2 - b ** 2) / b ** 2;
  const p = Math.hypot(x, y);
  const θ = Math.atan2(z * WGS84_A, p * b);
  const φ = Math.atan2(z + ep2 * b * Math.sin(θ) ** 3, p - WGS84_E2 * WGS84_A * Math.cos(θ) ** 3);
  const λ = Math.atan2(y, x);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(φ) ** 2);
  const heightM = p / Math.cos(φ) - N;
  return { lat: φ * R2D, lon: λ * R2D, heightM };
}

/** Approximate local solar time "HH:MM" at a longitude (used for the time clue). */
export function localSolarTime(atIso: string, lon: number): string {
  const t = new Date(atIso).getTime() + (lon / 15) * 3600_000;
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Solar elevation in degrees at a place and time (NOAA approximation, ±0.5°). */
export function sunElevationDeg(atIso: string, p: LatLon): number {
  const d = new Date(atIso);
  const jd = d.getTime() / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const λ = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const ε = (23.439 - 0.0000004 * n) * D2R;
  const δ = Math.asin(Math.sin(ε) * Math.sin(λ));
  const α = Math.atan2(Math.cos(ε) * Math.sin(λ), Math.cos(λ));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const H = ((gmst * 15 + p.lon) * D2R - α);
  const φ = p.lat * D2R;
  return Math.asin(Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H)) * R2D;
}

/**
 * How much a player can see: daylight and land give real context, a night
 * over open ocean gives none. 0–2. Used to prefer good scenes, never to
 * relax a safety filter.
 */
export function sceneQuality(atIso: string, p: LatLon, overLand: boolean): number {
  // Polar ice sheets are land but featureless, and imagery there is sparse.
  const landWithFeatures = overLand && Math.abs(p.lat) < 62;
  return (landWithFeatures ? 1 : 0) + (sunElevationDeg(atIso, p) > 8 ? 1 : 0);
}
