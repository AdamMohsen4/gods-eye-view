# Recorded fixtures

Used whenever `FIXTURE_MODE=1` (default in dev and tests). Real providers are
only called with `LIVE_DATA=1`. Re-record keyless sources with
`pnpm fixtures:record`.

| File | Source | Recorded | Notes |
| --- | --- | --- | --- |
| `usgs/4.5_week.geojson` | USGS M4.5+ past week summary feed | 2026-11-09 | Real data, U.S. public domain |
| `firms/J1_VIIRS_C2_Global_24h.csv` | NASA FIRMS NOAA-20 VIIRS 24 h global CSV | 2026-11-09 | Real data trimmed to FRP ≥ 20 MW; CC0 / U.S. public domain, citation requested |
| `celestrak/stations.json`, `celestrak/visual.json` | CelesTrak GP JSON (`GROUP=stations`, `GROUP=visual`) | 2026-11-09 | Real data |
| `flyitalyadsb/world.json` | **Synthetic**, in the FlyItalyADSB ADS-B Exchange v2 format | 2026-11-09 | No paid key yet. 30 plausible airliner contacts plus 15 records that the selection filters must reject (each tagged `_fixture_expect: "reject"` with a `note`). Replace with a recorded response once the key exists. |
