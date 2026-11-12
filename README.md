# Earthnow

A street-level geography game. You're dropped into a 360° panorama somewhere on Earth: look around, pin your guess, score by distance.
Classic maps, a shared Daily, challenge links, country streaks, live 1v1 duels, party rooms (everyone scores, duel, teams, elimination), friends with party invites, badges and a map maker.

Spec: `docs/SPEC.md` · API: `docs/API.md` · Decisions: `docs/ADR-*.md` · Data: `docs/DATA_AUDIT.md`.

## Run it

```sh
pnpm install
cp .env.example .env     # IMAGERY_PROVIDER=fixture by default: generated panoramas, no keys
pnpm dev                 # server :8787, client :5173
```

Open http://localhost:5173.

### Real imagery

1. **Mapillary** (free): create an app at https://www.mapillary.com/dashboard/developers, put its client token in `MAPILLARY_TOKEN`, set `IMAGERY_PROVIDER=mapillary`.
2. **Google Street View** (billed; **evaluation only for now**, see ADR-004): put a Street View metadata key in `GOOGLE_MAPS_SERVER_KEY` and a referrer-restricted Maps JavaScript API key in `GOOGLE_MAPS_BROWSER_KEY`, then set `IMAGERY_PROVIDER=google`. Google's terms forbid showing Street View on the same screen as a non-Google map, which the guess map is.
3. Stop the server, then fill the maps: `pnpm locations:generate -- --provider mapillary` (add `--map sweden --count 300` to do one map).

## Checks

```sh
pnpm lint       # eslint + tsc for every package
pnpm test       # vitest: scoring, db, API (incl. "no answer before the guess"), duel/party/teams/elimination engine, friends
pnpm test:e2e   # playwright: desktop + 390 px phone; classic, daily, play again, keyboard-only, parties

Behind a reverse proxy, set `TRUST_PROXY` (hop count or proxy IPs) so rate limits see real client IPs.
```

## Layout

| Path | What |
| --- | --- |
| `shared/` | Types, scoring, geo, WebSocket message types |
| `db/` | Drizzle schema + SQL migrations (Postgres in prod, PGlite in dev and tests) |
| `server/` | Fastify API, solo game engine, map maker, realtime hub and match engine, imagery providers, location generator |
| `client/` | Vite + React app, MapLibre maps, panorama adapters (Mapillary, Google, fixture) |
