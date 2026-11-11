/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON bodies in API tests */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDb, type DbHandle } from '@earthnow/db';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { seedFixtures } from './seed.ts';

let h: DbHandle;
let app: Awaited<ReturnType<typeof buildApp>>;
let clock = new Date('2026-11-10T12:00:00Z');

beforeAll(async () => {
  h = await openDb('memory://');
  await seedFixtures(h.db);
  app = await buildApp({ db: h.db, config: { ...loadConfig({ IMAGERY_PROVIDER: 'fixture', ADMIN_TOKEN: 'test-admin' }), rateLimitMax: 100_000 }, now: () => clock });
});
afterAll(async () => {
  await app.close();
  await h.close();
});

const guest = () => randomUUID();
async function call(method: string, url: string, g: string | null, payload?: unknown) {
  const res = await app.inject({ method: method as 'GET', url, headers: g ? { 'x-guest-id': g } : {}, payload: payload as object });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, any>) : null, raw: res.body };
}

/** Collect every number in a JSON payload. */
function numbers(raw: string): number[] {
  return [...raw.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
}

describe('no truth before the guess', () => {
  it('pre-guess responses never contain the location coordinates', async () => {
    const g = guest();
    const start = await call('POST', '/api/games', g, { mapSlug: 'world' });
    expect(start.status).toBe(200);
    const pre = [start.raw, (await call('GET', `/api/games/${start.body!.id}`, g)).raw];
    const reveal = await call('POST', `/api/games/${start.body!.id}/guess`, g, { guess: { lat: 0, lon: 0 } });
    const truth = reveal.body!.round.truth as { lat: number; lon: number };
    for (const raw of pre) {
      const ns = numbers(raw);
      expect(ns.some((n) => Math.abs(n - truth.lat) < 0.01)).toBe(false);
      expect(ns.some((n) => Math.abs(n - truth.lon) < 0.01)).toBe(false);
      expect(raw).not.toContain('"truth"');
    }
    // The next round is equally clean.
    const next = await call('POST', `/api/games/${start.body!.id}/next`, g);
    expect(next.body!.current.pano.panoId).toMatch(/^fx-[0-9a-f]{20}$/);
    expect(JSON.stringify(next.body!.current)).not.toMatch(/lat|lon/);
  });
});

describe('classic game', () => {
  it('plays five rounds and finishes', async () => {
    const g = guest();
    let s = (await call('POST', '/api/games', g, { mapSlug: 'europe', settings: { move: 'nmpz', timeLimit: 60 } })).body!;
    expect(s.settings).toEqual({ move: 'nmpz', timeLimit: 60, rounds: 5 });
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) {
      expect(s.current.index).toBe(i);
      seen.add(s.current.pano.panoId);
      const r = (await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 50, lon: 10 } })).body!;
      expect(r.round.score).toBeGreaterThanOrEqual(0);
      expect(r.finished).toBe(i === 4);
      if (i < 4) s = (await call('POST', `/api/games/${s.id}/next`, g)).body!;
    }
    expect(seen.size).toBe(5);
    const final = (await call('GET', `/api/games/${s.id}`, g)).body!;
    expect(final.status).toBe('finished');
    expect(final.rounds).toHaveLength(5);
    expect((await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 1, lon: 1 } })).status).toBe(409);
  });

  it('scores a late guess as a timeout', async () => {
    const g = guest();
    const s = (await call('POST', '/api/games', g, { mapSlug: 'world', settings: { timeLimit: 10 } })).body!;
    clock = new Date(clock.getTime() + 20_000);
    const r = (await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 1, lon: 1 } })).body!;
    expect(r.round.timedOut).toBe(true);
    expect(r.round.score).toBe(0);
  });

  it("does not show other players' games", async () => {
    const s = (await call('POST', '/api/games', guest(), { mapSlug: 'world' })).body!;
    expect((await call('GET', `/api/games/${s.id}`, guest())).status).toBe(404);
  });

  it('rejects bad input', async () => {
    const g = guest();
    expect((await call('POST', '/api/games', g, { mapSlug: 'nope' })).status).toBe(404);
    expect((await call('POST', '/api/games', null, { mapSlug: 'world' })).status).toBe(401);
    const s = (await call('POST', '/api/games', g, { mapSlug: 'world' })).body!;
    expect((await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 200, lon: 0 } })).status).toBe(400);
  });
});

