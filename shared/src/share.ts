import { scoreBand } from './scoring.ts';

const BAND_EMOJI = { great: '🟩', good: '🟨', fair: '🟧', poor: '🟥' } as const;

/** Spoiler-free share text for a 5-round game. */
export function shareText(opts: { title: string; total: number; scores: number[]; url: string }): string {
  const row = opts.scores.map((s) => BAND_EMOJI[scoreBand(s)]).join('');
  return `${opts.title} · ${opts.total.toLocaleString('en-US')} / ${(opts.scores.length * 5000).toLocaleString('en-US')}\n${row}\n${opts.url}`;
}
