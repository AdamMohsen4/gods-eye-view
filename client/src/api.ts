import type {
  ChallengeInfo,
  EditableMap,
  FriendsInfo,
  GameSettings,
  GameState,
  GuessResponse,
  LatLon,
  LeaderboardRow,
  MapSummary,
  MeResponse,
  ProfileStats,
  PublicConfig,
  CountryRef,
} from '@earthnow/shared';

const KEY = 'earthnow.guestId';

export function guestId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* storage blocked: guest id lives for this tab only */
    }
  }
  return id;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-guest-id': guestId(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'error');
  return data as T;
}

let configPromise: Promise<PublicConfig> | null = null;

export const api = {
  // A failed fetch is not cached, so the next caller retries.
  config: () =>
    (configPromise ??= req<PublicConfig>('GET', '/api/config').catch((e: unknown) => {
      configPromise = null;
      throw e;
    })),
  me: () => req<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { displayName?: string; country?: string | null }) => req<MeResponse>('PUT', '/api/me', patch),
  deleteMe: () => req<void>('DELETE', '/api/me'),
  stats: () => req<ProfileStats>('GET', '/api/me/stats'),
  maps: (kind?: 'official' | 'community') => req<MapSummary[]>('GET', `/api/maps${kind ? `?kind=${kind}` : ''}`),
  map: (slug: string) => req<MapSummary>('GET', `/api/maps/${encodeURIComponent(slug)}`),
  mapLeaderboard: (slug: string, mode: 'classic' | 'streak') => req<LeaderboardRow[]>('GET', `/api/maps/${encodeURIComponent(slug)}/leaderboard?mode=${mode}`),
  startGame: (mapSlug: string, settings: Partial<GameSettings>, mode: 'classic' | 'streak' = 'classic') =>
    req<GameState>('POST', '/api/games', { mapSlug, settings, mode }),
  game: (id: string) => req<GameState>('GET', `/api/games/${id}`),
  guess: (id: string, guess: LatLon | null) => req<GuessResponse>('POST', `/api/games/${id}/guess`, { guess }),
  next: (id: string) => req<GameState>('POST', `/api/games/${id}/next`),
  friends: () => req<FriendsInfo>('GET', '/api/friends'),
  addFriend: (code: string) => req<FriendsInfo>('POST', '/api/friends', { code }),
  acceptFriend: (id: string) => req<FriendsInfo>('POST', `/api/friends/${id}/accept`),
  removeFriend: (id: string) => req<FriendsInfo>('DELETE', `/api/friends/${id}`),
  daily: () => req<ChallengeInfo>('GET', '/api/daily'),
  createChallenge: (mapSlug: string, settings: Partial<GameSettings>) => req<{ token: string }>('POST', '/api/challenges', { mapSlug, settings }),
  challenge: (token: string) => req<ChallengeInfo>('GET', `/api/challenges/${encodeURIComponent(token)}`),
  playChallenge: (token: string) => req<GameState>('POST', `/api/challenges/${encodeURIComponent(token)}/play`),
  challengeLeaderboard: (token: string) =>
    req<{ rows: LeaderboardRow[]; you: LeaderboardRow | null }>('GET', `/api/challenges/${encodeURIComponent(token)}/leaderboard`),
  ratingLeaderboard: () => req<LeaderboardRow[]>('GET', '/api/leaderboard/rating'),
  countryAt: (p: LatLon) => req<{ country: CountryRef | null }>('GET', `/api/geo/country?lat=${p.lat}&lon=${p.lon}`),
  maker: {
    list: () => req<EditableMap[]>('GET', '/api/maker/maps'),
    create: (name: string, description = '') => req<EditableMap>('POST', '/api/maker/maps', { name, description }),
    get: (id: string) => req<EditableMap>('GET', `/api/maker/maps/${id}`),
    update: (id: string, patch: { name?: string; description?: string; published?: boolean }) => req<EditableMap>('PATCH', `/api/maker/maps/${id}`, patch),
    remove: (id: string) => req<void>('DELETE', `/api/maker/maps/${id}`),
    addLocation: (id: string, point: LatLon) => req<EditableMap['locations'][number]>('POST', `/api/maker/maps/${id}/locations`, { point }),
    removeLocation: (id: string, loc: string) => req<void>('DELETE', `/api/maker/maps/${id}/locations/${loc}`),
  },
};

const ERRORS: Record<string, string> = {
  map_not_found: 'That map does not exist or is not published.',
  challenge_not_found: 'That challenge link is not valid.',
  daily_closed: 'That daily has closed. Today’s is waiting.',
  no_coverage: 'No street-level imagery near that point.',
  duplicate_location: 'That panorama is already on the map.',
  too_few_locations: 'Add at least 5 places before publishing.',
  imagery_unavailable: 'Imagery is not configured on the server.',
  map_too_small: 'This map has too few places for that many rounds.',
  map_exhausted: 'You have played every place on this map.',
  player_in_match: 'Someone in the room is still in another match.',
  already_running: 'A game is already running in this room.',
  opponent_gone: 'Your opponent left before the match began. Try again.',
  not_enough_players: 'Nobody is connected to play.',
  game_finished: 'That game is already over.',
  banned: 'This account can’t play right now.',
  party_not_found: 'No party with that code.',
  party_full: 'That party is full.',
  duel_needs_two: 'A duel needs exactly two players in the room.',
  invalid_friend_code: 'Friend codes are 6 letters and digits, like K7QX2M.',
  friend_not_found: 'No player has that friend code.',
  friend_self: 'That’s your own code.',
  too_many_friends: 'You’ve reached the friend limit.',
  too_many_requests: 'You have too many open friend requests. Wait for some answers first.',
  friend_request_not_found: 'That request is gone.',
  not_friends: 'You can only invite friends.',
  friend_offline: 'They just went offline.',
  teams_need_two_sides: 'Both teams need at least one connected player.',
  invalid_team: 'That team doesn’t exist.',
  host_only: 'Only the host can do that.',
  already_in_match: 'You are already in a match.',
  rate_limited: 'Slow down a little.',
  invalid_display_name: 'Names need at least 2 characters.',
};

export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e);
  return ERRORS[code] ?? 'Something went wrong. Try again.';
}
