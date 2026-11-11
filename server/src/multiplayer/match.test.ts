import { describe, expect, it } from 'vitest';
import type { MapSummary, MatchState } from '@earthnow/shared';
import { Match, type MatchDeps, type MatchLocation, type MatchResult } from './match.ts';

const MAP: MapSummary = { id: 'm', slug: 'world', name: 'World', description: '', kind: 'official', creatorName: null, locationCount: 10, scaleKm: 15000, plays: 0 };

function harness() {
  let t = 0;
  const timers: { at: number; fn: () => void; dead: boolean }[] = [];
  const states: MatchState[] = [];
  const results: MatchResult[] = [];
  let n = 0;
  const deps: MatchDeps = {
    now: () => t,
    schedule: (fn, ms) => {
      const timer = { at: t + ms, fn, dead: false };
      timers.push(timer);
      return () => (timer.dead = true);
    },
    pickLocation: async (): Promise<MatchLocation> => {
      n++;
      return { id: `l${n}`, lat: 59.33, lon: 18.06, pano: { provider: 'fixture', panoId: `p${n}`, heading: 0 }, country: { code: 'SE', name: 'Sweden' }, credit: null };
    },
    publish: (s) => states.push(structuredClone(s)),
    finish: async (r) => {
      results.push(r);
      return {};
    },
  };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      t = next.at;
      next.dead = true;
      next.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
    t = end;
  };
  return { deps, states, results, advance, last: () => states[states.length - 1]! };
}

const STOCKHOLM = { lat: 59.33, lon: 18.06 };
const MADRID = { lat: 40.4, lon: -3.7 };
const OSLO = { lat: 59.91, lon: 10.75 };

describe('duel', () => {
  it('hides the answer and others\' guesses until the reveal, then deals damage', async () => {
    const h = harness();
    const m = new Match('x', 'duel', true, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, [
      { id: 'a', name: 'A', country: null, rating: 1000 },
      { id: 'b', name: 'B', country: null, rating: 1000 },
    ], h.deps);
    m.start();
    expect(h.last().phase).toBe('starting');
    await h.advance(5000);
    expect(h.last().phase).toBe('round');
    m.guess('a', STOCKHOLM);
    const during = h.last();
    expect(during.round!.guessed).toEqual(['a']);
    expect(JSON.stringify(during)).not.toContain('59.33');
    // First guess starts the 15 s countdown.
    expect(new Date(during.round!.endsAt!).getTime()).toBe(5000 + 15_000);
    await h.advance(17_000);
    const rev = h.last();
    // The knockout round goes straight to finished, carrying its reveal.
    expect(rev.phase).toBe('finished');
    const b = rev.reveal!.guesses.find((g) => g.playerId === 'b')!;
    expect(b.guess).toBeNull();
    expect(b.damage).toBe(5000);
    expect(rev.players.find((p) => p.id === 'b')!.hp).toBe(0);
    await h.advance(10);
    expect(h.results[0]!.winnerId).toBe('a');
  });

  it('ends a round as soon as both guessed and escalates the multiplier', async () => {
    const h = harness();
    const m = new Match('x', 'duel', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, [
      { id: 'a', name: 'A', country: null, rating: 1000 },
      { id: 'b', name: 'B', country: null, rating: 1000 },
    ], h.deps);
    m.start();
    await h.advance(5000);
    const mults: number[] = [];
    for (let i = 0; i < 6 && m.phase !== 'finished'; i++) {
      mults.push(h.last().round!.multiplier);
      m.guess('a', STOCKHOLM);
      m.guess('b', OSLO);
      expect(h.last().phase).toMatch(/reveal|finished/);
      await h.advance(8000);
    }
    expect(mults.slice(0, 4)).toEqual([1, 1, 1, 1.5]);
    expect(m.phase).toBe('finished');
  });

  it('forfeits on leave', async () => {
    const h = harness();
    const m = new Match('x', 'duel', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, [
      { id: 'a', name: 'A', country: null, rating: 1000 },
      { id: 'b', name: 'B', country: null, rating: 1000 },
    ], h.deps);
    m.start();
    await h.advance(5000);
    m.leave('b');
    await h.advance(1);
    expect(h.results[0]!.winnerId).toBe('a');
  });
});

describe('party (classic)', () => {
  it('runs the set number of rounds and ranks by total', async () => {
    const h = harness();
    const m = new Match('x', 'classic', false, MAP, { move: 'move', timeLimit: 30, rounds: 3 }, [
      { id: 'a', name: 'A', country: null, rating: 1000 },
      { id: 'b', name: 'B', country: null, rating: 1000 },
      { id: 'c', name: 'C', country: null, rating: 1000 },
    ], h.deps);
    m.start();
    await h.advance(5000);
    for (let i = 0; i < 3; i++) {
      m.guess('a', STOCKHOLM);
      m.guess('b', MADRID);
      // c never guesses: the 30 s timer closes the round.
      await h.advance(32_000);
      await h.advance(8000);
    }
    expect(m.phase).toBe('finished');
    const final = h.last();
    expect(final.history).toHaveLength(3);
    expect(h.results[0]!.winnerId).toBe('a');
    expect(final.players.find((p) => p.id === 'c')!.total).toBe(0);
  });

  it('does not wait for disconnected players', async () => {
    const h = harness();
    const m = new Match('x', 'classic', false, MAP, { move: 'move', timeLimit: 0, rounds: 2 }, [
      { id: 'a', name: 'A', country: null, rating: 1000 },
      { id: 'b', name: 'B', country: null, rating: 1000 },
    ], h.deps);
    m.start();
    await h.advance(5000);
    m.guess('a', STOCKHOLM);
    expect(h.last().phase).toBe('round');
    m.setConnected('b', false);
    expect(h.last().phase).toBe('reveal');
  });
});
