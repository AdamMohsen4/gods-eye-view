/**
 * Warm the browser cache with the imagery tiles the NEXT round will need,
 * while the player is busy with the current one. Esri tiles are cacheable
 * (max-age 1 day), so Cesium then gets them from cache instantly.
 */
import { subjectGeo, type LatLon, type PublicRound } from '@earthnow/shared';

const ESRI_TILE = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

/** Web Mercator tile containing a point at zoom z. */
export function tileXY(p: LatLon, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat)) * (Math.PI / 180);
  const x = Math.floor(((p.lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Tile URLs around a point: a 3×3 block per zoom level. */
export function tileUrls(p: LatLon, zooms: number[]): string[] {
  const urls: string[] = [];
  for (const z of zooms) {
    const n = 2 ** z;
    const { x, y } = tileXY(p, z);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const ty = y + dy;
        if (ty < 0 || ty >= n) continue;
        urls.push(`${ESRI_TILE}/${z}/${ty}/${(((x + dx) % n) + n) % n}`);
      }
  }
  return urls;
}

/** Zoom levels worth warming for the opening view of a round type. */
const ZOOMS: Record<PublicRound['type'], number[]> = {
  flight: [7, 8, 9, 10, 11, 12],
  satellite: [5, 6, 7, 8, 9],
  quake: [6, 7, 8, 9, 10, 11],
  fire: [8, 9, 10, 11, 12, 13],
};

const warmed = new Set<string>();

export function prefetchRound(round: PublicRound): void {
  if (String(import.meta.env.VITE_IMAGERY ?? 'esri') !== 'esri') return;
  if (warmed.has(round.snapshotId)) return;
  // Respect data-saver and slow connections.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return;
  warmed.add(round.snapshotId);
  const at = subjectGeo(round.camera, round.subject);
  const urls = tileUrls(at, ZOOMS[round.type]);
  let i = 0;
  // Four at a time so it never crowds out the round being played.
  const next = (): void => {
    const url = urls[i++];
    if (!url) return;
    fetch(url, { mode: 'cors', credentials: 'omit', priority: 'low' } as RequestInit)
      .catch(() => undefined)
      .finally(next);
  };
  for (let k = 0; k < 4; k++) next();
}
