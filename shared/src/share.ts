import type { RoundType } from './types.ts';
import { scoreBand } from './scoring.ts';

export const TYPE_EMOJI: Record<RoundType, string> = {
  flight: '✈️',
  satellite: '🛰️',
  fire: '🔥',
  quake: '🌋',
};

const BAND_EMOJI = { green: '🟩', yellow: '🟨', red: '🟥' } as const;

export interface ShareRound {
  type: RoundType;
  score: number;
}

/** Spoiler-free share text. One emoji row per round. */
export function buildShareText(dailyNumber: number, rounds: ShareRound[], link: string): string {
  const total = rounds.reduce((s, r) => s + r.score, 0);
  const rows = rounds.map((r) => `${TYPE_EMOJI[r.type]} ${BAND_EMOJI[scoreBand(r.score)]}`);
  return [`Earthnow #${dailyNumber} · ${total.toLocaleString('en-US')} 🌍`, ...rows, link].join('\n');
}
