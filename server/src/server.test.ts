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

describe('daily streak edge cases', () => {
  it('finishing an older daily late does not reset the streak', async () => {
    const g = guest();
    const day1 = new Date('2026-11-20T12:00:00Z');
    const day2 = new Date('2026-11-21T12:00:00Z');
    const saved = clock;
    try {
      clock = day1;
      const old = (await call('GET', '/api/daily', g)).body!;
      let s1 = (await call('POST', `/api/challenges/${old.token}/play`, g)).body!;
      await call('POST', `/api/games/${s1.id}/guess`, g, { guess: { lat: 10, lon: 10 } });
      s1 = (await call('POST', `/api/games/${s1.id}/next`, g)).body!;
      clock = day2;
      const today = (await call('GET', '/api/daily', g)).body!;
      let s2 = (await call('POST', `/api/challenges/${today.token}/play`, g)).body!;
      for (let r = 0; r < 5; r++) {
        await call('POST', `/api/games/${s2.id}/guess`, g, { guess: { lat: 10, lon: 10 } });
        if (r < 4) s2 = (await call('POST', `/api/games/${s2.id}/next`, g)).body!;
      }
      // Now finish yesterday's.
      for (let r = 1; r < 5; r++) {
        await call('POST', `/api/games/${s1.id}/guess`, g, { guess: { lat: 10, lon: 10 } });
        if (r < 4) s1 = (await call('POST', `/api/games/${s1.id}/next`, g)).body!;
      }
      const me = (await call('GET', '/api/me', g)).body!;
      expect(me.dailyStreak.playedToday).toBe(true);
      expect(me.dailyStreak.current).toBe(1);
    } finally {
      clock = saved;
    }
  });

  it('next never opens a round past the end, even when raced with the last guess', async () => {
    const g = guest();
    let s = (await call('POST', '/api/games', g, { mapSlug: 'world' })).body!;
    for (let r = 0; r < 4; r++) {
      await call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 0, lon: 0 } });
      s = (await call('POST', `/api/games/${s.id}/next`, g)).body!;
    }
    const [, n] = await Promise.all([
      call('POST', `/api/games/${s.id}/guess`, g, { guess: { lat: 0, lon: 0 } }),
      call('POST', `/api/games/${s.id}/next`, g),
    ]);
    expect([200, 409]).toContain(n.status);
    s = (await call('GET', `/api/games/${s.id}`, g)).body!;
    expect(s.status).toBe('finished');
    expect(s.rounds).toHaveLength(5);
    expect(s.current).toBeNull();
  });
});

