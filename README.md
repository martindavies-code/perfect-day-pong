# Perfect Day Pong

A first-person 3D Pong roguelike inspired by *Room Ten* (1986), haunted by the BBC's 1997 *Perfect Day* promotional film, and dressed like a Factory Records catalogue.

## Run Locally

Serve the repository root with any static HTTP server (required for ES modules, Gamepad API on `localhost`, and OAuth):

```bash
python -m http.server 8000
# or: npx serve . -l 8000
```

Open `http://localhost:8000`.

## Run Tests

```bash
npm test
# or: node tests/logic.test.js
```

## Notes
- Built with vanilla JavaScript (ES modules), HTML5 Canvas 2D projecting a true 3D `(x, y, z)` simulation, and procedural Web Audio.
- No build step required.
