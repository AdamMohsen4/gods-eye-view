/**
 * Fill the database from fixtures and make today's + tomorrow's daily.
 * Usage: FIXTURE_MODE=1 pnpm seed
 */
import { openDb, type Db } from '@earthnow/db';
import { addDays, utcDate } from '@earthnow/shared';
import { pollAll } from './snapshotter.ts';
import { generateDaily } from './daily.ts';

export async function seedFromFixtures(db: Db, now = new Date()) {
  // Several flight/satellite polls so Arcade has a pool; fixtures are static,
  // so vary the capture time to get distinct snapshots. Start 6 min back so
  // Arcade (rounds must be ≥ 5 min old) has a pool right after seeding.
  const stats = [];
  for (let i = 0; i < 4; i++) stats.push(...(await pollAll(db, new Date(now.getTime() - (6 + i * 31) * 60_000))));
  const today = utcDate(now);
  for (const date of [today, addDays(today, 1)]) {
    await generateDaily(db, date, { now, force: true, freshHours: 24 * 30 });
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = await openDb();
  const stats = await seedFromFixtures(h.db);
  for (const s of stats) console.log(`${s.provider}: ${s.candidates} candidates, ${s.passed} passed, ${s.inserted} new`);
  await h.close();
}
