# Perfect Day Pong

A first-person 3D Pong roguelike inspired by *Room Ten* (1986), haunted by the BBC's 1997 *Perfect Day* promotional film, and dressed like a Factory Records catalogue.

## Play Online

- GitHub Pages: `https://martindavies-code.github.io/perfect-day-pong/`

## Run Locally

Serve the repository root with any static HTTP server (required for ES modules, Gamepad API on `localhost`, and Google OAuth):

```bash
python -m http.server 8000
```

Open `http://localhost:8000`.

## Run Tests

```bash
npm test
```

Runs the unit suite plus a deterministic full 9-match win-path simulation (`tests/winpath.sim.mjs`).

Spatial Web Audio verification (`OfflineAudioContext`): open `http://localhost:8000/tests/audio-test.html` in a browser.

## Known Limitations

- **Mid-run resume**: an interrupted run can be continued from the title screen; the current fixture restarts at 0-0 while licences, pickups, Fee Points and match progress are kept.
- **Cloud save concurrency**: Drive `appDataFolder` read-before-write is not atomic; v1 assumes one active device/session at a time. The revision check, conflict prompt, and automatic local backups reduce damage but cannot eliminate a simultaneous-write race between two devices.
- **Google Sign-In setup**: Requires a public Web OAuth Client ID in `config.js` (see `SETUP_GOOGLE.md`). Until configured, local save and JSON export/import work fully in guest mode.
