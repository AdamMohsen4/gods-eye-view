/**
 * Snapshotter worker: the ONLY component that talks to data providers.
 * Polls, filters, freezes snapshots, and generates tomorrow's Daily at 23:00 UTC.
 */
import { openDb, type Db } from '@earthnow/db';
import { pollFires, pollFlights, pollQuakes, pollSatellites, pruneSnapshots, type PollStats } from './snapshotter.ts';
import { ensureDailies } from './daily.ts';
import { liveData } from './env.ts';

const seconds = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 1000;

function log(s: PollStats) {
  const top = Object.entries(s.rejected).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, n]) => `${r}:${n}`).join(', ');
  console.log(`[snapshotter] ${s.provider} ${s.candidates} seen, ${s.passed} passed, ${s.inserted} new${top ? ` | rejected ${top}` : ''}`);
}

function every(ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error('[snapshotter]', (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

export function startWorker(db: Db): () => void {
  const timers: ReturnType<typeof setInterval>[] = [];
  console.log(`[snapshotter] starting (${liveData() ? 'LIVE_DATA' : 'FIXTURE_MODE'})`);
  timers.push(every(seconds('FLIGHT_POLL_SECONDS', 120), async () => log(await pollFlights(db))));
  timers.push(every(seconds('SATELLITE_POLL_SECONDS', 120), async () => log(await pollSatellites(db))));
  timers.push(every(seconds('QUAKE_POLL_SECONDS', 900), async () => log(await pollQuakes(db))));
  timers.push(every(seconds('FIRE_POLL_SECONDS', 1800), async () => log(await pollFires(db))));
  timers.push(every(6 * 3600_000, async () => console.log(`[snapshotter] pruned ${await pruneSnapshots(db)}`)));

  // Daily generation: ensureDailies creates tomorrow's Daily once it is 23:00 UTC
  // (and backfills today on boot). An existing daily is never overwritten here, so
  // admin swaps survive; the admin panel can regenerate an unpublished daily.
  timers.push(every(60_000, async () => {
    const created = await ensureDailies(db, new Date(), liveData() ? 36 : 24 * 30);
    if (created.length) console.log(`[snapshotter] created dailies ${created.join(', ')}`);
  }));
  return () => timers.forEach(clearInterval);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = await openDb();
  if (h.kind === 'pglite') console.warn('[snapshotter] PGlite is single-process: in dev run the worker inside the server (EMBED_WORKER=1) instead');
  startWorker(h.db);
  process.on('SIGTERM', () => void h.close().then(() => process.exit(0)));
}
