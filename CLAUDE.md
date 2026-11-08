# CLAUDE.md — Earthnow

## What we are building
A live-world guessing game (see docs/SPEC.md). This repo is a fork of
bilawalsidhu/gods-eye-view (MIT). Keep its LICENSE and copyright notice.
We reuse its Cesium globe, cockpit camera and the flight, satellite,
earthquake and fire layers. Everything else is removed or disabled.

## First task in a fresh fork (M0)
1. Pin to the latest release tag, not main. Record the commit in docs/UPSTREAM.md.
2. Read the repo's DATA_SOURCES.md and LICENSE. Produce docs/DATA_AUDIT.md:
   one row per layer/asset with licence, commercial OK (yes/no/unknown), action.
3. Delete or feature-flag OFF: CCTV, ALPR, traffic, radio, voice agent,
   MCP panel, military-aircraft feeds, vessels (phase 2), and any asset
   marked non-commercial. Nothing on the "never" list may be re-enabled.
4. Replace the OpenSky flight provider with a FlyItalyADSB adapter.

## Stack
- Client: the fork's Vite + Cesium app, refactored into /client
  (TypeScript for all new code; leave untouched upstream JS as is)
- Game server: Node + Fastify + TypeScript in /server
- Postgres (EU region) + Drizzle ORM; Redis for rate limits and leaderboards
- Snapshotter worker in /worker: polls providers, freezes snapshots
- Auth: Clerk (guest play must work with no account)
- Payments: Stripe; webhooks are the source of truth
- Tests: Vitest + Playwright (desktop and a 390px mobile viewport)

## Non-negotiable rules
1. The true location of a round NEVER reaches the client before the guess
   is accepted. Add a test that fails if any pre-guess response contains
   lat/lon of the snapshot.
2. Every snapshot passes the selection filters in /worker/filters.ts
   (no military/state/police/medical/LADD/PIA aircraft, no takeoff/landing
   phase, size thresholds, disaster delay). Filters have unit tests with
   fixtures. Never loosen a filter to get more rounds; flag it to me.
3. No feature may let a user search for, follow or be notified about a
   specific aircraft, vessel or person.
4. All provider keys live server-side. The client never calls a paid or
   keyed provider directly. Rate-limit every public endpoint.
5. Every round reveal shows its data attribution.
6. Do not use GeoGuessr's name, UI, wording or assets.

## How to work
- One milestone task at a time; write a short plan before coding.
- Small PRs; tests in the same PR; `pnpm lint && pnpm test` green before
  you call a task done.
- Use recorded fixture data in dev and tests (FIXTURE_MODE=1); hit real
  providers only with LIVE_DATA=1.
- Performance budget: Daily playable on a mid-range Android over 4G;
  first round interactive in < 4 s. Measure, don't guess.
- When the spec is silent, choose the simplest option, log it in
  docs/ADR-xxx.md, and mention it. Ask me before anything that costs
  money, changes data licensing, or touches user data.

## Definition of done
- Acceptance items in SPEC.md met, tests green, docs updated
- Summary: what changed, how to verify, open questions

## Repo notes (added during M0–M3)
- Layout: `shared/` (types, geo, scoring, camera poses, share text — used by all),
  `db/` (Drizzle schema + SQL migrations, PGlite or Postgres), `worker/`
  (providers, `src/filters.ts`, snapshot freezing, daily generator),
  `server/` (Fastify API, share cards, admin), `client/` (Vite + Cesium game).
  Contract: `docs/API.md`. Decisions: `docs/ADR-*.md`.
- Commands: `pnpm install`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`,
  `pnpm seed` (fixtures → ./.data/pg, server stopped), `pnpm dev` (server with embedded worker + client),
  `pnpm fixtures:record` (LIVE_DATA, keyless sources only).
- `FIXTURE_MODE=1` is the default for tests; the flight fixture is synthetic until
  a FlyItalyADSB key exists (`fixtures/README.md`).
- Status of milestones is tracked with checkboxes in `docs/SPEC.md`.
