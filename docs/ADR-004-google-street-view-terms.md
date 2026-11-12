# ADR-004: Google Street View is evaluation-only until the map question is settled

Date: 2026-11-11 · Status: open, needs an owner decision

## Context

The imagery adapter (ADR-001) supports Mapillary and Google Street View. A review of the Google
Maps Platform Terms of Service (https://cloud.google.com/maps-platform/terms) found two conflicts
with how Earthnow works today:

1. §3.2.3(e): the customer will not "display Street View imagery and non-Google Maps on the same
   screen". Every round shows the panorama next to the MapLibre/OpenFreeMap guess map, and the
   reveal shows the Google location on that map.
2. §3.2.3(b) and the Service Specific Terms: caching is not allowed except where stated. Street
   View pano IDs may be stored, but we also store the lat/lng returned by the metadata API in
   `locations`. Google also warns that pano IDs change over time, so stored IDs go stale.

Hiding road labels and the address is fine (documented options); Google's logo, copyright and
terms links stay visible, as the adapter already leaves them. No clause bans guessing games as such.
Each panorama load is billed (Dynamic Street View SKU); metadata calls are free.

## Decision

- Ship with **Mapillary** (CC BY-SA 4.0, free, no such restriction). `IMAGERY_PROVIDER=google`
  stays in the code for evaluation and is marked evaluation-only in the README.
- Nothing about Google is changed in code beyond correctness fixes, because both ways out cost
  money or change licensing, which the owner decides (CLAUDE.md).

## Options for the owner

A. **Mapillary only.** Simplest; coverage is patchier than Google's.
B. **Google all the way** when `provider=google`: Google Maps JS for the guess, result and maker
   maps (billed per map load), store only `pano_id`, and look the location up at reveal time
   (metadata call, free) instead of storing lat/lng. Roughly two days of work plus a cost model.
C. Ask Google for written permission for the current design.

## Consequences

Until A, B or C is chosen, a production deploy must run `IMAGERY_PROVIDER=mapillary`.
