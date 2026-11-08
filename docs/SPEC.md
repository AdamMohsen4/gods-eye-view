# Earthnow — Live-World Guessing Game Spec & Agent Brief

Nov 9, 2026 · @adam

## Summary

Earthnow is a browser and mobile-web guessing game where every round is something happening on Earth right now: a plane in flight, a ship at sea, a satellite overhead, an earthquake or a wildfire. Players see a 3D view with the map labels stripped, then drop a pin; scores depend on distance.

**Hook:** "GeoGuessr, but live." No static-photo game can say "this happened 4 minutes ago," which makes each daily puzzle newsworthy and shareable.

**Build strategy:** fork God's Eye View (MIT-licensed code) for its Cesium globe, cockpit camera, and flight, vessel, satellite, quake and fire layers. Strip everything else, and add a game server, accounts and a daily puzzle generator.

**Working name:** Earthnow (placeholder; check trademarks). Avoid names or visuals that resemble GeoGuessr.

**MVP goal:** 10,000 daily players within 90 days of launch, with 25% day-7 retention and share-card click-through as the growth engine.

## Core loop and game modes

A round takes 30–90 seconds: look, reason, pin, reveal. The reveal is the payoff: the camera flies from the player's pin to the true spot and shows what the thing is.

1. **Look.** The player gets a labelless 3D view: a cockpit view over terrain, a ship's deck-level view of coastline, a sky view with a satellite crossing, or a fire's smoke plume on terrain. Clue chips (altitude, speed, heading, local time of day) unlock one at a time and cost points.
2. **Pin.** Drop a guess on a flat world map. A 60 s timer runs in Daily and Duel modes.
3. **Reveal.** Camera flies pin → truth; show distance, score, and a fact card ("KL 1203, Amsterdam → Oslo, captured 4 min ago").

| Mode | Who | Format | MVP? |
| --- | --- | --- | --- |
| Daily Earth | Everyone, free | 5 rounds, same for all players worldwide, resets 00:00 UTC | Yes |
| Live Arcade | Signed-in, free with limits | Endless rounds drawn from the last 10 minutes of data | Yes (5 rounds/day free, unlimited on Plus) |
| Party | Friends | Private room link, 2–8 players, same rounds, live leaderboard | Phase 2 |
| Duel | Ranked 1v1 | Health-bar format, Elo rating | Phase 2 |
| Themed weeks | Everyone | e.g. only ships, only night flights, only Nordic sky | Phase 2 |

## Round types and data sources

Launch with four round types whose data is reliable and licensable; do not ship any layer until its commercial terms are confirmed in writing. God's Eye View's MIT license covers its code only, not the data feeds it calls.

| Round type | Candidate source | Answer reliability | Commercial status | MVP? |
| --- | --- | --- | --- | --- |
| Flights | FlyItalyADSB API (Pro €49/mo, worldwide) | High; positions update about every 0.5 s | Allowed on every plan with a CC BY-SA 4.0 attribution line; reselling the data as a feed needs a deal | Yes |
| Flights (avoid) | OpenSky, adsb.fi, airplanes.live, ADS-B Exchange community | High | Non-commercial or written licence required; God's Eye View defaults to OpenSky, so swap it out | No |
| Earthquakes | USGS real-time feeds | High, but magnitudes get revised | Generally public domain; confirm | Yes |
| Wildfires | NASA FIRMS active fire detections | Medium: detections, not exact outlines | Open data with citation; confirm | Yes |
| Satellites | CelesTrak orbital elements, propagated with satellite.js | High for position; it is computed, not live telemetry | Free; confirm terms | Yes |
| Ships | AISStream or similar AIS feed | Medium: sparse far offshore | Terms not yet checked | Phase 2 |
| Public cameras, plate readers, traffic | — | — | Excluded permanently (privacy) | Never |

**Round selection rules (enforced in code):**

- Exclude military, state, police and medical aircraft, and any aircraft flagged on privacy lists (LADD/PIA). FlyItalyADSB returns these unfiltered, so we filter them.
- Exclude flights within 10 minutes of departure or landing (too easy from the airport, and avoids live tracking of small private planes).
- Exclude events with casualties or active evacuations from the free Daily; quakes and fires use a 6 h delay and a minimum size.
- Store a frozen snapshot per round (position, heading, altitude, camera pose), so every player gets the same answer even after the data moves on.

## Scoring, daily challenge and share card

Each round scores 0–5,000 points by distance, so a perfect Daily is 25,000; the share card is the growth engine and must work without an account.

```latex
\text{score} = 5000 \cdot e^{-d / s} \cdot (1 - 0.1\,h)
```

d = distance in km, s = scale per round type (flights 1,500 km, ships 800, quakes and fires 1,000, satellites 2,000), h = clue chips used (0–3). Tune s so the median player scores about 2,500 per round.

**Daily Earth**

