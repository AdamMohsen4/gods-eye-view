import type { LatLon } from '@earthnow/shared';

export function pinEl(kind: 'guess' | 'truth' | 'player', label?: string, color?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `pin pin-${kind}`;
  if (color) el.style.setProperty('--pin', color);
  if (label) {
    const s = document.createElement('span');
    s.textContent = label;
    el.appendChild(s);
  }
  return el;
}

/** Shift `b` by ±360° so a line from `a` takes the short way across the antimeridian. */
export function nearLon(a: LatLon, b: LatLon): LatLon {
  let lon = b.lon;
  while (lon - a.lon > 180) lon -= 360;
  while (lon - a.lon < -180) lon += 360;
  return { lat: b.lat, lon };
}

export const PLAYER_COLORS = ['#ff6b35', '#3b82c4', '#c2410c', '#7c5cbf', '#2f9e6b', '#d6336c', '#b08900', '#0e7c86'];
