# ADR-001 · Pivot to a street-level game with a switchable imagery adapter

Date: 2026-11-10 · Status: accepted

The owner dropped the live-world (God's Eye View fork) concept in favour of a street-level
guessing game with every common mode, multiplayer included. All fork code, the live-data worker,
the safety filters and the Cesium client were deleted; git history keeps them (`a9d4f99b`).

**Imagery:** Mapillary and Google Street View behind one interface, chosen by `IMAGERY_PROVIDER`.
- Server: `ImageryProvider.findPano(point, radius)` for generating and snapping locations.
- Client: `PanoMount(el, {pano, move})` for the viewer, with Moving / No move / NMPZ enforced per provider.
- Locations are stored per provider (`locations.provider`). Switching providers serves a different
  set at once; challenges keep their own location ids.

A `fixture` provider (generated panoramas, pre-baked locations) lets dev, CI and e2e run with no keys.

**Consequence:** the old rule "the client never calls a keyed provider" can't hold for street-level imagery,
because the viewer runs in the browser. The browser gets only a public token/key meant for client use
(Mapillary client token; Google key restricted by HTTP referrer). Server keys are separate and never sent.
