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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdp-ui-test-'));
const debugPort = 9239;
const chrome = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  const wsUrl = await getWsUrl(debugPort);
  const cdp = await connectCdp(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Inject test-only Google GIS / Drive stub inside this isolated browser context
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__pdpMockRemote = {
        schemaVersion: 1,
        revision: 4,
        deviceId: 'remote-test-device',
        updatedAt: '2026-11-20T12:00:00.000Z',
        totalEarned: 120,
        upgradeLevels: { startBatSize: 1, startBatSpeed: 0, startLives: 0, pickupChoices: 0, tempoCharges: 0, serveWindow: 0 },
        stats: { runsPlayed: 3, runsWon: 1, matchesWon: 12, pointsScored: 64, louReedWins: 1 },
        settings: { mouseSensitivity: 1, quickDeuce: false, spatialMode: 'hrtf', masterVolume: 0.8, musicVolume: 0.42, sfxVolume: 0.88 }
      };
      window.__pdpMockVersion = 'v-remote-4';
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient(opts) {
              return { requestAccessToken: () => opts.callback({ access_token: 'test-token', expires_in: 3600 }) };
            },
            revoke(_tok, cb) { cb?.(); }
          }
        }
      };
      const origFetch = window.fetch.bind(window);
      window.fetch = async (url, opts = {}) => {
        const s = String(url);
        if (s.includes('googleapis.com/drive/v3/files')) {
          if (s.includes('alt=media')) {
            return new Response(JSON.stringify(window.__pdpMockRemote), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({
            files: window.__pdpMockRemote ? [{ id: 'mock-file-id', name: 'perfect-day-pong-save.json', md5Checksum: window.__pdpMockVersion }] : []
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return origFetch(url, opts);
      };
    `,
  });

  // 1. Desktop & Narrow title check + zero HTTP/JS errors
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `${baseUrl}/` });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(await evalJs(cdp, 'document.querySelector("h1")?.textContent'), 'Perfect Day Pong');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 700, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await evalJs(cdp, 'document.documentElement.scrollWidth > document.documentElement.clientWidth'), false, 'No horizontal overflow at 480x700');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 200));

  // 2. Unaffordable upgrade feedback check
  await evalJs(cdp, 'document.getElementById("btn-upgrades").click()');
  await new Promise((r) => setTimeout(r, 150));
  await evalJs(cdp, 'document.querySelector(".btn-buy-upgrade").click()');
  await new Promise((r) => setTimeout(r, 150));
  const shopMsg = await evalJs(cdp, 'document.querySelector(".note-line")?.textContent || ""');
  assert.ok(shopMsg.includes('Insufficient Fee Points'), `Expected unaffordable upgrade explanation, got: ${shopMsg}`);
  await evalJs(cdp, 'document.getElementById("btn-up-back").click()');
  await new Promise((r) => setTimeout(r, 150));

  // 3. Initial-connection comparison wording (FIRST SYNC)
  await evalJs(cdp, 'document.getElementById("btn-google-signin").click()');
  await new Promise((r) => setTimeout(r, 300));
  const firstHeading = await evalJs(cdp, 'document.querySelector(".card h2")?.textContent');
  const firstBadge = await evalJs(cdp, 'document.querySelector(".card .fac-cat")?.textContent');
  const firstBody = await evalJs(cdp, 'document.querySelector(".card p")?.textContent');
  assert.equal(firstHeading, 'Choose Your Active Save');
  assert.equal(firstBadge, 'FIRST SYNC');
  assert.ok(firstBody.includes('no previous sync history'), `Unexpected first-sync body: ${firstBody}`);
  await maybeShot(cdp, 'ui-first-sync.png');

  // Choose cloud save -> activates remote save & creates local backup
  await evalJs(cdp, 'document.getElementById("btn-use-cloud").click()');
  await new Promise((r) => setTimeout(r, 250));
  const statsStrip = await evalJs(cdp, 'document.querySelector(".stat-strip")?.textContent || ""');
  assert.ok(statsStrip.includes('RUNS: 3'), `Cloud save should now be active: ${statsStrip}`);

  // 4. Genuine diverged conflict wording (CONFLICT)
  await evalJs(cdp, `
    (() => {
      const s = JSON.parse(localStorage.getItem('pdp_save_v1'));
      s.revision += 1;
      localStorage.setItem('pdp_save_v1', JSON.stringify(s));
    })()
  `);
  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 600));
  await evalJs(cdp, `window.__pdpMockVersion = 'v-remote-5';`);
  await evalJs(cdp, 'document.getElementById("btn-google-signin").click()');
  await new Promise((r) => setTimeout(r, 300));
  const divHeading = await evalJs(cdp, 'document.querySelector(".card h2")?.textContent');
  const divBadge = await evalJs(cdp, 'document.querySelector(".card .fac-cat")?.textContent');
  const divBody = await evalJs(cdp, 'document.querySelector(".card p")?.textContent');
  assert.equal(divHeading, 'Cloud Save Conflict');
  assert.equal(divBadge, 'CONFLICT');
  assert.ok(divBody.includes('Both this device and Google Drive changed'), `Unexpected diverged body: ${divBody}`);
  await maybeShot(cdp, 'ui-diverged-conflict.png');
  await evalJs(cdp, 'document.getElementById("btn-decide-later").click()');
  await new Promise((r) => setTimeout(r, 150));

  // 5. Run start -> pick opponent -> reload -> Continue Run persists
  await evalJs(cdp, 'document.getElementById("btn-new-run").click()');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await evalJs(cdp, 'document.querySelectorAll(".route-node").length'), 9, 'Nine real route stages shown before play');
  assert.ok(await evalJs(cdp, 'document.querySelector(".card").getBoundingClientRect().top >= document.getElementById("screen-overlay").getBoundingClientRect().top'), 'Tall route header must remain reachable');
  await maybeShot(cdp, 'playtest-route-desktop.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 700, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evalJs(cdp, 'document.documentElement.scrollWidth > document.documentElement.clientWidth'), false);
  await maybeShot(cdp, 'playtest-route-narrow.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await evalJs(cdp, 'document.getElementById("screen-overlay").scrollTop = document.getElementById("screen-overlay").scrollHeight');
  await evalJs(cdp, 'document.querySelector(".btn-pick-opp").click()');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await evalJs(cdp, 'document.getElementById("screen-overlay").classList.contains("hidden")'), true);
  // A scrolled route must not carry its scroll offset into another screen.
  await evalJs(cdp, 'document.getElementById("btn-settings").click()');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await evalJs(cdp, 'document.getElementById("screen-overlay").scrollTop'), 0, 'Settings starts at top after leaving a scrolled route');
  assert.ok(await evalJs(cdp, 'document.querySelector(".card-header").getBoundingClientRect().top >= document.getElementById("screen-overlay").getBoundingClientRect().top'), 'Settings heading remains reachable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 700, deviceScaleFactor: 1, mobile: false });
  await evalJs(cdp, 'document.getElementById("screen-overlay").scrollTop = document.getElementById("screen-overlay").scrollHeight');
  await evalJs(cdp, 'document.getElementById("btn-settings-back").click()');
  await evalJs(cdp, 'document.getElementById("btn-settings").click()');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await evalJs(cdp, 'document.getElementById("screen-overlay").scrollTop'), 0, 'Narrow settings also resets after hidden playing screen');
  await maybeShot(cdp, 'playtest-settings-scroll-reset.png');
  await evalJs(cdp, 'document.getElementById("btn-settings-back").click()');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });


  await cdp.send('Page.reload');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await evalJs(cdp, 'Boolean(document.getElementById("btn-continue-run"))'), true, 'Continue Run should appear on reload');
  await evalJs(cdp, 'document.getElementById("btn-continue-run").click()');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await evalJs(cdp, 'document.getElementById("status-hud")?.textContent'), '0 - 0');

  // Stable HUD must not rebuild text/nodes while a point waits to be served.
  const hudMutations = await evalJs(cdp, `new Promise(resolve => {
    let mutations = 0, frames = 0;
    const observer = new MutationObserver(records => mutations += records.length);
    observer.observe(document.getElementById('hud-overlay'), {subtree:true, childList:true, characterData:true, attributes:true});
    function next() { if (++frames < 12) requestAnimationFrame(next); else { observer.disconnect(); resolve(mutations); } }
    requestAnimationFrame(next);
  })`);
  assert.equal(hudMutations, 0, 'No unchanged HUD rewrites across twelve animation frames');
  assert.ok(await evalJs(cdp, 'parseFloat(getComputedStyle(document.getElementById("score-player")).fontSize) >= 36'), 'Score is prominent');
  await maybeShot(cdp, 'playtest-score-desktop.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 700, deviceScaleFactor: 1, mobile: false });
  await maybeShot(cdp, 'playtest-score-narrow.png');
  assert.equal(await evalJs(cdp, 'document.documentElement.scrollWidth > document.documentElement.clientWidth'), false);

  // 6. OfflineAudioContext verification page
  await cdp.send('Page.navigate', { url: `${baseUrl}/tests/audio-test.html` });
  let passed = '';
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    passed = await evalJs(cdp, 'document.getElementById("results")?.dataset?.passed || ""');
    if (passed) break;
  }
  assert.equal(passed, 'true', 'OfflineAudioContext test suite must pass');

  // Verify zero console/runtime errors and zero HTTP failures
  const jsErrors = [];
  const httpFails = [];
  for (const ev of cdp.events) {
    if (ev.method === 'Runtime.exceptionThrown') jsErrors.push(ev.params.exceptionDetails?.text);
    if (ev.method === 'Runtime.consoleAPICalled' && ev.params.type === 'error') {
      jsErrors.push(ev.params.args?.map((a) => a.value || a.description).join(' '));
    }
    if (ev.method === 'Network.responseReceived' && ev.params.response.status >= 400) {
      httpFails.push(`${ev.params.response.status} ${ev.params.response.url}`);
    }
  }
  assert.equal(jsErrors.length, 0, `Browser JS/console errors: ${jsErrors.join('; ')}`);
  assert.equal(httpFails.length, 0, `HTTP failures: ${httpFails.join('; ')}`);

  cdp.close();
  console.log('Isolated Chromium UI progression test passed (layout, shop feedback, FIRST SYNC vs CONFLICT UI, Continue Run, OfflineAudioContext, 0 errors).');
} finally {
  chrome.kill();
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}
