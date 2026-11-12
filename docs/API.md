# API

All `/api` calls identify the player with `x-guest-id: <uuid v4>` (the client makes one and keeps it in localStorage).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | `{ok, now}`; `now` (server ms) lets clients correct clock skew for round timers |
| GET | `/api/config` | `{provider, mapillaryToken?, googleKey?, mapStyle}`: the public viewer key for the active provider only |
| GET/PUT/DELETE | `/api/me` | Profile; PUT `{displayName?, country?}`; DELETE removes all data |
| GET | `/api/me/stats` | Profile stats, including `badges` (progress toward each milestone, computed on read) |
| GET/POST | `/api/friends` | GET → `{code, friends: [{id, name, country, level, online, status: friend\|incoming\|outgoing}]}`; POST `{code}` asks (or accepts if they asked you) |
| POST/DELETE | `/api/friends/:id/accept` · `/api/friends/:id` | Accept a request; DELETE unfriends, declines or cancels |
| GET | `/api/maps?kind=official\|community` | Published maps with ≥ 5 locations; each carries `countries` (ISO codes) and `bounds` of its places |
| GET | `/api/maps/:slug` · `/api/maps/:slug/leaderboard?mode=classic\|streak` | |
| POST | `/api/games` | `{mapSlug, mode: 'classic'\|'streak', settings: {move, timeLimit}}` → `GameState` with round 0 open |
| GET | `/api/games/:id` | `GameState`; `current` holds only `{pano:{provider,panoId,heading}, startedAt, deadline}` |
| POST | `/api/games/:id/guess` | `{guess: {lat,lon} \| null}` → reveal (truth, distance, score, country, credit) |
| POST | `/api/games/:id/next` | Opens the next round (never past the last one; returns the state if the game is over) |
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
`party.team {team, playerId?}` (teams format; others need the host), `party.invite {userId}` (online friends only),
`match.watch {matchId}`, `match.guess {matchId, guess}`, `match.leave {matchId}`, `ping`.

Server → client: `welcome {userId, now, matchIds}`, `queue.status`, `party.state`, `party.closed {reason}`,
`party.invite {code, from}` (to the friend), `party.invited {userId}` (to the inviter), `match.state` (full
`MatchState`; the round's location appears only in `reveal`), `error {code}`, `pong {now}`. Types: `shared/src/multiplayer.ts`.

Right after `welcome` the server sends the full picture, so a reconnecting client never keeps stale
views: `queue.status`, then `party.state` or `party.closed {reason: 'none'}`, then `match.state` for
every live match the player is in. `party.closed` reasons: `none` (not in a party), `left`, `kicked`.
`now` in `welcome`/`pong` is the server clock in ms; clients estimate skew from the shortest round trip.

Rules worth knowing: a socket may `hello` again as another guest (it moves). Matchmaking pairs
synchronously, so one waiting player can never land in two duels. `party.start` fails with
`map_too_small` when the map has fewer places than rounds, and `player_in_match` when someone in the
room is still in another match; starting a party match takes its players out of the duel queue.
A party round with no time limit shows no clock but ends after 10 minutes. A duel in which both
players stay disconnected past the 45 s forfeit ends with no winner and no rating change. If a match
runs out of places it finishes early with what was played.

Match formats (`MatchState.format`; parties pick one, ranked/casual queues are always `duel`):

| Format | Players | Rules |
| --- | --- | --- |
| `classic` | 1–8 | Everyone plays every round; highest total after N rounds wins. |
| `duel` | 2 | 5,000 HP each; a first guess starts a 15 s clock; the worse guess loses the difference (×1.5, ×2… from round 4). |
| `teams` | 2–8, two sides | Each side shares 5,000 HP (`MatchState.teams`); a side's round score is its best guess; damage as in a duel (`reveal.teamDamage`). A side with nobody left concedes. `result.winnerTeam` names the winner. |
| `elimination` | 2–8 | 3 lives each (`PlayerPublic.lives`); the worst guess of a round costs a life (`lostLife`), unless everyone tied; leaving gives up your lives; last one standing wins (capped at 20 rounds, then most lives, then total). |

`party.start` errors: `duel_needs_two`, `teams_need_two_sides`, `not_enough_players`, `map_too_small`
(duel and teams need 5 places, elimination 10, classic one per round), `player_in_match`, `already_running`.
