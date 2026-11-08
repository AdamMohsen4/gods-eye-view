# ADR-006: Daily numbering, publish/lock rule, Arcade freshness

**Status:** accepted · 2026-11-09

- Daily #1 is `DAILY_EPOCH` in `shared/src/dates.ts` (2026-11-01 for now).
  **Move it to the public launch date** so the first public Daily is #1.
- A daily is generated at 23:00 UTC for the next day and is *published* (locked
  for swaps/regeneration) from 00:00 UTC on its date. The one exception is
  `POST /api/admin/snapshots/:id/disable`, which pulls a round from play at once
  (e.g. an event turned deadly) and swaps in a fresh snapshot of the same type.
- Starting a daily round is an explicit `POST /api/rounds/start`; that sets
  `started_at` and the 60 s deadline. `GET /api/daily/today` returns poses so
  the client can prefetch tiles, at the cost of letting a player look before
  the timer starts.
- Arcade serves snapshots captured 5–15 minutes ago, falling back to the newest
  snapshot ≥ 5 minutes old the player hasn't seen. Quakes and fires are frozen
  when they pass the 6 h disaster delay, so in Arcade they are "fresh
  snapshots of 6 h+ old events". Snapshots in today's or future dailies are
  never served in Arcade.
