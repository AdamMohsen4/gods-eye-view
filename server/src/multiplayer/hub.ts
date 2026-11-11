/**
 * Realtime hub: sockets, duel matchmaking, party rooms and live matches.
 * Single process, in memory. Running more than one instance needs sticky
 * sessions or a shared bus (see docs/ADR-003).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { locations, matchPlayers, matches, users, type Db, type UserRow } from '@earthnow/db';
import {
  MOVE_MODES,
  TIME_LIMITS,
  elo,
  type ClientMessage,
  type MapSummary,
  type PartySettings,
  type PartyState,
  type ServerMessage,
} from '@earthnow/shared';
import type { Config } from '../config.ts';
import { countryRef } from '../countries.ts';
import { GameError, type Game } from '../game.ts';
import { DEFAULT_TIMING, Match, MatchError, type MatchLocation, type MatchResult, type MatchTiming } from './match.ts';

export interface Socket {
  send(data: string): void;
  close(): void;
}

interface Conn {
  socket: Socket;
  user: UserRow | null;
  tokens: number;
  last: number;
}

interface Party {
  code: string;
  hostId: string;
  members: string[];
  settings: PartySettings;
  matchId: string | null;
  leaveTimers: Map<string, () => void>;
}

const PARTY_MAX = 8;
const PARTY_GRACE_MS = 60_000;
const DUEL_SETTINGS = { move: 'move' as const, timeLimit: 0, rounds: 0 };

export interface HubOptions {
  timing?: MatchTiming;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export class Hub {
  private conns = new Set<Conn>();
  private byUser = new Map<string, Set<Conn>>();
  private queues: Record<'ranked' | 'casual', { userId: string; since: number }[]> = { ranked: [], casual: [] };
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, string>();
  readonly matches = new Map<string, Match>();
  private now: () => number;
  private schedule: (fn: () => void, ms: number) => () => void;
  private timing: MatchTiming;

  constructor(
    private db: Db,
    private game: Game,
    private config: Config,
    opts: HubOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.schedule =
      opts.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
    this.timing = opts.timing ?? { ...DEFAULT_TIMING, countdownMs: config.duelCountdownSeconds * 1000 };
  }

  /* ------------------------------ sockets ------------------------------ */

  connect(socket: Socket): (raw: string) => Promise<void> {
    const conn: Conn = { socket, user: null, tokens: 20, last: this.now() };
    this.conns.add(conn);
    return async (raw: string) => {
      // Token bucket: 10 messages/s sustained, bursts of 20.
      const t = this.now();
      conn.tokens = Math.min(20, conn.tokens + ((t - conn.last) / 1000) * 10);
      conn.last = t;
      if (conn.tokens < 1) return this.send(conn, { t: 'error', code: 'rate_limited' });
      conn.tokens -= 1;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw) as ClientMessage;
      } catch {
        return this.send(conn, { t: 'error', code: 'bad_json' });
      }
      try {
        await this.handle(conn, msg);
      } catch (e) {
        const code = e instanceof MatchError || e instanceof GameError ? (e as Error & { code?: string }).code ?? e.message : 'internal';
        if (code === 'internal') console.error('[hub]', e);
        this.send(conn, { t: 'error', code });
      }
    };
  }

  disconnect(socket: Socket): void {
    const conn = [...this.conns].find((c) => c.socket === socket);
    if (!conn) return;
    this.conns.delete(conn);
    const uid = conn.user?.id;
    if (!uid) return;
    const set = this.byUser.get(uid);
    set?.delete(conn);
    if (set && set.size === 0) {
      this.byUser.delete(uid);
      this.leaveQueues(uid);
      for (const m of this.matches.values()) if (m.isPlayer(uid)) m.setConnected(uid, false);
      const code = this.partyOf.get(uid);
      const party = code ? this.parties.get(code) : undefined;
      if (party) {
        party.leaveTimers.set(uid, this.schedule(() => this.leaveParty(uid), PARTY_GRACE_MS));
        this.publishParty(party);
      }
    }
  }

  private send(conn: Conn, msg: ServerMessage): void {
    try {
      conn.socket.send(JSON.stringify(msg));
    } catch {
      /* socket gone */
    }
  }

  private sendUser(userId: string, msg: ServerMessage): void {
    for (const c of this.byUser.get(userId) ?? []) this.send(c, msg);
  }

  online(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  private async handle(conn: Conn, msg: ClientMessage): Promise<void> {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    if (msg.t === 'hello') {
      if (typeof msg.guestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(msg.guestId)) throw new GameError(400, 'guest_id_required');
      const user = await this.game.guest(msg.guestId.toLowerCase());
      if (user.banned) throw new GameError(403, 'banned');
      conn.user = user;
      const set = this.byUser.get(user.id) ?? new Set();
      set.add(conn);
      this.byUser.set(user.id, set);
      this.send(conn, { t: 'welcome', userId: user.id });
      // Reattach to anything in progress.
      for (const m of this.matches.values()) {
        if (m.isPlayer(user.id)) {
          m.setConnected(user.id, true);
          this.send(conn, { t: 'match.state', match: m.view() });
        }
      }
      const code = this.partyOf.get(user.id);
      const party = code ? this.parties.get(code) : undefined;
      if (party) {
        party.leaveTimers.get(user.id)?.();
        party.leaveTimers.delete(user.id);
        this.publishParty(party);
      }
      return;
    }
    if (!conn.user) throw new GameError(401, 'hello_first');
    // Refresh name/rating changes made over HTTP.
    const me = (await this.game.userById(conn.user.id)) ?? conn.user;
    conn.user = me;

    switch (msg.t) {
      case 'queue.join':
        return this.joinQueue(me, !!msg.ranked);
      case 'queue.leave':
        this.leaveQueues(me.id);
        return this.sendUser(me.id, { t: 'queue.status', waiting: false, since: null, ranked: false });
      case 'party.create':
        return this.createParty(me);
      case 'party.join':
        return this.joinParty(me, String(msg.code ?? '').toUpperCase());
      case 'party.leave':
        return this.leaveParty(me.id);
      case 'party.settings':
        return this.partySettings(me.id, msg.settings);
      case 'party.start':
        return this.startParty(me.id);
      case 'party.kick':
        return this.kick(me.id, String(msg.playerId));
      case 'match.watch': {
        const m = this.matches.get(String(msg.matchId));
        if (!m || !m.isPlayer(me.id)) throw new GameError(404, 'match_not_found');
        return this.send(conn, { t: 'match.state', match: m.view() });
      }
      case 'match.guess': {
        const m = this.matches.get(String(msg.matchId));
        if (!m) throw new GameError(404, 'match_not_found');
        return m.guess(me.id, msg.guess);
      }
      case 'match.leave': {
        const m = this.matches.get(String(msg.matchId));
        if (m?.isPlayer(me.id)) m.leave(me.id);
        return;
      }
      default:
        throw new GameError(400, 'unknown_message');
    }
  }

  /* ---------------------------- matchmaking ---------------------------- */

  private leaveQueues(userId: string): void {
    for (const k of ['ranked', 'casual'] as const) this.queues[k] = this.queues[k].filter((q) => q.userId !== userId);
  }

  private inActiveMatch(userId: string): boolean {
    return [...this.matches.values()].some((m) => m.isPlayer(userId) && m.phase !== 'finished');
  }

  private async joinQueue(me: UserRow, ranked: boolean): Promise<void> {
    if (this.inActiveMatch(me.id)) throw new GameError(409, 'already_in_match');
    this.leaveQueues(me.id);
    const key = ranked ? 'ranked' : 'casual';
    const q = this.queues[key];
    // Closest rating among those waiting, widening with wait time.
    const candidates = [];
    for (const w of q) {
      if (w.userId === me.id || !this.online(w.userId)) continue;
      const u = await this.game.userById(w.userId);
      if (!u) continue;
      const window = 150 + ((this.now() - w.since) / 1000) * 25;
      if (!ranked || Math.abs(u.rating - me.rating) <= window) candidates.push({ w, u });
    }
    candidates.sort((a, b) => Math.abs(a.u.rating - me.rating) - Math.abs(b.u.rating - me.rating));
    const opp = candidates[0];
    if (!opp) {
      q.push({ userId: me.id, since: this.now() });
      this.sendUser(me.id, { t: 'queue.status', waiting: true, since: new Date().toISOString(), ranked });
      return;
    }
    this.queues[key] = q.filter((x) => x !== opp.w);
    for (const id of [me.id, opp.u.id]) this.sendUser(id, { t: 'queue.status', waiting: false, since: null, ranked });
    const world = await this.game.mapSummary(await this.game.mapBySlug('world'));
    await this.startMatch('duel', ranked, world, DUEL_SETTINGS, [me, opp.u]);
  }

  /* ------------------------------- matches ------------------------------ */

  private async startMatch(format: 'duel' | 'classic', ranked: boolean, map: MapSummary, settings: PartySettings | typeof DUEL_SETTINGS, players: UserRow[]): Promise<Match> {
    const id = randomUUID();
    const s = { move: settings.move, timeLimit: settings.timeLimit, rounds: settings.rounds };
    const match: Match = new Match(
      id,
      format,
      ranked,
      map,
      s,
      players.map((u) => ({ id: u.id, name: u.displayName, country: u.country, rating: u.rating })),
      {
        now: this.now,
        schedule: this.schedule,
        pickLocation: (exclude) => this.pickLocation(map.id, exclude),
        publish: (state) => {
          for (const p of state.players) this.sendUser(p.id, { t: 'match.state', match: state });
        },
        finish: (r) => this.persist(r),
      },
      this.timing,
    );
    this.matches.set(id, match);
    // Forget finished matches after a while.
    this.schedule(() => this.cleanupMatch(id), 6 * 3600_000);
    match.start();
    return match;
  }

  private cleanupMatch(id: string): void {
    const m = this.matches.get(id);
    if (m && m.phase === 'finished') {
      m.dispose();
      this.matches.delete(id);
    } else if (m) this.schedule(() => this.cleanupMatch(id), 3600_000);
  }

  private async pickLocation(mapId: string, exclude: string[]): Promise<MatchLocation> {
    const base = and(eq(locations.mapId, mapId), eq(locations.provider, this.config.provider), eq(locations.disabled, false));
    const where = exclude.length ? and(base, sql`${locations.id} NOT IN (${sql.join(exclude.map((e) => sql`${e}::uuid`), sql`, `)})`) : base;
    const [l] = await this.db.select().from(locations).where(where).orderBy(sql`random()`).limit(1);
    if (!l) throw new GameError(409, 'map_exhausted');
    return {
      id: l.id,
      lat: l.lat,
      lon: l.lon,
      pano: { provider: l.provider, panoId: l.panoId, heading: l.heading },
      country: countryRef(l.country),
      credit: l.credit,
    };
  }

  private async persist(r: MatchResult): Promise<Record<string, number>> {
    const changes: Record<string, number> = {};
    if (r.ranked && r.format === 'duel' && r.players.length === 2) {
      const [a, b] = r.players as [MatchResult['players'][0], MatchResult['players'][0]];
      const aScore = r.winnerId === a.id ? 1 : r.winnerId === b.id ? 0 : 0.5;
      const [na, nb] = elo(a.rating, b.rating, aScore);
      changes[a.id] = na - a.rating;
      changes[b.id] = nb - b.rating;
    }
    await this.db.insert(matches).values({
      id: r.matchId,
      format: r.format,
      ranked: r.ranked,
      mapId: r.mapId,
      settings: r.settings,
      winnerId: r.winnerId,
      summary: { history: r.history, players: r.players },
      finishedAt: new Date(this.now()),
    });
    for (const p of r.players) {
      await this.db
        .insert(matchPlayers)
        .values({ matchId: r.matchId, userId: p.id, total: p.total, won: p.won, ratingChange: changes[p.id] ?? 0 })
        .onConflictDoNothing();
      const xp = Math.floor(p.total / 200) + (p.won ? 25 : 0);
      await this.db
        .update(users)
        .set({ rating: sql`${users.rating} + ${changes[p.id] ?? 0}`, xp: sql`${users.xp} + ${xp}` })
        .where(eq(users.id, p.id));
    }
    return changes;
  }

  /* ------------------------------- parties ------------------------------ */

  private newCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = [...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join('');
      if (!this.parties.has(code)) return code;
    }
  }

  private async partyState(p: Party): Promise<PartyState> {
    const players = [];
    for (const id of p.members) {
      const u = await this.game.userById(id);
      if (u) players.push({ id, name: u.displayName, country: u.country, rating: u.rating, connected: this.online(id), hp: 0, total: 0 });
    }
    let map: MapSummary | null = null;
    try {
      map = await this.game.mapSummary(await this.game.mapBySlug(p.settings.mapSlug));
    } catch {
      map = null;
    }
    return { code: p.code, hostId: p.hostId, players, settings: p.settings, map, matchId: p.matchId };
  }

  private publishParty(p: Party): void {
    void this.partyState(p).then((party) => {
      for (const id of p.members) this.sendUser(id, { t: 'party.state', party });
    });
  }

  private async createParty(me: UserRow): Promise<void> {
    this.leaveParty(me.id);
    const party: Party = {
      code: this.newCode(),
      hostId: me.id,
      members: [me.id],
      settings: { mapSlug: 'world', format: 'classic', move: 'move', timeLimit: 120, rounds: 5 },
      matchId: null,
      leaveTimers: new Map(),
    };
    this.parties.set(party.code, party);
    this.partyOf.set(me.id, party.code);
    this.publishParty(party);
  }

  private async joinParty(me: UserRow, code: string): Promise<void> {
    const party = this.parties.get(code);
    if (!party) throw new GameError(404, 'party_not_found');
    if (party.members.includes(me.id)) return this.publishParty(party);
    if (party.members.length >= PARTY_MAX) throw new GameError(409, 'party_full');
    this.leaveParty(me.id);
    party.members.push(me.id);
    this.partyOf.set(me.id, code);
    this.publishParty(party);
  }

  private leaveParty(userId: string): void {
    const code = this.partyOf.get(userId);
    const party = code ? this.parties.get(code) : undefined;
    this.partyOf.delete(userId);
    if (!party) return;
    party.leaveTimers.get(userId)?.();
    party.leaveTimers.delete(userId);
    party.members = party.members.filter((m) => m !== userId);
    if (party.matchId) this.matches.get(party.matchId)?.leave(userId);
    if (party.members.length === 0) {
      this.parties.delete(party.code);
      return;
    }
    if (party.hostId === userId) party.hostId = party.members[0]!;
    this.publishParty(party);
  }

  private hostParty(userId: string): Party {
    const code = this.partyOf.get(userId);
    const party = code ? this.parties.get(code) : undefined;
    if (!party) throw new GameError(404, 'party_not_found');
    if (party.hostId !== userId) throw new GameError(403, 'host_only');
    return party;
  }

  private async partySettings(userId: string, patch: Partial<PartySettings>): Promise<void> {
    const party = this.hostParty(userId);
    const s = { ...party.settings };
    if (typeof patch.mapSlug === 'string') {
      const map = await this.game.mapBySlug(patch.mapSlug);
      if (!map.published) throw new GameError(404, 'map_not_found');
      s.mapSlug = map.slug;
    }
    if (patch.format === 'duel' || patch.format === 'classic') s.format = patch.format;
    if (MOVE_MODES.includes(patch.move as never)) s.move = patch.move!;
    if (TIME_LIMITS.includes(patch.timeLimit as never)) s.timeLimit = patch.timeLimit!;
    if (Number.isInteger(patch.rounds) && patch.rounds! >= 1 && patch.rounds! <= 10) s.rounds = patch.rounds!;
    party.settings = s;
    this.publishParty(party);
  }

  private async startParty(userId: string): Promise<void> {
    const party = this.hostParty(userId);
    const running = party.matchId ? this.matches.get(party.matchId) : undefined;
    if (running && running.phase !== 'finished') throw new GameError(409, 'already_running');
    const present = party.members.filter((m) => this.online(m));
    if (party.settings.format === 'duel' && present.length !== 2) throw new GameError(409, 'duel_needs_two');
    if (present.length < 1) throw new GameError(409, 'not_enough_players');
    const players = (await Promise.all(present.map((id) => this.game.userById(id)))).filter((u): u is UserRow => !!u);
    const map = await this.game.mapSummary(await this.game.mapBySlug(party.settings.mapSlug));
    const settings = party.settings.format === 'duel' ? { ...party.settings, rounds: 0 } : party.settings;
    const match = await this.startMatch(party.settings.format, false, map, settings, players);
    party.matchId = match.id;
    this.publishParty(party);
  }

  private kick(userId: string, target: string): void {
    const party = this.hostParty(userId);
    if (target === userId || !party.members.includes(target)) return;
    this.leaveParty(target);
    this.sendUser(target, { t: 'party.closed', reason: 'kicked' });
  }
}
