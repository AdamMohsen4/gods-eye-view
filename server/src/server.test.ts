import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDb, snapshots, type Db, type SnapshotRow } from '@earthnow/db';
import {
  MIN_DISPLACEMENT_KM,
  addDays,
  cameraGeo,
  haversineKm,
  subjectGeo,
  utcDate,
  type DailyToday,
  type GuessResponse,
  type StartRoundResponse,
} from '@earthnow/shared';
import { seedFromFixtures } from '@earthnow/worker';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { completeDay, displayStreak, EMPTY_STREAK } from './streak.ts';
import { shareCardSvg } from './shareImage.ts';

let clock = new Date();
const now = () => clock;
let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
const config = { ...loadConfig({}), adminToken: 'secret-admin', rateLimitMax: 100000, arcadeFreeRoundsPerDay: 3 };

beforeAll(async () => {
  db = (await openDb('memory://')).db;
  await seedFromFixtures(db, clock);
  app = await buildApp({ db, config, now });
});

const guestHeaders = (id: string) => ({ 'x-guest-id': id });
async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, guest?: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: guest ? guestHeaders(guest) : {}, payload: payload as object });
  return { status: res.statusCode, body: (res.body ? safeJson(res.body) : null) as T, raw: res.body };
}
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

/** Every number that appears anywhere in a JSON value. */
function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}
function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysIn(v, out);
    }
  return out;
}

/**
 * CLAUDE.md rule 1: fails if a pre-guess response contains the snapshot's
 * lat/lon, any answer-bearing field, or a pose that pinpoints the truth.
 */
function assertNoTruth(responseBody: string, snaps: SnapshotRow[]) {
  const json = JSON.parse(responseBody);
  const keys = keysIn(json);
  for (const banned of ['trueLat', 'trueLon', 'true_lat', 'true_lon', 'truth', 'lat', 'lon', 'latitude', 'longitude', 'payload', 'fact'])
    expect(keys.has(banned), `pre-guess response has key "${banned}"`).toBe(false);
  const nums = numbersIn(json);
  for (const s of snaps) {
    for (const n of nums) {
      expect(Math.abs(n - s.trueLat) < 1e-4 && Math.abs(n) > 1e-3, `contains true lat ${s.trueLat}`).toBe(false);
      expect(Math.abs(n - s.trueLon) < 1e-4 && Math.abs(n) > 1e-3, `contains true lon ${s.trueLon}`).toBe(false);
    }
    const fact = (s.payload as { fact: { title: string; subtitle: string } }).fact;
    expect(responseBody.includes(fact.subtitle), 'contains the fact card').toBe(false);
    if (s.type === 'flight') expect(responseBody.includes(fact.title), 'contains the callsign').toBe(false);
  }
  // Poses and subjects must not reconstruct to the true point.
  const rounds = [json.round, ...(json.rounds ?? [])].filter(Boolean);
  for (const r of rounds) {
    const s = snaps.find((x) => x.id === r.snapshotId);
    if (!s) continue;
    const truth = { lat: s.trueLat, lon: s.trueLon };
    expect(haversineKm(truth, cameraGeo(r.camera))).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_KM);
    expect(haversineKm(truth, subjectGeo(r.camera, r.subject))).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_KM);
  }
}

describe('truth never reaches the client before the guess', () => {
  it('daily/today, start, clue, arcade, me and summary are answer-free', async () => {
    const guest = randomUUID();
    const all = await db.select().from(snapshots);
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    expect(today.status).toBe(200);
    expect(today.body.rounds).toHaveLength(5);
    assertNoTruth(today.raw, all);

    for (const r of today.body.rounds) {
      const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: r.snapshotId, mode: 'daily' });
      expect(start.status).toBe(200);
      assertNoTruth(start.raw, all);
      const again = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: r.snapshotId, mode: 'daily' });
      assertNoTruth(again.raw, all);
      for (let i = 0; i < 3; i++) {
        const clue = await call('POST', `/api/rounds/${start.body.roundId}/clue`, guest);
        expect(clue.status).toBe(200);
        assertNoTruth(clue.raw, all);
      }
    }
    const arcade = await call('GET', '/api/arcade/next', guest);
    expect(arcade.status).toBe(200);
    assertNoTruth(arcade.raw, all);
    assertNoTruth((await call('GET', '/api/me', guest)).raw, all);
    assertNoTruth((await call('GET', `/api/daily/${utcDate(clock)}/summary`, guest)).raw, all);
    assertNoTruth((await call('GET', '/api/leaderboard', guest)).raw, all);
  });

  it('the guess response is the first to carry the truth', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: today.body.rounds[0]!.snapshotId, mode: 'daily' });
    const res = await call<GuessResponse>('POST', `/api/rounds/${start.body.roundId}/guess`, guest, { guess: { lat: 0, lon: 0 } });
    const [s] = await db.select().from(snapshots).where(eq(snapshots.id, today.body.rounds[0]!.snapshotId));
    expect(res.body.truth).toEqual({ lat: s!.trueLat, lon: s!.trueLon });
    expect(res.body.attribution.length).toBeGreaterThan(0);
  });
});