- Generated at 23:00 UTC from frozen snapshots; one of each type plus a wildcard.
- Same rounds for all; leaderboards global, by country, and among friends.
- Streak counter; one free streak-freeze per week.

**Share card** (text plus an auto-generated image)

- Text: `Earthnow #142 · 21,480 🌍` then one emoji row per round (✈️🛰️🔥🌋🚢 with 🟩🟨🟥 by score band), then the link. No spoilers.
- Image: 1080×1350 card with a dimmed globe and the player's five pins, no true locations.
- Every share link opens the Daily directly with no sign-up wall.

## MVP scope and non-goals

An 8-week MVP ships Daily Earth and limited Live Arcade on mobile web and desktop; native apps and multiplayer wait for retention data.

**In the MVP**

1. Daily Earth: 5 rounds across flights, quakes, fires and satellites, share card, streaks, leaderboards.
2. Live Arcade: 5 free rounds/day, unlimited for Plus.
3. Accounts optional (play as guest; sign in with Google, Apple or email to save streaks).
4. Plus subscription via Stripe.
5. Admin panel: preview tomorrow's Daily, swap a round, ban a user.
6. Mobile-first performance: playable on a mid-range Android phone over 4G.

**Not in the MVP:** ships, Party and Duel modes, native apps, voice agent, user-made maps, ads, public cameras or any people-tracking layer.

## Architecture

Keep the fork's globe as the client and move all data access behind our own server: a worker freezes live data into snapshots, and the game server hands out rounds without their answers.

[embedded content: Earthnow architecture · 9 components — not included in the pasted copy. As built:]

```
 FlyItalyADSB ─┐
 USGS ─────────┤                ┌──────────────┐      ┌───────────────┐      ┌──────────────┐
 NASA FIRMS ───┼──► worker ────►│  Postgres    │◄────►│  game server  │◄────►│ client (Vite │
 CelesTrak ────┘  (filters,     │  snapshots,  │      │  Fastify API, │      │ + Cesium)    │
                   freeze,      │  dailies,    │      │  share cards, │      └──────┬───────┘
                   daily gen)   │  rounds …    │      │  admin        │             │ imagery/terrain
                                └──────────────┘      └───────────────┘             ▼ tiles only
```

The snapshotter is the only component that talks to data providers; players never touch a live feed, which protects API keys, keeps every player's round identical, and stops the app being used as a tracker.

## Data model and API

The answer never reaches the client before the guess: the server sends only a camera pose and clue values, and returns the true location after the guess is locked.

| Table | Key columns | Notes |
| --- | --- | --- |
| users | id, auth\_id, display\_name, country, plan | Guests get a local id, merged on sign-in |
| snapshots | id, type, source, captured\_at, true\_lat, true\_lon, payload JSON, camera\_pose JSON | Frozen at capture; payload holds callsign, altitude etc. for the reveal |
| dailies | id, date, number, snapshot\_ids\[5\] | Locked once published |
| rounds | id, user\_id, snapshot\_id, mode, started\_at, guess\_lat, guess\_lon, clues\_used, distance\_km, score | Unique (user\_id, snapshot\_id) |
| streaks | user\_id, current, best, freeze\_available |  |
| subscriptions | user\_id, stripe\_sub\_id, status, renews\_at | Stripe webhooks are the source of truth |

**API** (full contract as built: `docs/API.md`)

- `GET /api/daily/today` → round ids and camera poses, no answers
- `POST /api/rounds/{id}/clue` → next clue value; records clue use
- `POST /api/rounds/{id}/guess` → validates timer server-side, returns truth, distance, score
- `GET /api/arcade/next` → a fresh snapshot from the last 10 minutes, rate-limited by plan
- `GET /api/leaderboard?scope=global|country|friends&date=`
- `GET /share/{daily}/{user}` → share page with Open Graph image

## Monetization

Free Daily drives reach; a cheap Plus tier, priced under GeoGuessr Pro ($3.99/mo yearly, $6.99 monthly), converts the regulars.

| Tier | Price | Includes |
| --- | --- | --- |
| Free | €0 | Daily Earth, 5 Arcade rounds/day, leaderboards, share cards |
| Plus | €2.99/mo yearly, €4.99 monthly | Unlimited Arcade, Party rooms (phase 2), archive of past Dailies, stats, no ads |
| Schools (phase 2) | per-classroom licence | Teacher dashboard, curated geography and science rounds |

**Running costs to model before launch:** flight data (FlyItalyADSB Pro at €49/mo + VAT), 3D globe imagery and terrain (Cesium ion or Google photorealistic tiles are metered; God's Eye View's keyless mode uses Esri imagery, whose commercial terms must be checked), hosting and Postgres. Set the break-even subscriber target once these quotes are in.

**Later:** non-intrusive sponsored themed weeks (an airline's routes, a space agency's satellites). No interstitial ads in the Daily.

## Privacy, safety and legal

The game must feel like a geography puzzle, never a tracking tool; this decides which data we keep and how fresh it is.

