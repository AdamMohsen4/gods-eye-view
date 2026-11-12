/**
 * Solo games: classic, daily, challenge and country streak.
 *
 * The true location of a round only leaves this module inside a revealed
 * round (after its guess is locked) or a finished game. `activeRound` is the
 * single place a location becomes client data before the guess, and it
 * carries only the panorama id and a heading.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import {
  challenges,
  gameRounds,
  games,
  locations,
  maps,
  rowsOf,
  users,
  type ChallengeRow,
  type Db,
  type GameRoundRow,
  type GameRow,
  type LocationRow,
  type MapRow,
  type UserRow,
} from '@earthnow/db';
import {
  DEFAULT_SETTINGS,
  MOVE_MODES,
  TIME_LIMITS,
  addDays,
  dailyNumber,
  haversineKm,
  isLatLon,
  levelFor,
  scoreGuess,
  shuffle,
  seededRandom,
  spreadKm,
  utcDate,
  xpForRound,
  type ActiveRound,
  type ChallengeInfo,
  type GameMode,
  type GameSettings,
  type GameState,
  type GuessResponse,
  type LatLon,
  type LeaderboardRow,
  type MapSummary,
  type MeResponse,
  type ProfileStats,
  badgeProgress,
  type RevealedRound,
} from '@earthnow/shared';
import type { Config } from './config.ts';
import { countryAt, countryName, countryRef } from './countries.ts';

export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const STREAK_MAX_ROUNDS = 1000;
/** Daily settings rotate through the week so every day plays differently. */
const DAILY_ROTATION: GameSettings[] = [
  { move: 'move', timeLimit: 0, rounds: 5 },
  { move: 'nomove', timeLimit: 120, rounds: 5 },
  { move: 'move', timeLimit: 180, rounds: 5 },
  { move: 'nmpz', timeLimit: 60, rounds: 5 },
  { move: 'move', timeLimit: 0, rounds: 5 },
  { move: 'nomove', timeLimit: 0, rounds: 5 },
  { move: 'nmpz', timeLimit: 0, rounds: 5 },
];

export function dailySettings(date: string): GameSettings {
  return DAILY_ROTATION[(((dailyNumber(date) - 1) % 7) + 7) % 7]!;
}

export function parseSettings(raw: unknown, mode: GameMode = 'classic'): GameSettings {
  const r = (raw ?? {}) as Partial<GameSettings>;
  const move = MOVE_MODES.includes(r.move as never) ? r.move! : DEFAULT_SETTINGS.move;
  const timeLimit = TIME_LIMITS.includes(r.timeLimit as never) ? r.timeLimit! : DEFAULT_SETTINGS.timeLimit;
  const rounds = mode === 'streak' ? STREAK_MAX_ROUNDS : 5;
  return { move, timeLimit, rounds };
}

function token(n = 10): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(n)].map((b) => alphabet[b % alphabet.length]).join('');
}

export class Game {
  constructor(
    private db: Db,
    private config: Config,
    private now: () => Date = () => new Date(),
  ) {}

  /* ------------------------------ players ------------------------------ */