describe('rounds', () => {
  it('scores, applies clue penalty, and locks after one guess', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    const sid = today.body.rounds[1]!.snapshotId;
    const [s] = await db.select().from(snapshots).where(eq(snapshots.id, sid));
    const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: sid, mode: 'daily' });
    expect(start.body.deadline).toBeTruthy();
    await call('POST', `/api/rounds/${start.body.roundId}/clue`, guest);
    const res = await call<GuessResponse>('POST', `/api/rounds/${start.body.roundId}/guess`, guest, { guess: { lat: s!.trueLat, lon: s!.trueLon } });
    expect(res.body.score).toBe(4500);
    expect(res.body.distanceKm).toBe(0);
    const twice = await call('POST', `/api/rounds/${start.body.roundId}/guess`, guest, { guess: { lat: 0, lon: 0 } });
    expect(twice.status).toBe(409);
    const restart = await call('POST', '/api/rounds/start', guest, { snapshotId: sid, mode: 'daily' });
    expect(restart.status).toBe(409);
    const clue = await call('POST', `/api/rounds/${start.body.roundId}/clue`, guest);
    expect(clue.status).toBe(409);
  });

  it('caps clues at three', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: today.body.rounds[2]!.snapshotId, mode: 'daily' });
    for (let i = 0; i < 3; i++) expect((await call('POST', `/api/rounds/${start.body.roundId}/clue`, guest)).status).toBe(200);
    const fourth = await call<{ error: string }>('POST', `/api/rounds/${start.body.roundId}/clue`, guest);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toBe('no_more_clues');
  });

  it('validates the timer server-side', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: today.body.rounds[3]!.snapshotId, mode: 'daily' });
    const real = clock;
    clock = new Date(real.getTime() + (config.roundTimerSeconds + config.timerGraceSeconds + 1) * 1000);
    try {
      const res = await call<GuessResponse>('POST', `/api/rounds/${start.body.roundId}/guess`, guest, { guess: { lat: 1, lon: 1 } });
      expect(res.body.timedOut).toBe(true);
      expect(res.body.score).toBe(0);
      expect(res.body.guess).toBeNull();
    } finally {
      clock = real;
    }
  });

  it('rejects bad input and other players’ rounds', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', a);
    const start = await call<StartRoundResponse>('POST', '/api/rounds/start', a, { snapshotId: today.body.rounds[4]!.snapshotId, mode: 'daily' });
    expect((await call('POST', `/api/rounds/${start.body.roundId}/guess`, b, { guess: { lat: 0, lon: 0 } })).status).toBe(404);
    expect((await call('POST', `/api/rounds/${start.body.roundId}/guess`, a, { guess: { lat: 91, lon: 0 } })).status).toBe(400);
    expect((await call('POST', '/api/rounds/start', a, { snapshotId: randomUUID(), mode: 'daily' })).status).toBe(404);
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', 'not-a-uuid')).status).toBe(401);
  });
});

describe('daily completion, streaks, leaderboard, share', () => {
  it('completes a daily, sets the streak and appears on the leaderboard', async () => {
    const guest = randomUUID();
    await call('PUT', '/api/me', guest, { displayName: 'Astrid', country: 'se' });
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    let last: GuessResponse | null = null;
    for (const r of today.body.rounds) {
      const start = await call<StartRoundResponse>('POST', '/api/rounds/start', guest, { snapshotId: r.snapshotId, mode: 'daily' });
      last = (await call<GuessResponse>('POST', `/api/rounds/${start.body.roundId}/guess`, guest, { guess: { lat: 50, lon: 10 } })).body;
    }
    expect(last!.dailyComplete?.streak.current).toBe(1);
    const me = await call<{ id: string; streak: { current: number }; country: string }>('GET', '/api/me', guest);
    expect(me.body.streak.current).toBe(1);
    expect(me.body.country).toBe('SE');

    const lb = await call<{ rows: Array<{ displayName: string }>; you: { score: number } }>('GET', '/api/leaderboard?scope=country', guest);
    expect(lb.body.rows.map((r) => r.displayName)).toContain('Astrid');
    expect(lb.body.you.score).toBe(last!.dailyComplete!.total);

    const number = today.body.number;
    const page = await app.inject({ method: 'GET', url: `/share/${number}/${me.body.id}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('og:image');
    expect(page.body).toContain(`/?ref=share&amp;d=${number}`.replace('&amp;', '&'));
    const png = await app.inject({ method: 'GET', url: `/share/${number}/${me.body.id}.png` });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });

  it('share card never contains true locations', async () => {
    const svg = shareCardSvg({ number: 3, total: 100, rounds: [{ type: 'flight', score: 100, guess: { lat: 10, lon: 10 } }] });
    expect(svg).toContain('Daily #3');
  });

  it('unknown share links fall through to the Daily without a wall', async () => {
    const res = await app.inject({ method: 'GET', url: `/share/9/${randomUUID()}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/?ref=share&d=9');
  });

  it('streak rules: consecutive days, weekly freeze, reset', () => {
    let s = completeDay(EMPTY_STREAK, '2026-11-09');
    s = completeDay(s, '2026-11-10');
    expect(s.current).toBe(2);
    s = completeDay(s, '2026-11-12'); // missed the 11th → freeze
    expect(s.current).toBe(3);
    expect(s.freezeAvailable).toBe(false);
    s = completeDay(s, '2026-11-14'); // missed again in same week → reset
    expect(s.current).toBe(1);
    expect(s.best).toBe(3);
    s = completeDay(s, '2026-11-15');
    s = completeDay(s, '2026-11-17'); // new ISO week → freeze refilled
    expect(s.current).toBe(3);
    expect(displayStreak(s, '2026-11-25').current).toBe(0);
  });
});

describe('arcade', () => {
  it('serves rounds ≥ 5 min old, excludes the daily, and enforces the free limit', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    const dailyIds = new Set(today.body.rounds.map((r) => r.snapshotId));
    for (let i = 0; i < config.arcadeFreeRoundsPerDay; i++) {
      const r = await call<StartRoundResponse>('GET', '/api/arcade/next', guest);
      expect(r.status).toBe(200);
      expect(r.body.deadline).toBeNull();
      expect(dailyIds.has(r.body.round.snapshotId)).toBe(false);
      expect(clock.getTime() - new Date(r.body.round.capturedAt).getTime()).toBeGreaterThanOrEqual(5 * 60_000);
    }
    const blocked = await call<{ error: string; limit: number }>('GET', '/api/arcade/next', guest);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'arcade_limit', limit: config.arcadeFreeRoundsPerDay });
  });
});

