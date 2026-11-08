# Data audit (M0)

Audit of God's Eye View v0.3.0 (`72eb3fd`) layers and assets against Earthnow's
commercial use. Sources: upstream `LICENSE`, `DATA_SOURCES.md`,
`public/models/README.md`, provider pages checked 2026-11-09.

**Commercial OK:** yes = terms allow it as we use it; no = forbidden or needs a
licence we don't have; unknown = not confirmed in writing yet.
**Nothing marked "unknown" ships to the public until it is confirmed in writing** (spec: data licences signed off at end of M0).

Not legal advice. Have these reviewed before launch.

## Layers used by Earthnow

| Layer / asset | Source | Licence / terms | Commercial OK | Action |
| --- | --- | --- | --- | --- |
| Flights | FlyItalyADSB API (ADSBx v2-compatible) | Commercial use allowed on all plans, one CC BY-SA 4.0 attribution line; reselling the data as a feed needs a deal | yes (per provider comparison page, 2026-10-28) | **Kept, new adapter** `worker/src/providers/flyitalyadsb.ts`. Get written confirmation with the Pro order. Attribution in every flight reveal + About |
| Earthquakes | USGS real-time GeoJSON feeds | U.S. public domain | yes (confirm in writing) | Kept, `worker/src/providers/usgs.ts`; credit shown |
| Wildfires | NASA FIRMS active fire (keyless 24 h CSV, NOAA-20 VIIRS) | Open data, citation requested (upstream lists CC0 / U.S. PD) | yes (confirm in writing) | Kept, `worker/src/providers/firms.ts`; NASA FIRMS citation in reveal + About |
| Satellites | CelesTrak GP elements + satellite.js SGP4 | U.S.-government-origin data, no licence, citation requested; satellite.js MIT | yes (confirm terms in writing) | Kept, `worker/src/providers/celestrak.ts`; credit shown |
| Basemap imagery | Esri World Imagery (ArcGIS Online tiles), upstream's keyless default | Esri Master Agreement / ArcGIS Online terms; commercial use of the public tile service by a third-party app is **not confirmed** | unknown | **Flagged.** Used only as `VITE_IMAGERY=esri` (dev default). Before launch: confirm with Esri, or switch to Cesium ion / Google Photorealistic 3D Tiles (metered, paid), or another licensed imagery provider. `VITE_IMAGERY=offline` uses Cesium's bundled Natural Earth II for tests |
| Terrain | Re:Earth / Mapterhorn quantized mesh (keyless) | Terrain mesh CC BY 4.0 | yes, with attribution — but it is a free community endpoint with no SLA | Kept (vendored `terrain.js`); credit shown. Plan a paid/self-hosted terrain before scale |
| Guess map + share card land shapes | Natural Earth via `world-atlas` npm (ISC packaging) | Public domain | yes | New; credit on About |
| Aircraft 3D model `b789.glb` | "Boeing 787-9" by Nobilis 2 (Sketchfab), optimised by God's Eye View | CC BY 4.0 | yes, with credit + modification note | Kept; credit in `client/public/models/README.md` and About |
| Code | God's Eye View | MIT | yes | LICENSE kept; notice on About page |

## Upstream layers removed (not in this repo any more)

| Layer / asset | Licence / terms (upstream) | Commercial OK | Action |
| --- | --- | --- | --- |
| OpenSky Network flights (upstream default) | Non-commercial; for-profit use needs written permission | no | **Removed**, replaced by FlyItalyADSB |
| adsb.lol / adsb.fi / airplanes.live / ADS-B Exchange community | ODbL or non-commercial / written licence required | no / unknown | Removed |
| Military aircraft feeds (adsb.lol `/mil`), military installations, OSM military names | ODbL; and conflicts with our safety rules | no (policy) | Removed — **never list** |
| CCTV (all ~40 municipal/DOT sources) | Mixed; several personal-use only (e.g. FL511) | no (policy) | Removed — **never list** (privacy) |
| ALPR camera mapping (OSM) | ODbL; people-tracking | no (policy) | Removed — **never list** |
| Traffic (TomTom, BYOK) | TomTom developer terms | no (policy) | Removed — **never list** |
| Radio Browser, browser SDR | PDDL / Apache-2.0 | n/a | Removed (out of scope) |
| Voice agent (OpenAI/Gemini realtime), MCP panel | Provider ToS | n/a | Removed (spec: not in MVP) |
| Vessels (AISStream) | Free beta, no formal ToS | unknown | Removed; phase 2 needs terms checked first |
| Google Photorealistic 3D Tiles, Places, Geocoding, Street View | Google Maps Platform ToS, own key, metered | unknown (paid) | Removed for now; candidate paid imagery |
| Mapillary / KartaView / Panoramax street level | CC BY-SA and platform terms | n/a | Removed (out of scope) |
| NOAA/ECMWF weather, nowCOAST, NHC, lightning | PD / CC BY 4.0 | yes | Removed (out of scope) |
| NIFC fire perimeters, InciWeb links | U.S. PD | yes | Removed (US-only; FIRMS covers the world) |
| Transit (MBTA, Entur, HSL, …), bikeshare (GBFS) | Per-feed | n/a | Removed (out of scope) |
| TeleGeography submarine cables (bundled) | **CC BY-NC-SA 3.0** | **no** | Removed |
| Bhote Koshi event pack (Vantor/GeoPera, bundled) | **CC BY-NC 4.0** | **no** | Removed |
| Datacenters, dams (OSM/OpenInfraMap extracts) | ODbL | yes (share-alike) | Removed (out of scope) |
| Natural Earth regions, US counties, DataSF neighbourhoods | PD / PDDL | yes | Removed (out of scope; we use world-atlas instead) |
| Yale Bright Star Catalogue, ESO Milky Way cube map | PD / CC BY 4.0 | yes | Removed (Cesium's default sky is enough) |
| Other 3D models (747, private jet, Bell 206, C172, Citation, MQ-9, ATR72) | CC BY 4.0 | yes | Removed (unused; MQ-9 is a military drone) |
| Photon, Nominatim, OSRM, Overpass, Open-Meteo, Google News, GDELT | Fair-use public services | n/a | Removed |

## Open items before launch

1. Written confirmation from FlyItalyADSB (Pro plan) that game use with attribution is covered.
2. Written confirmation (or documented public-domain status) for USGS, FIRMS, CelesTrak.
3. **Imagery decision**: Esri commercial terms, or a paid provider — this also sets a running cost.
4. Terrain: Re:Earth free endpoint is fine for beta; decide on a paid/self-hosted option for scale.
5. LADD list: the FAA LADD list is available to subscribers; `setPrivacyBlocklist()` is ready to load it once we have access. Until then we rely on the provider's `dbFlags` LADD/PIA bits plus the airline-only callsign rule.
