# ADR-001: Remove the upstream console; build the game on vendored modules

**Status:** accepted · 2026-11-09

## Context
The spec says to fork God's Eye View, reuse its globe, camera and four layers,
and delete or flag off everything else. v0.3.0 is ~2,200 tracked files and
~170 `src/` modules wired into one console (HUD, panels, CCTV, voice, MCP,
Pinokio launchers). Almost every module imports the console's shared state.
Feature-flagging the never-list layers would leave their code, data and
non-commercial assets (TeleGeography, Bhote Koshi) in the shipped bundle.

## Decision
Keep the fork's git history and LICENSE, delete the console, and build a new
lean Vite + Cesium client in `/client`. Copy the few upstream modules the game
needs into `client/src/vendor/gev/` unchanged (spec: "leave untouched upstream
JS as is"). Rendering the labelless views, the reveal fly-to and the
"spy-satellite" look are re-implemented in TypeScript on top of Cesium.

## Consequences
- Never-list layers cannot be re-enabled by flipping a flag: they are gone.
- No non-commercial asset ships.
- The upstream cockpit (HUD, cockpit tracking) is not reused; the flight view is
  a simpler chase camera. Upstream updates have to be cherry-picked per file.
