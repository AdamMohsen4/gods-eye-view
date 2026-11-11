import type { CountryRef, GameSettings, LatLon, MapSummary, PanoRef } from './types.ts';

export type MatchFormat = 'duel' | 'classic';

export interface PlayerPublic {
  id: string;
  name: string;
  country: string | null;
  rating: number;
  connected: boolean;
  hp: number;
  total: number;
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
}

export interface MatchState {
  id: string;
  format: MatchFormat;
  ranked: boolean;
  map: MapSummary;
  settings: GameSettings;
  players: PlayerPublic[];
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
  } | null;
  history: { index: number; truth: LatLon; guesses: RoundGuessReveal[] }[];
  result: { winnerId: string | null; ratingChange: Record<string, number> } | null;
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
  | { t: 'match.watch'; matchId: string }
  | { t: 'match.guess'; matchId: string; guess: LatLon }
  | { t: 'match.leave'; matchId: string }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'welcome'; userId: string }
  | { t: 'error'; code: string }
  | { t: 'queue.status'; waiting: boolean; since: string | null; ranked: boolean }
  | { t: 'party.state'; party: PartyState }
  | { t: 'party.closed'; reason: string }
  | { t: 'match.state'; match: MatchState }
  | { t: 'pong' };
