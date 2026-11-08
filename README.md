# Earthnow

A live-world guessing game: every round is something happening on Earth right
now — a plane in flight, a satellite overhead, an earthquake or a wildfire.
Look at a labelless 3D view, drop a pin, and see how close you were.

Fork of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) (MIT, see `LICENSE`).
Spec: `docs/SPEC.md` · API: `docs/API.md` · Decisions: `docs/ADR-*.md` · Data: `docs/DATA_AUDIT.md`.

## Run it

```sh
pnpm install
cp .env.example .env        # FIXTURE_MODE=1 by default: no keys needed
pnpm seed                   # fixtures → snapshots + Dailies in ./.data/pg (stop the server first)
pnpm dev                    # server :8787 (worker embedded), client :5173
```

Open http://localhost:5173. Admin panel: http://localhost:5173/admin.html (token = `ADMIN_TOKEN`).

## Checks

```sh
pnpm lint       # eslint + tsc for every package
pnpm test       # vitest: shared, db, worker filters, server API (incl. "no truth before guess")
pnpm test:e2e   # playwright: desktop + 390px mobile against a seeded fixture server
```

## Layout

| Path | What |
| --- | --- |
| `shared/` | Types, geo math, scoring, displaced camera poses, share text |
| `db/` | Drizzle schema + SQL migrations (Postgres in prod, PGlite in dev/tests) |
| `worker/` | Snapshotter: provider adapters, safety filters (`src/filters.ts`), daily generator |
| `server/` | Fastify game API, share page + OG image, admin |
| `client/` | Vite + Cesium game client |
| `fixtures/` | Recorded provider data for `FIXTURE_MODE=1` |

## Live data

`LIVE_DATA=1` makes the worker call real providers. Flights need
`FLYITALYADSB_API_KEY` (and `FLYITALYADSB_PLAN=pro` for worldwide queries).
USGS, NASA FIRMS and CelesTrak are keyless.
