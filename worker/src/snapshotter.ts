import { and, lt, notInArray, sql } from 'drizzle-orm';
import { snapshots, rowsOf, type Db, type NewSnapshot } from '@earthnow/db';
import { fetchAircraft } from './providers/flyitalyadsb.ts';
import { fetchQuakes } from './providers/usgs.ts';
import { fetchFires } from './providers/firms.ts';
import { fetchSatellites } from './providers/celestrak.ts';
import { clusterFires, filterAircraft, filterFire, filterQuake, filterSatellite, type Verdict } from './filters.ts';
import { sceneQuality } from '@earthnow/shared';
import { countryAt } from './country.ts';
import { freezeFire, freezeFlight, freezeQuake, freezeSatellite } from './freeze.ts';

export interface PollStats {
  provider: string;
  candidates: number;
  passed: number;
  inserted: number;
  rejected: Record<string, number>;
}

const MAX_PER_POLL = { flight: 6, satellite: 4, fire: 20, quake: 30 } as const;

function tally<T>(items: T[], check: (t: T) => Verdict) {
  const rejected: Record<string, number> = {};
  const passed: T[] = [];
  for (const item of items) {
    const v = check(item);
    if (v.ok) passed.push(item);
    else rejected[v.reason] = (rejected[v.reason] ?? 0) + 1;
  }
  return { passed, rejected };
}

/** Random pick that prefers daylight-over-land scenes (gameplay, not safety). */
function sampleByScene<T extends { lat?: number; lon?: number }>(items: T[], n: number, at: Date): T[] {
  const scored = items.map((x) => {
    const p = { lat: x.lat!, lon: x.lon! };
    return { x, q: sceneQuality(at.toISOString(), p, countryAt(p.lat, p.lon) !== null) + Math.random() * 0.9 };
  });
  return scored.sort((a, b) => b.q - a.q).slice(0, n).map((s) => s.x);
}

async function insert(db: Db, rows: NewSnapshot[]): Promise<number> {
  if (!rows.length) return 0;
  const result = await db.insert(snapshots).values(rows).onConflictDoNothing({ target: snapshots.dedupeKey }).returning({ id: snapshots.id });
  return result.length;
}

export async function pollFlights(db: Db, now = new Date()): Promise<PollStats> {
  const { items } = await fetchAircraft();
  const { passed, rejected } = tally(items, filterAircraft);
  const rows = sampleByScene(passed, MAX_PER_POLL.flight, now).map((a) => freezeFlight(a, now));
  return { provider: 'flights', candidates: items.length, passed: passed.length, inserted: await insert(db, rows), rejected };
}

export async function pollSatellites(db: Db, now = new Date()): Promise<PollStats> {
  const { items } = await fetchSatellites(now);
  const { passed, rejected } = tally(items, filterSatellite);
  const rows = sampleByScene(passed, MAX_PER_POLL.satellite, now).map((s) => freezeSatellite(s, now));
  return { provider: 'satellites', candidates: items.length, passed: passed.length, inserted: await insert(db, rows), rejected };
}

export async function pollQuakes(db: Db, now = new Date()): Promise<PollStats> {
  const { items, observedAt } = await fetchQuakes();
  const { passed, rejected } = tally(items, (q) => filterQuake(q, observedAt));
  const rows = passed.slice(0, MAX_PER_POLL.quake).map((q) => freezeQuake(q, now));
  return { provider: 'quakes', candidates: items.length, passed: passed.length, inserted: await insert(db, rows), rejected };
}

export async function pollFires(db: Db, now = new Date()): Promise<PollStats> {
  const { items, observedAt } = await fetchFires();
  const clusters = clusterFires(items);
  const { passed, rejected } = tally(clusters, (c) => filterFire(c, observedAt));
  const rows = passed
    .sort((a, b) => b.totalFrp - a.totalFrp)
    .slice(0, MAX_PER_POLL.fire)
    .map((c) => freezeFire(c, now));
  return { provider: 'fires', candidates: clusters.length, passed: passed.length, inserted: await insert(db, rows), rejected };
}

export async function pollAll(db: Db, now = new Date()): Promise<PollStats[]> {
  const out: PollStats[] = [];
  for (const poll of [pollFlights, pollSatellites, pollQuakes, pollFires]) {
    try {
      out.push(await poll(db, now));
    } catch (error) {
      console.error(`[snapshotter] ${poll.name} failed:`, (error as Error).message);
    }
  }
  return out;
}

/** Delete old snapshots that no daily or round references. */
export async function pruneSnapshots(db: Db, olderThanDays = 7): Promise<number> {
  const referenced = rowsOf<{ id: string }>(
    await db.execute(sql`SELECT unnest(snapshot_ids) AS id FROM dailies UNION SELECT snapshot_id FROM rounds`),
  ).map((r) => r.id);
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const where = referenced.length
    ? and(lt(snapshots.capturedAt, cutoff), notInArray(snapshots.id, referenced))
    : lt(snapshots.capturedAt, cutoff);
  return (await db.delete(snapshots).where(where).returning({ id: snapshots.id })).length;
}