  async guest(guestId: string): Promise<UserRow> {
    const existing = await this.db.select().from(users).where(eq(users.guestId, guestId));
    if (existing[0]) return existing[0];
    const name = `Explorer-${guestId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
    await this.db.insert(users).values({ guestId, displayName: name }).onConflictDoNothing({ target: users.guestId });
    return (await this.db.select().from(users).where(eq(users.guestId, guestId)))[0]!;
  }

  async userById(id: string): Promise<UserRow | null> {
    return (await this.db.select().from(users).where(eq(users.id, id)))[0] ?? null;
  }

  me(user: UserRow): MeResponse {
    const today = utcDate(this.now());
    const alive = user.lastDaily === today || user.lastDaily === addDays(today, -1);
    return {
      id: user.id,
      displayName: user.displayName,
      country: user.country,
      rating: user.rating,
      level: levelFor(user.xp),
      dailyStreak: { current: alive ? user.dailyStreak : 0, best: user.dailyBest, playedToday: user.lastDaily === today },
    };
  }

  async updateMe(user: UserRow, patch: { displayName?: unknown; country?: unknown }): Promise<MeResponse> {
    const set: Partial<Pick<UserRow, 'displayName' | 'country'>> = {};
    if (patch.displayName !== undefined) {
      // eslint-disable-next-line no-control-regex -- strip control characters from names
      const name = String(patch.displayName).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
      if (name.length < 2) throw new GameError(400, 'invalid_display_name');
      set.displayName = name;
    }
    if (patch.country !== undefined) {
      if (patch.country === null || patch.country === '') set.country = null;
      else if (typeof patch.country === 'string' && /^[A-Za-z]{2}$/.test(patch.country)) set.country = patch.country.toUpperCase();
      else throw new GameError(400, 'invalid_country');
    }
    if (Object.keys(set).length) await this.db.update(users).set(set).where(eq(users.id, user.id));
    return this.me((await this.userById(user.id))!);
  }

  /** GDPR: everything tied to the player goes (games, rounds and match rows cascade). */
  async deleteMe(user: UserRow): Promise<void> {
    await this.db.update(maps).set({ creatorId: null }).where(eq(maps.creatorId, user.id));
    await this.db.delete(users).where(eq(users.id, user.id));
  }

  /* -------------------------------- maps -------------------------------- */

  async mapBySlug(slug: string): Promise<MapRow> {
    const [m] = await this.db.select().from(maps).where(eq(maps.slug, slug));
    if (!m) throw new GameError(404, 'map_not_found');
    return m;
  }

  async mapById(id: string): Promise<MapRow> {
    const [m] = await this.db.select().from(maps).where(eq(maps.id, id));
    if (!m) throw new GameError(404, 'map_not_found');
    return m;
  }

  /** Map size in km for scoring, from the spread of its locations. */
  async scaleKm(mapId: string): Promise<number> {
    const [r] = rowsOf<{ min_lat: number; max_lat: number; min_lon: number; max_lon: number }>(
      await this.db.execute(sql`SELECT min(lat) AS min_lat, max(lat) AS max_lat, min(lon) AS min_lon, max(lon) AS max_lon
        FROM locations WHERE map_id = ${mapId} AND provider = ${this.config.provider} AND NOT disabled`),
    );
    if (!r || r.min_lat == null) return 1000;
    const km = spreadKm([
      { lat: r.min_lat, lon: r.min_lon },
      { lat: r.max_lat, lon: r.max_lon },
    ]);
    return Math.max(50, Math.min(18_000, km));
  }

  async summarize(rows: MapRow[]): Promise<MapSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const counts = rowsOf<{ map_id: string; n: number; min_lat: number; max_lat: number; min_lon: number; max_lon: number }>(
      await this.db.execute(sql`SELECT map_id, count(*)::int AS n, min(lat) AS min_lat, max(lat) AS max_lat, min(lon) AS min_lon, max(lon) AS max_lon
        FROM locations WHERE provider = ${this.config.provider} AND NOT disabled
        AND map_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) GROUP BY map_id`),
    );
    const cc = rowsOf<{ map_id: string; country: string }>(
      await this.db.execute(sql`SELECT DISTINCT map_id, country FROM locations
        WHERE provider = ${this.config.provider} AND NOT disabled AND country IS NOT NULL
        AND map_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`),
    );
    const plays = rowsOf<{ map_id: string; n: number }>(
      await this.db.execute(sql`SELECT map_id, count(*)::int AS n FROM games
        WHERE map_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) GROUP BY map_id`),
    );
    const creatorIds = [...new Set(rows.map((r) => r.creatorId).filter((x): x is string => !!x))];
    const creators = creatorIds.length ? await this.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, creatorIds)) : [];
    return rows.map((m) => {
      const c = counts.find((x) => x.map_id === m.id);
      const scale = c && c.n > 1 ? spreadKm([{ lat: c.min_lat, lon: c.min_lon }, { lat: c.max_lat, lon: c.max_lon }]) : 1000;
      return {
        id: m.id,
        slug: m.slug,
        name: m.name,
        description: m.description,
        kind: m.kind,
        creatorName: creators.find((x) => x.id === m.creatorId)?.name ?? null,
        locationCount: c?.n ?? 0,
        scaleKm: Math.round(Math.max(50, Math.min(18_000, scale))),
        plays: plays.find((x) => x.map_id === m.id)?.n ?? 0,
        countries: cc.filter((x) => x.map_id === m.id).map((x) => x.country).sort(),
        bounds: c && c.n ? ([c.min_lon, c.min_lat, c.max_lon, c.max_lat] as [number, number, number, number]) : null,
      };
    });
  }

  async listMaps(kind?: 'official' | 'community'): Promise<MapSummary[]> {
    const where = kind ? and(eq(maps.published, true), eq(maps.kind, kind)) : eq(maps.published, true);
    const rows = await this.db.select().from(maps).where(where).orderBy(asc(maps.sort), desc(maps.createdAt)).limit(200);
    return (await this.summarize(rows)).filter((m) => m.locationCount >= 5);
  }

  async mapSummary(row: MapRow): Promise<MapSummary> {
    return (await this.summarize([row]))[0]!;
  }

  /* ------------------------------- rounds ------------------------------- */

  private activeRound(r: GameRoundRow, loc: LocationRow): ActiveRound {
    return {
      index: r.idx,
      pano: { provider: loc.provider, panoId: loc.panoId, heading: loc.heading },
      startedAt: r.startedAt.toISOString(),
      deadline: r.deadline ? r.deadline.toISOString() : null,
    };
  }

  private revealed(g: GameRow, r: GameRoundRow, loc: LocationRow): RevealedRound {
    const guess = r.guessLat != null && r.guessLon != null ? { lat: r.guessLat, lon: r.guessLon } : null;
    return {
      index: r.idx,
      truth: { lat: loc.lat, lon: loc.lon },
      country: countryRef(loc.country),
      guess,
      guessCountry: countryRef(r.guessCountry),
      distanceKm: r.distanceKm,
      score: r.score ?? 0,
      timedOut: r.timedOut,
      correct: g.mode === 'streak' ? !!loc.country && r.guessCountry === loc.country : undefined,
      credit: loc.credit,
      panoId: loc.panoId,
      provider: loc.provider,
    };
  }

  private async loadGame(user: UserRow, gameId: string): Promise<GameRow> {
    const [g] = await this.db.select().from(games).where(eq(games.id, gameId));
    if (!g || g.userId !== user.id) throw new GameError(404, 'game_not_found');
    return g;
  }

  async state(user: UserRow, gameId: string): Promise<GameState> {
    return this.stateOf(await this.loadGame(user, gameId));
  }

  private async stateOf(g: GameRow): Promise<GameState> {
    const rs = await this.db.select().from(gameRounds).where(eq(gameRounds.gameId, g.id)).orderBy(asc(gameRounds.idx));
    const locs = rs.length ? await this.db.select().from(locations).where(inArray(locations.id, rs.map((r) => r.locationId))) : [];
    const locOf = (r: GameRoundRow) => locs.find((l) => l.id === r.locationId)!;
    const done = rs.filter((r) => r.guessedAt);
    const open = rs.find((r) => !r.guessedAt);
    const map = await this.mapSummary(await this.mapById(g.mapId));
    let challengeToken: string | null = null;
    let number: number | null = null;
    if (g.challengeId) {
      const [c] = await this.db.select().from(challenges).where(eq(challenges.id, g.challengeId));
      challengeToken = c?.token ?? null;
      number = c?.dailyDate ? dailyNumber(c.dailyDate) : null;
    }
    return {
      id: g.id,
      mode: g.mode,
      map: { ...map, scaleKm: Math.round(g.scaleKm) },
      settings: g.settings,
      status: g.status,
      totalScore: g.totalScore,
      streak: g.streak,
      rounds: done.map((r) => this.revealed(g, r, locOf(r))),
      current: open && g.status === 'active' ? this.activeRound(open, locOf(open)) : null,
      challengeToken,
      dailyNumber: number,
    };
  }

  /** Pick a location for round `idx` of a game that has no fixed list. */
  private async pickLocation(g: GameRow, used: string[]): Promise<LocationRow> {
    const recent = rowsOf<{ location_id: string }>(
      await this.db.execute(sql`SELECT gr.location_id FROM game_rounds gr JOIN games g ON g.id = gr.game_id
        WHERE g.user_id = ${g.userId} AND g.map_id = ${g.mapId} ORDER BY gr.started_at DESC LIMIT 300`),
    ).map((r) => r.location_id);
    // Streak rounds need a known country, or no guess could ever be right.
    const base = and(
      eq(locations.mapId, g.mapId),
      eq(locations.provider, g.provider),
      eq(locations.disabled, false),
      g.mode === 'streak' ? isNotNull(locations.country) : undefined,
    );
    for (const avoid of [[...new Set([...used, ...recent])], used]) {
      const where = avoid.length ? and(base, notInArray(locations.id, avoid)) : base;
      const [loc] = await this.db.select().from(locations).where(where).orderBy(sql`random()`).limit(1);
      if (loc) return loc;
    }
    throw new GameError(409, 'map_exhausted');
  }

  private async openRound(g: GameRow, idx: number, locationId: string): Promise<void> {
    const started = this.now();
    const deadline = g.settings.timeLimit ? new Date(started.getTime() + g.settings.timeLimit * 1000) : null;
    await this.db.insert(gameRounds).values({ gameId: g.id, idx, locationId, startedAt: started, deadline }).onConflictDoNothing();
  }

  private async createGame(user: UserRow, map: MapRow, mode: GameMode, settings: GameSettings, challenge?: ChallengeRow): Promise<GameRow> {
    const scale = await this.scaleKm(map.id);
    const [g] = await this.db
      .insert(games)
      .values({ userId: user.id, mapId: map.id, mode, settings, challengeId: challenge?.id ?? null, provider: this.config.provider, scaleKm: scale })
      .returning();
    const first = challenge ? challenge.locationIds[0]! : (await this.pickLocation(g!, [])).id;
    await this.openRound(g!, 0, first);
    return g!;
  }

  async startGame(user: UserRow, body: { mapSlug?: unknown; mode?: unknown; settings?: unknown }): Promise<GameState> {
    const mode: GameMode = body.mode === 'streak' ? 'streak' : 'classic';
    if (typeof body.mapSlug !== 'string') throw new GameError(400, 'invalid_map');
    const map = await this.mapBySlug(body.mapSlug);
    if (!map.published && map.creatorId !== user.id) throw new GameError(404, 'map_not_found');
    const settings = parseSettings(body.settings, mode);
    const g = await this.createGame(user, map, mode, settings);
    return this.stateOf(g);
  }

  async guess(user: UserRow, gameId: string, raw: unknown): Promise<GuessResponse> {
    const g = await this.loadGame(user, gameId);
    if (g.status !== 'active') throw new GameError(409, 'game_finished');
    const [r] = await this.db.select().from(gameRounds).where(and(eq(gameRounds.gameId, g.id), sql`guessed_at IS NULL`));
    if (!r) throw new GameError(409, 'no_open_round');
    const [loc] = await this.db.select().from(locations).where(eq(locations.id, r.locationId));
    const now = this.now();
    const late = !!r.deadline && now.getTime() > r.deadline.getTime() + this.config.timerGraceSeconds * 1000;
    const guess: LatLon | null = !late && isLatLon(raw) ? { lat: raw.lat, lon: raw.lon } : null;
    if (raw !== null && raw !== undefined && !isLatLon(raw) && !late) throw new GameError(400, 'invalid_guess');
    const distanceKm = guess ? haversineKm(guess, loc!) : null;
    const guessCountry = guess ? countryAt(guess) : null;

    let score = 0;
    let streak = g.streak;
    let finished = false;
    if (g.mode === 'streak') {
      const correct = !!guessCountry && guessCountry === loc!.country;
      if (correct) streak++;
      finished = !correct || r.idx + 1 >= STREAK_MAX_ROUNDS;
    } else {
      score = scoreGuess(distanceKm, g.scaleKm);
      finished = r.idx + 1 >= g.settings.rounds;
    }

    const totalScore = g.totalScore + score;
    // One transaction, so /next (which re-reads the game status after the rounds)
    // can never see the round guessed but the game still active.
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(gameRounds)
        .set({ guessLat: guess?.lat ?? null, guessLon: guess?.lon ?? null, guessCountry, guessedAt: now, distanceKm, score, timedOut: !guess })
        .where(and(eq(gameRounds.gameId, g.id), eq(gameRounds.idx, r.idx), sql`guessed_at IS NULL`))
        .returning();
      if (!row) throw new GameError(409, 'already_guessed');
      await tx
        .update(games)
        .set({
          totalScore,
          totalDistanceKm: g.totalDistanceKm + (distanceKm ?? 20_000),
          streak,
          status: finished ? 'finished' : 'active',
          finishedAt: finished ? now : null,
        })
        .where(eq(games.id, g.id));
      return row;
    });
    const xp = g.mode === 'streak' ? (streak > g.streak ? 10 : 0) : xpForRound(score);
    if (xp) await this.db.update(users).set({ xp: sql`${users.xp} + ${xp}` }).where(eq(users.id, user.id));
    if (finished && g.challengeId) await this.afterChallenge(user, g.challengeId);

    const round = this.revealed({ ...g, streak }, updated, loc!);
    return { round, totalScore, streak, finished };
  }

  async next(user: UserRow, gameId: string): Promise<GameState> {
    const g = await this.loadGame(user, gameId);
    if (g.status !== 'active') throw new GameError(409, 'game_finished');
    const rs = await this.db.select().from(gameRounds).where(eq(gameRounds.gameId, g.id)).orderBy(asc(gameRounds.idx));
    if (rs.some((r) => !r.guessedAt)) return this.stateOf(g);
    // Re-read after the rounds: a guess that just finished the game commits both together.
    const [fresh] = await this.db.select().from(games).where(eq(games.id, g.id));
    if (!fresh || fresh.status !== 'active') return this.stateOf(fresh ?? g);
    const idx = rs.length;
    const max = g.mode === 'streak' ? STREAK_MAX_ROUNDS : g.settings.rounds;
    if (idx >= max) return this.stateOf(fresh);
    let locationId: string;
    if (g.challengeId) {
      const [c] = await this.db.select().from(challenges).where(eq(challenges.id, g.challengeId));
      const id = c?.locationIds[idx];
      if (!id) return this.stateOf(fresh);
      locationId = id;
    } else {
      locationId = (await this.pickLocation(g, rs.map((r) => r.locationId))).id;
    }
    await this.openRound(g, idx, locationId);
    return this.stateOf(g);
  }

  /* ----------------------------- challenges ----------------------------- */

  async createChallenge(user: UserRow, body: { mapSlug?: unknown; settings?: unknown }): Promise<{ token: string }> {
    if (typeof body.mapSlug !== 'string') throw new GameError(400, 'invalid_map');
    const map = await this.mapBySlug(body.mapSlug);
    if (!map.published) throw new GameError(404, 'map_not_found');
    const settings = parseSettings(body.settings);
    const picks = await this.db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.mapId, map.id), eq(locations.provider, this.config.provider), eq(locations.disabled, false)))
      .orderBy(sql`random()`)
      .limit(settings.rounds);
    if (picks.length < settings.rounds) throw new GameError(409, 'map_too_small');
    const t = token();
    await this.db.insert(challenges).values({ token: t, mapId: map.id, settings, locationIds: picks.map((p) => p.id), creatorId: user.id });
    return { token: t };
  }

  private async challengeByToken(t: string): Promise<ChallengeRow> {
    const [c] = await this.db.select().from(challenges).where(eq(challenges.token, t));
    if (!c) throw new GameError(404, 'challenge_not_found');
    return c;
  }

  async challengeInfo(user: UserRow | null, t: string): Promise<ChallengeInfo> {
    return this.infoOf(user, await this.challengeByToken(t));
  }

  private async infoOf(user: UserRow | null, c: ChallengeRow): Promise<ChallengeInfo> {
    const map = await this.mapSummary(await this.mapById(c.mapId));
    const creator = c.creatorId ? await this.userById(c.creatorId) : null;
    const [p] = rowsOf<{ n: number }>(await this.db.execute(sql`SELECT count(*)::int AS n FROM games WHERE challenge_id = ${c.id} AND status = 'finished'`));
    const mine = user ? (await this.db.select().from(games).where(and(eq(games.userId, user.id), eq(games.challengeId, c.id))))[0] : undefined;
    return {
      token: c.token,
      map,
      settings: c.settings,
      creatorName: creator?.displayName ?? null,
      plays: p?.n ?? 0,
      gameId: mine?.id ?? null,
      finished: mine?.status === 'finished',
      dailyNumber: c.dailyDate ? dailyNumber(c.dailyDate) : null,
      date: c.dailyDate,
    };
  }

  /** Start (or resume) your game for a challenge. One attempt per player. */
  async playChallenge(user: UserRow, t: string): Promise<GameState> {
    const c = await this.challengeByToken(t);
    if (c.dailyDate && c.dailyDate !== utcDate(this.now())) {
      const mine = (await this.db.select().from(games).where(and(eq(games.userId, user.id), eq(games.challengeId, c.id))))[0];
      if (!mine) throw new GameError(409, 'daily_closed');
    }
    const existing = (await this.db.select().from(games).where(and(eq(games.userId, user.id), eq(games.challengeId, c.id))))[0];
    if (existing) return this.stateOf(existing);
    const map = await this.mapById(c.mapId);
    // Challenges keep the provider they were made with; their location ids pin it.
    const g = await this.createGame(user, map, c.dailyDate ? 'daily' : 'challenge', c.settings, c);
    return this.stateOf(g);
  }

  private async afterChallenge(user: UserRow, challengeId: string): Promise<void> {
    const [c] = await this.db.select().from(challenges).where(eq(challenges.id, challengeId));
    if (!c?.dailyDate) return;
    const fresh = (await this.userById(user.id))!;
    // Finishing an older daily late must not rewind or reset the streak.
    if (fresh.lastDaily && fresh.lastDaily >= c.dailyDate) return;
    const current = fresh.lastDaily === addDays(c.dailyDate, -1) ? fresh.dailyStreak + 1 : 1;
    await this.db
      .update(users)
      .set({ dailyStreak: current, dailyBest: Math.max(current, fresh.dailyBest), lastDaily: c.dailyDate })
      .where(eq(users.id, user.id));
  }

  /* -------------------------------- daily ------------------------------- */

  /** Today's daily challenge, created on first request. Same five places for everyone. */
  async daily(date = utcDate(this.now())): Promise<ChallengeRow> {
    const [existing] = await this.db.select().from(challenges).where(eq(challenges.dailyDate, date));
    if (existing) return existing;
    const world = await this.mapBySlug('world');
    const settings = dailySettings(date);
    const recent = rowsOf<{ id: string }>(
      await this.db.execute(sql`SELECT unnest(location_ids)::text AS id FROM challenges WHERE daily_date IS NOT NULL AND daily_date > ${addDays(date, -120)}::date`),
    ).map((r) => r.id);
    const pool = await this.db
      .select({ id: locations.id, country: locations.country })
      .from(locations)
      .where(and(eq(locations.mapId, world.id), eq(locations.provider, this.config.provider), eq(locations.disabled, false)))
      .orderBy(asc(locations.id));
    const rnd = seededRandom(`daily:${date}`);
    const fresh = pool.filter((p) => !recent.includes(p.id));
    // Five different countries where possible.
    const picks: string[] = [];
    const countriesUsed = new Set<string>();
    for (const p of shuffle(fresh.length >= 5 ? fresh : pool, rnd)) {
      if (picks.length >= settings.rounds) break;
      if (p.country && countriesUsed.has(p.country)) continue;
      picks.push(p.id);
      if (p.country) countriesUsed.add(p.country);
    }
    if (picks.length < settings.rounds) throw new GameError(503, 'no_locations');
    await this.db
      .insert(challenges)
      .values({ token: `daily-${date}`, mapId: world.id, settings, locationIds: picks, dailyDate: date })
      .onConflictDoNothing();
    return (await this.db.select().from(challenges).where(eq(challenges.dailyDate, date)))[0]!;
  }

  async dailyInfo(user: UserRow | null): Promise<ChallengeInfo> {
    return this.infoOf(user, await this.daily());
  }

  /* ---------------------------- leaderboards ---------------------------- */

  async challengeLeaderboard(user: UserRow | null, t: string): Promise<{ rows: LeaderboardRow[]; you: LeaderboardRow | null }> {
    const c = await this.challengeByToken(t);
    // Results are only shown to people who have finished, so the board can't spoil the rounds.
    const all = rowsOf<{ id: string; user_id: string; display_name: string; country: string | null; total_score: number; total_distance_km: number }>(
      await this.db.execute(sql`SELECT g.id, g.user_id, u.display_name, u.country, g.total_score, g.total_distance_km
        FROM games g JOIN users u ON u.id = g.user_id
        WHERE g.challenge_id = ${c.id} AND g.status = 'finished' AND NOT u.banned
        ORDER BY g.total_score DESC, g.total_distance_km ASC, g.finished_at ASC LIMIT 1000`),
    );
    const rows = all.map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      displayName: r.display_name,
      country: r.country,
      score: r.total_score,
      distanceKm: Math.round(r.total_distance_km),
      gameId: r.id,
    }));
    const you = user ? (rows.find((r) => r.userId === user.id) ?? null) : null;
    return { rows: rows.slice(0, 100), you };
  }

  async mapLeaderboard(slug: string, mode: 'classic' | 'streak'): Promise<LeaderboardRow[]> {
    const map = await this.mapBySlug(slug);
    const metric = mode === 'streak' ? sql`max(g.streak)` : sql`max(g.total_score)`;
    const rows = rowsOf<{ user_id: string; display_name: string; country: string | null; best: number }>(
      await this.db.execute(sql`SELECT g.user_id, u.display_name, u.country, ${metric}::int AS best
        FROM games g JOIN users u ON u.id = g.user_id
        WHERE g.map_id = ${map.id} AND g.mode = ${mode === 'streak' ? 'streak' : 'classic'} AND g.status = 'finished' AND NOT u.banned
          AND u.id IS DISTINCT FROM ${map.creatorId} -- a map's maker knows every answer
        GROUP BY g.user_id, u.display_name, u.country ORDER BY best DESC LIMIT 50`),
    );
    return rows.map((r, i) => ({ rank: i + 1, userId: r.user_id, displayName: r.display_name, country: r.country, score: r.best, distanceKm: null }));
  }

  async ratingLeaderboard(): Promise<LeaderboardRow[]> {
    const rows = rowsOf<{ id: string; display_name: string; country: string | null; rating: number }>(
      await this.db.execute(sql`SELECT u.id, u.display_name, u.country, u.rating FROM users u
        WHERE NOT u.banned AND EXISTS (SELECT 1 FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = u.id AND m.ranked)
        ORDER BY u.rating DESC LIMIT 100`),
    );
    return rows.map((r, i) => ({ rank: i + 1, userId: r.id, displayName: r.display_name, country: r.country, score: r.rating, distanceKm: null }));
  }

  /* -------------------------------- stats ------------------------------- */

  async stats(user: UserRow): Promise<ProfileStats> {
    const [agg] = rowsOf<{ games: number; best: number | null; best_streak: number | null }>(
      await this.db.execute(sql`SELECT count(*)::int AS games,
        max(total_score) FILTER (WHERE mode <> 'streak')::int AS best,
        max(streak) FILTER (WHERE mode = 'streak')::int AS best_streak
        FROM games WHERE user_id = ${user.id} AND status = 'finished'`),
    );
    const [rounds] = rowsOf<{ n: number; avg: number | null; perfect: number }>(
      await this.db.execute(sql`SELECT count(*)::int AS n, avg(gr.score)::float AS avg, count(*) FILTER (WHERE gr.score = 5000)::int AS perfect
        FROM game_rounds gr JOIN games g ON g.id = gr.game_id
        WHERE g.user_id = ${user.id} AND gr.guessed_at IS NOT NULL AND g.mode <> 'streak'`),
    );
    const [duels] = rowsOf<{ played: number; won: number }>(
      await this.db.execute(sql`SELECT count(*)::int AS played, count(*) FILTER (WHERE mp.won)::int AS won
        FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.user_id = ${user.id} AND m.format = 'duel'`),
    );
    const recent = rowsOf<{ id: string; mode: GameMode; name: string; total_score: number; streak: number; finished_at: Date | string }>(
      await this.db.execute(sql`SELECT g.id, g.mode, m.name, g.total_score, g.streak, g.finished_at FROM games g JOIN maps m ON m.id = g.map_id
        WHERE g.user_id = ${user.id} AND g.status = 'finished' ORDER BY g.finished_at DESC LIMIT 10`),
    );
    const byCountry = rowsOf<{ country: string; n: number; avg: number }>(
      await this.db.execute(sql`SELECT l.country, count(*)::int AS n, avg(gr.score)::float AS avg
        FROM game_rounds gr JOIN games g ON g.id = gr.game_id JOIN locations l ON l.id = gr.location_id
        WHERE g.user_id = ${user.id} AND gr.guessed_at IS NOT NULL AND g.mode <> 'streak' AND l.country IS NOT NULL
        GROUP BY l.country ORDER BY n DESC LIMIT 40`),
    );
    const [extra] = rowsOf<{ countries: number; maps: number; matches: number }>(
      await this.db.execute(sql`SELECT
        (SELECT count(DISTINCT l.country)::int FROM game_rounds gr JOIN games g ON g.id = gr.game_id JOIN locations l ON l.id = gr.location_id
          WHERE g.user_id = ${user.id} AND gr.guessed_at IS NOT NULL AND l.country IS NOT NULL) AS countries,
        (SELECT count(*)::int FROM maps WHERE creator_id = ${user.id} AND published) AS maps,
        (SELECT count(*)::int FROM match_players WHERE user_id = ${user.id}) AS matches`),
    );
    const badges = badgeProgress({
      gamesFinished: agg?.games ?? 0,
      perfectRounds: rounds?.perfect ?? 0,
      bestGame: agg?.best ?? 0,
      countriesPlayed: extra?.countries ?? 0,
      bestStreak: agg?.best_streak ?? 0,
      bestDailyStreak: user.dailyBest,
      duelsWon: duels?.won ?? 0,
      rating: user.rating,
      mapsPublished: extra?.maps ?? 0,
      matchesPlayed: extra?.matches ?? 0,
    });
    return {
      badges,
      gamesPlayed: agg?.games ?? 0,
      roundsPlayed: rounds?.n ?? 0,
      averageScore: Math.round(rounds?.avg ?? 0),
      bestGame: agg?.best ?? 0,
      perfectRounds: rounds?.perfect ?? 0,
      bestStreak: agg?.best_streak ?? 0,
      duels: { played: duels?.played ?? 0, won: duels?.won ?? 0, rating: user.rating },
      recent: recent.map((r) => ({
        gameId: r.id,
        mode: r.mode,
        mapName: r.name,
        score: r.total_score,
        streak: r.streak,
        finishedAt: new Date(r.finished_at).toISOString(),
      })),
      countries: byCountry.map((c) => ({ code: c.country, name: countryName(c.country), rounds: c.n, averageScore: Math.round(c.avg) })),
    };
  }
}
