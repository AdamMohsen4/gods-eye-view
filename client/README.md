# Earthnow client

Vite + TypeScript + CesiumJS. No UI framework; the shell is about 11 kB gzipped and Cesium loads lazily.

## Commands

```sh
pnpm --filter ./client dev          # :5173, proxies /api and /share to 127.0.0.1:8787
pnpm --filter ./client build        # dist/ (index.html + admin.html)
pnpm --filter ./client typecheck
pnpm --filter ./client test:e2e     # Playwright, desktop 1280×800 + mobile 390×844
```

`VITE_IMAGERY=esri` (default: Esri World Imagery, keyless, no labels) ·
`offline` (Cesium's bundled NaturalEarthII, flat terrain; used by e2e) ·
`ion` (+ `VITE_CESIUM_ION_TOKEN`).

## Layout

| Path | What |
| --- | --- |
| `src/main.ts` | Router and screens: home, Daily flow, arcade, results/share, leaderboard, about, profile |
| `src/views/round.ts` | One round: HUD, clue chips, timer, guess sheet, reveal card |
| `src/globe/scene.ts` | Cesium view (lazy chunk): imagery, leashed free navigation, subjects, lighting, reveal fly-to |
| `src/globe/prefetch.ts` | Warms the next round's imagery tiles in the background |
| `src/globe/view.ts` | Pure camera maths (unit-tested) |
| `src/map/guessMap.ts` | Flat pin map: d3-geo + d3-zoom + world-atlas (Natural Earth); 110m first, 50m when zoomed in |
| `src/lib/format.ts` | Pure helpers (unit-tested) |
| `src/admin.ts`, `admin.html` | Admin: preview a date, swap rounds, generate, ban |
| `src/vendor/gev/` | God's Eye View files vendored unchanged (MIT, commit 72eb3fd) |
| `public/models/b789.glb` | Boeing 787-9 model, CC BY 4.0 (credit in `public/models/README.md` and on the About page) |

## Moving around in a round

Players drag to move, scroll or pinch to zoom, and right-drag or use two fingers to tilt (Cesium's standard controls). They stay on a leash around the scene (`ROUND_LIMITS` in `src/globe/view.ts`, 150–250 km, max 80–160 km up), so they can build context from coastlines and terrain but can't zoom out to the whole globe. See `docs/ADR-007`.

## Performance

Measure it with `scripts/measure-tti.mjs` (first round interactive) and `scripts/measure-tiles.mjs` (time until each round's imagery is fully loaded). Serve `dist/` with brotli through `scripts/serve-dist.mjs`, so the numbers reflect a CDN rather than `vite preview`, which serves files uncompressed.
