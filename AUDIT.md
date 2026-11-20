# Adversarial Failure-Path Audit — Perfect Day Pong

Conducted against `dev` after Step 6 implementation, followed by fixes and separate re-checks.

## Findings

1. **[HIGH] Gamepad & Keyboard menu navigation missing on overlay screens**
   - *Where*: `input.js`, `main.js`, `style.css`
   - *Fix*: Added `nav` edge events (d-pad, left stick, keyboard arrows/WASD) + overlay button focus cycling (`moveOverlayFocus`, `activateOverlayFocus`).
   - *Status*: **fixed, not verified** on physical gamepad hardware; keyboard/button flow verified in headless Chrome CDP.

2. **[HIGH] `buildPickupOffer()` could return `[]` when all pickups are maxed and `lives === 5`**
   - *Where*: `logic.js` (`buildPickupOffer`, `choosePickup`, `computeRunFeePoints`)
   - *Fix*: Added fallback `fee_grant` pickup (+15 Fee Points) whenever `offers.length === 0`.
   - *Status*: **fixed and verified** (unit test in `tests/logic.test.js` re-run and passed).

3. **[MEDIUM] Sticky Bat early release (`confirm` while `stickyTimer > 0`) skipped paddle velocity transfer**
   - *Where*: `main.js` (`releaseStickyBall`)
   - *Fix*: Extracted `releaseStickyBall(m)` called by both early `confirm` and timer expiry.
   - *Status*: **fixed, not verified** in live interactive rally (code path inspected).

4. **[MEDIUM] Double-click race on opponent / pickup choice cards**
   - *Where*: `main.js` (`choiceLocked` guard)
   - *Fix*: Added `choiceLocked` boolean reset on `renderOverlay()` and checked before `pickOpponent` / `choosePickup`.
   - *Status*: **fixed, not verified** for rapid double-click (verified single click in CDP).

5. **[MEDIUM] Two gamepads: `onGamepadConnected` eagerly claimed pad 0 instead of first-pressed pad**
   - *Where*: `input.js` (`onGamepadConnected`, `pollGamepad`)
   - *Fix*: Removed eager claim in `onGamepadConnected`; `pollGamepad()` claims first pad with input.
   - *Status*: **fixed, not verified** (requires two physical controllers).

6. **[MEDIUM] Gamepad B (`back`) button not wired in `main.js`**
   - *Where*: `main.js` (`input.on('back')`)
   - *Fix*: Subscribed to `back` to exit `settings`, `upgrades`, and `paused`.
   - *Status*: **fixed, not verified** on physical gamepad (`Esc` verified in CDP).

7. **[MEDIUM] Narrow viewport resize overflow in `#topbar` and `#hud-top`**
   - *Where*: `style.css`
   - *Fix*: Made `#topbar` and `#hud-top` wrap cleanly, relaxed `.score-block` `min-width`, added `@media (max-width: 720px)`.
   - *Status*: **fixed and verified** (`480x700` and `1280x720` resize verified with `scrollWidth <= clientWidth` in Chrome CDP).

8. **[LOW] Strict import accepted future `schemaVersion`; cloud pull did not re-apply audio volumes**
   - *Where*: `logic.js`, `main.js`
   - *Fix*: Strict validation rejects non-integer or `> SAVE_SCHEMA_VERSION`; `audio.applyVolumes()` called on cloud pull/resolve.
   - *Status*: **fixed and verified** (`schemaVersion: 99` test in `tests/logic.test.js` passed; cloud pull verified by inspection).

9. **[HIGH] `await audio.unlockFromGesture()` blocked game start when AudioContext `resume()` remained pending**
   - *Where*: `main.js` (`btn-new-run`, `btn-pick-opp`, `btnMute`)
   - *Fix*: Changed to non-blocking `audio.unlockFromGesture()` call so game flow never waits on Web Audio autoplay promises.
   - *Status*: **fixed and verified** (headless Chrome CDP initially caught the hang; after fix, full start -> opponent -> serve -> pause flow passed with 0 console errors).