describe('realtime hub', () => {
  type Msg = Record<string, any>;
  function sock() {
    const inbox: Msg[] = [];
    const socket = { send: (d: string) => inbox.push(JSON.parse(d)), close: () => {} };
    const handle = app.hub.connect(socket);
    const say = (m: Msg) => handle(JSON.stringify(m));
    return { socket, inbox, say, last: (t: string) => [...inbox].reverse().find((m) => m.t === t) };
  }

  it('a second hello on the same socket moves it to the new user', async () => {
    const s = sock();
    const a = guest();
    const b = guest();
    await s.say({ t: 'hello', guestId: a });
    const ua = s.last('welcome')!.userId;
    await s.say({ t: 'hello', guestId: b });
    expect(app.hub.online(ua)).toBe(false);
    expect(app.hub.online(s.last('welcome')!.userId)).toBe(true);
    expect(typeof s.last('welcome')!.now).toBe('number');
    expect(s.last('welcome')!.matchIds).toEqual([]);
    app.hub.disconnect(s.socket);
  });

  it('on hello the client gets full queue and party state', async () => {
    const s = sock();
    await s.say({ t: 'hello', guestId: guest() });
    expect(s.last('queue.status')).toMatchObject({ waiting: false });
    expect(s.last('party.closed')).toMatchObject({ reason: 'none' });
    await s.say({ t: 'hello', guestId: 'not-a-uuid-but-36-chars-long-------' });
    expect(s.last('error')).toMatchObject({ code: 'guest_id_required' });
    app.hub.disconnect(s.socket);
  });

  it('two players joining at once can never both get the same waiting opponent', async () => {
    const [a, b, c] = [sock(), sock(), sock()];
    for (const s of [a, b, c]) await s.say({ t: 'hello', guestId: guest() });
    await a.say({ t: 'queue.join', ranked: false });
    expect(a.last('queue.status')).toMatchObject({ waiting: true });
    await Promise.all([b.say({ t: 'queue.join', ranked: false }), c.say({ t: 'queue.join', ranked: false })]);
    const aMatches = a.inbox.filter((m) => m.t === 'match.state').map((m) => m.match.id);
    expect(new Set(aMatches).size).toBe(1);
    const inMatch = [b, c].filter((s) => s.inbox.some((m) => m.t === 'match.state'));
    expect(inMatch).toHaveLength(1);
    const waiting = [b, c].find((s) => !s.inbox.some((m) => m.t === 'match.state'))!;
    expect(waiting.last('queue.status')).toMatchObject({ waiting: true });
    for (const s of [a, b, c]) {
      const id = s.last('match.state')?.match.id;
      if (id) await s.say({ t: 'match.leave', matchId: id });
      await s.say({ t: 'queue.leave' });
      app.hub.disconnect(s.socket);
    }
  });

  it('refuses a party game on a map with fewer places than rounds, and tells a leaver', async () => {
    const g = guest();
    const m = (await call('POST', '/api/maker/maps', g, { name: 'Tiny map' })).body!;
    for (let i = 0; i < 5; i++) await call('POST', `/api/maker/maps/${m.id}/locations`, g, { point: { lat: 60 + i * 0.5, lon: 15 } });
    await call('PATCH', `/api/maker/maps/${m.id}`, g, { published: true });
    const s = sock();
    await s.say({ t: 'hello', guestId: g });
    await s.say({ t: 'party.create' });
    await s.say({ t: 'party.settings', settings: { mapSlug: m.slug, rounds: 10 } });
    await new Promise((r) => setTimeout(r, 50));
    await s.say({ t: 'party.start' });
    expect(s.last('error')).toMatchObject({ code: 'map_too_small' });
    await s.say({ t: 'party.leave' });
    expect(s.last('party.closed')).toMatchObject({ reason: 'left' });
    app.hub.disconnect(s.socket);
  });
});

