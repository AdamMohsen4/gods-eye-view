import { describe, expect, it } from 'vitest';
import {
  COUNTRY_CODES,
  UUID_RE,
  arcadeRemaining,
  flagEmoji,
  formatClock,
  formatDistance,
  parseShareEntry,
  secondsLeft,
  timeAgo,
  uuidFromBytes,
} from './format.ts';

describe('client format helpers', () => {
  it('formats distances', () => {
    expect(formatDistance(null)).toBe('No pin');
    expect(formatDistance(0.42)).toBe('420 m');
    expect(formatDistance(12.345)).toBe('12.3 km');
    expect(formatDistance(4321.7)).toBe('4,322 km');
  });
  it('relative time', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(timeAgo('2026-11-09T11:56:00Z', now)).toBe('4 min ago');
    expect(timeAgo('2026-11-09T06:00:00Z', now)).toBe('6 h ago');
    expect(timeAgo('2026-11-09T12:00:30Z', now)).toBe('just now');
  });
  it('timer', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(secondsLeft(null, now)).toBeNull();
    expect(secondsLeft('2026-11-09T12:00:59.2Z', now)).toBe(60);
    expect(secondsLeft('2026-11-09T11:00:00Z', now)).toBe(0);
    expect(formatClock(65)).toBe('1:05');
  });
  it('arcade allowance', () => {
    expect(arcadeRemaining({ usedToday: 2, limit: 5 })).toBe(3);
    expect(arcadeRemaining({ usedToday: 9, limit: 5 })).toBe(0);
    expect(arcadeRemaining({ usedToday: 9, limit: null })).toBeNull();
  });
  it('share entry', () => {
    expect(parseShareEntry('?ref=share&d=142')).toBe(142);
    expect(parseShareEntry('?d=142')).toBeNull();
    expect(parseShareEntry('?ref=share&d=abc')).toBeNull();
  });
  it('uuid v4', () => {
    const id = uuidFromBytes(new Uint8Array(16).fill(255));
    expect(id).toMatch(UUID_RE);
  });
  it('countries', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES).toContain('SE');
    expect(flagEmoji('SE')).toBe('🇸🇪');
    expect(flagEmoji(null)).toBe('');
  });
});
