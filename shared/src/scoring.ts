import type { RoundType } from './types.ts';

export const MAX_ROUND_SCORE = 5000;

/** Distance scale s (km) per round type. Tune so the median round scores ~2,500. */
export const SCORE_SCALE_KM: Record<RoundType, number> = {
  flight: 1500,
  quake: 1000,
  fire: 1000,
  satellite: 2000,
};

/** score = 5000 · e^(−d/s) · (1 − 0.1·h), rounded to an integer. */
export function scoreRound(type: RoundType, distanceKm: number | null, cluesUsed: number): number {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  const h = Math.max(0, Math.min(3, Math.floor(cluesUsed)));
  const raw = MAX_ROUND_SCORE * Math.exp(-distanceKm / SCORE_SCALE_KM[type]) * (1 - 0.1 * h);
  return Math.round(raw);
}

export type ScoreBand = 'green' | 'yellow' | 'red';

export function scoreBand(score: number): ScoreBand {
  if (score >= 3500) return 'green';
  if (score >= 1500) return 'yellow';
  return 'red';
}
