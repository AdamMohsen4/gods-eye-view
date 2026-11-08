# ADR-005: Postgres-only leaderboards for MVP; PGlite for dev and tests

**Status:** accepted · 2026-11-09

- Leaderboards are a `SUM(score) GROUP BY user` over one day's daily rounds,
  indexed on `(daily_date, user_id)`. At the 10k-DAU goal that is ~50k rows a
  day, well within Postgres. Redis sorted sets are deferred until measurements
  say otherwise; `@fastify/rate-limit` uses its in-memory store until there is
  more than one server instance (then plug in Redis).
- `DATABASE_URL` unset → embedded PGlite in `./.data/pg`; `memory://` → an
  in-memory PGlite for tests. Production uses EU-region Postgres via
  `postgres-js`. Migrations are plain SQL files in `db/migrations`, applied in
  order and recorded in `_migrations`; the Drizzle schema in `db/src/schema.ts`
  mirrors them.
- Friends leaderboard waits for accounts (needs a social graph).
