import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { dailies, rowsOf, snapshots, users, type Db, type UserRow } from '@earthnow/db';
import { utcDate, type RoundType } from '@earthnow/shared';
import { DailyLockedError, generateDaily, isPublished } from '@earthnow/worker';
import type { Config } from './config.ts';
import { Game, GameError } from './game.ts';
import { ALL_ATTRIBUTIONS } from './attributions.ts';
import { shareCardPng } from './shareImage.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AppOptions {
  db: Db;
  config: Config;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp({ db, config, now = () => new Date(), logger = false }: AppOptions) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 16 * 1024 });
  const game = new Game(db, config, now);

  // Rate-limit every public endpoint (per IP). Redis store can be plugged in for multi-instance.
  await app.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: '1 minute' });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error instanceof GameError) return reply.status(error.status).send({ error: error.code, ...error.extra });
    if (error instanceof DailyLockedError) return reply.status(409).send({ error: 'daily_locked' });
    if (error.statusCode === 429) return reply.status(429).send({ error: 'rate_limited' });
    if (error.statusCode && error.statusCode < 500) return reply.status(error.statusCode).send({ error: 'bad_request' });
    app.log.error(error);
    return reply.status(500).send({ error: 'internal' });
  });

  async function player(req: FastifyRequest, required = true): Promise<UserRow | null> {
    const id = req.headers['x-guest-id'];
    if (typeof id !== 'string' || !UUID.test(id)) {
      if (required) throw new GameError(401, 'guest_id_required');
      return null;
    }
    const user = await game.guest(id.toLowerCase());
    if (user.banned) throw new GameError(403, 'banned');
    return user;
  }
  const must = async (req: FastifyRequest) => (await player(req))!;

  /* ------------------------------ player API ------------------------------ */

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/attributions', async () => ALL_ATTRIBUTIONS);

  app.get('/api/me', async (req) => game.me(await must(req)));
  app.put('/api/me', async (req) => game.updateMe(await must(req), (req.body ?? {}) as Record<string, unknown>));
  app.delete('/api/me', async (req, reply) => {
    await game.deleteMe(await must(req));
    return reply.status(204).send();
  });

  app.get('/api/daily/today', async (req) => game.today(await player(req, false)));

  app.post('/api/rounds/start', async (req) => {
    const body = (req.body ?? {}) as { snapshotId?: unknown; mode?: unknown };
    if (typeof body.snapshotId !== 'string' || !UUID.test(body.snapshotId) || body.mode !== 'daily')
      throw new GameError(400, 'invalid_request');
    return game.startDaily(await must(req), body.snapshotId);
  });

  app.post<{ Params: { id: string } }>('/api/rounds/:id/clue', async (req) => game.clue(await must(req), req.params.id));
  app.post<{ Params: { id: string } }>('/api/rounds/:id/guess', async (req) => {
    const body = (req.body ?? {}) as { guess?: unknown };
    if (!('guess' in body)) throw new GameError(400, 'invalid_guess');
    return game.guess(await must(req), req.params.id, body.guess);
  });

  app.get('/api/arcade/next', { config: { rateLimit: { max: Math.min(30, config.rateLimitMax) } } }, async (req) =>
    game.nextArcade(await must(req)),
  );

  app.get<{ Params: { date: string } }>('/api/daily/:date/summary', async (req) => {
    if (!DATE.test(req.params.date)) throw new GameError(400, 'invalid_date');
    return game.summary(await must(req), req.params.date);
  });

  app.get<{ Querystring: { scope?: string; date?: string } }>('/api/leaderboard', async (req) => {
    const scope = req.query.scope === 'country' ? 'country' : 'global';
    const date = req.query.date && DATE.test(req.query.date) ? req.query.date : utcDate(now());
    return game.leaderboard(await player(req, false), scope, date);
  });

  /* -------------------------------- share --------------------------------- */

  async function shareData(number: number, userId: string) {
    if (!UUID.test(userId) || !Number.isInteger(number)) return null;
    const [d] = await db.select().from(dailies).where(eq(dailies.number, number));
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!d || !u || u.banned) return null;
    return { daily: d, summary: await game.summary(u, d.date) };
  }

  app.get<{ Params: { number: string; file: string } }>('/share/:number/:file', async (req, reply) => {
    const number = Number(req.params.number);
    const isPng = req.params.file.endsWith('.png');
    const userId = req.params.file.replace(/\.png$/, '');
    const data = await shareData(number, userId);
    const target = `/?ref=share&d=${encodeURIComponent(req.params.number)}`;
    if (!data) return isPng ? reply.status(404).send({ error: 'not_found' }) : reply.redirect(target);
    if (isPng) {
      const png = await shareCardPng({ number, total: data.summary.total, rounds: data.summary.rounds });
      return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=300').send(png);
    }
    const title = `Earthnow #${number} · ${data.summary.total.toLocaleString('en-US')} / 25,000`;
    const image = `${config.publicOrigin}/share/${number}/${userId}.png`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="${title}">
<meta property="og:description" content="Five things happening on Earth right now. Where are they?">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${target}">
</head><body><a href="${target}">Play today's Earthnow</a></body></html>`;
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  /* -------------------------------- admin --------------------------------- */

  function admin(req: FastifyRequest, reply: FastifyReply): boolean {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = config.adminToken;
    const ok =
      !!expected &&
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) void reply.status(401).send({ error: 'admin_only' });
    return ok;
  }

  app.get<{ Params: { date: string } }>('/api/admin/daily/:date', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!DATE.test(req.params.date)) throw new GameError(400, 'invalid_date');
    const found = await game.dailyFor(req.params.date);
    if (!found) return { date: req.params.date, published: isPublished(req.params.date, now()), daily: null, rounds: [] };
    return {
      date: req.params.date,
      published: isPublished(req.params.date, now()),
      daily: found.daily,
      rounds: found.snapshots,
    };
  });

  app.post<{ Params: { date: string } }>('/api/admin/daily/:date/generate', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!DATE.test(req.params.date)) throw new GameError(400, 'invalid_date');
    const fresh = process.env.LIVE_DATA === '1' ? 36 : 24 * 30;
    return generateDaily(db, req.params.date, { now: now(), freshHours: fresh });
  });

  app.post<{ Params: { date: string }; Body: { index?: number; snapshotId?: string } }>(
    '/api/admin/daily/:date/swap',
    async (req, reply) => {
      if (!admin(req, reply)) return reply;
      const { date } = req.params;
      const { index, snapshotId } = req.body ?? {};
      if (!DATE.test(date) || !Number.isInteger(index) || typeof snapshotId !== 'string' || !UUID.test(snapshotId))
        throw new GameError(400, 'invalid_request');
      if (isPublished(date, now())) throw new DailyLockedError(date);
      const [d] = await db.select().from(dailies).where(eq(dailies.date, date));
      if (!d || index! < 0 || index! >= d.snapshotIds.length) throw new GameError(404, 'daily_not_found');
      if (d.snapshotIds.includes(snapshotId)) throw new GameError(409, 'already_in_daily');
      const [s] = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId));
      if (!s) throw new GameError(404, 'snapshot_not_found');
      const ids = [...d.snapshotIds];
      ids[index!] = snapshotId;
      const [row] = await db.update(dailies).set({ snapshotIds: ids }).where(eq(dailies.id, d.id)).returning();
      return row;
    },
  );

  app.get<{ Querystring: { type?: string; limit?: string } }>('/api/admin/snapshots', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    const type = req.query.type as RoundType | undefined;
    const where = type ? and(eq(snapshots.type, type), eq(snapshots.disabled, false)) : eq(snapshots.disabled, false);
    return db.select().from(snapshots).where(where).orderBy(desc(snapshots.capturedAt)).limit(limit);
  });

  /** Remove a round's snapshot from play at once (e.g. an event turned deadly). */
  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>('/api/admin/snapshots/:id/disable', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!UUID.test(req.params.id)) throw new GameError(400, 'invalid_request');
    const disabled = req.body?.disabled !== false;
    const [row] = await db.update(snapshots).set({ disabled }).where(eq(snapshots.id, req.params.id)).returning({ id: snapshots.id, disabled: snapshots.disabled });
    if (!row) throw new GameError(404, 'snapshot_not_found');
    // Replace it in today's and future dailies with a fresh snapshot of the same type,
    // even though today's daily is otherwise locked. Scores already earned stay.
    const replaced: string[] = [];
    if (disabled) {
      const affected = await db.select().from(dailies).where(and(gte(dailies.date, utcDate(now())), sql`${req.params.id}::uuid = ANY(${dailies.snapshotIds})`));
      for (const d of affected) {
        const [old] = await db.select().from(snapshots).where(eq(snapshots.id, req.params.id));
        const used = rowsOf<{ id: string }>(await db.execute(sql`SELECT unnest(snapshot_ids)::text AS id FROM dailies`)).map((r) => r.id);
        const candidates = await db.select().from(snapshots).where(and(eq(snapshots.type, old!.type), eq(snapshots.disabled, false))).orderBy(desc(snapshots.capturedAt)).limit(200);
        const pick = candidates.find((c) => !used.includes(c.id));
        if (!pick) continue;
        await db.update(dailies).set({ snapshotIds: d.snapshotIds.map((id) => (id === req.params.id ? pick.id : id)) }).where(eq(dailies.id, d.id));
        replaced.push(d.date);
      }
    }
    return { ...row, replacedIn: replaced };
  });

  app.post<{ Params: { id: string }; Body: { banned?: boolean } }>('/api/admin/users/:id/ban', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    if (!UUID.test(req.params.id)) throw new GameError(400, 'invalid_request');
    const banned = req.body?.banned !== false;
    const [row] = await db.update(users).set({ banned }).where(eq(users.id, req.params.id)).returning({ id: users.id, banned: users.banned });
    if (!row) throw new GameError(404, 'user_not_found');
    return row;
  });

  return app;
}
