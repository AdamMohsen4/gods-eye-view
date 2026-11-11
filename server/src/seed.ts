import { and, eq, sql } from 'drizzle-orm';
import { locations, maps, rowsOf, type Db } from '@earthnow/db';
import { seededRandom, type Provider } from '@earthnow/shared';
import { OFFICIAL_MAPS } from './catalog.ts';
import { generateLocations } from './locations.ts';
import type { ImageryProvider } from './imagery/index.ts';

/** Create or update the official maps. Idempotent. */
export async function ensureOfficialMaps(db: Db): Promise<void> {
  for (const def of OFFICIAL_MAPS) {
    await db
      .insert(maps)
      .values({ slug: def.slug, name: def.name, description: def.description, kind: 'official', published: true, sort: def.sort })
      .onConflictDoUpdate({ target: maps.slug, set: { name: def.name, description: def.description, sort: def.sort, kind: 'official', published: true } });
  }
}

export async function locationCount(db: Db, mapId: string, provider: Provider): Promise<number> {
  const [r] = rowsOf<{ n: number }>(
    await db.execute(sql`SELECT count(*)::int AS n FROM locations WHERE map_id = ${mapId} AND provider = ${provider} AND NOT disabled`),
  );
  return r?.n ?? 0;
}

/** Fill each official map with up to `perMap` locations from `provider`. */
export async function seedLocations(
  db: Db,
  provider: ImageryProvider,
  opts: { perMap?: (slug: string) => number; only?: string; log?: (s: string) => void; seed?: string } = {},
): Promise<void> {
  await ensureOfficialMaps(db);
  for (const def of OFFICIAL_MAPS) {
    if (opts.only && def.slug !== opts.only) continue;
    const [m] = await db.select().from(maps).where(eq(maps.slug, def.slug));
    const want = opts.perMap?.(def.slug) ?? def.target;
    const have = await locationCount(db, m!.id, provider.id);
    if (have >= want) continue;
    const existing = await db.select({ panoId: locations.panoId }).from(locations).where(and(eq(locations.mapId, m!.id), eq(locations.provider, provider.id)));
    let n = have;
    const buffer: (typeof locations.$inferInsert)[] = [];
    const flush = async () => {
      if (buffer.length) await db.insert(locations).values(buffer.splice(0)).onConflictDoNothing();
    };
    await generateLocations(def, provider, want - have, {
      rnd: opts.seed ? seededRandom(`${opts.seed}:${def.slug}`) : Math.random,
      exclude: new Set(existing.map((e) => e.panoId)),
      concurrency: provider.id === 'fixture' ? 1 : 6,
      onFound: async (l) => {
        buffer.push({ mapId: m!.id, provider: provider.id, panoId: l.panoId, lat: l.lat, lon: l.lon, heading: l.heading, country: l.country, credit: l.credit });
        // Real providers are slow; write as we go so an interrupted run keeps its progress.
        if (buffer.length >= (provider.id === 'fixture' ? 500 : 10)) await flush();
        n++;
        if (n % 25 === 0) opts.log?.(`${def.slug}: ${n}/${want}`);
      },
    });
    await flush();
    opts.log?.(`${def.slug}: ${await locationCount(db, m!.id, provider.id)} locations (${provider.id})`);
  }
}

/** Load the pre-generated fixture locations (fixtures/locations.json). Fast and deterministic. */
export async function seedFixtures(db: Db): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const data = JSON.parse(readFileSync(new URL('../fixtures/locations.json', import.meta.url), 'utf8')) as Record<
    string,
    { panoId: string; lat: number; lon: number; heading: number; country: string }[]
  >;
  await ensureOfficialMaps(db);
  for (const [slug, locs] of Object.entries(data)) {
    const [m] = await db.select().from(maps).where(eq(maps.slug, slug));
    if (!m || (await locationCount(db, m.id, 'fixture')) >= locs.length) continue;
    for (let i = 0; i < locs.length; i += 500) {
      await db
        .insert(locations)
        .values(locs.slice(i, i + 500).map((l) => ({ ...l, mapId: m.id, provider: 'fixture' as const, credit: 'Generated test panorama' })))
        .onConflictDoNothing();
    }
  }
}
