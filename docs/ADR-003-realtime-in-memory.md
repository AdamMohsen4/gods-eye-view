# ADR-003 · Realtime matches run in memory in one process

Date: 2026-11-10 · Status: accepted

Duels and parties use one WebSocket (`/ws`, `@fastify/websocket`) and an in-process `Hub`. The match
engine (`server/src/multiplayer/match.ts`) is a pure state machine with injected clock, scheduler,
location picker and persistence, so tests drive it with a fake clock. Results, Elo changes and XP
are written to `matches` / `match_players` / `users` when a match ends.

Limits: one server instance. Scaling out needs sticky sessions per party/match or a shared bus (Redis
pub/sub). Disconnects: a duel player forfeits after 45 s away; a party keeps a member for 60 s.
