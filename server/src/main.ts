import { openDb } from '@earthnow/db';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { ensureOfficialMaps, seedFixtures } from './seed.ts';

const config = loadConfig();
const h = await openDb();
await ensureOfficialMaps(h.db);
if (process.env.SEED_ON_BOOT === '1' || config.provider === 'fixture') {
  // Fixture locations are generated locally and instantly; real providers use `pnpm locations:generate`.
  await seedFixtures(h.db);
}
if (!config.adminToken) console.warn('[server] ADMIN_TOKEN not set: admin endpoints are disabled');
console.log(`[server] imagery provider: ${config.provider}`);
const app = await buildApp({ db: h.db, config, logger: process.env.NODE_ENV === 'production' });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`[server] listening on http://localhost:${port} (${h.kind})`);
const stop = async () => {
  await app.close();
  await h.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
