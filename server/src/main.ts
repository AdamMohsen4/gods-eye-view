import { openDb } from '@earthnow/db';
import { seedFromFixtures, startWorker } from '@earthnow/worker';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const h = await openDb();
if (process.env.SEED_ON_BOOT === '1') {
  if (process.env.LIVE_DATA === '1') throw new Error('SEED_ON_BOOT only works with fixtures');
  await seedFromFixtures(h.db);
}
// PGlite cannot be shared between processes, so in dev the worker runs here.
const stopWorker = process.env.EMBED_WORKER === '1' ? startWorker(h.db) : () => {};
if (!config.adminToken) console.warn('[server] ADMIN_TOKEN not set: admin endpoints are disabled');
const app = await buildApp({ db: h.db, config, logger: process.env.NODE_ENV === 'production' });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`[server] listening on http://localhost:${port} (${h.kind})`);
const stop = async () => {
  stopWorker();
  await app.close();
  await h.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