- **No people tracking.** No public cameras, plate readers, phone or social data. Only aircraft, vessels, satellites and natural events.
- **Aircraft filters** (see Round types): no military, state, police, medical or privacy-listed aircraft; no general-aviation planes under a size threshold; no searching for a specific tail number or callsign anywhere in the product.
- **No live lookup.** Players cannot follow a round's object after the reveal; the reveal shows a snapshot, and Arcade rounds are at least 5 minutes old.
- **Disasters with care.** Quake and fire rounds have a delay and a minimum size, and fact cards are neutral. Remove a round at once if an event turns deadly.
- **Attribution.** Show every data source in the reveal and on an About page (FlyItalyADSB requires a CC BY-SA 4.0 line; USGS, NASA and CelesTrak credits). Keep the God's Eye View MIT notice in the repo and the app's About page.
- **Branding.** Original name, logo and look; nothing resembling GeoGuessr.
- **GDPR (you are in Sweden):** EU hosting, guest play without personal data, minimal analytics with consent, account deletion. Users under 13 cannot create accounts; under-16 consent rules vary by EU country.
- **Security:** God's Eye View is built for localhost; every provider key moves server-side behind authenticated, rate-limited endpoints.

Not legal advice; have the data licences and terms reviewed before launch.

## Milestones

Eight weeks to a public beta; data licences are signed off at the end of M0, before any game code depends on them.

Legend: `[x]` done in code · `[~]` partly done (see note) · `[ ]` open. Items that need the owner (money, accounts, legal) are marked **(owner)**.

**M0 — Fork and audit (week 1)**

- [~] Fork, pin release tag, CI, preview deploys — pinned to v0.3.0 (`docs/UPSTREAM.md`), CI in `.github/workflows/ci.yml`; preview deploys need a hosting choice **(owner)**
- [x] DATA\_AUDIT.md complete; restricted layers removed or flagged off
- [~] FlyItalyADSB adapter replaces OpenSky; written confirmation of USGS, FIRMS and CelesTrak terms — adapter done and tested on fixtures; written confirmations **(owner)**

**M1 — Snapshotter and round engine (weeks 2–3)**

- [x] Worker polls providers and freezes snapshots with camera poses
- [x] Selection filters with fixture tests
- [x] Round API: start, clue, guess, scoring; truth never sent early (test)

**M2 — Play experience (weeks 4–5)**

- [ ] Labelless view per round type; clue chips; guess map; reveal fly-to
- [~] Daily Earth generator, admin preview and swap — generator + admin API done; admin UI in client
- [~] Guest play, then Clerk sign-in with streak merge — guest play done; Clerk deferred **(owner: Clerk account)**

**M3 — Social and growth (week 6)**

- [ ] Share text and OG image; share page opens the Daily directly
- [x] Streaks, freezes, leaderboards (global, country, friends) — friends waits for accounts

**M4 — Plus and hardening (week 7)**

- [ ] Stripe Plus; Arcade limits by plan — limits by plan done; Stripe deferred **(owner: Stripe account)**
- [~] Rate limits, server-side keys, GDPR deletion, consent banner — rate limits, server-side keys, deletion done; no analytics yet, so no consent banner needed
- [ ] Mobile performance pass against the budget

**M5 — Beta (week 8)**

- [ ] 200 testers from geography and aviation communities **(owner)**
- [ ] Track: day-1 and day-7 retention, share rate, median score per round type
- [ ] Legal review of terms, privacy policy and data licences **(owner)**

## Instructions for the Claude agent

Fork God's Eye View on GitHub, save the block below as `CLAUDE.md` in the fork's root, and paste this doc into `docs/SPEC.md`. Start each session with: "Read CLAUDE.md and docs/SPEC.md, then do the next unchecked milestone task."

The CLAUDE.md block is saved verbatim in `/CLAUDE.md` (with a short "Repo notes" section appended).

## Sources

- [God's Eye View: The Open-Source OSINT Globe](https://aiidelist.com/blog/gods-eye-view-open-source-osint-globe.md) (AI IDE List, Oct 7, 2026): features, MIT licence, data-licence caveats, architecture
- [ADS-B API comparison](https://flyitalyadsb.com/en/data/comparison/) (FlyItalyADSB, updated Oct 28, 2026): flight-data commercial terms; published by a provider, so verify competitors' terms directly
- [OpenSky KNIME node documentation](https://nodepit.com/node/org.knime.python3.nodes.extension.ExtensionNodeSetFactory%24DynamicExtensionNodeFactory%23sdl.harvard.geospatial_!_OpenSkyNetworkDataNode): OpenSky for-profit use needs written permission (search snippet)
- [Games Like GeoGuessr: 7 Free Browser Picks Compared](https://www.gamebrief.net/blog/games-like-geoguessr-free-2026) (GameBrief, Oct 29, 2026): GeoGuessr Pro pricing (search snippet)
