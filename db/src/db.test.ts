import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { openDb, rowsOf, users } from './index.ts';

describe('db', () => {
  it('migrates an in-memory PGlite and round-trips a row', async () => {
    const h = await openDb('memory://');
    await h.db.insert(users).values({ displayName: 'Test', guestId: '7f2b9d0e-1c3a-4b5d-8e6f-0a1b2c3d4e5f' });
    const rows = rowsOf<{ n: number }>(await h.db.execute(sql`SELECT count(*)::int AS n FROM users`));
    expect(rows[0]?.n).toBe(1);
    // Migrations are idempotent.
    const { migrate } = await import('./client.ts');
    await migrate(h.db);
    await h.close();
  });
});
