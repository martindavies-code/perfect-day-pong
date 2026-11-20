# HANDOVER.md — Perfect Day Pong

- **Status / Step**: Step 8 complete (independent-review fixes: upgrade feedback, mid-run resume, narrow-screen polish, deterministic win-path test).
- **Live URL**: `https://martindavies-code.github.io/perfect-day-pong/`
- **How to run / test**: `python -m http.server 8000` -> `http://localhost:8000`. Tests: `npm test` (unit suite + deterministic full-run win-path simulation). Audio test: `tests/audio-test.html`.
- **What works**:
  - True 3D `(x,y,z)` physics, swept bat collision, spin, 5 depth cues, mouse (pointer lock + fallback)/gamepad/keyboard, finite AI (`>=110ms`).
  - 9-match run across 3 Acts, 16 opponents (Choir/Quartet/Boyzone/Piano/Bowie/Bono/Lou 3 phases + Borrowed Time), 8 pickups, 6 upgrades, Fee Points.
  - Factory look, 24 tagged BBC interstitial cards, Charter review bars, layered Detroit house + 3D HRTF/Stereo spatial audio.
  - `localStorage` save, Export/Import (256 KB cap, strict validation, backups), 2-click Reset, Google Drive `appDataFolder` + conflict UI.
  - **Mid-run resume**: run state snapshots to `localStorage` at every match boundary (opponent pick, match end, pickup). The title screen offers "Continue Run" after an interrupted run. Resuming a fixture restarts that match at 0-0; licences, pickups, Fee Points and match index are preserved. Reset Progress and Import clear the interrupted run.
  - **Upgrade feedback**: an unaffordable BUY click now shows the reason and your unspent points instead of silently doing nothing.
- **Step 8 fixes (independent review)**:
  1. Insufficient-funds BUY was a silent no-op (button disabled) -> clickable with on-screen reason.
  2. 480px title card: hazard stripe margins, wrapping header, smaller h1 (badge overlap and clipped subtitle fixed).
  3. Mid-run progress was lost on refresh -> run snapshot + Continue Run (above).
  4. Reported stale "N licences remaining" message: investigated; message and licence indicator render from the same `runState.lives` in the same pass, so a durable mismatch is not possible in code. Not reproduced; treated as a transient artifact of automated clicking during review.
- **Verified in Step 8**:
  - `node tests/winpath.sim.mjs`: deterministic full 9-match win with real rally physics (scripted capped-speed player vs each opponent's real AI): route completes, fixed bosses (Bono, Elton, Bowie, Lou) on route, Lou reaches phase 2+, run won, fee points awarded.
  - Unit suite re-run green; narrow-viewport and Continue Run flow checked live after publish.
- **Still only verified by code/tests (not hardware)**:
  - Physical Bluetooth/USB gamepad behaviour and two-controller claim order.
  - Subjective audio mix through headphones (spatial direction and levels are machine-verified via `tests/audio-test.html`; taste is not).
- **Known issues**:
  - Cloud save read-before-write is not atomic across two simultaneous devices (v1 assumes one active session; revision check + backups mitigate).
  - Google OAuth Web Client ID is unset (`config.js`) until the Google Cloud project setup is completed (console path verified available).
- **Next 3 steps**:
  1. Complete Google cloud-save setup (dedicated GCP project, Web OAuth client, paste ID into `config.js`).
  2. Optional: human playthrough for feel/balance tuning.
  3. Optional: physical controller check.
- **Decisions**: Vanilla ES modules + Canvas 2D 3D projection + Web Audio; zero build step; relative paths throughout.
