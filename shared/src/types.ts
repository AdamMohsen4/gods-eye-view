import type { BadgeProgress } from './badges.ts';
/** Street-level imagery sources. `fixture` is a generated stand-in for dev and tests. */
export const PROVIDERS = ['mapillary', 'google', 'fixture'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface LatLon {
  lat: number;
  lon: number;
}

/** How much the player may do inside the panorama. */
export type MoveMode = 'move' | 'nomove' | 'nmpz';

export interface GameSettings {
  move: MoveMode;
  /** Seconds per round; 0 = no limit. */
  timeLimit: number;
  rounds: number;
}

export const DEFAULT_SETTINGS: GameSettings = { move: 'move', timeLimit: 0, rounds: 5 };
export const TIME_LIMITS = [0, 10, 30, 60, 120, 180, 300] as const;
export const MOVE_MODES: MoveMode[] = ['move', 'nomove', 'nmpz'];

export type GameMode = 'classic' | 'daily' | 'challenge' | 'streak';

/**
 * What the client needs to show a panorama. Deliberately no lat/lon: the
 * true location only leaves the server inside a reveal.
 */
export interface PanoRef {
  provider: Provider;
  panoId: string;
  /** Initial camera heading, degrees clockwise from north. */
  heading: number;
}

export interface MapSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: 'official' | 'community';
  creatorName: string | null;
  locationCount: number;
  scaleKm: number;
  plays: number;
  /** ISO 3166-1 alpha-2 codes of the countries the map's places are in. */
  countries: string[];
  /** [minLon, minLat, maxLon, maxLat] of the map's places, or null without places. */
  bounds: [number, number, number, number] | null;
}

export interface CountryRef {
  code: string;
  name: string;
}

export interface RevealedRound {
  index: number;
  truth: LatLon;
  country: CountryRef | null;
  guess: LatLon | null;
  guessCountry: CountryRef | null;
  distanceKm: number | null;
  score: number;
  timedOut: boolean;
  /** Streak mode: was the country right. */
  correct?: boolean;
  credit: string | null;
  panoId: string;
  provider: Provider;
}

export interface ActiveRound {
  index: number;
  pano: PanoRef;
  startedAt: string;
  /** ISO time the round closes, or null when untimed. */
  deadline: string | null;
}

export interface GameState {
  id: string;
  mode: GameMode;
  map: MapSummary;
  settings: GameSettings;
  status: 'active' | 'finished';
  totalScore: number;
  /** Streak mode: current streak length. */
  streak: number;
  /** Rounds already revealed, oldest first. */
  rounds: RevealedRound[];
  current: ActiveRound | null;
  challengeToken: string | null;
  dailyNumber: number | null;
}

export interface GuessResponse {
  round: RevealedRound;
  totalScore: number;
  streak: number;
  finished: boolean;
}

export interface ChallengeInfo {
  token: string;
  map: MapSummary;
  settings: GameSettings;
  creatorName: string | null;
  plays: number;
  /** Your game for this challenge, if you have started it. */
  gameId: string | null;
  finished: boolean;
  dailyNumber: number | null;
  date: string | null;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  country: string | null;
  score: number;
  /** Total distance in km, used as tie-breaker and detail. */
  distanceKm: number | null;
  gameId?: string;
}

export interface Level {
  level: number;
  xp: number;
  /** XP at which this level started and the next begins. */
  floor: number;
  next: number;
}

export interface MeResponse {
  id: string;
  displayName: string;
  country: string | null;
  rating: number;
  level: Level;
  dailyStreak: { current: number; best: number; playedToday: boolean };
}

export interface ProfileStats {
  gamesPlayed: number;
  roundsPlayed: number;
  averageScore: number;
  bestGame: number;
  perfectRounds: number;
  bestStreak: number;
  duels: { played: number; won: number; rating: number };
  recent: { gameId: string; mode: GameMode; mapName: string; score: number; streak: number; finishedAt: string }[];
  countries: { code: string; name: string; rounds: number; averageScore: number }[];
  badges: BadgeProgress[];
}

export interface PublicConfig {
  provider: Provider;
  mapillaryToken: string | null;
  googleKey: string | null;
  /** 'openfreemap' (vector tiles, keyless) or 'offline' (bundled country outlines). */
  mapStyle: 'openfreemap' | 'offline';
}

export interface EditableMap {
  id: string;
  slug: string;
  name: string;
  description: string;
  published: boolean;
  locations: { id: string; lat: number; lon: number; country: string | null }[];
}

export interface FriendView {
  id: string;
  name: string;
  country: string | null;
  level: number;
  online: boolean;
  /** friend: accepted; incoming: they asked you; outgoing: you asked them. */
  status: 'friend' | 'incoming' | 'outgoing';
}

export interface FriendsInfo {
  /** Your code, to give to friends. */
  code: string;
  friends: FriendView[];
}
