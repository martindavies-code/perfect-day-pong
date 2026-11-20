# HANDOVER.md — Perfect Day Pong

- **Status / Step**: Step 2 complete (full 9-match roguelike run, 3 Acts, pickups, Lou Reed phases, local save & upgrades).
- **How to run**: `python -m http.server 8000` in `C:\Users\Martin\Projects\perfect-day-pong`, open `http://localhost:8000`.
- **How to test**: `node tests/logic.test.js` (or `npm test`). All Step 2 unit tests pass; headless Chrome DOM check passed.
- **What works**:
  - 9-match run across Act I (5-artist pool), Act II (7-artist pool + Bono mini-boss), Act III (Elton, Bowie, Lou Reed).
  - Opponent quirks/formations (Choir, Quartet, Boyzone, Piano, Bowie gravity shift, Bono shades+decoy, Lou 3 phases + Borrowed Time).
  - Lives (3 start, max 5), 8 pickup types (at least 2 Extra Life offers guaranteed), Fee Points + 6 permanent upgrades in `localStorage`.
- **Placeholders**: Full BBC interstitial cards & Act ident stingers (Step 4), Export/Import UI & Google Cloud Save (Step 5), richer audio/juice (Step 6).
- **Known bugs / limitations**: Live audio & gamepad require interactive browser; cloud save not yet wired.
- **Next 3 steps**:
  1. Step 3: Merge `dev` to `main`, create GitHub repo `perfect-day-pong`, enable GitHub Pages from `main`, verify live URL.
  2. Step 4: Factory Records catalogue polish, 20+ BBC interstitial cards, title/act continuity idents.
  3. Step 5-7: Export/Import save + Google OAuth Drive `appDataFolder` cloud save, audio polish + `tests/audio-test.html`, adversarial QA (`AUDIT.md`).
- **Decisions**: Kept `storage.js` separate from pure `logic.js`; all upgrade/save validation unit-tested in Node.
