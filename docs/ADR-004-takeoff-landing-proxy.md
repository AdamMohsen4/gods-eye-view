# ADR-004: Cruise-only proxy for "no flights within 10 minutes of takeoff/landing"

**Status:** accepted · 2026-11-09

The ADS-B feed has no route phase or departure time. We approximate with a
conservative cruise test: barometric altitude ≥ FL200, |vertical rate| ≤ 1,000
fpm and ground speed ≥ 300 kt. Airliners take roughly 10–15 minutes to reach
FL200 and a similar time to descend from it, so this is at least as strict as
the spec. Combined with: large categories only (A3–A5, or an airliner type
when the category is missing), airline-format callsigns only (which excludes
registration callsigns, i.e. private flights), a blocklist of military, state,
police, coast guard and medical operator prefixes, emergency squawks, and the
provider's military/PIA/LADD `dbFlags`.

Any future change that loosens these numbers needs the owner's sign-off (CLAUDE.md rule 2).
