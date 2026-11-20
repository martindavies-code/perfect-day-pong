# HANDOVER: pull current main before any further edits

The GitHub main branch is ahead of the original AG dev checkout and Drive snapshot. Do not push the old dev checkout over main. Fetch/pull main, reconcile local changes, and refresh the shared source snapshot before editing.

## Current state
- Live game: https://martindavies-code.github.io/perfect-day-pong/
- Local: serve the repo with a static HTTP server. Run npm test for unit, qualified physics-route simulation, and cloud safety regressions.
- Review fixes: unaffordable-upgrade explanation; run-boundary local snapshots and Continue Run; narrow overlay top alignment and wrapped title.
- Continue Run preserves licences, pickups and fixture position, restarting the interrupted fixture at 0-0. It is local to the device, not part of the cloud career save.
- Google project perfect-day-pong is configured, Drive API enabled, External/Testing, owner added as test user. Web client and exact origins are in config.js / SETUP_GOOGLE.md. No billing was enabled and the unrelated Deck Order project was not changed.
- Actual appDataFolder write and HTTP 200 JSON readback were verified. The game's remote-pull path was verified with a temporary test marker, then the cloud test data was restored to zero stats and Quick Deuce off.

## Cloud safety fix
- Existing cloud save plus no shared sync baseline now always opens the comparison screen. Neither side is overwritten without the user's selection, even when this device has default progress.
- Settings changes advance revision and schedule a debounced sync.
- Regression tests cover fresh and nonempty local saves without metadata, absent cloud, settings-style revision/sync, and backups before either conflict choice.
- Read-before-write is still not atomic: use one active session at a time.

## Verification and limits
- Live title, game loop, loss/retry/game-over, settings, local resume, and 480px layout inspected.
- Spatial audio OfflineAudioContext tests: 7/7 passed. Subjective headphone mix and physical controllers were not tested.
- Seeded Node physics simulation covers a nine-match route, but approximates special formations and some boss mechanics with a single paddle. It is not proof of full special-mechanic beatability.
- Isolated Chromium UI test used an otherwise unchanged copy with test-only state access and forced match finishes appended. Real opponent/pickup buttons, all three Acts, automatic fixed bosses, Lou, finale, fee award, and persisted victory stats passed. No production debug hooks were added. This verifies UI transitions, not real-time victory against every special mechanic.
- Only browser resource errors in that UI test were missing favicon.ico (404), not game JavaScript errors.

## Remaining work
- Refresh the shared Drive source snapshot from this main branch before AG resumes.
- Real-time balance/feel and hardware checks remain optional tuning, not a prerequisite for the verified save/layout fixes.
