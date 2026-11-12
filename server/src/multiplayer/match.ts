/**
 * One realtime match. Pure state machine: time,
 * scheduling, location picking, persistence and broadcasting are injected,
 * so tests can drive it with a fake clock.
 *
 * Formats:
 *   duel         two players, 5,000 HP each; the worse guess loses the difference.
 *   teams        two sides sharing 5,000 HP; a side's round score is its best guess.
 *   classic      everyone scores; the highest total after N rounds wins.
 *   elimination  three lives each; the worst guess of a round costs a life,
 *                the last player standing wins.
 *
 * Privacy: the round's location is only put into the public state at
 * reveal; while a round runs, others see *that* you guessed, never where.
 */
import {
  DUEL_HP,
  ELIMINATION_LIVES,
  ELIMINATION_MAX_ROUNDS,
  duelMultiplier,
  haversineKm,
  isLatLon,
  scoreGuess,
  type CountryRef,
  type GameSettings,
  type LatLon,
  type MapSummary,
  type MatchFormat,
  type MatchState,
  type PanoRef,
  type PlayerPublic,
  type RoundGuessReveal,
} from '@earthnow/shared';

export interface MatchLocation extends LatLon {
  id: string;
  pano: PanoRef;
  country: CountryRef | null;
  credit: string | null;
}

export interface MatchPlayerInit {
  id: string;
  name: string;
  country: string | null;
  rating: number;
  /** Teams format only: 0 or 1. */
  team?: number;
}

export interface MatchResult {
  matchId: string;
  format: MatchFormat;
  ranked: boolean;
  mapId: string;
  settings: GameSettings;
  winnerId: string | null;
  winnerTeam: number | null;
  players: { id: string; total: number; hp: number; won: boolean; rating: number; team: number | null; lives: number }[];
  history: MatchState['history'];
}

export interface MatchDeps {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  pickLocation(exclude: string[]): Promise<MatchLocation>;
  publish(state: MatchState): void;
  /** Persist and return rating changes keyed by user id. */
  finish(result: MatchResult): Promise<Record<string, number>>;
  /** Errors that must not crash the process (defaults to console.error). */
  log?(message: string, err: unknown): void;
}

export interface MatchTiming {
  startDelayMs: number;
  revealMs: number;
  /** Duel and teams: time left for the others once the first guess is in. */
  countdownMs: number;
  /** Duel: a round can never run longer than this. */
  duelRoundCapMs: number;
  /** Party game without a time limit: a round can never run longer than this. */
  classicRoundCapMs: number;
  graceMs: number;
  /** Duel: a disconnected player forfeits after this long. */
  forfeitMs: number;
}

export const DEFAULT_TIMING: MatchTiming = {
  startDelayMs: 4000,
  revealMs: 7000,
  countdownMs: 15_000,
  duelRoundCapMs: 180_000,
  classicRoundCapMs: 600_000,
  graceMs: 1500,
  forfeitMs: 45_000,
};

interface Round {
  index: number;
  loc: MatchLocation;
  startedAt: number;
  endsAt: number | null;
  multiplier: number;
  guesses: Map<string, LatLon>;
}

interface Player extends PlayerPublic {
  forfeitTimer: (() => void) | null;
}

export class MatchError extends Error {}

export class Match {
  readonly players = new Map<string, Player>();
  phase: MatchState['phase'] = 'starting';
  private rounds: Round[] = [];
  private history: MatchState['history'] = [];
  private lastReveal: MatchState['reveal'] = null;
  private timer: (() => void) | null = null;
  private startsAt: number | null = null;
  private nextAt: number | null = null;
  private result: MatchState['result'] = null;
  private picking = false;
  /** Teams format: each side's health. */
  private teamHp: number[] | null = null;

