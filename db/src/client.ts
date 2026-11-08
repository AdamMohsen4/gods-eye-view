import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Open the database.
 * - `DATABASE_URL=postgres://…` → postgres-js (production; EU-region Postgres).
 * - `memory://` → in-memory PGlite (tests).
 * - unset → PGlite persisted in <repo>/.data/pg (local dev only; single process,
 *   so the server embeds the worker with EMBED_WORKER=1).
 */
export async function openDb(url = process.env.DATABASE_URL): Promise<DbHandle> {
  let handle: DbHandle;
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const client = postgres(url, { max: 10, onnotice: () => {} });
    handle = { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end(), kind: 'postgres' };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    let dataDir: string | undefined;
    if (url !== 'memory://') {
      dataDir = url?.startsWith('file://') ? url.slice(7) : join(MIGRATIONS_DIR, '..', '..', '.data', 'pg');
      mkdirSync(dataDir, { recursive: true });
    }
    const client = new PGlite(dataDir);
    await client.waitReady;
    handle = { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close(), kind: 'pglite' };
  }
  await migrate(handle.db);
  return handle;
}

/** Apply migrations/*.sql in order, once each. */
export async function migrate(db: Db): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set(rowsOf<{ name: string }>(await db.execute(sql`SELECT name FROM _migrations`)).map((r) => r.name));
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of text.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await db.execute(sql.raw(statement));
    }
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
  }
}

/** Normalise `db.execute` results across drivers to a row array. */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
