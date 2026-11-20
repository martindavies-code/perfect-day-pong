# HANDOVER.md - Perfect Day Pong

## Current state and safe workflow
- Live game: https://martindavies-code.github.io/perfect-day-pong/
- Repository: https://github.com/martindavies-code/perfect-day-pong
- Before editing, fetch origin, inspect git status and remote branches, and fast-forward main. Do not work from an older Drive download or overwrite unpushed work. The Drive folder is a source snapshot, not a second development branch.
- Serve the repository root with `python -m http.server 8000`, then open http://localhost:8000.
- Keep cloud play to one active session. Read-before-write is not atomic. Continue Run is device-local and restarts the current match at 0-0; Google sync carries career progress and settings, not an active run.

## 20 November playtest changes
- Mouse input no longer uses exponential position easing. `applyMouseSample()` in `playtest.js` applies the latest target once per rendered frame before the 120 Hz physics steps. Swipe velocity uses display-frame time and remains available to every physics substep, rather than disappearing before an impact. Physics swipe speed is bounded at 24 room units/second to prevent cursor warps from generating unbounded spin, without limiting direct position tracking. Keyboard/gamepad movement still uses the existing speed upgrades. A held gamepad stick no longer repeatedly steals mouse control; fresh stick movement or a new button press can switch back.
- `input.js` caches canvas bounds, refreshing them on ResizeObserver, resize and scroll, rather than forcing a layout read on every mouse event.
- HUD setters skip unchanged text, HTML and style writes. This removes continuous node replacement, including opponent/server labels and licence icons.
- Scores are larger and higher contrast, with explicit match-point status. On-screen and optional spoken calls read YOU first and opponent second. Deuce, advantage, match point and Quick Deuce's deciding point come from the real scoring rules.
- `announcer.js` uses an installed English browser speech voice with lower pitch. Only `localService` voices are eligible. No remote speech service, sample download, account or payment is used. Voice availability and sound vary by device. If no working local English voice is exposed, score calls remain on screen. Settings can disable voice. Mute, pause/settings, hiding the page and serving cancel speech. Input never waits for speech, so a fast serve can cut a call short.
- Before selecting an opponent, the route shows all nine stages. The current offer is exact. Future choice slots show remaining possible artists, not invented fixed opponents: future pairs depend on the seed, previous opponent picks and pickup RNG consumption. Bono, Elton John, David Bowie and Lou Reed are fixed at matches 6-9. Rendering the route does not consume RNG or change the run.
- The title and opponent screen have aiming/spin help grounded in `stepBallPhysics()`: off-centre contact aims in that direction; paddle motion adds launch speed and spin; spin curves and decays; a still edge hit also has a smaller counter-curve. Gravity remains active. Curve Master multiplies spin by 35% per stack.
- Bigger graphics changes are intentionally deferred until Martin has checked control feel.

## Verification
- `npm test`: logic, older win-path simulation, cloud-safety, boss-mechanics and new playtest regression tests.
- `CHROME_PATH=/path/to/chrome npm run test:ui`: isolated temporary browser profile with mocked Google/Drive only inside the test. Covers first-sync/diverged wording, Use cloud, shop feedback, Continue Run, route layout, larger scores, zero unchanged HUD rewrites across twelve frames, OfflineAudioContext 7/7, and zero JS/HTTP errors.
- `PDP_SCREENSHOT_DIR=/path` saves screenshots during UI tests. Production has no debug hooks.
- An isolated short Chromium mouse trace compared the e1da56a baseline with this change. Previously a step input still had a position-easing tail after 100 ms; now the target is reached on the next rendered frame. HUD mutations were 1,341 before vs 0 after. Canvas-bound reads were 93 before vs 1 after, with the latter coming from the measurement itself. The sample's frame callback p95 was 3.6 ms before vs 2.2 ms after. These are one environment's diagnostic samples, not an end-to-end latency guarantee or a statistical benchmark.
- Desktop 1280x720 and narrow 480x700 screenshots inspected. Tall route cards retain an accessible header and scrolling; narrow scores stay readable.
- Voice selection, mute, no-gesture, no-local-voice and volume behavior are tested with a fake speech API. Audible voice quality on Martin's browser is not verified.

## Preserved safety and previous fixes
- First Google connection without a complete shared baseline still requires an explicit save choice. Both choice directions retain backups. Distinct first-sync/diverged wording remains intact.
- Google project/API/OAuth setup and `drive.appdata` scope unchanged. No billing, broader permissions or unrelated project changes.
- Lou Reed Phase 2's prowl fix and shared multi-box opponent formations are preserved.
- Cloud tests still cover first sign-in, missing baseline/cloud, remote-only pull, diverged copies, settings sync and both conflict-choice backups.

## Remaining playtest checks
- Martin should compare mouse movement and late returns on his actual device, including pointer-locked play, then check swipe/spin strength. Removing easing changes feel, so feedback matters more than a remote claim of zero latency.
- Physical Bluetooth/USB gamepads, subjective headphone mix and installed speech quality remain unverified.
- Deterministic boss tests use real formations but are not human-play balance evidence. The older win-path uses a single-paddle approximation, and the newer boss harness holds tempo fixed while production accelerates every seventh paddle hit.
- Do not expand graphics or rebalance bosses merely to make another coding pass. Use actual playtest feedback to choose the next work.