  constructor(
    readonly id: string,
    readonly format: MatchFormat,
    readonly ranked: boolean,
    readonly map: MapSummary,
    readonly settings: GameSettings,
    players: MatchPlayerInit[],
    private deps: MatchDeps,
    private timing: MatchTiming = DEFAULT_TIMING,
  ) {
    if (format === 'duel' && players.length !== 2) throw new MatchError('duel_needs_two');
    if (format === 'teams') {
      const sides = new Set(players.map((p) => p.team));
      if (!sides.has(0) || !sides.has(1) || sides.size !== 2) throw new MatchError('teams_need_two_sides');
      this.teamHp = [DUEL_HP, DUEL_HP];
    }
    if (format === 'elimination' && players.length < 2) throw new MatchError('not_enough_players');
    for (const p of players) {
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        country: p.country,
        rating: p.rating,
        connected: true,
        hp: format === 'duel' ? DUEL_HP : 0,
        total: 0,
        team: format === 'teams' ? p.team! : null,
        lives: format === 'elimination' ? ELIMINATION_LIVES : 0,
        forfeitTimer: null,
      });
    }
  }

  /** Duel-style rounds: a first guess starts a countdown, damage multiplies late on. */
  private get headToHead(): boolean {
    return this.format === 'duel' || this.format === 'teams';
  }

  /** Still in the match (not knocked out or out of lives). */
  private alive(p: Player): boolean {
    if (this.format === 'duel') return p.hp > 0;
    if (this.format === 'elimination') return p.lives > 0;
    if (this.format === 'teams') return this.teamHp![p.team!]! > 0;
    return true;
  }

  start(): void {
    this.startsAt = this.deps.now() + this.timing.startDelayMs;
    this.phase = 'starting';
    this.publish();
    this.setTimer(() => void this.beginRound(), this.timing.startDelayMs);
  }

  private setTimer(fn: () => void, ms: number): void {
    this.timer?.();
    this.timer = this.deps.schedule(fn, Math.max(0, ms));
  }

  private get current(): Round | undefined {
    return this.phase === 'round' ? this.rounds[this.rounds.length - 1] : undefined;
  }

  private log(message: string, err: unknown): void {
    if (this.deps.log) this.deps.log(message, err);
    else console.error(`[match ${this.id}] ${message}`, err);
  }

  private async beginRound(): Promise<void> {
    if (this.phase === 'finished' || this.picking) return;
    this.picking = true;
    let loc: MatchLocation;
    try {
      loc = await this.deps.pickLocation(this.rounds.map((r) => r.loc.id));
    } catch (e) {
      // Out of places (or the database failed): end the match with what was played.
      this.log('could not pick a location; finishing early', e);
      this.picking = false;
      await this.finish();
      return;
    }
    this.picking = false;
    // The match may have ended (forfeit, everyone left) while we waited.
    if ((this.phase as MatchState['phase']) === 'finished') return; // TS narrowed it before the await
    const now = this.deps.now();
    const index = this.rounds.length;
    const limitMs = this.settings.timeLimit * 1000;
    // Party games without a limit show no clock but still end after a hidden cap,
    // so one idle player can't hold the room forever.
    const endsAt = limitMs ? now + limitMs : this.headToHead ? now + this.timing.duelRoundCapMs : null;
    const hardEnd = endsAt ?? now + this.timing.classicRoundCapMs;
    const round: Round = {
      index,
      loc,
      startedAt: now,
      endsAt,
      multiplier: this.headToHead ? duelMultiplier(index) : 1,
      guesses: new Map(),
    };
    this.rounds.push(round);
    this.phase = 'round';
    this.nextAt = null;
    this.setTimer(() => this.endRound(), hardEnd - now + this.timing.graceMs);
    this.publish();
  }

  guess(playerId: string, raw: unknown): void {
    const round = this.current;
    const p = this.players.get(playerId);
    if (!round || !p) throw new MatchError('no_open_round');
    if (!this.alive(p)) throw new MatchError('eliminated');
    if (round.guesses.has(playerId)) throw new MatchError('already_guessed');
    if (!isLatLon(raw)) throw new MatchError('invalid_guess');
    const now = this.deps.now();
    if (round.endsAt && now > round.endsAt + this.timing.graceMs) throw new MatchError('too_late');
    round.guesses.set(playerId, { lat: raw.lat, lon: raw.lon });

    if (this.activePlayers().every((q) => round.guesses.has(q.id))) {
      this.endRound();
      return;
    }
    if (this.headToHead && round.guesses.size === 1) {
      const cutoff = now + this.timing.countdownMs;
      if (!round.endsAt || cutoff < round.endsAt) {
        round.endsAt = cutoff;
        this.setTimer(() => this.endRound(), cutoff - now + this.timing.graceMs);
      }
    }
    this.publish();
  }

  /** Players still expected to guess this round. */
  private activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.connected && this.alive(p));
  }

  private endRound(): void {
    const round = this.current;
    if (!round) return;
    this.timer?.();
    const guesses: RoundGuessReveal[] = [...this.players.values()].map((p) => {
      const g = round.guesses.get(p.id) ?? null;
      const distanceKm = g ? haversineKm(g, round.loc) : null;
      return { playerId: p.id, guess: g, distanceKm, score: scoreGuess(distanceKm, this.map.scaleKm), damage: 0, lostLife: false };
    });
    let teamDamage: number[] | null = null;
    if (this.format === 'duel') {
      const [a, b] = guesses as [RoundGuessReveal, RoundGuessReveal];
      const diff = Math.round(Math.abs(a.score - b.score) * round.multiplier);
      const loser = a.score < b.score ? a : b.score < a.score ? b : null;
      if (loser && diff > 0) {
        loser.damage = diff;
        const p = this.players.get(loser.playerId)!;
        p.hp = Math.max(0, p.hp - diff);
      }
    } else if (this.format === 'teams') {
      // A side scores its best guess of the round.
      const best = [0, 1].map((t) => Math.max(0, ...guesses.filter((g) => this.players.get(g.playerId)!.team === t).map((g) => g.score)));
      const diff = Math.round(Math.abs(best[0]! - best[1]!) * round.multiplier);
      teamDamage = [0, 0];
      if (diff > 0) {
        const loser = best[0]! < best[1]! ? 0 : 1;
        teamDamage[loser] = diff;
        this.teamHp![loser] = Math.max(0, this.teamHp![loser]! - diff);
      }
    } else if (this.format === 'elimination') {
      // The worst guess among those still in costs a life. If everyone tied, nobody loses one.
      const inPlay = guesses.filter((g) => this.players.get(g.playerId)!.lives > 0);
      const worst = Math.min(...inPlay.map((g) => g.score));
      const losers = inPlay.filter((g) => g.score === worst);
      if (losers.length < inPlay.length) {
        for (const g of losers) {
          g.lostLife = true;
          this.players.get(g.playerId)!.lives -= 1;
        }
      }
    }
    for (const g of guesses) this.players.get(g.playerId)!.total += g.score;

    this.history.push({ index: round.index, truth: { lat: round.loc.lat, lon: round.loc.lon }, guesses });
    const over = this.isOver();
    this.nextAt = over ? null : this.deps.now() + this.timing.revealMs;
    this.lastReveal = {
      index: round.index,
      truth: { lat: round.loc.lat, lon: round.loc.lon },
      country: round.loc.country,
      guesses,
      multiplier: round.multiplier,
      credit: round.loc.credit,
      nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
      teamDamage,
    };
    this.phase = 'reveal';
    if (over) {
      void this.finish();
    } else {
      this.publish();
      this.setTimer(() => void this.beginRound(), this.timing.revealMs);
    }
  }

  private isOver(): boolean {
    const ps = [...this.players.values()];
    switch (this.format) {
      case 'duel':
        return ps.some((p) => p.hp <= 0);
      case 'teams':
        return this.teamHp!.some((hp) => hp <= 0);
      case 'elimination':
        return ps.filter((p) => p.lives > 0).length <= 1 || this.rounds.length >= ELIMINATION_MAX_ROUNDS;
      default:
        return this.rounds.length >= this.settings.rounds;
    }
  }

  private winner(): Player | null {
    if (this.format === 'teams') return null;
    const ps = [...this.players.values()];
    // Elimination: most lives left, then the best total breaks a tie.
    const key = (p: Player) => (this.format === 'duel' ? p.hp : this.format === 'elimination' ? p.lives * 1e7 + p.total : p.total);
    const best = Math.max(...ps.map(key));
    const top = ps.filter((p) => key(p) === best);
    return top.length === 1 ? top[0]! : null;
  }

  private winningTeam(): number | null {
    if (this.format !== 'teams') return null;
    const [a, b] = this.teamHp as [number, number];
    return a === b ? null : a > b ? 0 : 1;
  }

  /**
   * Ends the match and persists it. Never rejects: a failed save is logged and
   * the players still see the final result. `abandoned` means nobody wins and
   * ratings do not move (both duel players vanished).
   */
  private async finish(abandoned = false): Promise<void> {
    if (this.phase === 'finished') return;
    this.timer?.();
    for (const p of this.players.values()) p.forfeitTimer?.();
    this.phase = 'finished';
    const w = abandoned ? null : this.winner();
    const wt = abandoned ? null : this.winningTeam();
    const won = (p: Player) => (this.format === 'teams' ? wt !== null && p.team === wt : p.id === w?.id);
    this.result = { winnerId: w?.id ?? null, winnerTeam: wt, ratingChange: {} };
    this.publish();
    try {
      const changes = await this.deps.finish({
        matchId: this.id,
        format: this.format,
        ranked: this.ranked && !abandoned,
        mapId: this.map.id,
        settings: this.settings,
        winnerId: w?.id ?? null,
        winnerTeam: wt,
        players: [...this.players.values()].map((p) => ({ id: p.id, total: p.total, hp: p.hp, won: won(p), rating: p.rating, team: p.team, lives: p.lives })),
        history: this.history,
      });
      this.result = { winnerId: w?.id ?? null, winnerTeam: wt, ratingChange: changes };
      for (const [id, d] of Object.entries(changes)) {
        const p = this.players.get(id);
        if (p) p.rating += d;
      }
    } catch (e) {
      this.log('could not save the result', e);
    } finally {
      this.publish();
    }
  }

  /**
   * Leaving a duel forfeits it. Leaving elimination gives up your lives.
   * Leaving a party or team game just stops your guesses.
   */
  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || this.phase === 'finished') return;
    if (this.format === 'duel') {
      p.hp = 0;
      void this.finish();
      return;
    }
    if (this.format === 'elimination') p.lives = 0;
    p.connected = false;
    this.afterPresenceChange();
  }

  setConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (!p || p.connected === connected || this.phase === 'finished') return;
    p.connected = connected;
    p.forfeitTimer?.();
    p.forfeitTimer = null;
    if (!connected && this.format === 'duel') {
      p.forfeitTimer = this.deps.schedule(() => this.forfeit(playerId), this.timing.forfeitMs);
    }
    this.afterPresenceChange();
  }

  /** A duel player stayed away too long. If the opponent is gone too, nobody wins. */
  private forfeit(playerId: string): void {
    if (this.phase === 'finished') return;
    const othersGone = [...this.players.values()].every((q) => q.id === playerId || !q.connected);
    if (othersGone) void this.finish(true);
    else this.leave(playerId);
  }

  private afterPresenceChange(): void {
    const round = this.current;
    const active = this.activePlayers();
    if (this.format !== 'duel' && active.length === 0) {
      void this.finish();
      return;
    }
    // Teams: a side with nobody left concedes.
    if (this.format === 'teams') {
      for (const t of [0, 1]) {
        if (![...this.players.values()].some((q) => q.team === t && q.connected)) {
          this.teamHp![t] = 0;
          void this.finish();
          return;
        }
      }
    }
    // Elimination: everyone else gave up.
    if (this.format === 'elimination' && this.isOver()) {
      void this.finish();
      return;
    }
    if (round && active.length > 0 && active.every((q) => round.guesses.has(q.id))) {
      this.endRound();
      return;
    }
    this.publish();
  }

  isPlayer(id: string): boolean {
    return this.players.has(id);
  }

  view(): MatchState {
    const round = this.current;
    return {
      id: this.id,
      format: this.format,
      ranked: this.ranked,
      map: this.map,
      settings: this.settings,
      players: [...this.players.values()].map(({ forfeitTimer: _f, ...p }) => p),
      teams: this.teamHp ? this.teamHp.map((hp) => ({ hp })) : null,
      phase: this.phase,
      roundIndex: Math.max(0, this.rounds.length - 1),
      round: round
        ? {
            index: round.index,
            pano: round.loc.pano,
            endsAt: round.endsAt ? new Date(round.endsAt).toISOString() : null,
            multiplier: round.multiplier,
            guessed: [...round.guesses.keys()],
          }
        : null,
      reveal: this.phase === 'round' ? null : this.lastReveal,
      history: this.history,
      result: this.result,
      startsAt: this.startsAt && this.phase === 'starting' ? new Date(this.startsAt).toISOString() : null,
    };
  }

  private publish(): void {
    this.deps.publish(this.view());
  }

  dispose(): void {
    this.timer?.();
    for (const p of this.players.values()) p.forfeitTimer?.();
  }
}
