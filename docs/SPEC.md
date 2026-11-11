# Earthnow — Street-level Geography Game · Spec

Nov 10, 2026 · replaces the Nov 9 live-world spec (that version is in git history at `a9d4f99b`).

## Summary

You are dropped somewhere on Earth in a 360° street-level panorama. Look
around, read the clues (signs, road lines, plants, plates, architecture),
pin a guess on a world map, and score by distance. Modes cover solo play,
a shared daily, friend challenges, country streaks, 1v1 duels and private
party rooms, plus a map maker for community maps.

Earthnow has its own name, look, wording and assets. It must not copy any
existing game's name, UI, wording or art.

## Modes

| Mode | Format | Status |
| --- | --- | --- |
| Classic | 5 rounds on any map; Moving / No move / NMPZ; time limit off or 10 s–5 min | ✅ |
| Daily | 5 rounds on World, same for everyone, resets 00:00 UTC, settings rotate weekly, one attempt, streak counter | ✅ |
| Challenge | Link with fixed locations and settings; one attempt each; leaderboard unlocks after finishing | ✅ |
| Country streak | Name the country (pin anywhere inside it); one miss ends it; best streak per map | ✅ |
| Duels | Realtime 1v1, 5,000 HP each; the first guess starts a 15 s clock for the other player; the lower score loses the difference; ×1.5, ×2… from round 4; ranked (Elo) and casual queues | ✅ |
| Party | Private room with a 5-letter code, 2–8 players; host picks map, format (everyone scores / duel), movement, time, rounds | ✅ |
| Map maker | Click to add places (snapped to the nearest panorama), publish at ≥ 5 places | ✅ |
| Profile | Level/XP, stats, recent games, per-country averages, name + country, delete my data | ✅ |
| Leaderboards | Today's daily, duel rating, best score / best streak per map | ✅ |
| Accounts (sign-in), Plus subscription | Guest identity only so far | ⏳ deferred |
| Team duels, battle royale, friends list, badges | — | ⏳ not built |

## Scoring

`score = 5000 · e^(−10·d / s)`. Here *d* is the distance in km and *s* is the map's size (the bounding
diagonal of its locations, clamped to 50–18,000 km). A guess within 25 m scores 5,000. A timeout or no
guess scores 0. XP: 1 per 100 points, +5 per perfect round, +10 per streak step, plus duel/party bonuses.
Levels: level *n* starts at 60·(n−1)² XP.

## Imagery

Locations are stored per provider, so `IMAGERY_PROVIDER` switches instantly:

| Provider | Viewer | Location search | Cost | Licence |
| --- | --- | --- | --- | --- |
| `mapillary` | mapillary-js (MIT) | Graph API, 360° images only | Free | Imagery CC BY-SA 4.0, credited on reveal |
| `google` | Maps JS `StreetViewPanorama` | Street View metadata endpoint (no charge) | Dynamic Street View is billed per panorama load | Google Maps Platform terms |
| `fixture` | Generated canvas | Pre-generated `server/fixtures/locations.json` | — | Dev and tests only |

`pnpm locations:generate -- --provider mapillary` fills the official maps. Candidates are drawn
near populated places (GeoNames), snapped to the nearest panorama, and kept only if the panorama is
in the intended country.

## Rules (enforced)

1. The true location never leaves the server before the guess: pre-guess responses carry only
   `{provider, panoId, heading}`. The test is in `server/src/server.test.ts`. The panorama id itself
   can be looked up by a determined cheater (see ADR-002).
2. Multiplayer never sends another player's guess, or the answer, before the round's reveal.
3. Every reveal shows imagery attribution. Map tiles show OpenFreeMap / OpenMapTiles / OSM attribution.
4. Server keys stay server-side. The browser gets only the public, referrer-restricted viewer key or
   token for the active provider.
5. Every public HTTP endpoint is rate-limited. The WebSocket has a per-connection token bucket.

## Architecture

```
client (Vite + React + MapLibre + pano adapter)
   │  HTTP /api/*         │  WebSocket /ws
   ▼                      ▼
server (Fastify) ── Game (solo) · MapMaker · Hub → Match (duel/party state machine)
   │
   ▼
Postgres / PGlite: users, maps, locations, challenges, games, game_rounds, matches, match_players
```

API contract: `docs/API.md`.
