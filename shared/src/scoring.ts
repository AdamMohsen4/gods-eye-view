export const MAX_ROUND_SCORE = 5000;
/** Guesses this close count as perfect, in km. */
export const PERFECT_KM = 0.025;

/**
 * score = 5000 · e^(−10·d / scale). `scale` is the map's size in km (its
 * bounding diagonal), so a 1,000 km miss is harsh on Sweden and gentle on
 * the whole world.
 */
export function scoreGuess(distanceKm: number | null, scaleKm: number): number {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  if (distanceKm <= PERFECT_KM) return MAX_ROUND_SCORE;
  const s = Math.max(50, scaleKm);
  return Math.round(MAX_ROUND_SCORE * Math.exp((-10 * distanceKm) / s));
}

export type ScoreBand = 'great' | 'good' | 'fair' | 'poor';

export function scoreBand(score: number): ScoreBand {
  if (score >= 4500) return 'great';
  if (score >= 3000) return 'good';
  if (score >= 1500) return 'fair';
  return 'poor';
}

/* -------------------------------- levels -------------------------------- */

/** XP needed to reach level n (n ≥ 1): 60·(n−1)². */
export function xpForLevel(n: number): number {
  return 60 * (n - 1) ** 2;
}

export function levelFor(xp: number) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return { level, xp, floor: xpForLevel(level), next: xpForLevel(level + 1) };
}

/** XP for one revealed round: 1 per 100 points, +5 for a perfect. */
export function xpForRound(score: number): number {
  return Math.floor(score / 100) + (score === MAX_ROUND_SCORE ? 5 : 0);
}

/* --------------------------------- duels -------------------------------- */

export const DUEL_HP = 5000;

/** Damage multiplier for a duel round (0-based): ×1 for rounds 1–3, then +0.5 each round. */
export function duelMultiplier(roundIndex: number): number {
  return roundIndex < 3 ? 1 : 1 + 0.5 * (roundIndex - 2);
}

/** Elo with K=32. Returns the new ratings [a, b]; `aScore` is 1 win, 0 loss, 0.5 draw. */
export function elo(a: number, b: number, aScore: number, k = 32): [number, number] {
  const ea = 1 / (1 + 10 ** ((b - a) / 400));
  const delta = Math.round(k * (aScore - ea));
  return [a + delta, b - delta];
}
