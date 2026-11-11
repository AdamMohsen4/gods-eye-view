/**
 * Fill the official maps with real panoramas.
 *   pnpm locations:generate -- --provider mapillary [--map world] [--count 500]
 * Run with the server stopped when using the local PGlite database.
 */
import { parseArgs } from 'node:util';
import { openDb } from '@earthnow/db';
import { PROVIDERS, type Provider } from '@earthnow/shared';
import { loadConfig } from '../config.ts';
import { imageryProvider } from '../imagery/index.ts';
import { seedLocations } from '../seed.ts';

const { values } = parseArgs({
  options: { provider: { type: 'string' }, map: { type: 'string' }, count: { type: 'string' } },
  allowPositionals: true,
});
const config = loadConfig();
const id = (values.provider ?? config.provider) as Provider;
if (!PROVIDERS.includes(id)) throw new Error(`unknown provider ${id}`);
const provider = imageryProvider(id, config);
const h = await openDb();
const count = values.count ? Number(values.count) : undefined;
await seedLocations(h.db, provider, { only: values.map, perMap: count ? () => count : undefined, log: (s) => console.log(s) });
await h.close();