describe('country streak', () => {
  it('continues while right and ends on a wrong country', async () => {
    const g = guest();
    const s = (await call('POST', '/api/games', g, { mapSlug: 'world', mode: 'streak' })).body!;
    // Guess in the middle of the Atlantic: no country, so the streak ends at 0.
    const r = (await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 0, lon: -30 } })).body!;
    expect(r.round.correct).toBe(false);
    expect(r.finished).toBe(true);
    expect(r.streak).toBe(0);
  });

  it('counts a correct country', async () => {
    const g = guest();
    const s = (await call('POST', '/api/games', g, { mapSlug: 'sweden', mode: 'streak' })).body!;
    // Every Sweden location is in Sweden.
    const r = (await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 62, lon: 15 } })).body!;
    expect(r.round.correct).toBe(true);
    expect(r.streak).toBe(1);
    expect(r.finished).toBe(false);
  });
});

describe('challenges and daily', () => {
  it('gives everyone the same rounds and ranks finishers', async () => {
    const a = guest();
    const b = guest();
    const { token } = (await call('POST', '/api/challenges', a, { mapSlug: 'japan', settings: { move: 'nomove' } })).body!;
    const panos: string[][] = [[], []];
    for (const [i, g] of [a, b].entries()) {
      let s = (await call('POST', `/api/challenges/${token}/play`, g)).body!;
      expect(s.mode).toBe('challenge');
      for (let r = 0; r < 5; r++) {
        panos[i]!.push(s.current.pano.panoId);
        await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 36, lon: 138 + i } });
        if (r < 4) s = (await call('POST', `/api/games/${s.id}/next`, g)).body!;
      }
    }
    expect(panos[0]).toEqual(panos[1]);
    const board = (await call('GET', `/api/challenges/${token}/leaderboard`, a)).body!;
    expect(board.rows).toHaveLength(2);
    expect(board.you.userId).toBeTruthy();
    // Can't peek at the board before finishing.
    expect((await call('GET', `/api/challenges/${token}/leaderboard`, guest())).status).toBe(403);
    // Replaying resumes the same finished game.
    const again = (await call('POST', `/api/challenges/${token}/play`, a)).body!;
    expect(again.status).toBe('finished');
  });

  it('builds one daily per date in different countries and counts the streak', async () => {
    const g = guest();
    const d1 = (await call('GET', '/api/daily', g)).body!;
    const d2 = (await call('GET', '/api/daily', guest())).body!;
    expect(d1.token).toBe(d2.token);
    expect(d1.dailyNumber).toBe(1);
    let s = (await call('POST', `/api/challenges/${d1.token}/play`, g)).body!;
    expect(s.mode).toBe('daily');
    for (let r = 0; r < 5; r++) {
      await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 10, lon: 10 } });
      if (r < 4) s = (await call('POST', `/api/games/${s.id}/next`, g)).body!;
    }
    const me = (await call('GET', '/api/me', g)).body!;
    expect(me.dailyStreak).toEqual({ current: 1, best: 1, playedToday: true });
    expect(me.level.xp).toBeGreaterThanOrEqual(0);
    const share = await app.inject({ method: 'GET', url: `/share/${s.id}.png` });
    expect(share.headers['content-type']).toBe('image/png');
  });
});

describe('map maker', () => {
  it('creates, snaps points, and publishes at five locations', async () => {
    const g = guest();
    const m = (await call('POST', '/api/maker/maps', g, { name: 'Swedish lakes' })).body!;
    expect(m.published).toBe(false);
    // At sea → no coverage.
    expect((await call('POST', `/api/maker/maps/${m.id}/locations`, g, { point: { lat: 0, lon: -30 } })).status).toBe(422);
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', `/api/maker/maps/${m.id}/locations`, g, { point: { lat: 60 + i * 0.5, lon: 15 } });
      expect(r.status).toBe(200);
      expect(r.body!.country).toBe('SE');
    }
    expect((await call('PATCH', `/api/maker/maps/${m.id}`, guest(), { published: true })).status).toBe(404);
    const pub = (await call('PATCH', `/api/maker/maps/${m.id}`, g, { published: true })).body!;
    expect(pub.published).toBe(true);
    const list = (await call('GET', '/api/maps?kind=community', null)).body as unknown as { slug: string; creatorName: string }[];
    expect(list.some((x) => x.slug === m.slug)).toBe(true);
    const game = await call('POST', '/api/games', guest(), { mapSlug: m.slug });
    expect(game.status).toBe(200);
  });
});

describe('profile', () => {
  it('renames and reports stats', async () => {
    const g = guest();
    expect((await call('PUT', '/api/me', g, { displayName: 'A' })).status).toBe(400);
    const me = (await call('PUT', '/api/me', g, { displayName: 'Ada <b>', country: 'se' })).body!;
    expect(me.displayName).toBe('Ada b');
    expect(me.country).toBe('SE');
    const st = (await call('GET', '/api/me/stats', g)).body!;
    expect(st.gamesPlayed).toBe(0);
    expect((await call('DELETE', '/api/me', g)).status).toBe(204);
  });
});
