// On-device diagnostic logging for Perfect Day Pong.
//
// Privacy and performance rules:
// - Ring buffer of at most MAX_ENTRIES entries in memory; errors also persist
//   a capped tail to localStorage so they survive a reload.
// - Records category, message, small structured data, timestamps. Never
//   personal data, save contents, OAuth tokens, or URLs (which can carry
//   auth state). Strings are truncated.
// - Nothing is uploaded anywhere. Export is a manual user action in Settings.
// - No per-frame logging; breadcrumbs fire on state transitions only.

const MAX_ENTRIES = 200;
const MAX_MESSAGE = 300;
const PERSIST_KEY = 'pdp-diagnostics-errors';
const MAX_PERSISTED = 50;

const buffer = [];
let seq = 0;
let insideDiag = false;

function clip(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.slice(0, MAX_MESSAGE);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'string' ? v.slice(0, MAX_MESSAGE) : v)));
  } catch {
    return String(value).slice(0, MAX_MESSAGE);
  }
}

export function diagLog(category, message, data) {
  if (insideDiag) return null;
  insideDiag = true;
  try {
    const entry = { i: ++seq, t: Date.now(), cat: String(category).slice(0, 24), msg: clip(String(message)) };
    if (data !== undefined) entry.data = clip(data);
    buffer.push(entry);
    if (buffer.length > MAX_ENTRIES) buffer.shift();
    return entry;
  } catch {
    return null;
  } finally {
    insideDiag = false;
  }
}

export function diagError(kind, message, stack) {
  const entry = diagLog('error', message, { kind, stack: stack ? String(stack).slice(0, 800) : undefined });
  persistError(entry);
  return entry;
}

function persistError(entry) {
  if (!entry || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    list.push(entry);
    while (list.length > MAX_PERSISTED) list.shift();
    localStorage.setItem(PERSIST_KEY, JSON.stringify(list));
  } catch {
    // Storage full or unavailable: keep the in-memory copy only.
  }
}

function readPersisted() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function initDiagnostics() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => {
    diagError('error', e.message || 'unknown', e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    diagError('unhandledrejection', (reason && reason.message) || String(reason), reason && reason.stack);
  });
  diagLog('boot', 'diagnostics ready', { ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'node' });
}

export function exportDiagnosticsJson(buildId) {
  return JSON.stringify({
    app: 'perfect-day-pong',
    build: buildId || 'unknown',
    exportedAt: new Date().toISOString(),
    recent: buffer.slice(),
    persistedErrors: readPersisted(),
  }, null, 2);
}

// Test hooks (not used by the game itself).
export function _diagBufferSize() {
  return buffer.length;
}
