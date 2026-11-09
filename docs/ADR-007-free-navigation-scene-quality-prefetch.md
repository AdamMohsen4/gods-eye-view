# ADR-007: Free navigation on a leash, context-rich scenes, tile prefetch

**Status:** accepted · 2026-11-09 (after first owner playtest)

## Context
Owner feedback on the first build: imagery rendered slowly, you couldn't drag
to look around, the satellite view was far too high, and scenes had no real
context. Causes found:
- The round overlay (`#app`) sat above the Cesium canvas and swallowed every
  pointer event, so no drag ever reached the view.
- The view was deliberately locked in place (turn and narrow only).
- Satellite rounds put the camera in orbit (~420 km), flights used a
  horizon-level chase view, and snapshots were chosen at random, often at night
  or over open ocean / polar ice.
- Tile settings requested high detail all the way to the horizon.

## Decision
1. **Free, leashed navigation**: Cesium's standard pan/zoom/tilt during a round,
   clamped to `ROUND_LIMITS` (leash 150–250 km around the scene, max height
   80–160 km). Overlay passes pointer events through; e2e test guards it.
2. **Closer opening views** (`shared/src/camera.ts`): flights 350 m behind the
   aircraft looking 22° down at the ground; satellite rounds show the ground
   under the spacecraft (nadir point + ground track) from 90 km; quakes from
   26 km up, fires from 6.5 km. Every pose is still ≥ 6 km from the truth
   (500-seed test).
3. **Prefer scenes with context** (gameplay, not a safety filter): the worker
   and the daily picker rank candidates by `sceneQuality` — daylight (sun > 8°)
   and over land with features (|lat| < 62°). Night/ocean scenes are used only
   when nothing better exists.
4. **Faster tiles**: `maximumScreenSpaceError` 4 (5 on 3× screens), denser fog
   culling, more parallel requests to the two HTTP/2 tile hosts, ArcGIS
   provider so Esri's "Map data not yet available" placeholder tiles are
   discarded, and the next round's imagery is prefetched into the HTTP cache
   while the current round is played.

## Measured (throttled phone: 9 Mbps, 150 ms RTT, 4× CPU, 390×844 @3×, Esri)
Round shown → all imagery tiles loaded, per round of the seeded daily:

| | quake | fire | fire | satellite | flight |
| --- | --- | --- | --- | --- | --- |
| before | 7.6 s | 4.6 s | 3.2 s | 1.8 s | 5.5 s |
| after tile settings | 4.8 s | 2.9 s | 2.6 s | 1.2 s | 3.3 s |
| + prefetch (rounds 2–5) | 4.2 s | 2.4 s | 2.0 s | 1.4 s | 2.3 s |

Measured on a Mac with GPU, not a real phone; confirm on a mid-range Android.

## Trade-off
Free movement plus a 150–250 km leash makes rounds easier than a locked
view. Tune `ROUND_LIMITS` and the score scales once median scores per round
type are known (target ≈ 2,500).
