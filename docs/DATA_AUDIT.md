# Data audit

| Asset | Used for | Licence / terms | Commercial OK | Action |
| --- | --- | --- | --- | --- |
| Mapillary imagery + Graph API | Panoramas, location search | Imagery CC BY-SA 4.0; API under Mapillary terms | Yes, with attribution (confirm API terms in writing before launch) | Credit photographer on every reveal ✅ |
| Google Street View (Maps JS + metadata) | Panoramas, location search | Google Maps Platform ToS; billed per dynamic panorama | Yes, if paid and ToS-compliant (no caching or storing beyond pano ids; check game use) | Owner to create billed keys and review ToS ⏳ |
| OpenFreeMap tiles (OpenMapTiles schema, OSM data) | Guess and result maps | OSM ODbL; OpenMapTiles CC BY 4.0; OpenFreeMap free, no SLA | Yes, with attribution | Attribution shown by MapLibre ✅; self-host or a paid tile host for scale ⏳ |
| Natural Earth via `world-atlas` | Country lookup, offline map | Public domain | Yes | — |
| GeoNames via `all-the-cities` | Location candidates (server script only) | CC BY 4.0 | Yes, with attribution | Credit in THIRD_PARTY_NOTICES ✅ |
| `i18n-iso-countries` | Country names (server) | MIT | Yes | — |
