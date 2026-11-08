/**
 * Game logic over the database. The true location of a snapshot only leaves
 * this module through `guessRound` (after the guess is locked) and the admin
 * routes. `toPublicRound` is the single place a snapshot becomes client data.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import {
  dailies,
  rounds,
  rowsOf,
  snapshots,
  streaks,
  users,
  type Db,
  type RoundRow,
  type SnapshotRow,
  type UserRow,
} from '@earthnow/db';
import {
  MAX_CLUES,
  haversineKm,
  isLatLon,
  scoreRound,
  utcDate,
  type ClueResponse,
  type DailyToday,
  type FactCard,
  type GuessResponse,
  type LatLon,
  type LeaderboardRow,
  type MeResponse,
  type PublicRound,
  type StartRoundResponse,
} from '@earthnow/shared';
import type { Config } from './config.ts';
import { revealAttribution } from './attributions.ts';
import { EMPTY_STREAK, completeDay, displayStreak, type StreakRecord } from './streak.ts';

export class GameError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function toPublicRound(s: SnapshotRow): PublicRound {
  return {
    snapshotId: s.id,
    type: s.type,
    capturedAt: s.capturedAt.toISOString(),
    camera: s.cameraPose,
    subject: s.subject,
    sceneTime: s.eventAt.toISOString(),
    cluesAvailable: Math.min(MAX_CLUES, s.clues.length),
  };
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

  private async streakRecord(userId: string): Promise<StreakRecord> {
    const [row] = await this.db.select().from(streaks).where(eq(streaks.userId, userId));
    return row ?? EMPTY_STREAK;
  }

  async me(user: UserRow): Promise<MeResponse> {
    const today = utcDate(this.now());
    return {
      id: user.id,
      displayName: user.displayName,
      country: user.country,
      plan: user.plan,
      streak: displayStreak(await this.streakRecord(user.id), today),
      arcade: {
        usedToday: await this.arcadeUsedToday(user.id),
        limit: user.plan === 'plus' ? null : this.config.arcadeFreeRoundsPerDay,
      },
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
      if (patch.country === null) set.country = null;
      else if (typeof patch.country === 'string' && /^[A-Za-z]{2}$/.test(patch.country)) set.country = patch.country.toUpperCase();
      else throw new GameError(400, 'invalid_country');
    }
    if (Object.keys(set).length) await this.db.update(users).set(set).where(eq(users.id, user.id));
    const [fresh] = await this.db.select().from(users).where(eq(users.id, user.id));
    return this.me(fresh!);
  }

  /** GDPR: delete everything tied to this player. */
  async deleteMe(user: UserRow): Promise<void> {
    await this.db.delete(rounds).where(eq(rounds.userId, user.id));
    await this.db.delete(streaks).where(eq(streaks.userId, user.id));
    await this.db.delete(users).where(eq(users.id, user.id));
  }

  /* ------------------------------- daily ------------------------------- */

  async dailyFor(date: string) {
    const [d] = await this.db.select().from(dailies).where(eq(dailies.date, date));
    if (!d) return null;
    const rows = await this.db.select().from(snapshots).where(inArray(snapshots.id, d.snapshotIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { daily: d, snapshots: d.snapshotIds.map((id) => byId.get(id)!).filter(Boolean) };
  }

  async today(user: UserRow | null): Promise<DailyToday> {
    const date = utcDate(this.now());
    const found = await this.dailyFor(date);
    if (!found) throw new GameError(503, 'daily_not_ready');
    const played = user
      ? await this.db
          .select()
          .from(rounds)
          .where(and(eq(rounds.userId, user.id), inArray(rounds.snapshotId, found.daily.snapshotIds)))
      : [];
    return {
      date,
      number: found.daily.number,
      rounds: found.snapshots.map(toPublicRound),
      played: found.snapshots.map((s) => {
        const r = played.find((p) => p.snapshotId === s.id && p.guessedAt);
        return r ? { snapshotId: s.id, score: r.score ?? 0, distanceKm: r.distanceKm } : null;
      }),
    };
  }

  /* ------------------------------- rounds ------------------------------ */

  private async snapshot(id: string): Promise<SnapshotRow> {
    const [s] = await this.db.select().from(snapshots).where(eq(snapshots.id, id));
    if (!s) throw new GameError(404, 'snapshot_not_found');
    return s;
  }

  private startResponse(r: RoundRow, s: SnapshotRow): StartRoundResponse {
    return {
      roundId: r.id,
      startedAt: r.startedAt.toISOString(),
      deadline: r.deadline?.toISOString() ?? null,
      round: toPublicRound(s),
      cluesUsed: s.clues.slice(0, r.cluesUsed),
    };
  }

  async startDaily(user: UserRow, snapshotId: string): Promise<StartRoundResponse> {
    const date = utcDate(this.now());
    const found = await this.dailyFor(date);
    if (!found || !found.daily.snapshotIds.includes(snapshotId)) throw new GameError(404, 'not_in_todays_daily');
    const s = found.snapshots.find((x) => x.id === snapshotId)!;
    const [existing] = await this.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, user.id), eq(rounds.snapshotId, snapshotId)));
    if (existing) {
      if (existing.guessedAt) throw new GameError(409, 'already_played');
      return this.startResponse(existing, s);
    }
    const startedAt = this.now();
    const deadline = new Date(startedAt.getTime() + this.config.roundTimerSeconds * 1000);
    const [r] = await this.db
      .insert(rounds)
      .values({ userId: user.id, snapshotId, mode: 'daily', dailyDate: date, startedAt, deadline })
      .onConflictDoNothing()
      .returning();
    if (!r) return this.startDaily(user, snapshotId); // lost a race; return the winner's row
    return this.startResponse(r, s);
  }

  private async arcadeUsedToday(userId: string): Promise<number> {
    const dayStart = new Date(`${utcDate(this.now())}T00:00:00Z`);
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.mode, 'arcade'), gte(rounds.startedAt, dayStart)));
    return Number(row?.n ?? 0);
  }

  /** Arcade: a snapshot at least 5 minutes old, preferring the 5–15 minute window. */
  async nextArcade(user: UserRow): Promise<StartRoundResponse> {
    if (user.plan !== 'plus') {
      const used = await this.arcadeUsedToday(user.id);
      if (used >= this.config.arcadeFreeRoundsPerDay)
        throw new GameError(429, 'arcade_limit', { limit: this.config.arcadeFreeRoundsPerDay });
    }
    const now = this.now();
    const minAge = new Date(now.getTime() - 5 * 60_000);
    const freshest = new Date(now.getTime() - 15 * 60_000);
    // Never serve a snapshot that is in today's or a future Daily.
    const reserved = rowsOf<{ id: string }>(
      await this.db.execute(sql`SELECT unnest(snapshot_ids)::text AS id FROM dailies WHERE date >= ${utcDate(now)}::date`),
    ).map((r) => r.id);
    const played = (await this.db.select({ id: rounds.snapshotId }).from(rounds).where(eq(rounds.userId, user.id))).map((r) => r.id);
    const exclude = [...reserved, ...played];
    const base = and(eq(snapshots.disabled, false), lte(snapshots.capturedAt, minAge), exclude.length ? notInArray(snapshots.id, exclude) : undefined);
    let pool = await this.db
      .select()
      .from(snapshots)
      .where(and(base, gte(snapshots.capturedAt, freshest)))
      .limit(50);
    if (!pool.length) pool = await this.db.select().from(snapshots).where(base).orderBy(desc(snapshots.capturedAt)).limit(50);
    if (!pool.length) throw new GameError(503, 'arcade_empty');
    const s = pool[Math.floor(Math.random() * pool.length)]!;
    const [r] = await this.db
      .insert(rounds)
      .values({ userId: user.id, snapshotId: s.id, mode: 'arcade', startedAt: now, deadline: null })
      .returning();
    return this.startResponse(r!, s);
  }

  private async ownRound(user: UserRow, roundId: string): Promise<RoundRow> {
    if (!/^[0-9a-f-]{36}$/i.test(roundId)) throw new GameError(404, 'round_not_found');
    const [r] = await this.db.select().from(rounds).where(and(eq(rounds.id, roundId), eq(rounds.userId, user.id)));
    if (!r) throw new GameError(404, 'round_not_found');
    return r;
  }

  private expired(r: RoundRow): boolean {
    return !!r.deadline && this.now().getTime() > r.deadline.getTime() + this.config.timerGraceSeconds * 1000;
  }

  async clue(user: UserRow, roundId: string): Promise<ClueResponse> {
    const r = await this.ownRound(user, roundId);
    if (r.guessedAt || this.expired(r)) throw new GameError(409, 'round_closed');
    const s = await this.snapshot(r.snapshotId);
    if (r.cluesUsed >= Math.min(MAX_CLUES, s.clues.length)) throw new GameError(409, 'no_more_clues');
    const [updated] = await this.db
      .update(rounds)
      .set({ cluesUsed: sql`${rounds.cluesUsed} + 1` })
      .where(and(eq(rounds.id, r.id), eq(rounds.cluesUsed, r.cluesUsed), sql`${rounds.guessedAt} IS NULL`))
      .returning();
    if (!updated) throw new GameError(409, 'round_closed');
    return { clue: s.clues[r.cluesUsed]!, cluesUsed: updated.cluesUsed };
  }

  async guess(user: UserRow, roundId: string, guess: unknown): Promise<GuessResponse> {
    const r = await this.ownRound(user, roundId);
    if (r.guessedAt) throw new GameError(409, 'already_guessed');
    if (guess !== null && !isLatLon(guess)) throw new GameError(400, 'invalid_guess');
    const s = await this.snapshot(r.snapshotId);
    const timedOut = this.expired(r);
    const pin: LatLon | null = guess && !timedOut ? { lat: (guess as LatLon).lat, lon: (guess as LatLon).lon } : null;
    const truth = { lat: s.trueLat, lon: s.trueLon };
    const distanceKm = pin ? haversineKm(pin, truth) : null;
    const score = scoreRound(s.type, distanceKm, r.cluesUsed);
    const [locked] = await this.db
      .update(rounds)
      .set({
        guessLat: pin?.lat ?? null,
        guessLon: pin?.lon ?? null,
        guessedAt: this.now(),
        distanceKm,
        score,
        timedOut,
      })
      .where(and(eq(rounds.id, r.id), sql`${rounds.guessedAt} IS NULL`))
      .returning();
    if (!locked) throw new GameError(409, 'already_guessed');

    const response: GuessResponse = {
      roundId: r.id,
      truth,
      guess: pin,
      distanceKm: distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      score,
      timedOut,
      fact: this.factWithAge(s),
      attribution: revealAttribution(s.type),
    };
    if (r.mode === 'daily' && r.dailyDate) {
      const done = await this.completedDaily(user.id, r.dailyDate);
      if (done) response.dailyComplete = done;
    }
    return response;
  }

  private factWithAge(s: SnapshotRow): FactCard {
    const fact = (s.payload as { fact: FactCard }).fact;
    const mins = Math.max(0, Math.round((this.now().getTime() - s.capturedAt.getTime()) / 60_000));
    const age = mins < 90 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} days`;
    const lines = [...fact.lines];
    if (s.type === 'flight' || s.type === 'satellite') lines[lines.length - 1] = `Captured ${age} ago`;
    return { ...fact, lines };
  }

  /** If all five daily rounds are guessed, update the streak once and return totals. */
  private async completedDaily(userId: string, date: string) {
    const found = await this.dailyFor(date);
    if (!found) return null;
    const mine = await this.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), inArray(rounds.snapshotId, found.daily.snapshotIds), isNotNull(rounds.guessedAt)));
    if (mine.length < found.daily.snapshotIds.length) return null;
    const next = completeDay(await this.streakRecord(userId), date);
    await this.db
      .insert(streaks)
      .values({ userId, ...next })
      .onConflictDoUpdate({ target: streaks.userId, set: next });
    return {
      total: mine.reduce((sum, x) => sum + (x.score ?? 0), 0),
      streak: { current: next.current, best: next.best, freezeAvailable: next.freezeAvailable },
    };
  }

  async summary(user: UserRow, date: string) {
    const found = await this.dailyFor(date);
    if (!found) throw new GameError(404, 'daily_not_found');
    const mine = await this.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, user.id), inArray(rounds.snapshotId, found.daily.snapshotIds)));
    const list = found.snapshots.map((s) => {
      const r = mine.find((m) => m.snapshotId === s.id && m.guessedAt);
      return {
        type: s.type,
        score: r?.score ?? null,
        guess: r && r.guessLat !== null && r.guessLon !== null ? { lat: r.guessLat, lon: r.guessLon } : null,
      };
    });
    return { date, number: found.daily.number, total: list.reduce((a, b) => a + (b.score ?? 0), 0), rounds: list };
  }

  /* ---------------------------- leaderboard ---------------------------- */

  async leaderboard(user: UserRow | null, scope: 'global' | 'country', date: string) {
    const country = scope === 'country' ? user?.country ?? null : null;
    if (scope === 'country' && !country) return { date, scope, rows: [] as LeaderboardRow[], you: null };
    const totals = rowsOf<{ id: string; display_name: string; country: string | null; score: number }>(
      await this.db.execute(sql`
        SELECT u.id, u.display_name, u.country, SUM(r.score)::int AS score
        FROM rounds r JOIN users u ON u.id = r.user_id
        WHERE r.mode = 'daily' AND r.daily_date = ${date}::date AND r.score IS NOT NULL AND NOT u.banned
          ${country ? sql`AND u.country = ${country}` : sql``}
        GROUP BY u.id ORDER BY score DESC, MIN(r.guessed_at) ASC`),
    );
    const rows = totals.map((t, i) => ({
      rank: i + 1,
      displayName: t.display_name,
      country: t.country?.trim() ?? null,
      score: t.score,
      isYou: t.id === user?.id,
    }));
    return { date, scope, rows: rows.slice(0, 50), you: rows.find((r) => r.isYou) ?? null };
  }
}
