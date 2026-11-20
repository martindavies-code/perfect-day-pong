# HANDOVER.md — Perfect Day Pong

## Current state
- **Live game**: https://martindavies-code.github.io/perfect-day-pong/
- **Local run**: serve repo with `python -m http.server 8000` -> `http://localhost:8000`.
- **Tests**:
  - `npm test`: runs `logic.test.js`, `winpath.sim.mjs`, `cloud-safety.test.mjs`, and `boss-mechanics.test.mjs`.
  - `npm run test:ui`: runs `tests/ui-progression.test.mjs` (isolated local server + temporary Chrome profile + mocked GIS/Drive inside test harness only, zero production debug hooks).
  - `tests/audio-test.html`: 7/7 `OfflineAudioContext` spatial checks.

## Recent changes (post-Step 8c polish)
- **Initial-connection vs diverged-conflict wording**: `detectCloudConflict()` in `logic.js` now returns `reason: 'no_baseline'` or `'diverged'`, passed by `cloud.js` as `conflictReason`, so `main.js` renders `"Choose Your Active Save"` (`FIRST SYNC`) on first connection without sync history vs `"Cloud Save Conflict"` (`CONFLICT`) when both sides actually diverged.
- **Lou Reed Phase 2 prowl fix & shared formation logic**: moved `computeOpponentFormation()` and `computeOpponentIdleTarget()` into `logic.js` and added `options.idleTargetX/Y` to `stepAI()`, fixing Phase 2 prowl so it is no longer overwritten to `0` on outgoing shots.
- **Boss/formation deterministic suite**: added `tests/boss-mechanics.test.mjs` exercising real multi-box formations (`visual_ministry`, `brodsky_quartet`, `boyzone`, `elton_john`), Bowie gravity shift, Bono finite AI, and Lou Reed Phases 1–3 + prowl + Borrowed Time.
- **Inline SVG favicon**: added in `index.html` and `tests/audio-test.html` to eliminate `/favicon.ico` 404 console noise.

## Verification and limits
- Verified: `npm test` (unit, win-path physics simulation, cloud safety regressions, boss/formation mechanics), `npm run test:ui` (desktop `1280x720` + narrow `480x700` layout, unaffordable shop feedback, mocked `FIRST SYNC` & `CONFLICT` screens, `Continue Run` after reload, `OfflineAudioContext` 7/7, 0 JS/HTTP errors), and live site inspection.
- Not verified live: physical Bluetooth/USB gamepad hardware, subjective headphone mix, and real-time human play across every boss mechanic.
- Preserved limits: cloud read-before-write is not atomic (one active session at a time); `Continue Run` is device-local.
