import { describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { openDb, snapshots } from '@earthnow/db';
import { haversineKm, ROUND_TYPES, MIN_DISPLACEMENT_KM, cameraGeo } from '@earthnow/shared';
import { seedFromFixtures } from './seed.ts';
import { DailyLockedError, generateDaily, pickDailySnapshots } from './daily.ts';

describe('snapshotter + daily generator', async () => {
  const h = await openDb('memory://');
  const now = new Date();
  await seedFromFixtures(h.db, now);
  const today = now.toISOString().slice(0, 10);

  it('creates a daily with one of each type plus a wildcard', async () => {
    const d = (await h.db.query.dailies.findMany()).find((x) => x.date === today)!;
    expect(d.snapshotIds).toHaveLength(5);
    const rows = await h.db.select().from(snapshots).where(inArray(snapshots.id, d.snapshotIds));
    for (const t of ROUND_TYPES) expect(rows.some((r) => r.type === t)).toBe(true);
  });

  it('never reuses a snapshot from an earlier daily', async () => {
    const all = await h.db.query.dailies.findMany();
    const ids = all.flatMap((d) => d.snapshotIds);
    expect(new Set(ids).size).toBe(ids.length);
    const next = await pickDailySnapshots(h.db, '2099-01-01', { freshHours: 24 * 365 });
    for (const r of next) expect(ids).not.toContain(r.id);
  });

  it('refuses to regenerate a published daily', async () => {
    await expect(generateDaily(h.db, today, { now })).rejects.toBeInstanceOf(DailyLockedError);
  });

  it('stores camera poses displaced from the truth', async () => {
    for (const r of await h.db.select().from(snapshots)) {
      expect(haversineKm({ lat: r.trueLat, lon: r.trueLon }, cameraGeo(r.cameraPose))).toBeGreaterThanOrEqual(MIN_DISPLACEMENT_KM);
      expect(r.clues).toHaveLength(3);
      expect((r.payload as { fact?: unknown }).fact).toBeTruthy();
    }
  });
});
