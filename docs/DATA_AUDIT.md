# Data audit

| Asset | Used for | Licence / terms | Commercial OK | Action |
| --- | --- | --- | --- | --- |
| Mapillary imagery, coverage vector tiles + Graph API | Panoramas, location search (tiles find 360° coverage, Graph API gives position and photographer) | Imagery CC BY-SA 4.0; API under Mapillary terms | Yes, with attribution (confirm API terms in writing before launch) | Credit photographer on every reveal ✅ |
| Google Street View (Maps JS + metadata) | Panoramas, location search | Google Maps Platform ToS; billed per dynamic panorama | Not as built: §3.2.3(e) forbids Street View on the same screen as a non-Google map, and we store lat/lng (ADR-004) | Owner decision: Mapillary only, Google maps throughout, or written permission ⏳ |
| OpenFreeMap tiles (OpenMapTiles schema, OSM data) | Guess and result maps | OSM ODbL; OpenMapTiles CC BY 4.0; OpenFreeMap free, no SLA | Yes, with attribution | Attribution shown by MapLibre ✅; self-host or a paid tile host for scale ⏳ |
| Natural Earth via `world-atlas` | Country lookup, offline map | Public domain | Yes | — |
| GeoNames via `all-the-cities` | Location candidates (server script only) | CC BY 4.0 | Yes, with attribution | Credit in THIRD_PARTY_NOTICES ✅ |
| `i18n-iso-countries` | Country names (server) | MIT | Yes | — |

## Personal data we store

Guest players only (no email or real name): display name, optional country, play history, ratings,
a public friend code, and friendships (who asked whom, accepted or pending). Friend presence (online
or not) is shown only to accepted friends and is never stored. "Delete my data" removes the player
row; their games, match rows and friendships cascade, and their maps stay published without a
creator. A finished match's summary (the other players' history) keeps the deleted player's id and
scores, but no name.
