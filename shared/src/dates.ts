/** UTC calendar date "YYYY-MM-DD". */
export function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDate(d);
}

/** Daily #1. Move to the public launch date before launch (docs/ADR-006). */
export const DAILY_EPOCH = '2026-11-01';

export function dailyNumber(date: string): number {
  const ms = new Date(`${date}T00:00:00Z`).getTime() - new Date(`${DAILY_EPOCH}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** ISO week key "YYYY-Www", used for the weekly streak freeze. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
