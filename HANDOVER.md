# HANDOVER.md — Perfect Day Pong

- **Status / Step**: Step 0 complete (scaffold, repo, dev branch, tennis scoring state machine, unit tests).
- **How to run**: `python -m http.server 8000` in `C:\Users\Martin\Projects\perfect-day-pong` (no playable page yet until Step 1).
- **How to test**: `node tests/logic.test.js` (or `npm test`). All 7 test blocks pass.
- **What works**: Pure tennis scoring state machine (`logic.js`) with 0/15/30/40/Deuce/Ad/Game, strict win-by-2, optional Quick Deuce (3rd deuce deciding point), serve alternation, deuce counter.
- **Placeholders**: Game UI, 3D match engine, audio engine, roguelike run, save/cloud, Factory Records theme.
- **Known bugs / limitations**: None in Step 0.
- **Next 3 steps**:
  1. Build Step 1: playable 3D match (`index.html`, `main.js`, `audio.js`, `physics` in `logic.js`) with depth cues, mouse/gamepad/keyboard controls, finite AI, and minimal Web Audio (shared clock, spatial ball/impacts, basic kick/hat/arp groove).
  2. Build Step 2: full 9-match roguelike run across 3 Acts, lives, pickups, Lou Reed boss phases, local save + Fee Points + basic upgrade board.
  3. Build Step 3: verify end-to-end, merge `dev` to `main`, publish to GitHub Pages.
- **Decisions**: Plain ES modules + Canvas 2D (3D perspective projection) + Web Audio, zero build step, `"type": "module"` in `package.json`.