describe('friends', () => {
  it('asks by code, accepts, lists both sides, and removes', async () => {
    const a = guest();
    const b = guest();
    const infoA = (await call('GET', '/api/friends', a)).body!;
    const infoB = (await call('GET', '/api/friends', b)).body!;
    expect(infoA.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(infoA.code).not.toBe(infoB.code);
    // The code is stable.
    expect((await call('GET', '/api/friends', a)).body!.code).toBe(infoA.code);

    expect((await call('POST', '/api/friends', a, { code: 'nope' })).status).toBe(400);
    expect((await call('POST', '/api/friends', a, { code: 'ZZZZZZ' })).status).toBe(404);
    expect((await call('POST', '/api/friends', a, { code: infoA.code })).status).toBe(400);

    const sent = (await call('POST', '/api/friends', a, { code: infoB.code.toLowerCase() })).body!;
    expect(sent.friends).toEqual([expect.objectContaining({ status: 'outgoing', online: false })]);
    const incoming = (await call('GET', '/api/friends', b)).body!;
    expect(incoming.friends).toEqual([expect.objectContaining({ status: 'incoming' })]);
    const bId = sent.friends[0].id as string;
    const aId = incoming.friends[0].id as string;

    // Only the addressee can accept.
    expect((await call('POST', `/api/friends/${bId}/accept`, a)).status).toBe(404);
    const accepted = (await call('POST', `/api/friends/${aId}/accept`, b)).body!;
    expect(accepted.friends).toEqual([expect.objectContaining({ status: 'friend', id: aId })]);
    expect((await call('GET', '/api/friends', a)).body!.friends[0].status).toBe('friend');

    const removed = (await call('DELETE', `/api/friends/${aId}`, b)).body!;
    expect(removed.friends).toEqual([]);
    expect((await call('GET', '/api/friends', a)).body!.friends).toEqual([]);
  });

  it('asking someone who already asked you accepts; deleting your data removes the friendship', async () => {
    const a = guest();
    const b = guest();
    const codeA = (await call('GET', '/api/friends', a)).body!.code;
    const codeB = (await call('GET', '/api/friends', b)).body!.code;
    await call('POST', '/api/friends', a, { code: codeB });
    const both = (await call('POST', '/api/friends', b, { code: codeA })).body!;
    expect(both.friends[0].status).toBe('friend');
    await call('DELETE', '/api/me', b);
    expect((await call('GET', '/api/friends', a)).body!.friends).toEqual([]);
  });

  it('profile stats carry badge progress', async () => {
    const g = guest();
    const s = (await call('GET', '/api/me/stats', g)).body!;
    expect(s.badges.length).toBeGreaterThan(5);
    expect(s.badges.find((b: any) => b.id === 'first-game')).toMatchObject({ earned: false, progress: 0, goal: 1 });
  });
});

describe('realtime: friends, invites and team parties', () => {
  type Msg = Record<string, any>;
  const tick = () => new Promise((r) => setTimeout(r, 30));
  function sock() {
    const inbox: Msg[] = [];
    const socket = { send: (d: string) => inbox.push(JSON.parse(d)), close: () => {} };
    const handle = app.hub.connect(socket);
    const say = async (m: Msg) => {
      await handle(JSON.stringify(m));
      await tick();
    };
    return { socket, inbox, say, last: (t: string) => [...inbox].reverse().find((m) => m.t === t) };
  }

  it('invites only friends who are online, and a teams party starts with two sides', async () => {
    const ga = guest();
    const gb = guest();
    const gc = guest();
    const codeB = (await call('GET', '/api/friends', gb)).body!.code;
    const codeA = (await call('GET', '/api/friends', ga)).body!.code;
    await call('POST', '/api/friends', ga, { code: codeB });
    await call('POST', '/api/friends', gb, { code: codeA });
    const [a, b, c] = [sock(), sock(), sock()];
    await a.say({ t: 'hello', guestId: ga });
    await b.say({ t: 'hello', guestId: gb });
    await c.say({ t: 'hello', guestId: gc });
    const bId = b.last('welcome')!.userId;
    const cId = c.last('welcome')!.userId;

    // Not in a party yet.
    await a.say({ t: 'party.invite', userId: bId });
    expect(a.last('error')).toMatchObject({ code: 'party_not_found' });
    await a.say({ t: 'party.create' });
    const code = a.last('party.state')!.party.code;
    // Not friends with c.
    await a.say({ t: 'party.invite', userId: cId });
    expect(a.last('error')).toMatchObject({ code: 'not_friends' });
    // Friends with b: b gets the invite with the code.
    await a.say({ t: 'party.invite', userId: bId });
    expect(b.last('party.invite')).toMatchObject({ code, from: { name: expect.any(String) } });
    expect(a.last('party.invited')).toMatchObject({ userId: bId });

    // Teams: the second player lands on the other side.
    await b.say({ t: 'party.join', code });
    await a.say({ t: 'party.settings', settings: { format: 'teams' } });
    const players = a.last('party.state')!.party.players as Msg[];
    expect(new Set(players.map((p) => p.team))).toEqual(new Set([0, 1]));
    // Both on one side: refused.
    await b.say({ t: 'party.team', team: 0 });
    await a.say({ t: 'party.start' });
    expect(a.last('error')).toMatchObject({ code: 'teams_need_two_sides' });
    // Only the host moves others.
    await b.say({ t: 'party.team', team: 1, playerId: a.last('welcome')!.userId });
    expect(b.last('error')).toMatchObject({ code: 'host_only' });
    await b.say({ t: 'party.team', team: 1 });
    await a.say({ t: 'party.start' });
    const m = a.last('match.state')!.match;
    expect(m.format).toBe('teams');
    expect(m.teams).toEqual([{ hp: 5000 }, { hp: 5000 }]);
    for (const s of [a, b, c]) app.hub.disconnect(s.socket);
  });
});
