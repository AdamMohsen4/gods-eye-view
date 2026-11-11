import { describe, expect, it } from 'vitest';
import { dailyNumber, duelMultiplier, elo, haversineKm, levelFor, scoreGuess, seededRandom, shareText, spreadKm } from './index.ts';

describe('scoring', () => {
  it('gives 5000 inside 25 m and decays with distance', () => {
    expect(scoreGuess(0.01, 18000)).toBe(5000);
    expect(scoreGuess(0, 18000)).toBe(5000);
    const a = scoreGuess(100, 18000);
    const b = scoreGuess(1000, 18000);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(2500);
    expect(scoreGuess(1000, 1500)).toBeLessThan(10);
    expect(scoreGuess(null, 1000)).toBe(0);
  });
  it('levels up quadratically', () => {
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(60).level).toBe(2);
    expect(levelFor(239).level).toBe(2);
    expect(levelFor(240).level).toBe(3);
  });
  it('escalates duel damage from round 4', () => {
    expect([0, 1, 2, 3, 4].map(duelMultiplier)).toEqual([1, 1, 1, 1.5, 2]);
  });
  it('elo is zero-sum', () => {
    const [a, b] = elo(1000, 1000, 1);
    expect(a).toBe(1016);
    expect(b).toBe(984);
  });
});

describe('geo + misc', () => {
  it('measures Stockholm → Gothenburg ~ 398 km', () => {
    expect(haversineKm({ lat: 59.3293, lon: 18.0686 }, { lat: 57.7089, lon: 11.9746 })).toBeCloseTo(398, -1);
  });
  it('spread of a single point is 0', () => {
    expect(spreadKm([{ lat: 1, lon: 1 }])).toBe(0);
  });
  it('numbers dailies from the epoch', () => {
    expect(dailyNumber('2026-11-10')).toBe(1);
    expect(dailyNumber('2026-11-12')).toBe(3);
  });
  it('seeded random is deterministic', () => {
    expect(seededRandom('x')()).toBe(seededRandom('x')());
  });
  it('share text has no locations', () => {
    const t = shareText({ title: 'Earthnow Daily #3', total: 12000, scores: [5000, 4000, 2000, 1000, 0], url: 'https://x/y' });
    expect(t).toContain('🟩🟨🟧🟥🟥');
    expect(t).toContain('12,000 / 25,000');
  });
});
