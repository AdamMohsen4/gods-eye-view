/** YYYY-MM-DD in UTC. */
export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcDate(d);
}

/** Daily #1 is the launch date; numbering never skips. */
export const DAILY_EPOCH = '2026-11-10';

export function dailyNumber(date: string): number {
  const ms = new Date(`${date}T00:00:00Z`).getTime() - new Date(`${DAILY_EPOCH}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}
