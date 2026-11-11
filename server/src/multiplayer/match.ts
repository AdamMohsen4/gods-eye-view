/**
 * One realtime match (duel or party game). Pure state machine: time,
 * scheduling, location picking, persistence and broadcasting are injected,
 * so tests can drive it with a fake clock.
 *
 * Privacy: the round's location is only put into the public state at
 * reveal; while a round runs, others see *that* you guessed, never where.
 */
import {
  DUEL_HP,
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
}

export interface MatchResult {
  matchId: string;
  format: MatchFormat;
  ranked: boolean;
  mapId: string;
  settings: GameSettings;
  winnerId: string | null;
  players: { id: string; total: number; hp: number; won: boolean; rating: number }[];
  history: MatchState['history'];
}

export interface MatchDeps {
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  pickLocation(exclude: string[]): Promise<MatchLocation>;
  publish(state: MatchState): void;
  /** Persist and return rating changes keyed by user id. */
  finish(result: MatchResult): Promise<Record<string, number>>;
}

export interface MatchTiming {
  startDelayMs: number;
  revealMs: number;
  /** Duel: time left for the others once the first guess is in. */
  countdownMs: number;
  /** Duel: a round can never run longer than this. */
  duelRoundCapMs: number;
  graceMs: number;
  /** Duel: a disconnected player forfeits after this long. */
  forfeitMs: number;
}

export const DEFAULT_TIMING: MatchTiming = {
  startDelayMs: 4000,
  revealMs: 7000,
  countdownMs: 15_000,
  duelRoundCapMs: 180_000,
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
    for (const p of players) {
      this.players.set(p.id, { ...p, connected: true, hp: format === 'duel' ? DUEL_HP : 0, total: 0, forfeitTimer: null });
    }
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

  private async beginRound(): Promise<void> {
    if (this.phase === 'finished') return;
    const loc = await this.deps.pickLocation(this.rounds.map((r) => r.loc.id));
    const now = this.deps.now();
    const index = this.rounds.length;
    const limitMs = this.settings.timeLimit * 1000;
    const endsAt = limitMs ? now + limitMs : this.format === 'duel' ? now + this.timing.duelRoundCapMs : null;
    const round: Round = {
      index,
      loc,
      startedAt: now,
      endsAt,
      multiplier: this.format === 'duel' ? duelMultiplier(index) : 1,
      guesses: new Map(),
    };
    this.rounds.push(round);
    this.phase = 'round';
    this.nextAt = null;
    if (endsAt) this.setTimer(() => this.endRound(), endsAt - now + this.timing.graceMs);
    else this.timer?.();
    this.publish();
  }

  guess(playerId: string, raw: unknown): void {
    const round = this.current;
    const p = this.players.get(playerId);
    if (!round || !p) throw new MatchError('no_open_round');
    if (this.format === 'duel' && p.hp <= 0) throw new MatchError('eliminated');
    if (round.guesses.has(playerId)) throw new MatchError('already_guessed');
    if (!isLatLon(raw)) throw new MatchError('invalid_guess');
    const now = this.deps.now();
    if (round.endsAt && now > round.endsAt + this.timing.graceMs) throw new MatchError('too_late');
    round.guesses.set(playerId, { lat: raw.lat, lon: raw.lon });

    if (this.activePlayers().every((q) => round.guesses.has(q.id))) {
      this.endRound();
      return;
    }
    if (this.format === 'duel' && round.guesses.size === 1) {
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
    return [...this.players.values()].filter((p) => p.connected && (this.format !== 'duel' || p.hp > 0));
  }

  private endRound(): void {
    const round = this.current;
    if (!round) return;
    this.timer?.();
    const guesses: RoundGuessReveal[] = [...this.players.values()].map((p) => {
      const g = round.guesses.get(p.id) ?? null;
      const distanceKm = g ? haversineKm(g, round.loc) : null;
      return { playerId: p.id, guess: g, distanceKm, score: scoreGuess(distanceKm, this.map.scaleKm), damage: 0 };
    });
    if (this.format === 'duel') {
      const [a, b] = guesses as [RoundGuessReveal, RoundGuessReveal];
      const diff = Math.round(Math.abs(a.score - b.score) * round.multiplier);
      const loser = a.score < b.score ? a : b.score < a.score ? b : null;
      if (loser && diff > 0) {
        loser.damage = diff;
        const p = this.players.get(loser.playerId)!;
        p.hp = Math.max(0, p.hp - diff);
      }
    }
    for (const g of guesses) this.players.get(g.playerId)!.total += g.score;

    this.history.push({ index: round.index, truth: { lat: round.loc.lat, lon: round.loc.lon }, guesses });
    const over = this.format === 'duel' ? [...this.players.values()].some((p) => p.hp <= 0) : this.rounds.length >= this.settings.rounds;
    this.nextAt = over ? null : this.deps.now() + this.timing.revealMs;
    this.lastReveal = {
      index: round.index,
      truth: { lat: round.loc.lat, lon: round.loc.lon },
      country: round.loc.country,
      guesses,
      multiplier: round.multiplier,
      credit: round.loc.credit,
      nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
    };
    this.phase = 'reveal';
    if (over) {
      void this.finish();
    } else {
      this.publish();
      this.setTimer(() => void this.beginRound(), this.timing.revealMs);
    }
  }

  private winner(): Player | null {
    const ps = [...this.players.values()];
    const key = (p: Player) => (this.format === 'duel' ? p.hp : p.total);
    const best = Math.max(...ps.map(key));
    const top = ps.filter((p) => key(p) === best);
    return top.length === 1 ? top[0]! : null;
  }

  private async finish(): Promise<void> {
    if (this.phase === 'finished') return;
    this.timer?.();
    for (const p of this.players.values()) p.forfeitTimer?.();
    this.phase = 'finished';
    const w = this.winner();
    this.result = { winnerId: w?.id ?? null, ratingChange: {} };
    this.publish();
    try {
      const changes = await this.deps.finish({
        matchId: this.id,
        format: this.format,
        ranked: this.ranked,
        mapId: this.map.id,
        settings: this.settings,
        winnerId: w?.id ?? null,
        players: [...this.players.values()].map((p) => ({ id: p.id, total: p.total, hp: p.hp, won: p.id === w?.id, rating: p.rating })),
        history: this.history,
      });
      this.result = { winnerId: w?.id ?? null, ratingChange: changes };
      for (const [id, d] of Object.entries(changes)) {
        const p = this.players.get(id);
        if (p) p.rating += d;
      }
    } finally {
      this.publish();
    }
  }

  /** Leaving a duel forfeits it. Leaving a party game just stops your guesses. */
  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || this.phase === 'finished') return;
    if (this.format === 'duel') {
      p.hp = 0;
      void this.finish();
      return;
    }
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
      p.forfeitTimer = this.deps.schedule(() => this.leave(playerId), this.timing.forfeitMs);
    }
    this.afterPresenceChange();
  }

  private afterPresenceChange(): void {
    const round = this.current;
    const active = this.activePlayers();
    if (this.format === 'classic' && active.length === 0) {
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
