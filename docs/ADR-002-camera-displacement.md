# ADR-002: Displaced camera poses; answers stay server-side

**Status:** accepted · 2026-11-09

## Context
Rule 1: the true location must never reach the client before the guess. But
the client renders real imagery, and a camera pose is a location. A pose that
sits exactly on the aircraft is the answer.

## Decision
- The worker builds every pose around an **anchor** displaced 6–40 km from the
  truth in a seeded random direction (`shared/src/camera.ts`). The subject is
  drawn at the anchor and sent as an ENU offset from the camera, not as an
  absolute coordinate.
- Pre-guess payloads (`PublicRound`) carry only pose, subject offset, type,
  timestamps and clue count. The truth, payload and fact card are returned
  only by `POST /rounds/:id/guess`, after the guess is stored.
- `server/src/server.test.ts` fails if any pre-guess response contains the true
  lat/lon (to 1e-4°), an answer-bearing key, the fact card, the callsign, or a
  pose/subject within `MIN_DISPLACEMENT_KM` of the truth.

## Consequences / residual risk
A determined player can still convert the pose (or watch tile requests) to get
within ~6–40 km of the answer, which scores close to 5,000. Client rendering
cannot prevent that; only server-side rendering (streamed frames or
pre-rendered images) would. That is a cost and latency decision for later,
together with anti-cheat signals (impossible accuracy streaks).
