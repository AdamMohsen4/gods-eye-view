# API

All `/api` calls identify the player with `x-guest-id: <uuid v4>` (the client makes one and keeps it in localStorage).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/config` | `{provider, mapillaryToken?, googleKey?, mapStyle}`: the public viewer key for the active provider only |
| GET/PUT/DELETE | `/api/me` | Profile; PUT `{displayName?, country?}`; DELETE removes all data |
| GET | `/api/me/stats` | Profile stats |
| GET | `/api/maps?kind=official\|community` | Published maps with ≥ 5 locations |
| GET | `/api/maps/:slug` · `/api/maps/:slug/leaderboard?mode=classic\|streak` | |
| POST | `/api/games` | `{mapSlug, mode: 'classic'\|'streak', settings: {move, timeLimit}}` → `GameState` with round 0 open |
| GET | `/api/games/:id` | `GameState`; `current` holds only `{pano:{provider,panoId,heading}, startedAt, deadline}` |
| POST | `/api/games/:id/guess` | `{guess: {lat,lon} \| null}` → reveal (truth, distance, score, country, credit) |
| POST | `/api/games/:id/next` | Opens the next round |
| GET | `/api/daily` | Today's challenge info (created on first request) |
| POST | `/api/challenges` | `{mapSlug, settings}` → `{token}` |
| GET | `/api/challenges/:token` · POST `/play` · GET `/leaderboard` (403 until you finish) | |
| GET | `/api/leaderboard/rating` | Ranked duel ratings |
| GET | `/api/geo/country?lat&lon` | Country under a point (streak mode shows it before you lock in) |
| — | `/api/maker/maps[/:id[/locations[/:loc]]]` | Map maker CRUD; adding a location snaps it to the nearest panorama (422 `no_coverage`) |
| GET | `/share/:gameId` · `/share/:gameId.png` | Open Graph page and 1200×630 card; no locations |
| POST | `/api/admin/locations/:id/disable` · `/api/admin/users/:id/ban` | `Authorization: Bearer $ADMIN_TOKEN` |

## WebSocket `/ws`

Client → server: `hello {guestId}` first, then `queue.join {ranked}`, `queue.leave`, `party.create`,
`party.join {code}`, `party.leave`, `party.settings {settings}`, `party.start`, `party.kick {playerId}`,
`match.watch {matchId}`, `match.guess {matchId, guess}`, `match.leave {matchId}`, `ping`.

Server → client: `welcome`, `queue.status`, `party.state`, `party.closed`, `match.state` (full
`MatchState`; the round's location appears only in `reveal`), `error {code}`, `pong`. Types: `shared/src/multiplayer.ts`.
