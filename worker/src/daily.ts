import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { dailies, snapshots, rowsOf, type Db, type SnapshotRow } from '@earthnow/db';
import { ROUND_TYPES, addDays, dailyNumber, haversineKm, seededRandom, utcDate, type RoundType } from '@earthnow/shared';

export const DAILY_ROUNDS = 5;
/** Rounds in one daily should be spread out; picks closer than this are skipped. */
const MIN_SPREAD_KM = 1500;

export class DailyLockedError extends Error {
  constructor(date: string) {
    super(`Daily ${date} is published and locked`);
  }
}

/** A daily is published (and locked) from 00:00 UTC on its date. */
export function isPublished(date: string, now = new Date()): boolean {
  return date <= utcDate(now);
}

async function usedSnapshotIds(db: Db): Promise<Set<string>> {
  return new Set(rowsOf<{ id: string }>(await db.execute(sql`SELECT unnest(snapshot_ids)::text AS id FROM dailies`)).map((r) => r.id));
}

/**
 * Pick five snapshots: one flight, quake, fire and satellite, plus a wildcard,
 * spread around the globe, never reused from an earlier daily.
 */
export async function pickDailySnapshots(db: Db, date: string, opts: { freshHours?: number; exclude?: string[] } = {}): Promise<SnapshotRow[]> {
  const used = await usedSnapshotIds(db);
  for (const id of opts.exclude ?? []) used.add(id);
  const since = new Date(Date.now() - (opts.freshHours ?? 36) * 3600_000);
  const rows = (
    await db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.disabled, false), gte(snapshots.capturedAt, since)))
      .orderBy(desc(snapshots.capturedAt))
      .limit(2000)
  ).filter((r) => !used.has(r.id));

  const rnd = seededRandom(`daily:${date}`);
  const shuffle = <T>(xs: T[]) => xs.map((x) => [rnd(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const byType = new Map<RoundType, SnapshotRow[]>(ROUND_TYPES.map((t) => [t, shuffle(rows.filter((r) => r.type === t))]));

  const picked: SnapshotRow[] = [];
  const farEnough = (r: SnapshotRow) =>
    picked.every((p) => haversineKm({ lat: p.trueLat, lon: p.trueLon }, { lat: r.trueLat, lon: r.trueLon }) >= MIN_SPREAD_KM);
  const take = (pool: SnapshotRow[]) => {
    const r = pool.find((c) => !picked.includes(c) && farEnough(c)) ?? pool.find((c) => !picked.includes(c));
    if (r) picked.push(r);
    return r;
  };
  for (const type of ROUND_TYPES) take(byType.get(type) ?? []);
  // Wildcard: the "most live" types first.
  const wildPool = shuffle([...(byType.get('flight') ?? []), ...(byType.get('satellite') ?? []), ...rows]);
  while (picked.length < DAILY_ROUNDS && take(wildPool)) {
    /* keep taking */
  }
  if (picked.length < DAILY_ROUNDS) throw new Error(`Not enough snapshots for daily ${date} (${picked.length}/${DAILY_ROUNDS})`);
  return shuffle(picked);
}

export async function generateDaily(db: Db, date: string, opts: { now?: Date; freshHours?: number; force?: boolean } = {}) {
  if (isPublished(date, opts.now) && !opts.force) {
    const existing = await db.select().from(dailies).where(eq(dailies.date, date));
    if (existing.length) throw new DailyLockedError(date);
  }
  const picks = await pickDailySnapshots(db, date, { freshHours: opts.freshHours });
  const values = { date, number: dailyNumber(date), snapshotIds: picks.map((p) => p.id) };
  const [row] = await db
    .insert(dailies)
    .values(values)
    .onConflictDoUpdate({ target: dailies.date, set: { snapshotIds: values.snapshotIds, generatedAt: new Date() } })
    .returning();
  return row!;
}

/** Make sure today's and (after 23:00 UTC) tomorrow's daily exist. */
export async function ensureDailies(db: Db, now = new Date(), freshHours?: number): Promise<string[]> {
  const today = utcDate(now);
  const wanted = [today];
  if (now.getUTCHours() >= 23) wanted.push(addDays(today, 1));
  const created: string[] = [];
  for (const date of wanted) {
    const existing = await db.select({ id: dailies.id }).from(dailies).where(eq(dailies.date, date));
    if (existing.length) continue;
    await generateDaily(db, date, { now, freshHours, force: true });
    created.push(date);
  }
  return created;
}
