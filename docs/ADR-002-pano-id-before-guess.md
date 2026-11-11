# ADR-002 · The panorama id reaches the client before the guess

Date: 2026-11-10 · Status: accepted

Showing a panorama requires its id, and both providers let anyone resolve an id to coordinates
(Mapillary Graph API, Google metadata). No game in this genre can prevent a determined player with
devtools from cheating this way.

What we do:
- Pre-guess payloads never contain lat/lon (tested), only `{provider, panoId, heading}`.
- Fixture ids are hashes, not coordinates.
- Viewer UI that reveals the place is switched off during a round: Mapillary attribution (it links to the
  image page), Google address and road labels. The reveal credits the photographer or source.
- Ranked play is duels, where a cheater gains little over a skilled player; a future anti-cheat could flag
  sub-second perfect guesses.
