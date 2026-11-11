import { boolean, char, date, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { GameMode, GameSettings, MatchFormat, Provider } from '@earthnow/shared';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authId: text('auth_id').unique(),
  guestId: uuid('guest_id').unique(),
  displayName: text('display_name').notNull(),
  country: char('country', { length: 2 }),
  rating: integer('rating').notNull().default(1000),
  xp: integer('xp').notNull().default(0),
  dailyStreak: integer('daily_streak').notNull().default(0),
  dailyBest: integer('daily_best').notNull().default(0),
  lastDaily: date('last_daily', { mode: 'string' }),
  banned: boolean('banned').notNull().default(false),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const maps = pgTable('maps', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kind: text('kind').$type<'official' | 'community'>().notNull().default('community'),
  creatorId: uuid('creator_id'),
  published: boolean('published').notNull().default(false),
  sort: integer('sort').notNull().default(100),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  mapId: uuid('map_id').notNull(),
  provider: text('provider').$type<Provider>().notNull(),
  panoId: text('pano_id').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  heading: doublePrecision('heading').notNull().default(0),
  country: char('country', { length: 2 }),
  credit: text('credit'),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  mapId: uuid('map_id').notNull(),
  settings: jsonb('settings').$type<GameSettings>().notNull(),
  locationIds: uuid('location_ids').array().notNull(),
  creatorId: uuid('creator_id'),
  dailyDate: date('daily_date', { mode: 'string' }).unique(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  mapId: uuid('map_id').notNull(),
  mode: text('mode').$type<GameMode>().notNull(),
  challengeId: uuid('challenge_id'),
  settings: jsonb('settings').$type<GameSettings>().notNull(),
  provider: text('provider').$type<Provider>().notNull(),
  scaleKm: doublePrecision('scale_km').notNull(),
  status: text('status').$type<'active' | 'finished'>().notNull().default('active'),
  totalScore: integer('total_score').notNull().default(0),
  totalDistanceKm: doublePrecision('total_distance_km').notNull().default(0),
  streak: integer('streak').notNull().default(0),
  createdAt: tz('created_at').notNull().defaultNow(),
  finishedAt: tz('finished_at'),
});

export const gameRounds = pgTable(
  'game_rounds',
  {
    gameId: uuid('game_id').notNull(),
    idx: integer('idx').notNull(),
    locationId: uuid('location_id').notNull(),
    startedAt: tz('started_at').notNull().defaultNow(),
    deadline: tz('deadline'),
    guessLat: doublePrecision('guess_lat'),
    guessLon: doublePrecision('guess_lon'),
    guessCountry: char('guess_country', { length: 2 }),
    guessedAt: tz('guessed_at'),
    distanceKm: doublePrecision('distance_km'),
    score: integer('score'),
    timedOut: boolean('timed_out').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.idx] })],
);

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey(),
  format: text('format').$type<MatchFormat>().notNull(),
  ranked: boolean('ranked').notNull().default(false),
  mapId: uuid('map_id'),
  settings: jsonb('settings').$type<GameSettings>().notNull(),
  winnerId: uuid('winner_id'),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  finishedAt: tz('finished_at'),
});

export const matchPlayers = pgTable(
  'match_players',
  {
    matchId: uuid('match_id').notNull(),
    userId: uuid('user_id').notNull(),
    total: integer('total').notNull().default(0),
    won: boolean('won').notNull().default(false),
    ratingChange: integer('rating_change').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);

export type UserRow = typeof users.$inferSelect;
export type MapRow = typeof maps.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type ChallengeRow = typeof challenges.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameRoundRow = typeof gameRounds.$inferSelect;
