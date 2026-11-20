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
- Overlay scroll resets when opening a different screen or returning from play. Long route/settings panels no longer leave the next screen scrolled past its heading. Same-screen feedback refreshes preserve position. A reproduced 480px route/play/settings navigation regression now passes.
- Bigger graphics changes are intentionally deferred until Martin has checked control feel.

## 20 November second playtest round
- Score calls: level scores are "Love all", "15 all", "30 all" (on screen and spoken); unequal scores read YOU first then opponent, as the HUD does. Deuce, advantage, match point unchanged. Real tennis calls the server's score first; this game keeps YOU first to match the HUD.
- Pick screens (opponent and pickup) no longer highlight the first card. A highlight appears only after the first keyboard or gamepad direction press (a confirm press with no highlight just starts it). Mouse and touch never show one.
- Music: NOT done in this round. Perfect Day is Lou Reed's copyrighted composition; no MIDI or melody is bundled. See rights note below; the engine is unchanged.
- John Birt: the player is John Birt, BBC Director-General (Wikipedia: 1992 to 2000). HUD label is BIRT (YOU). `content.js` has SOURCED cards restating the Wikipedia article (quotation marks only around wording it quotes) and SATIRE, INVENTED cards that are clearly labelled and contain no quotation marks. Source: https://en.wikipedia.org/wiki/John_Birt%2C_Baron_Birt
- Rights note: MusicBrainz and EasySong list EMI Music/Oakfield Avenue Music/Screen Gems-EMI as publishers of Perfect Day. Free MIDI sites host others' transcriptions without a licence to redistribute, so a public game needs publisher permission or a licensed arrangement before bundling a Perfect Day melody. Card labelling is covered by tests/playtest.test.mjs.
- Deferred to next round: fonts and general visual polish.

## 20 November visual polish round
- Court depth in `renderer.js`: side walls and ceiling now get faint tonal planes, and the back wall has a clear light outline, so the room reads as surfaces instead of a bare wireframe.
- A soft edge vignette (`drawVignette()`) is rendered to an offscreen canvas once per resize and drawn under the ball, bats and HUD each frame. No per-frame gradients, no `shadowBlur`, no per-frame DOM writes; projection and physics are untouched.
- Verified: `npm test` and the isolated Chromium UI suite pass with 0 errors; 1280x720 and 480x700 in-play screenshots inspected before and after. The existing floor gradient, ball floor shadow, ball trail and bat-plane hit flashes were already present and are unchanged.
- Deferred still: title/route typography and any larger art pass, pending Martin's read of this round.
- Inset view (Martin's request after seeing the depth pass): `VIEW_FIT = 0.88` in `logic.js` bounds the projection so the room cross-section at the player plane (z=0, the largest) always fits the viewport with an outer margin; the previous framing cropped the near-plane corners, so high and low corner shots left the screen. `viewScale(width, height)` is the shared pixels-per-room-unit helper. `renderer.js` derives its focal length from it; `input.js` maps the visible court edges (per axis) to the paddle's full range. Physics, room geometry and difficulty are unchanged; pointer-lock, keyboard and gamepad movement are relative and unchanged. Verified with corner screenshots at 1280x720, 1920x993 and 480x700 with the ball at all four near-plane corners.
- Readability pass (CSS only): `--muted` brightened (#9a9890 to #b6b4ab) for secondary text contrast on panels, and looser line-height on card paragraphs and the route's possible-opponent lists. Fonts unchanged (system stacks, no Arial).

## 20 November larger visual redesign (title, route, UI)
- Title screen rebuilt as a Factory-sleeve layout: filled PDP 001 catalogue badge, kicker row, oversized tracked wordmark, standfirst line, and an inline SVG transmission clock (abstract BBC continuity motif). An EBU-style colour-bars stripe replaces the diagonal hazard stripe on the title card only.
- Menu backdrop: radial studio glow plus faint CRT scanlines behind overlay cards. Pure CSS, no JS, no per-frame cost; gameplay canvas and HUD are untouched.
- Card craft: more air, harder offset shadow, filled catalogue badges everywhere, ruled stat-strip cells, continuity cards get a quote bar with a bordered SOURCED / SATIRE label chip, choice cards get a spine accent on hover/focus, route nodes get a listings treatment with a shadowed current node, firmer primary buttons.
- Accessibility: choice-card hover transform disabled under prefers-reduced-motion; the clock is aria-hidden; heading structure and all copy unchanged (h1 text, John Birt persona line, nine route nodes, card labels). var() is invalid inside SVG presentation attributes, so the clock accent hand/dot are coloured via CSS classes, not attributes.
- main.js changes are markup-only on the title screen plus a choice-cta class on the two pick screens. No logic, physics, input, audio, save or cloud changes.
- Verified: npm test (9 suites) and the isolated Chromium UI suite pass; before/after screenshots inspected at 1280x720, wide desktop and 480x700 for title, route, settings and in-play; the title card fits at 720p with the primary action above the fold.

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

## Perfect Day lead line (music)
- perfectday.js holds the reduced vocal-melody line (8 bars, 21 notes) taken from a karaoke MIDI supplied by the project owner. midi.js reduces any MIDI to this form (pass the track index; here track 4, the one whose note onsets match all 154 lyric events).
- audio.js plays it as a square lead on the 16th grid, bass takes the tune's tonic, racket hits step through the tune, longer rallies add an octave layer. Walls/misses keep their hit/fill sounds.
- Rights: the composition is Lou Reed's (EMI / Oakfield Avenue / Screen Gems-EMI). No publisher licence has been found or verified; the project owner supplied the file for use in this game. If a rights holder objects, delete perfectday.js and the setMotif call in main.js and the original house track returns.
- Verified: npm test (scheduling test with a fake Web Audio API) and a real Chromium render of the engine, recorded and pitch-analysed: opening notes A#4, F5, D#5, F5, D#5 at the expected beat times. Nobody has listened to it yet.
