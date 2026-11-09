import { destination, haversineKm, initialBearing, type LatLon, type RoundType } from '@earthnow/shared';

const D2R = Math.PI / 180;

/**
 * How far a player may roam during a round. They can pan, zoom and tilt
 * freely to build context, but stay on a leash around the scene so they
 * cannot simply zoom out to the whole globe. Heights are metres above the
 * ellipsoid; leash is km from the scene's anchor point.
 */
export const ROUND_LIMITS: Record<RoundType, { maxHeightM: number; leashKm: number }> = {
  flight: { maxHeightM: 120_000, leashKm: 200 },
  satellite: { maxHeightM: 160_000, leashKm: 250 },
  quake: { maxHeightM: 120_000, leashKm: 200 },
  fire: { maxHeightM: 80_000, leashKm: 150 },
};
export const MIN_HEIGHT_M = 300;

/** Pull a camera ground point back onto the leash circle if it strayed. */
export function leash(anchor: LatLon, at: LatLon, leashKm: number): LatLon | null {
  const d = haversineKm(anchor, at);
  if (d <= leashKm) return null;
  return destination(anchor, initialBearing(anchor, at), leashKm);
}

/** Field-of-view limits (used by the reveal and tests). */
export const MIN_FOV_DEG = 18;
export const MAX_FOV_DEG = 75;
export const MIN_PITCH = -89 * D2R;
export const MAX_PITCH = 25 * D2R;

export function clampFov(deg: number): number {
  if (!Number.isFinite(deg)) return 60;
  return Math.min(MAX_FOV_DEG, Math.max(MIN_FOV_DEG, deg));
}

export function clampPitch(rad: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, rad));
}

/** Cesium resolutionScale that caps the drawing buffer at 1.5 device pixels per CSS pixel. */
export function renderScale(devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, 1.5);
}

/** Camera height for the reveal so guess and truth both fit on screen. */
export function revealHeightM(guess: LatLon | null, truth: LatLon): number {
  if (!guess) return 3_000_000;
  const km = haversineKm(guess, truth);
  return Math.min(14_000_000, Math.max(600_000, km * 1000 * 1.7));
}

/**
 * Where the reveal camera ends up: over the midpoint of pin and truth, high
 * enough to show both. On phones the fact card covers the lower part of the
 * screen, so the camera moves south and the two points sit in the top half.
 */
export function revealView(guess: LatLon | null, truth: LatLon, compact: boolean): LatLon & { height: number } {
  // Phones only have the top ~55% of the screen free, so pull back further.
  const height = compact && guess ? Math.min(14_000_000, revealHeightM(guess, truth) * 1.6) : revealHeightM(guess, truth);
  const mid = guess ? destination(guess, initialBearing(guess, truth), haversineKm(guess, truth) / 2) : truth;
  if (!compact) {
    // Desktop: the fact card sits on the right, so move the camera east and
    // the two points drift into the left part of the screen.
    const eastKm = (2 * height * Math.tan(Math.PI / 6) * 0.3) / 1000;
    return { ...destination(mid, 90, eastKm), height };
  }
  // Visible ground span ≈ 2·h·tan(30°); shift by ~22% of it.
  const shiftKm = (2 * height * Math.tan(Math.PI / 6) * 0.22) / 1000;
  const lat = Math.max(-85, mid.lat - shiftKm / 111.2);
  return { lat, lon: mid.lon, height };
}
