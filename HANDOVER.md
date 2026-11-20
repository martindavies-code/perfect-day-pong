# HANDOVER.md — Perfect Day Pong

- **Status / Step**: Step 7 complete (Steps 4-7 built, audited in `AUDIT.md`, verified, ready for final `main` publish).
- **Live URL**: `https://martindavies-code.github.io/perfect-day-pong/`
- **How to run / test**: `python -m http.server 8000` -> `http://localhost:8000`. Unit tests: `node tests/logic.test.js`. Audio test: `tests/audio-test.html`.
- **What works**:
  - True 3D `(x,y,z)` physics, swept bat collision, spin, 5 depth cues, mouse (pointer lock + fallback)/gamepad/keyboard, finite AI (`>=110ms`).
  - 9-match run across 3 Acts, 16 opponents (Choir/Quartet/Boyzone/Piano/Bowie/Bono/Lou 3 phases + Borrowed Time), 8 pickups, 6 upgrades, Fee Points.
  - Factory look, 24 tagged BBC interstitial cards, Charter review bars, layered Detroit house + 3D HRTF/Stereo spatial audio.
  - `localStorage` save, Export/Import (256 KB cap, strict validation, backups), 2-click Reset, Google Drive `appDataFolder` + conflict UI.
- **Manual headphone check for Martin**: ball clearly approaches; passes left/right; far wall sounds far; music never masks ball; mute (`M`) & volume sliders work.
- **Known issues**:
  - Cloud save read-before-write is not atomic across two simultaneous devices (v1 assumes one active session; revision check + backups mitigate).
  - Google OAuth Web Client ID is unset (`config.js`); live sign-in is built, untested until Martin completes `SETUP_GOOGLE.md`.
  - Physical gamepad & live interactive audio only verified via code/OfflineAudioContext (not physical controller hardware).
- **Next 3 steps**:
  1. Complete `SETUP_GOOGLE.md` and paste `GOOGLE_CLIENT_ID` into `config.js`.
  2. Run manual headphone & Bluetooth controller check on `https://martindavies-code.github.io/perfect-day-pong/`.
  3. Tune opponent speeds/feel after first full live playthrough.
- **Decisions**: Vanilla ES modules + Canvas 2D 3D projection + Web Audio; zero build step; relative paths throughout.
