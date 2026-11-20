# HANDOVER.md — Perfect Day Pong

- **Status / Step**: Step 1 complete (playable 3D match, controls, depth cues, finite AI, spatial audio + minimal groove).
- **How to run**: `python -m http.server 8000` in `C:\Users\Martin\Projects\perfect-day-pong`, open `http://localhost:8000`.
- **How to test**: `node tests/logic.test.js` (or `npm test`). All Step 1 unit tests pass; headless Chrome DOM check verified.
- **What works**:
  - True 3D `(x,y,z)` fixed-timestep (`1/120`s) physics with swept bat-plane checks, spin curve, low gravity, 4 tempos.
  - All 5 depth cues: perspective ball, floor shadow, converging wireframe grid with fog, moving depth ring, bat-plane flashes.
  - Mouse (pointer lock + fallback), Gamepad (stick/d-pad/A/B/Start/bumpers, auto-pause on disconnect), Keyboard.
  - Finite beatable AI (`>= 110ms` reaction, capped speed, prediction error, miss chance).
  - Web Audio HRTF/Stereo spatial ball + impacts, shared clock sequencer (kick, hat, bass, arp) + quantised answers.
- **Placeholders**: Single Test Signal opponent; roguelike 9-match run, Act themes, pickups, Fee Points/saves in Steps 2-5.
- **Known bugs / limitations**: Live audio & gamepad require interactive browser session (`file://` unsupported for modules/gamepad).
- **Next 3 steps**:
  1. Step 2: Full 9-match run across 3 Acts, 3+ pickup types, lives (3 start, cap 5), Lou Reed boss phases, local save + Fee Points + basic upgrade board.
  2. Step 3: Verify end-to-end, merge `dev` to `main`, create GitHub repo & enable GitHub Pages.
  3. Step 4-7: Factory Records / BBC full theme, export/import + cloud save, richer audio/juice, QA audit & re-check.
- **Decisions**: Vanilla ES modules + Canvas 2D 3D projection; `1 unit = 1 metre`; game `+z` mapped to audio `-z`.
