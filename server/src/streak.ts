import { addDays, isoWeek, type StreakState } from '@earthnow/shared';

export interface StreakRecord {
  current: number;
  best: number;
  freezeAvailable: boolean;
  freezeWeek: string | null;
  lastCompleted: string | null;
}

export const EMPTY_STREAK: StreakRecord = { current: 0, best: 0, freezeAvailable: true, freezeWeek: null, lastCompleted: null };

/** Refill the weekly freeze when a new ISO week starts. */
function refill(s: StreakRecord, date: string): StreakRecord {
  const week = isoWeek(date);
  return s.freezeWeek === week ? s : { ...s, freezeAvailable: true, freezeWeek: week };
}

/**
 * Apply a completed Daily on `date`. One missed day is bridged by the weekly
 * freeze if it is available; otherwise the streak restarts at 1.
 */
export function completeDay(prev: StreakRecord, date: string): StreakRecord {
  if (prev.lastCompleted === date) return prev;
  const s = refill(prev, date);
  let current = 1;
  let freezeAvailable = s.freezeAvailable;
  if (s.lastCompleted === addDays(date, -1)) current = s.current + 1;
  else if (s.lastCompleted === addDays(date, -2) && s.freezeAvailable) {
    current = s.current + 1;
    freezeAvailable = false;
  }
  return { ...s, current, best: Math.max(s.best, current), freezeAvailable, lastCompleted: date };
}

/** Streak as displayed today: broken streaks show 0 without writing. */
export function displayStreak(s: StreakRecord, today: string): StreakState {
  const r = refill(s, today);
  const alive =
    r.lastCompleted !== null &&
    (r.lastCompleted >= addDays(today, -1) || (r.lastCompleted === addDays(today, -2) && r.freezeAvailable));
  return { current: alive ? r.current : 0, best: r.best, freezeAvailable: r.freezeAvailable };
}
