import type {
  Attribution,
  ClueResponse,
  DailyToday,
  GuessResponse,
  LatLon,
  LeaderboardRow,
  MeResponse,
  RoundType,
  StartRoundResponse,
} from '@earthnow/shared';
import { UUID_RE, uuidFromBytes } from './lib/format.ts';

const KEY = 'earthnow.guestId';
let memoryId: string | null = null;

/** Guest id kept in localStorage; falls back to memory when storage is blocked. */
export function guestId(): string {
  if (memoryId) return memoryId;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID_RE.test(stored)) return (memoryId = stored);
  } catch {
    /* storage blocked */
  }
  const id = crypto.randomUUID?.() ?? uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));
  memoryId = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage blocked */
  }
  return id;
}

export function forgetGuest(): void {
  memoryId = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(`${status} ${code}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'x-guest-id': guestId(),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? res.statusText), json);
  return json as T;
}

export interface DailySummary {
  date: string;
  number: number;
  total: number;
  rounds: Array<{ type: RoundType; score: number; guess: LatLon | null }>;
}

export interface LeaderboardResponse {
  date: string;
  scope: 'global' | 'country';
  rows: LeaderboardRow[];
  you: LeaderboardRow | null;
}

export const api = {
  me: () => call<MeResponse>('GET', '/api/me'),
  updateMe: (body: { displayName?: string; country?: string | null }) => call<MeResponse>('PUT', '/api/me', body),
  deleteMe: () => call<void>('DELETE', '/api/me'),
  today: () => call<DailyToday>('GET', '/api/daily/today'),
  start: (snapshotId: string) => call<StartRoundResponse>('POST', '/api/rounds/start', { snapshotId, mode: 'daily' }),
  clue: (roundId: string) => call<ClueResponse>('POST', `/api/rounds/${roundId}/clue`),
  guess: (roundId: string, guess: LatLon | null) => call<GuessResponse>('POST', `/api/rounds/${roundId}/guess`, { guess }),
  arcadeNext: () => call<StartRoundResponse>('GET', '/api/arcade/next'),
  summary: (date: string) => call<DailySummary>('GET', `/api/daily/${date}/summary`),
  leaderboard: (scope: 'global' | 'country', date: string) =>
    call<LeaderboardResponse>('GET', `/api/leaderboard?scope=${scope}&date=${date}`),
  attributions: () => call<Attribution[]>('GET', '/api/attributions'),
};
