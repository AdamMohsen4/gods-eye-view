/** Round types shipped in the MVP. Ships are phase 2 and deliberately absent. */
export const ROUND_TYPES = ['flight', 'quake', 'fire', 'satellite'] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export type Mode = 'daily' | 'arcade';

export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Camera pose for the labelless view. Position is Earth-centred Earth-fixed
 * (metres) and is ALWAYS displaced from the true location (see camera.ts),
 * so it never pinpoints the answer.
 */
export interface CameraPose {
  /** ECEF position in metres. */
  position: [number, number, number];
  /** Radians, Cesium convention (heading clockwise from north, pitch negative = down). */
  heading: number;
  pitch: number;
  roll: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

/**
 * The thing to draw in the scene, as an offset from the camera in the camera's
 * local east-north-up frame (metres). Never an absolute coordinate.
 */
export interface SceneSubject {
  kind: RoundType;
  offsetEnu: [number, number, number];
  /** Subject heading in degrees (aircraft/satellite track). */
  headingDeg?: number;
  /** Visual size hint: magnitude for quakes, FRP for fires. */
  intensity?: number;
}

export type ClueKey =
  | 'altitude'
  | 'speed'
  | 'heading'
  | 'localTime'
  | 'magnitude'
  | 'depth'
  | 'frp'
  | 'inclination'
  | 'hemisphere';

export interface Clue {
  key: ClueKey;
  label: string;
  value: string;
}

/** Clue keys offered for each round type, in unlock order (max 3 used). */
export const CLUE_ORDER: Record<RoundType, ClueKey[]> = {
  flight: ['altitude', 'speed', 'localTime'],
  quake: ['magnitude', 'depth', 'localTime'],
  fire: ['frp', 'localTime', 'hemisphere'],
  satellite: ['altitude', 'inclination', 'localTime'],
};

export const MAX_CLUES = 3;

/** Data attribution line shown in every reveal. */
export interface Attribution {
  text: string;
  url: string;
  license?: string;
}

/** Fact card shown at reveal. Neutral wording; no tracking links. */
export interface FactCard {
  title: string;
  subtitle: string;
  lines: string[];
  country: string | null;
}

/* ---------------------------- API payloads ---------------------------- */

/** One round as seen BEFORE the guess. Contains no true lat/lon. */
export interface PublicRound {
  snapshotId: string;
  type: RoundType;
  /** Seconds between capture and when the data was frozen (for "captured X min ago"). */
  capturedAt: string;
  camera: CameraPose;
  subject: SceneSubject;
  /** Simulation time to light the scene (equals capture time). */
  sceneTime: string;
  cluesAvailable: number;
}

export interface DailyToday {
  date: string;
  number: number;
  rounds: PublicRound[];
  /** Progress for the requesting player, if any. */
  played: Array<{ snapshotId: string; score: number; distanceKm: number | null } | null>;
}

export interface StartRoundResponse {
  roundId: string;
  startedAt: string;
  /** Null in modes without a timer. */
  deadline: string | null;
  round: PublicRound;
  cluesUsed: Clue[];
}

export interface ClueResponse {
  clue: Clue;
  cluesUsed: number;
}

export interface GuessResponse {
  roundId: string;
  truth: LatLon;
  guess: LatLon | null;
  distanceKm: number | null;
  score: number;
  timedOut: boolean;
  fact: FactCard;
  attribution: Attribution[];
  /** Daily only: set when this guess completed the day's five rounds. */
  dailyComplete?: { total: number; streak: StreakState };
}

export interface StreakState {
  current: number;
  best: number;
  freezeAvailable: boolean;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  country: string | null;
  score: number;
  isYou: boolean;
}

export interface MeResponse {
  id: string;
  displayName: string;
  country: string | null;
  plan: 'free' | 'plus';
  streak: StreakState;
  arcade: { usedToday: number; limit: number | null };
}
