import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { challenges, games, locations, users, rowsOf, type Db, type UserRow } from '@earthnow/db';
import { dailyNumber, isLatLon, type PublicConfig } from '@earthnow/shared';
import type { Config } from './config.ts';
import { countryAt, countryRef } from './countries.ts';
import { Game, GameError } from './game.ts';
import { MapMaker } from './mapmaker.ts';
import { Hub, type HubOptions } from './multiplayer/hub.ts';
import { ProviderUnavailable } from './imagery/index.ts';
import { shareCardPng } from './shareImage.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9-]{4,40}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;

export interface AppOptions {
  db: Db;
  config: Config;
  now?: () => Date;
  logger?: boolean;
  hub?: HubOptions;
}

export async function buildApp({ db, config, now = () => new Date(), logger = false, hub: hubOpts }: AppOptions) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 16 * 1024 });
  const game = new Game(db, config, now);
  const maker = new MapMaker(db, config);
  const hub = new Hub(db, game, config, hubOpts);

  await app.register(rateLimit, { global: true, max: config.rateLimitMax, timeWindow: '1 minute' });
  await app.register(websocket, { options: { maxPayload: 4096 } });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error instanceof GameError) return reply.status(error.status).send({ error: error.code, ...error.extra });
    if (error instanceof ProviderUnavailable) return reply.status(503).send({ error: 'imagery_unavailable', detail: error.message });
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
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const uuidParam = (v: string) => {
    if (!UUID.test(v)) throw new GameError(400, 'invalid_id');
    return v;
  };

  /* ------------------------------- realtime ------------------------------ */

  app.get('/ws', { websocket: true }, (socket) => {
    const onMessage = hub.connect(socket);
    socket.on('message', (data: Buffer) => void onMessage(data.toString()));
    socket.on('close', () => hub.disconnect(socket));
  });

  /* -------------------------------- basics ------------------------------- */

  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/config', async (): Promise<PublicConfig> => ({
    provider: config.provider,
    mapillaryToken: config.provider === 'mapillary' ? config.mapillaryClientToken : null,
    googleKey: config.provider === 'google' ? config.googleBrowserKey : null,
    mapStyle: config.mapStyle,
  }));

  /** Which country a map point is in (streak mode shows it before you lock in). */
  app.get<{ Querystring: { lat?: string; lon?: string } }>('/api/geo/country', async (req) => {
    const p = { lat: Number(req.query.lat), lon: Number(req.query.lon) };
    if (!isLatLon(p)) throw new GameError(400, 'invalid_point');
    return { country: countryRef(countryAt(p)) };
  });

  app.get('/api/me', async (req) => game.me(await must(req)));
  app.put('/api/me', async (req) => game.updateMe(await must(req), body(req)));
  app.delete('/api/me', async (req, reply) => {
    await game.deleteMe(await must(req));
    return reply.status(204).send();
  });
  app.get('/api/me/stats', async (req) => game.stats(await must(req)));

  /* --------------------------------- maps -------------------------------- */

  app.get<{ Querystring: { kind?: string } }>('/api/maps', async (req) => {
    const kind = req.query.kind === 'official' || req.query.kind === 'community' ? req.query.kind : undefined;
    return game.listMaps(kind);
  });
  app.get<{ Params: { slug: string } }>('/api/maps/:slug', async (req) => {
    if (!SLUG.test(req.params.slug)) throw new GameError(400, 'invalid_map');
    const m = await game.mapBySlug(req.params.slug);
    const me = await player(req, false);
    if (!m.published && m.creatorId !== me?.id) throw new GameError(404, 'map_not_found');
    return game.mapSummary(m);
  });
  app.get<{ Params: { slug: string }; Querystring: { mode?: string } }>('/api/maps/:slug/leaderboard', async (req) => {
    if (!SLUG.test(req.params.slug)) throw new GameError(400, 'invalid_map');
    return game.mapLeaderboard(req.params.slug, req.query.mode === 'streak' ? 'streak' : 'classic');
  });

  /* -------------------------------- games -------------------------------- */

  app.post('/api/games', async (req) => game.startGame(await must(req), body(req)));
  app.get<{ Params: { id: string } }>('/api/games/:id', async (req) => game.state(await must(req), uuidParam(req.params.id)));
  app.post<{ Params: { id: string } }>('/api/games/:id/guess', async (req) => {
    const b = body(req);
    if (!('guess' in b)) throw new GameError(400, 'invalid_guess');
    return game.guess(await must(req), uuidParam(req.params.id), b.guess);
  });
  app.post<{ Params: { id: string } }>('/api/games/:id/next', async (req) => game.next(await must(req), uuidParam(req.params.id)));

  /* ----------------------------- challenges ------------------------------ */

  app.get('/api/daily', async (req) => game.dailyInfo(await player(req, false)));
  app.post('/api/challenges', { config: { rateLimit: { max: 30 } } }, async (req) => game.createChallenge(await must(req), body(req)));
  app.get<{ Params: { token: string } }>('/api/challenges/:token', async (req) => {
    if (!TOKEN.test(req.params.token)) throw new GameError(400, 'invalid_token');
    return game.challengeInfo(await player(req, false), req.params.token);
  });
  app.post<{ Params: { token: string } }>('/api/challenges/:token/play', async (req) => {
    if (!TOKEN.test(req.params.token)) throw new GameError(400, 'invalid_token');
    return game.playChallenge(await must(req), req.params.token);
  });
  app.get<{ Params: { token: string } }>('/api/challenges/:token/leaderboard', async (req) => {
    if (!TOKEN.test(req.params.token)) throw new GameError(400, 'invalid_token');
    const me = await player(req, false);
    const info = await game.challengeInfo(me, req.params.token);
    if (!info.finished) throw new GameError(403, 'finish_first');
    return game.challengeLeaderboard(me, req.params.token);
  });

  app.get('/api/leaderboard/rating', async () => game.ratingLeaderboard());

  /* ------------------------------ map maker ------------------------------ */

  app.get('/api/maker/maps', async (req) => maker.mine(await must(req)));
  app.post('/api/maker/maps', async (req) => maker.create(await must(req), body(req)));
  app.get<{ Params: { id: string } }>('/api/maker/maps/:id', async (req) => maker.get(await must(req), uuidParam(req.params.id)));
  app.patch<{ Params: { id: string } }>('/api/maker/maps/:id', async (req) => maker.update(await must(req), uuidParam(req.params.id), body(req)));
  app.delete<{ Params: { id: string } }>('/api/maker/maps/:id', async (req, reply) => {
    await maker.remove(await must(req), uuidParam(req.params.id));
    return reply.status(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/maker/maps/:id/locations', { config: { rateLimit: { max: 120 } } }, async (req) =>
    maker.addLocation(await must(req), uuidParam(req.params.id), body(req).point),
  );
  app.delete<{ Params: { id: string; loc: string } }>('/api/maker/maps/:id/locations/:loc', async (req, reply) => {
    await maker.removeLocation(await must(req), uuidParam(req.params.id), uuidParam(req.params.loc));
    return reply.status(204).send();
  });

  /* -------------------------------- share -------------------------------- */

  async function sharedGame(gameId: string) {
    if (!UUID.test(gameId)) return null;
    const [g] = await db.select().from(games).where(and(eq(games.id, gameId), eq(games.status, 'finished')));
    if (!g || g.mode === 'streak') return null;
    const [u] = await db.select().from(users).where(eq(users.id, g.userId));
    if (!u || u.banned) return null;
    const scores = rowsOf<{ score: number }>(await db.execute(sql`SELECT coalesce(score, 0)::int AS score FROM game_rounds WHERE game_id = ${g.id} ORDER BY idx`)).map((r) => r.score);
    const [c] = g.challengeId ? await db.select().from(challenges).where(eq(challenges.id, g.challengeId)) : [];
    const state = await game.state(u, g.id);
    const title = c?.dailyDate ? `Earthnow Daily #${dailyNumber(c.dailyDate)}` : `Earthnow · ${state.map.name}`;
    return { g, u, scores, c, title };
  }

  app.get<{ Params: { file: string } }>('/share/:file', async (req, reply) => {
    const isPng = req.params.file.endsWith('.png');
    const data = await sharedGame(req.params.file.replace(/\.png$/, ''));
    const target = data?.c ? `/challenge/${data.c.token}?ref=share` : '/?ref=share';
    if (!data) return isPng ? reply.status(404).send({ error: 'not_found' }) : reply.redirect('/');
    if (isPng) {
      const png = await shareCardPng({ title: data.title, subtitle: `${data.u.displayName} scored`, total: data.g.totalScore, scores: data.scores });
      return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=300').send(png);
    }
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    const title = esc(`${data.title} · ${data.g.totalScore.toLocaleString('en-US')}`);
    const image = `${config.publicOrigin}/share/${data.g.id}.png`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:title" content="${title}">
<meta property="og:description" content="Five places on Earth. Can you beat it?">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${target}">
</head><body><a href="${target}">Play on Earthnow</a></body></html>`;
    return reply.header('content-type', 'text/html; charset=utf-8').send(html);
  });

  /* -------------------------------- admin -------------------------------- */

  function admin(req: FastifyRequest, reply: FastifyReply): boolean {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expected = config.adminToken;
    const ok = !!expected && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
    if (!ok) void reply.status(401).send({ error: 'admin_only' });
    return ok;
  }

  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>('/api/admin/locations/:id/disable', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const [row] = await db
      .update(locations)
      .set({ disabled: req.body?.disabled !== false })
      .where(eq(locations.id, uuidParam(req.params.id)))
      .returning({ id: locations.id, disabled: locations.disabled });
    if (!row) throw new GameError(404, 'location_not_found');
    return row;
  });
  app.post<{ Params: { id: string }; Body: { banned?: boolean } }>('/api/admin/users/:id/ban', async (req, reply) => {
    if (!admin(req, reply)) return reply;
    const [row] = await db
      .update(users)
      .set({ banned: req.body?.banned !== false })
      .where(eq(users.id, uuidParam(req.params.id)))
      .returning({ id: users.id, banned: users.banned });
    if (!row) throw new GameError(404, 'user_not_found');
    return row;
  });

  return Object.assign(app, { hub, game });
}
