# CLAUDE.md — Earthnow

## What we are building
A street-level geography guessing game (see docs/SPEC.md). On 2026-11-10 it replaced the
earlier live-world game built on a God's Eye View fork; that code is gone and lives only in
git history (`a9d4f99b`).

## Stack
- Client: Vite + React + TypeScript in /client; MapLibre (OpenFreeMap tiles) for maps;
  panorama adapters for Mapillary (mapillary-js), Google Street View (Maps JS) and a fixture.
- Server: Node + Fastify + TypeScript in /server; WebSocket hub for duels and parties.
- Postgres (EU region) + Drizzle ORM; PGlite in dev and tests.
- Auth: guest identity (x-guest-id). Clerk sign-in and Stripe Plus are deferred.
- Tests: Vitest + Playwright (desktop and a 390px mobile viewport).

## Non-negotiable rules
1. The true location of a round NEVER reaches the client before the guess is accepted.
   Pre-guess payloads carry only {provider, panoId, heading}. Keep the test in
   server/src/server.test.ts green (see ADR-002 for the pano-id limit).
2. In multiplayer, never send the answer or another player's guess before the reveal.
3. Server keys stay server-side. The browser only gets the public viewer token/key for the
   active provider (ADR-001). Rate-limit every public endpoint and the WebSocket.
4. Every round reveal shows its imagery attribution; maps keep tile attribution.
5. Do not use GeoGuessr's (or any other game's) name, UI, wording or assets.

## How to work
- Write a short plan before coding; tests in the same change; `pnpm lint && pnpm test`
  green (and `pnpm test:e2e` for UI changes) before calling a task done.
- Tests always use IMAGERY_PROVIDER=fixture. The owner's local `.env` uses Mapillary (token set
  2026-11-11; the local `.data` DB holds ~9,700 real Mapillary locations). Real providers need keys (README).
- After UI changes, play it in a real browser and look at screenshots before reporting.
- When the spec is silent, choose the simplest option, log it in docs/ADR-xxx.md, and
  mention it. Ask before anything that costs money, changes data licensing, or touches user data.

## Repo notes
- Layout: `shared/` (types, scoring, geo, ws messages), `db/` (schema + migrations),
  `server/` (API, game engine, map maker, multiplayer hub/match, imagery, location generator),
  `client/` (React app). Contract: `docs/API.md`. Decisions: `docs/ADR-*.md`.
- Commands: `pnpm dev`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm seed`,
  `pnpm locations:generate -- --provider mapillary|google [--map slug] [--count n]`.
- Mapillary search uses the coverage vector tiles (z12 sequences, z14 images) plus one Graph API
  lookup per hit; the `images` bbox search finds almost no 360° panoramas and times out on big boxes.
- `pnpm test:e2e` starts its own in-memory server on :8797 and Vite on :5183, so it never
  touches a running `pnpm dev` (:8787/:5173) or its `.data` database.
- Google Street View is evaluation-only until ADR-004 is decided; ship with Mapillary.
- `server/fixtures/locations.json` is regenerated with
  `node --import tsx server/src/scripts/buildFixtures.ts`.