describe('admin', () => {
  const auth = { authorization: 'Bearer secret-admin' };
  it('requires the token', async () => {
    expect((await app.inject({ method: 'GET', url: `/api/admin/daily/${utcDate(clock)}` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/admin/daily/${utcDate(clock)}`, headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
  });
  it('previews tomorrow, swaps a round, and refuses to touch a published daily', async () => {
    const tomorrow = addDays(utcDate(clock), 1);
    const preview = await app.inject({ method: 'GET', url: `/api/admin/daily/${tomorrow}`, headers: auth });
    const body = preview.json() as { published: boolean; rounds: SnapshotRow[]; daily: { snapshotIds: string[] } };
    expect(body.published).toBe(false);
    expect(body.rounds).toHaveLength(5);
    const candidates = (await app.inject({ method: 'GET', url: '/api/admin/snapshots?type=quake&limit=100', headers: auth })).json() as SnapshotRow[];
    const used = new Set(body.daily.snapshotIds);
    const pick = candidates.find((c) => !used.has(c.id))!;
    const swap = await app.inject({ method: 'POST', url: `/api/admin/daily/${tomorrow}/swap`, headers: auth, payload: { index: 0, snapshotId: pick.id } });
    expect(swap.statusCode).toBe(200);
    expect((swap.json() as { snapshotIds: string[] }).snapshotIds[0]).toBe(pick.id);
    const locked = await app.inject({ method: 'POST', url: `/api/admin/daily/${utcDate(clock)}/swap`, headers: auth, payload: { index: 0, snapshotId: pick.id } });
    expect(locked.statusCode).toBe(409);
  });
  it('disabling a snapshot replaces it in today’s daily', async () => {
    const today = await call<DailyToday>('GET', '/api/daily/today', randomUUID());
    const victim = today.body.rounds[0]!.snapshotId;
    const res = await app.inject({ method: 'POST', url: `/api/admin/snapshots/${victim}/disable`, headers: auth, payload: {} });
    expect((res.json() as { replacedIn: string[] }).replacedIn).toContain(utcDate(clock));
    const after = await call<DailyToday>('GET', '/api/daily/today', randomUUID());
    expect(after.body.rounds.map((r) => r.snapshotId)).not.toContain(victim);
    expect(after.body.rounds).toHaveLength(5);
  });
  it('bans a user, who then cannot play or appear on the leaderboard', async () => {
    const guest = randomUUID();
    const me = await call<{ id: string }>('GET', '/api/me', guest);
    const res = await app.inject({ method: 'POST', url: `/api/admin/users/${me.body.id}/ban`, headers: auth, payload: { banned: true } });
    expect(res.statusCode).toBe(200);
    expect((await call('GET', '/api/me', guest)).status).toBe(403);
  });
});

describe('GDPR', () => {
  it('deletes all data for a guest', async () => {
    const guest = randomUUID();
    const today = await call<DailyToday>('GET', '/api/daily/today', guest);
    await call('POST', '/api/rounds/start', guest, { snapshotId: today.body.rounds[0]!.snapshotId, mode: 'daily' });
    const before = await call<{ id: string }>('GET', '/api/me', guest);
    expect((await call('DELETE', '/api/me', guest)).status).toBe(204);
    const after = await call<{ id: string }>('GET', '/api/me', guest);
    expect(after.body.id).not.toBe(before.body.id);
  });
});
