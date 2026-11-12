/**
 * Realtime hub: sockets, duel matchmaking, party rooms and live matches.
 * Single process, in memory. Running more than one instance needs sticky
 * sessions or a shared bus (see docs/ADR-003).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { locations, maps, matchPlayers, matches, users, type Db, type UserRow } from '@earthnow/db';
import {
  MATCH_FORMATS,
  MOVE_MODES,
  TIME_LIMITS,
  elo,
  type ClientMessage,
  type MapSummary,
  type MatchFormat,
  type PartySettings,
  type PartyState,
  type ServerMessage,
} from '@earthnow/shared';
import type { Config } from '../config.ts';
import { countryRef } from '../countries.ts';
import { GameError, type Game } from '../game.ts';
import { DEFAULT_TIMING, Match, MatchError, type MatchLocation, type MatchResult, type MatchTiming } from './match.ts';
import type { Friends } from '../friends.ts';

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
  starting: boolean;
  leaveTimers: Map<string, () => void>;
  /** Teams format: member id → 0 or 1. */
  teams: Map<string, number>;
}

const PARTY_MAX = 8;
const PARTY_GRACE_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DUEL_SETTINGS = { move: 'move' as const, timeLimit: 0, rounds: 0 };

export interface HubOptions {
  timing?: MatchTiming;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export class Hub {
  /** Set by the app once both exist (friends need the hub's presence; invites need friends). */
  friends: Friends | null = null;
  private conns = new Set<Conn>();
  private byUser = new Map<string, Set<Conn>>();
  private queues: Record<'ranked' | 'casual', { userId: string; rating: number; since: number }[]> = { ranked: [], casual: [] };
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
    this.detach(conn);
  }

  /** Removes a socket from its user; if it was their last one, they go offline. */
  private detach(conn: Conn): void {
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
    if (msg.t === 'ping') return this.send(conn, { t: 'pong', now: this.now() });
    if (msg.t === 'hello') {
      if (typeof msg.guestId !== 'string' || !UUID_RE.test(msg.guestId)) throw new GameError(400, 'guest_id_required');
      const user = await this.game.guest(msg.guestId.toLowerCase());
      if (user.banned) throw new GameError(403, 'banned');
      if (conn.user && conn.user.id !== user.id) this.detach(conn);
      conn.user = user;
      const set = this.byUser.get(user.id) ?? new Set();
      set.add(conn);
      this.byUser.set(user.id, set);
      const live = [...this.matches.values()].filter((m) => m.isPlayer(user.id)).map((m) => m.id);
      this.send(conn, { t: 'welcome', userId: user.id, now: this.now(), matchIds: live });
      // Full state so a reconnecting client never shows stale queue/party/match views.
      const queued = (['ranked', 'casual'] as const).find((k) => this.queues[k].some((q) => q.userId === user.id));
      const entry = queued ? this.queues[queued].find((q) => q.userId === user.id) : undefined;
      this.send(conn, {
        t: 'queue.status',
        waiting: !!entry,
        since: entry ? new Date(entry.since).toISOString() : null,
        ranked: queued === 'ranked',
      });
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
      } else {
        this.send(conn, { t: 'party.closed', reason: 'none' });
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
        this.leaveParty(me.id);
        return this.sendUser(me.id, { t: 'party.closed', reason: 'left' });
      case 'party.settings':
        return this.partySettings(me.id, msg.settings);
      case 'party.start':
        return this.startParty(me.id);
      case 'party.kick':
        return this.kick(me.id, String(msg.playerId));
      case 'party.invite':
        return this.invite(me, String(msg.userId));
      case 'party.team':
        return this.setTeam(me.id, msg.playerId === undefined ? me.id : String(msg.playerId), Number(msg.team));
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
    // Pairing is synchronous (ratings are snapshotted at join time), so two
    // players joining at once can never both claim the same opponent.
    const now = this.now();
    const candidates = this.queues[key].filter((w) => {
      if (w.userId === me.id || !this.online(w.userId) || this.inActiveMatch(w.userId)) return false;
      const window = 150 + ((now - w.since) / 1000) * 25;
      return !ranked || Math.abs(w.rating - me.rating) <= window;
    });
    candidates.sort((a, b) => Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating));
    const opp = candidates[0];
    if (!opp) {
      this.queues[key].push({ userId: me.id, rating: me.rating, since: now });
      this.sendUser(me.id, { t: 'queue.status', waiting: true, since: new Date(now).toISOString(), ranked });
      return;
    }
    this.leaveQueues(opp.userId);
    for (const id of [me.id, opp.userId]) this.sendUser(id, { t: 'queue.status', waiting: false, since: null, ranked });
    try {
      const other = await this.game.userById(opp.userId);
      if (!other) throw new GameError(409, 'opponent_gone');
      const world = await this.game.mapSummary(await this.game.mapBySlug('world'));
      await this.startMatch('duel', ranked, world, DUEL_SETTINGS, [me, other]);
    } catch (e) {
      // Put the waiting player back; the joiner gets the error.
      if (this.online(opp.userId) && !this.inActiveMatch(opp.userId)) {
        this.queues[key].push(opp);
        this.sendUser(opp.userId, { t: 'queue.status', waiting: true, since: new Date(opp.since).toISOString(), ranked });
      }
      throw e;
    }
  }

