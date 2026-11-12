import type { CountryRef, GameSettings, LatLon, MapSummary, PanoRef } from './types.ts';

export type MatchFormat = 'duel' | 'classic' | 'teams' | 'elimination';
export const MATCH_FORMATS: MatchFormat[] = ['classic', 'duel', 'teams', 'elimination'];

/** Elimination: lives each player starts with. */
export const ELIMINATION_LIVES = 3;
/** Elimination: the match ends after this many rounds even if several players survive. */
export const ELIMINATION_MAX_ROUNDS = 20;

export interface PlayerPublic {
  id: string;
  name: string;
  country: string | null;
  rating: number;
  connected: boolean;
  hp: number;
  total: number;
  /** Teams format: 0 or 1. Null elsewhere. */
  team: number | null;
  /** Elimination format: lives left. 0 elsewhere. */
  lives: number;
}

export interface PartySettings extends GameSettings {
  mapSlug: string;
  format: MatchFormat;
}

export interface PartyState {
  code: string;
  hostId: string;
  players: PlayerPublic[];
  settings: PartySettings;
  map: MapSummary | null;
  matchId: string | null;
}

export interface RoundGuessReveal {
  playerId: string;
  guess: LatLon | null;
  distanceKm: number | null;
  score: number;
  damage: number;
  /** Elimination: this guess cost a life. */
  lostLife: boolean;
}

export interface MatchState {
  id: string;
  format: MatchFormat;
  ranked: boolean;
  map: MapSummary;
  settings: GameSettings;
  players: PlayerPublic[];
  /** Teams format: each side's health. */
  teams: { hp: number }[] | null;
  phase: 'starting' | 'round' | 'reveal' | 'finished';
  roundIndex: number;
  /** Round in progress (no answer). */
  round: { index: number; pano: PanoRef; endsAt: string | null; multiplier: number; guessed: string[] } | null;
  /** Last revealed round. */
  reveal: {
    index: number;
    truth: LatLon;
    country: CountryRef | null;
    guesses: RoundGuessReveal[];
    multiplier: number;
    credit: string | null;
    nextAt: string | null;
    /** Teams format: damage each side took this round. */
    teamDamage: number[] | null;
  } | null;
  history: { index: number; truth: LatLon; guesses: RoundGuessReveal[] }[];
  result: { winnerId: string | null; winnerTeam: number | null; ratingChange: Record<string, number> } | null;
  startsAt: string | null;
}

/* ------------------------------- messages ------------------------------- */

export type ClientMessage =
  | { t: 'hello'; guestId: string }
  | { t: 'queue.join'; ranked: boolean }
  | { t: 'queue.leave' }
  | { t: 'party.create' }
  | { t: 'party.join'; code: string }
  | { t: 'party.leave' }
  | { t: 'party.settings'; settings: Partial<PartySettings> }
  | { t: 'party.start' }
  | { t: 'party.kick'; playerId: string }
  /** Teams format: move yourself, or (host) anyone, to team 0 or 1. */
  | { t: 'party.team'; team: number; playerId?: string }
  /** Invite a friend (who is online) to the party you are in. */
  | { t: 'party.invite'; userId: string }
  | { t: 'match.watch'; matchId: string }
  | { t: 'match.guess'; matchId: string; guess: LatLon }
  | { t: 'match.leave'; matchId: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; userId: string; /** Server clock, ms since epoch. */ now: number; /** Live matches you're in; their state follows. */ matchIds: string[] }
  | { t: 'error'; code: string }
  | { t: 'queue.status'; waiting: boolean; since: string | null; ranked: boolean }
  | { t: 'party.state'; party: PartyState }
  | { t: 'party.closed'; reason: string }
  | { t: 'party.invite'; code: string; from: { id: string; name: string } }
  /** Sent to the inviter once the invite is delivered. */
  | { t: 'party.invited'; userId: string }
  | { t: 'match.state'; match: MatchState }
  | { t: 'pong'; now: number };
