import {
  boolean,
  char,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { CameraPose, Clue, SceneSubject } from '@earthnow/shared';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  authId: text('auth_id').unique(),
  guestId: uuid('guest_id').unique(),
  displayName: text('display_name').notNull(),
  country: char('country', { length: 2 }),
  plan: text('plan').$type<'free' | 'plus'>().notNull().default('free'),
  banned: boolean('banned').notNull().default(false),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const snapshots = pgTable('snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').$type<'flight' | 'quake' | 'fire' | 'satellite'>().notNull(),
  source: text('source').notNull(),
  dedupeKey: text('dedupe_key').notNull().unique(),
  capturedAt: tz('captured_at').notNull(),
  eventAt: tz('event_at').notNull(),
  trueLat: doublePrecision('true_lat').notNull(),
  trueLon: doublePrecision('true_lon').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  cameraPose: jsonb('camera_pose').$type<CameraPose>().notNull(),
  subject: jsonb('subject').$type<SceneSubject>().notNull(),
  clues: jsonb('clues').$type<Clue[]>().notNull(),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: tz('created_at').notNull().defaultNow(),
});

export const dailies = pgTable('dailies', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date', { mode: 'string' }).notNull().unique(),
  number: integer('number').notNull(),
  snapshotIds: uuid('snapshot_ids').array().notNull(),
  generatedAt: tz('generated_at').notNull().defaultNow(),
});

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  snapshotId: uuid('snapshot_id').notNull(),
  mode: text('mode').$type<'daily' | 'arcade'>().notNull(),
  dailyDate: date('daily_date', { mode: 'string' }),
  startedAt: tz('started_at').notNull().defaultNow(),
  deadline: tz('deadline'),
  guessLat: doublePrecision('guess_lat'),
  guessLon: doublePrecision('guess_lon'),
  guessedAt: tz('guessed_at'),
  cluesUsed: integer('clues_used').notNull().default(0),
  distanceKm: doublePrecision('distance_km'),
  score: integer('score'),
  timedOut: boolean('timed_out').notNull().default(false),
});

export const streaks = pgTable('streaks', {
  userId: uuid('user_id').primaryKey(),
  current: integer('current').notNull().default(0),
  best: integer('best').notNull().default(0),
  freezeAvailable: boolean('freeze_available').notNull().default(true),
  freezeWeek: text('freeze_week'),
  lastCompleted: date('last_completed', { mode: 'string' }),
});

export const subscriptions = pgTable('subscriptions', {
  userId: uuid('user_id').primaryKey(),
  stripeSubId: text('stripe_sub_id').unique(),
  status: text('status').notNull(),
  renewsAt: tz('renews_at'),
});

export type SnapshotRow = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