  /* ------------------------------- matches ------------------------------ */

  private async startMatch(
    format: MatchFormat,
    ranked: boolean,
    map: MapSummary,
    settings: PartySettings | typeof DUEL_SETTINGS,
    players: UserRow[],
    teams?: Map<string, number>,
  ): Promise<Match> {
    const id = randomUUID();
    const s = { move: settings.move, timeLimit: settings.timeLimit, rounds: settings.rounds };
    const match: Match = new Match(
      id,
      format,
      ranked,
      map,
      s,
      players.map((u) => ({ id: u.id, name: u.displayName, country: u.country, rating: u.rating, team: teams?.get(u.id) })),
      {
        now: this.now,
        schedule: this.schedule,
        pickLocation: (exclude) => this.pickLocation(map.id, exclude),
        publish: (state) => {
          for (const p of state.players) this.sendUser(p.id, { t: 'match.state', match: state });
        },
        finish: (r) => this.persist(r),
        log: (message, err) => console.error(`[match ${id}] ${message}`, err),
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
    // The map or a player's account may have been deleted mid-match.
    const [mapRow] = await this.db.select({ id: maps.id }).from(maps).where(eq(maps.id, r.mapId));
    const alive = new Set(
      (await this.db.select({ id: users.id }).from(users).where(inArray(users.id, r.players.map((p) => p.id)))).map((u) => u.id),
    );
    await this.db.insert(matches).values({
      id: r.matchId,
      format: r.format,
      ranked: r.ranked,
      mapId: mapRow ? r.mapId : null,
      settings: r.settings,
      winnerId: r.winnerId,
      summary: { history: r.history, players: r.players },
      finishedAt: new Date(this.now()),
    });
    for (const p of r.players) {
      if (!alive.has(p.id)) continue;
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
      if (u)
        players.push({
          id,
          name: u.displayName,
          country: u.country,
          rating: u.rating,
          connected: this.online(id),
          hp: 0,
          total: 0,
          team: p.settings.format === 'teams' ? (p.teams.get(id) ?? 0) : null,
          lives: 0,
        });
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
    this.partyState(p)
      .then((party) => {
        for (const id of p.members) this.sendUser(id, { t: 'party.state', party });
      })
      .catch((e) => console.error('[hub] party state', e));
  }

  private async createParty(me: UserRow): Promise<void> {
    this.leaveParty(me.id);
    const party: Party = {
      code: this.newCode(),
      hostId: me.id,
      members: [me.id],
      settings: { mapSlug: 'world', format: 'classic', move: 'move', timeLimit: 120, rounds: 5 },
      matchId: null,
      starting: false,
      leaveTimers: new Map(),
      teams: new Map([[me.id, 0]]),
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
    party.teams.set(me.id, this.smallerTeam(party));
    this.partyOf.set(me.id, code);
    this.publishParty(party);
  }

  /** The side a newcomer joins: the one with fewer members (team 0 on a tie). */
  private smallerTeam(party: Party): number {
    const n1 = party.members.filter((m) => party.teams.get(m) === 1).length;
    const n0 = party.members.filter((m) => party.teams.get(m) === 0).length;
    return n1 < n0 ? 1 : 0;
  }

  /** Ask an online friend to join your party. */
  private async invite(me: UserRow, target: string): Promise<void> {
    const code = this.partyOf.get(me.id);
    if (!code || !this.parties.has(code)) throw new GameError(404, 'party_not_found');
    if (!this.friends || !UUID_RE.test(target) || !(await this.friends.areFriends(me.id, target))) throw new GameError(403, 'not_friends');
    if (!this.online(target)) throw new GameError(409, 'friend_offline');
    this.sendUser(target, { t: 'party.invite', code, from: { id: me.id, name: me.displayName } });
    this.sendUser(me.id, { t: 'party.invited', userId: target });
  }

  /** Teams: anyone can switch sides; the host can move others. */
  private setTeam(userId: string, target: string, team: number): void {
    const code = this.partyOf.get(userId);
    const party = code ? this.parties.get(code) : undefined;
    if (!party) throw new GameError(404, 'party_not_found');
    if (target !== userId && party.hostId !== userId) throw new GameError(403, 'host_only');
    if (!party.members.includes(target) || (team !== 0 && team !== 1)) throw new GameError(400, 'invalid_team');
    party.teams.set(target, team);
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
    party.teams.delete(userId);
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
    if (MATCH_FORMATS.includes(patch.format as never)) s.format = patch.format!;
    if (MOVE_MODES.includes(patch.move as never)) s.move = patch.move!;
    if (TIME_LIMITS.includes(patch.timeLimit as never)) s.timeLimit = patch.timeLimit!;
    if (Number.isInteger(patch.rounds) && patch.rounds! >= 1 && patch.rounds! <= 10) s.rounds = patch.rounds!;
    party.settings = s;
    this.publishParty(party);
  }

  private async startParty(userId: string): Promise<void> {
    const party = this.hostParty(userId);
    if (party.starting) throw new GameError(409, 'already_running');
    party.starting = true;
    try {
      await this.startPartyMatch(party);
    } finally {
      party.starting = false;
    }
  }

  private async startPartyMatch(party: Party): Promise<void> {
    const running = party.matchId ? this.matches.get(party.matchId) : undefined;
    if (running && running.phase !== 'finished') throw new GameError(409, 'already_running');
    const present = party.members.filter((m) => this.online(m));
    const format = party.settings.format;
    if (format === 'duel' && present.length !== 2) throw new GameError(409, 'duel_needs_two');
    if (format === 'elimination' && present.length < 2) throw new GameError(409, 'not_enough_players');
    if (format === 'teams') {
      const sides = new Set(present.map((id) => party.teams.get(id) ?? 0));
      if (sides.size !== 2) throw new GameError(409, 'teams_need_two_sides');
    }
    if (present.length < 1) throw new GameError(409, 'not_enough_players');
    const busy = present.filter((id) => this.inActiveMatch(id));
    if (busy.length) throw new GameError(409, 'player_in_match');
    const players = (await Promise.all(present.map((id) => this.game.userById(id)))).filter((u): u is UserRow => !!u);
    const mapRow = await this.game.mapBySlug(party.settings.mapSlug);
    const available = await this.locationCount(mapRow.id);
    const needed = format === 'duel' || format === 'teams' ? 5 : format === 'elimination' ? 10 : party.settings.rounds;
    if (available < needed) throw new GameError(409, 'map_too_small');
    const map = await this.game.mapSummary(mapRow);
    for (const id of present) this.leaveQueues(id);
    for (const id of present) this.sendUser(id, { t: 'queue.status', waiting: false, since: null, ranked: false });
    const settings = format === 'classic' ? party.settings : { ...party.settings, rounds: 0 };
    const match = await this.startMatch(format, false, map, settings, players, party.teams);
    party.matchId = match.id;
    this.publishParty(party);
  }

  private async locationCount(mapId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(locations)
      .where(and(eq(locations.mapId, mapId), eq(locations.provider, this.config.provider), eq(locations.disabled, false)));
    return Number(r?.n ?? 0);
  }

  private kick(userId: string, target: string): void {
    const party = this.hostParty(userId);
    if (target === userId || !party.members.includes(target)) return;
    this.leaveParty(target);
    this.sendUser(target, { t: 'party.closed', reason: 'kicked' });
  }
}
