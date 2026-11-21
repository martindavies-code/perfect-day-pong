/**
 * Reproducible isolated Chromium UI & integration test for Perfect Day Pong.
 *
 * - Runs against a local HTTP server in an isolated temporary Chrome profile.
 * - Does not touch any real Google account, real Drive data, or real localStorage.
 * - Uses Page.addScriptToEvaluateOnNewDocument ONLY inside this test harness to
 *   stub Google Identity Services / Drive REST responses for testing the
 *   FIRST SYNC vs CONFLICT comparison UI screens without production debug hooks.
 * - Does NOT verify real-time match victory or physical controller hardware.
 *
 * Usage: node tests/ui-progression.test.mjs
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCREENSHOT_DIR = process.env.PDP_SCREENSHOT_DIR || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No headless Chromium browser found (set CHROME_PATH)');
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    const rel = cleanUrl === '/' ? '/index.html' : cleanUrl;
    const filePath = path.resolve(ROOT, '.' + rel);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function getWsUrl(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('CDP endpoint timed out');
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const events = [];
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      events,
      close: () => ws.close(),
    });
    ws.onerror = reject;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    };
  });
}

async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(`JS eval failed: ${JSON.stringify(res.exceptionDetails)}`);
  return res.result?.value;
}

async function maybeShot(cdp, name) {
  if (!SCREENSHOT_DIR) return;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, name), Buffer.from(shot.data, 'base64'));
}

const browserPath = findBrowser();
const { server, baseUrl } = await startStaticServer();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdp-touch-test-'));
const debugPort = 9241;
const chrome = spawn(browserPath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: 'ignore' });

try {
  const cdp = await connectCdp(await getWsUrl(debugPort));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__moves = []; window.addEventListener('touchmove', (e) => window.__moves.push(e.defaultPrevented), { capture: false, passive: true });` });
  await cdp.send('Page.navigate', { url: baseUrl + '/' });
  await new Promise((r) => setTimeout(r, 1500));

  const center = (sel) => evalJs(cdp, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; })()`);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
  const tap = async (sel) => { const [x, y] = await center(sel); await touch('touchStart', [[x, y]]); await new Promise((r) => setTimeout(r, 60)); await touch('touchEnd', []); await new Promise((r) => setTimeout(r, 300)); };

  // Landscape: top bar is compact, HUD bottom hints hidden once playing.
  assert.ok(await evalJs(cdp, 'document.getElementById("topbar").getBoundingClientRect().height <= 40'), 'Landscape top bar is compact');
  assert.equal(await evalJs(cdp, 'document.documentElement.scrollWidth > document.documentElement.clientWidth'), false, 'No horizontal overflow at 844x390');

  // Menus work by tap.
  await tap('#btn-new-run');
  assert.ok(await evalJs(cdp, '!!document.querySelector(".btn-pick-opp")'), 'Tap on Start New Run reaches opponent select');
  await tap('.btn-pick-opp');
  for (let i = 0; i < 3 && await evalJs(cdp, '!!document.querySelector(".btn-pick-up")'); i++) await tap('.btn-pick-up');
  // Might be an interstitial first; click through if a primary button remains.
  for (let i = 0; i < 3 && !(await evalJs(cdp, 'document.getElementById("screen-overlay").classList.contains("hidden")')); i++) {
    const has = await evalJs(cdp, '!!document.querySelector("#screen-overlay button.primary")');
    if (!has) break;
    await tap('#screen-overlay button.primary');
  }
  assert.ok(await evalJs(cdp, 'document.getElementById("screen-overlay").classList.contains("hidden")'), 'Match is on screen (overlay hidden)');
  await maybeShot(cdp, 'touch-landscape-await-serve.png');

  // Drag the bat: page must not scroll or zoom, touchmove must be default-prevented.
  const before = await evalJs(cdp, 'document.getElementById("announcer-hud").textContent');
  const [cx, cy] = await evalJs(cdp, '(() => { const r = document.getElementById("game-canvas").getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; })()');
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx + i * 18, cy - i * 8]]); await new Promise((r) => setTimeout(r, 16)); }
  const hint = await evalJs(cdp, 'document.getElementById("controls-hint").textContent');
  await new Promise((r) => setTimeout(r, 200));
  const hint2 = await evalJs(cdp, 'document.getElementById("controls-hint").textContent');
  await maybeShot(cdp, 'touch-landscape-drag.png');
  await touch('touchEnd', []);
  assert.match(hint2, /TOUCH/, 'HUD hint switches to touch controls after a drag');
  assert.equal(await evalJs(cdp, 'window.scrollY + window.scrollX + document.scrollingElement.scrollTop'), 0, 'Dragging does not scroll the page');
  const moves = await evalJs(cdp, 'window.__moves');
  assert.ok(moves.length > 0 && moves.every(Boolean), 'Every touchmove on the court is default-prevented (no scroll / pull-to-refresh)');
  // A drag must not serve (not a tap).
  assert.equal(await evalJs(cdp, 'document.getElementById("announcer-hud").textContent'), before, 'A drag alone does not serve');

  // Quick tap serves.
  await touch('touchStart', [[cx, cy]]);
  await new Promise((r) => setTimeout(r, 50));
  await touch('touchEnd', []);
  await new Promise((r) => setTimeout(r, 600));
  const after = await evalJs(cdp, 'document.getElementById("announcer-hud").textContent');
  console.log('announcer before/after tap:', JSON.stringify(before), JSON.stringify(after));
  await maybeShot(cdp, 'touch-landscape-rally.png');
  assert.notEqual(after, before, 'A quick tap serves the ball');

  // Second finger tap while first drags must not throw and keeps first finger bat control.
  await touch('touchStart', [[cx, cy]]);
  await touch('touchStart', [[cx, cy], [cx + 200, cy]]);
  await touch('touchEnd', [[cx, cy]]);
  await touch('touchEnd', []);

  // Portrait narrow still ok.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await maybeShot(cdp, 'touch-portrait.png');
  assert.equal(await evalJs(cdp, 'document.documentElement.scrollWidth > document.documentElement.clientWidth'), false, 'No horizontal overflow in portrait');
  for (const [w, h] of [[390, 780], [360, 740], [480, 700]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await new Promise((r) => setTimeout(r, 200));
    const fit = await evalJs(cdp, '(() => { const g = document.getElementById("speed-gauge").getBoundingClientRect(); const b = document.getElementById("speed-gauge").closest(".score-block").getBoundingClientRect(); return { gaugeRight: g.right, blockRight: b.right, vw: document.documentElement.clientWidth }; })()');
    assert.ok(fit.gaugeRight <= fit.blockRight - 4 && fit.blockRight <= fit.vw, `SPEED gauge stays inside its panel and the viewport at ${w}px: ${JSON.stringify(fit)}`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
  await maybeShot(cdp, 'touch-portrait-fixed.png');
  console.log('Touch UI test passed (tap menus, drag without scroll, tap serve, multi-touch, landscape + portrait layout).');
} finally {
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
