import { describe, expect, it } from 'vitest';
import type { MapSummary, MatchState } from '@earthnow/shared';
import { Match, type MatchDeps, type MatchLocation, type MatchResult } from './match.ts';

const MAP: MapSummary = { id: 'm', slug: 'world', name: 'World', description: '', kind: 'official', creatorName: null, locationCount: 10, scaleKm: 15000, plays: 0, countries: [], bounds: null };

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

describe('robustness', () => {
  const duo = [
    { id: 'a', name: 'A', country: null, rating: 1000 },
    { id: 'b', name: 'B', country: null, rating: 1000 },
  ];

  it('finishes cleanly when the map runs out of places instead of crashing', async () => {
    const h = harness();
    let calls = 0;
    const errors: unknown[] = [];
    h.deps.pickLocation = async () => {
      calls++;
      if (calls > 1) throw new Error('map_exhausted');
      return { id: 'l1', lat: 1, lon: 1, pano: { provider: 'fixture', panoId: 'p1', heading: 0 }, country: null, credit: null };
    };
    h.deps.log = (_m, e) => errors.push(e);
    const m = new Match('x', 'classic', false, MAP, { move: 'move', timeLimit: 0, rounds: 5 }, duo, h.deps);
    m.start();
    await h.advance(5000);
    m.guess('a', STOCKHOLM);
    m.guess('b', OSLO);
    await h.advance(8000);
    expect(h.last().phase).toBe('finished');
    expect(h.results).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('a failed save is logged, never thrown, and players still get the result', async () => {
    const h = harness();
    const errors: unknown[] = [];
    h.deps.finish = async () => {
      throw new Error('fk violation');
    };
    h.deps.log = (_m, e) => errors.push(e);
    const m = new Match('x', 'duel', true, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, duo, h.deps);
    m.start();
    await h.advance(5000);
    m.leave('b');
    await h.advance(10);
    expect(h.last().phase).toBe('finished');
    expect(h.last().result!.winnerId).toBe('a');
    expect(errors).toHaveLength(1);
  });

  it('does not come back to life if it ends while a location is being picked', async () => {
    const h = harness();
    let release: (() => void) | null = null;
    h.deps.pickLocation = () =>
      new Promise((resolve) => {
        release = () => resolve({ id: 'l1', lat: 1, lon: 1, pano: { provider: 'fixture', panoId: 'p1', heading: 0 }, country: null, credit: null });
      });
    const m = new Match('x', 'duel', true, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, duo, h.deps);
    m.start();
    await h.advance(5000);
    m.leave('b');
    release!();
    await h.advance(10);
    expect(h.last().phase).toBe('finished');
    expect(h.results).toHaveLength(1);
  });

  it('a duel where both players vanish has no winner and is not ranked', async () => {
    const h = harness();
    const m = new Match('x', 'duel', true, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, duo, h.deps);
    m.start();
    await h.advance(5000);
    m.setConnected('a', false);
    m.setConnected('b', false);
    await h.advance(46_000);
    expect(h.last().phase).toBe('finished');
    expect(h.results[0]!.winnerId).toBeNull();
    expect(h.results[0]!.ranked).toBe(false);
  });

  it('a party round without a time limit shows no clock but still ends after the cap', async () => {
    const h = harness();
    const m = new Match('x', 'classic', false, MAP, { move: 'move', timeLimit: 0, rounds: 2 }, duo, h.deps);
    m.start();
    await h.advance(5000);
    expect(h.last().round!.endsAt).toBeNull();
    m.guess('a', STOCKHOLM);
    await h.advance(601_000 + 2000);
    expect(h.last().phase).toBe('reveal');
    expect(h.last().reveal!.guesses.find((g) => g.playerId === 'b')!.guess).toBeNull();
  });
});

describe('teams', () => {
  const players = [
    { id: 'a', name: 'A', country: null, rating: 1000, team: 0 },
    { id: 'b', name: 'B', country: null, rating: 1000, team: 0 },
    { id: 'c', name: 'C', country: null, rating: 1000, team: 1 },
  ];

  it('scores each side by its best guess and damages the worse side', async () => {
    const h = harness();
    const m = new Match('t', 'teams', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, players, h.deps);
    m.start();
    await h.advance(5000);
    expect(h.last().teams).toEqual([{ hp: 5000 }, { hp: 5000 }]);
    m.guess('a', MADRID); // weak
    m.guess('b', STOCKHOLM); // perfect: team 0's score
    m.guess('c', OSLO); // close, but worse than b
    const rev = h.last();
    expect(rev.phase).toBe('reveal');
    expect(rev.reveal!.teamDamage![0]).toBe(0);
    expect(rev.reveal!.teamDamage![1]).toBeGreaterThan(0);
    expect(rev.teams![1]!.hp).toBe(5000 - rev.reveal!.teamDamage![1]!);
    expect(JSON.stringify(h.states.filter((s) => s.phase === 'round'))).not.toContain('59.33');
  });

  it('a side that empties concedes, and its members lose', async () => {
    const h = harness();
    const m = new Match('t', 'teams', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, players, h.deps);
    m.start();
    await h.advance(5000);
    m.leave('c');
    await h.advance(10);
    expect(h.last().phase).toBe('finished');
    expect(h.last().result!.winnerTeam).toBe(0);
    expect(h.results[0]!.players.find((p) => p.id === 'a')!.won).toBe(true);
    expect(h.results[0]!.players.find((p) => p.id === 'c')!.won).toBe(false);
  });

  it('refuses to start without two sides', () => {
    const h = harness();
    expect(() => new Match('t', 'teams', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, players.map((p) => ({ ...p, team: 0 })), h.deps)).toThrow('teams_need_two_sides');
  });
});

describe('elimination', () => {
  const players = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), country: null, rating: 1000 }));

  it('the worst guess costs a life; ties for everyone cost nothing; last standing wins', async () => {
    const h = harness();
    const m = new Match('e', 'elimination', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, players, h.deps);
    m.start();
    await h.advance(5000);
    expect(h.last().players.every((p) => p.lives === 3)).toBe(true);
    // Everyone equally good: nobody loses a life.
    for (const id of ['a', 'b', 'c']) m.guess(id, STOCKHOLM);
    expect(h.last().players.every((p) => p.lives === 3)).toBe(true);
    // c is worst every round until out, then b is worst until out.
    const round = async (worst: string) => {
      await h.advance(8000);
      for (const p of h.last().players.filter((q) => q.lives > 0)) m.guess(p.id, p.id === worst ? MADRID : STOCKHOLM);
    };
    for (let i = 0; i < 3; i++) await round('c');
    expect(h.last().players.find((p) => p.id === 'c')!.lives).toBe(0);
    expect(h.last().reveal!.guesses.find((g) => g.playerId === 'c')!.lostLife).toBe(true);
    // c is out: guessing now is refused.
    await h.advance(8000);
    expect(() => m.guess('c', STOCKHOLM)).toThrow('eliminated');
    m.guess('a', STOCKHOLM);
    m.guess('b', MADRID);
    for (let i = 0; i < 2; i++) await round('b');
    await h.advance(10);
    expect(h.last().phase).toBe('finished');
    expect(h.last().result!.winnerId).toBe('a');
  });

  it('leaving gives up your lives; the last one left wins', async () => {
    const h = harness();
    const m = new Match('e', 'elimination', false, MAP, { move: 'move', timeLimit: 0, rounds: 0 }, players, h.deps);
    m.start();
    await h.advance(5000);
    m.leave('b');
    m.leave('c');
    await h.advance(10);
    expect(h.last().phase).toBe('finished');
    expect(h.last().result!.winnerId).toBe('a');
  });
});
