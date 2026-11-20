import {
  ROOM,
  TEMPOS,
  ACTS,
  OPPONENTS,
  PICKUPS,
  UPGRADES,
  getTempoByIndex,
  createMatchScore,
  scorePoint,
  formatTennisScore,
  createPaddle,
  clampPaddle,
  createBall,
  stepBallPhysics,
  createAIState,
  stepAI,
  mulberry32,
  hashSeed,
  createRunState,
  pickOpponent,
  recordMatchResult,
  choosePickup,
  getEffectivePickups,
  getLouReedPhase,
  computeRunFeePoints,
  computeUnspentPoints,
  purchaseUpgrade,
} from './logic.js';
import {
  loadLocalSave,
  saveLocalSave,
  exportSaveJson,
  validateImportedText,
  resetProgress,
  createBackupSnapshot,
} from './storage.js';
import { createCloudManager } from './cloud.js';
import { pickInterstitialCard } from './content.js';
import { createInputManager } from './input.js';
import { createAudioEngine } from './audio.js';
import { createRenderer } from './renderer.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('screen-overlay');
const catBadge = document.getElementById('cat-badge');
const topTitle = document.getElementById('top-title');
const livesHud = document.getElementById('lives-hud');
const scorePlayerEl = document.getElementById('score-player');
const scoreOppEl = document.getElementById('score-opp');
const oppNameHud = document.getElementById('opp-name-hud');
const tempoHud = document.getElementById('tempo-hud');
const announcerHud = document.getElementById('announcer-hud');
const statusHud = document.getElementById('status-hud');
const abilityHud = document.getElementById('ability-hud');
const pickupsHud = document.getElementById('pickups-hud');
const controlsHint = document.getElementById('controls-hint');
const seedHud = document.getElementById('seed-hud');
const padHint = document.getElementById('pad-hint');
const audioStatusEl = document.getElementById('audio-status');
const btnMute = document.getElementById('btn-mute');
const btnSettings = document.getElementById('btn-settings');
const btnPause = document.getElementById('btn-pause');

const initialLoad = loadLocalSave();
let saveDoc = initialLoad.save;

const renderer = createRenderer(canvas);
const input = createInputManager(canvas, () => saveDoc.settings);
const audio = createAudioEngine(() => saveDoc.settings);
const cloud = createCloudManager();

// Screens: 'title' | 'upgrades' | 'choose_opponent' | 'playing' | 'paused' | 'choose_pickup' | 'match_lost_life' | 'run_end' | 'settings' | 'conflict'
let screen = 'title';
let prevScreenBeforeSettings = 'title';
let runState = null;
let matchState = null;
let lastRunSummary = null;
let cloudNotice = '';
let pendingConflict = null;
let resetConfirmPending = false;
let saveNotice = '';
let lastInterstitial = pickInterstitialCard(Math.random);
let charterReviewBanner = '';
let prevActSeen = 1;
let overlayFocusIdx = 0;
let choiceLocked = false;

function getOverlayButtons() {
  return Array.from(overlay.querySelectorAll('button:not([disabled])'));
}

function syncOverlayFocus() {
  const btns = getOverlayButtons();
  btns.forEach((b, i) => b.classList.toggle('pad-focus', i === overlayFocusIdx));
}

function moveOverlayFocus(dir) {
  if (screen === 'playing') return;
  const btns = getOverlayButtons();
  if (btns.length === 0) return;
  const delta = (dir === 'down' || dir === 'right') ? 1 : -1;
  overlayFocusIdx = (overlayFocusIdx + delta + btns.length) % btns.length;
  syncOverlayFocus();
  btns[overlayFocusIdx]?.focus();
}

function activateOverlayFocus() {
  const btns = getOverlayButtons();
  const target = btns[overlayFocusIdx] || btns[0];
  target?.click();
}

function persistSave() {
  saveLocalSave(saveDoc);
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleCloudSyncResult(res) {
  if (!res) return;
  if (res.action === 'conflict') {
    pendingConflict = res;
    screen = 'conflict';
    renderOverlay();
  } else if (res.action === 'pulled' && res.remoteSave) {
    saveDoc = res.remoteSave;
    persistSave();
    audio.applyVolumes();
    cloudNotice = 'Synced latest cloud save.';
    renderOverlay();
  } else if (res.action === 'uploaded' || res.action === 'uploaded_initial') {
    cloudNotice = 'Cloud save updated.';
  } else if (res.action === 'auth_expired' || res.action === 'error') {
    cloudNotice = res.message || 'Cloud sync unavailable; playing locally.';
  }
}

function startNewRun() {
  runState = createRunState({ upgradeLevels: saveDoc.upgradeLevels });
  prevActSeen = 1;
  charterReviewBanner = '';
  lastInterstitial = pickInterstitialCard(mulberry32(hashSeed(runState.seed)));
  audio.playContinuityIdent(1);
  if (runState.status === 'playing') {
    beginCurrentMatch();
  } else {
    screen = 'choose_opponent';
    renderOverlay();
  }
}

function beginCurrentMatch() {
  if (!runState) return;
  const oppDef = OPPONENTS[runState.currentOpponentId];
  const actDef = ACTS[(oppDef.act || 1) - 1] || ACTS[0];
  if (actDef.id !== prevActSeen) {
    prevActSeen = actDef.id;
    audio.playContinuityIdent(actDef.id);
  }
  const pickups = getEffectivePickups(runState);
  const up = saveDoc.upgradeLevels;

  const sizeMult = 1 + (up.startBatSize || 0) * 0.08 + (pickups.bat_size || 0) * 0.18;
  const speedMult = 1 + (up.startBatSpeed || 0) * 0.1 + (pickups.bat_speed || 0) * 0.18;
  const tempoCharges = 3 + (up.tempoCharges || 0) + (pickups.tempo_control || 0) * 2;

  const rng = mulberry32(hashSeed(`${runState.seed}-M${runState.matchIndex}`));
  matchState = {
    rng,
    oppDef,
    actDef,
    theme: {
      bg: actDef.bg,
      accent: actDef.accent,
      opponentColor: actDef.opponentColor,
    },
    pickups,
    playerSpeedMult: speedMult,
    spinMultiplier: 1 + (pickups.curve_master || 0) * 0.35,
    shadowBoost: 1 + (pickups.shadow_sight || 0) * 0.35,
    secondChanceLeft: pickups.second_chance ? 1 : 0,
    stickyTimer: 0,
    stickyEnabled: Boolean(pickups.sticky_bat),
    score: createMatchScore({ quickDeuce: saveDoc.settings.quickDeuce, firstServer: 'player' }),
    playerPaddle: createPaddle({ width: 1.55 * sizeMult, height: 1.1 * sizeMult }),
    opponentPaddle: createPaddle({ width: oppDef.width, height: oppDef.height }),
    opponentBoxes: null,
    ai: createAIState({
      reactionDelayMs: oppDef.reactionDelayMs,
      maxSpeed: oppDef.maxSpeed,
      predictionError: oppDef.predictionError,
      missChance: oppDef.missChance,
    }),
    ball: createBall({ x: 0, y: 0.25, z: 0.9, vx: 0, vy: 0, vz: 0 }),
    phase: 'awaiting_serve',
    phaseTimer: 0,
    serveAutoTimer: 1.0,
    serveReturnBoostLeft: (up.serveWindow || 0) > 0,
    tempoIndex: oppDef.act === 3 ? 2 : 1,
    tempoCharges,
    rallyHits: 0,
    elapsed: 0,
    gravityY: ROOM.defaultGravityY,
    bowieGravityShifted: false,
    hueyShiftedThisFlight: false,
    isWarmPhase: false,
    flashes: [],
    particles: [],
    ballTrail: [],
    shake: { x: 0, y: 0, mag: 0 },
    bonoDecoy: null,
    bonoShades: oppDef.style === 'bono',
    opponentStyle: oppDef.style,
    announcer:
      runState.currentOpponentId === 'lou_reed' && runState.borrowedPickupId
        ? `Lou Reed borrows ${PICKUPS[runState.borrowedPickupId].name}. Serve when ready.`
        : `${oppDef.name} — ${oppDef.vibe}`,
  };

  screen = 'playing';
  overlay.classList.add('hidden');
  audio.resetRally();
  syncAudioTrack();
  updateHud();
}

function launchServe() {
  if (!matchState || matchState.phase !== 'awaiting_serve') return;
  const m = matchState;
  const isPlayerServe = m.score.server === 'player';
  const deuceBoost = 1 + m.score.deuceCount * 0.06;
  const tempo = getTempoByIndex(m.tempoIndex);
  const actBase = 11.4 + (m.oppDef.act - 1) * 0.9;
  const baseZ = actBase * tempo.speedScale * deuceBoost;

  m.rallyHits = 0;
  m.ballTrail = [];
  m.stickyTimer = 0;
  m.hueyShiftedThisFlight = false;
  m.ai.wasApproaching = false;

  if (isPlayerServe) {
    m.ball = createBall({
      x: m.playerPaddle.x * 0.5,
      y: Math.max(-1.2, Math.min(1.2, m.playerPaddle.y * 0.5 + 0.2)),
      z: 0.55,
      vx: (m.rng() - 0.5) * 3.6,
      vy: 1.25 + (m.rng() - 0.5) * 1.2,
      vz: baseZ,
    });
  } else {
    const tomBoost = m.oppDef.id === 'tom_jones' ? 1.12 : 1.0;
    m.ball = createBall({
      x: m.opponentPaddle.x * 0.5,
      y: 0.35,
      z: ROOM.opponentZ - 0.55,
      vx: (m.rng() - 0.5) * 4.0,
      vy: 1.25 + (m.rng() - 0.5) * 1.2,
      vz: -baseZ * tomBoost,
    });
  }
  m.phase = 'rally';
  m.announcer = formatTennisScore(m.score).announcerText;
  audio.resetRally();
  syncAudioTrack();
}

function syncAudioTrack() {
  if (!matchState) {
    audio.setMatchState({ playing: false });
    return;
  }
  const m = matchState;
  const fmt = formatTennisScore(m.score);
  const tempo = getTempoByIndex(m.tempoIndex);
  const intensity = Math.max(m.score.playerPoints, m.score.opponentPoints) >= 2 ? 1 : 0;
  const actRoots = [45, 43, 41];
  const lou = m.oppDef.id === 'lou_reed' ? getLouReedPhase(m.score).phase : 1;
  audio.setMatchState({
    playing: screen === 'playing' && m.phase !== 'done',
    bpm: tempo.bpm,
    intensity,
    deuce: fmt.isDeuce,
    root: actRoots[(m.oppDef.act || 1) - 1] || 45,
    act: m.oppDef.act || 1,
    oppId: m.oppDef.id,
    lou,
  });
}

function useTempoControl() {
  if (!matchState || screen !== 'playing') return;
  const m = matchState;
  if (m.phase !== 'rally' || m.tempoCharges <= 0 || m.tempoIndex <= 0) return;
  m.tempoCharges -= 1;
  m.tempoIndex -= 1;
  const prevTempo = getTempoByIndex(m.tempoIndex + 1);
  const nextTempo = getTempoByIndex(m.tempoIndex);
  const ratio = nextTempo.speedScale / prevTempo.speedScale;
  m.ball.vx *= ratio;
  m.ball.vy *= ratio;
  m.ball.vz *= ratio;
  m.announcer = `Tempo Control: ${nextTempo.label}.`;
  audio.playUiBeep(520, 0.08);
  syncAudioTrack();
}

function spawnParticles(x, y, z, color = '#e0533c', count = 10) {
  if (!matchState) return;
  for (let i = 0; i < count; i++) {
    matchState.particles.push({
      x, y, z,
      vx: (Math.random() - 0.5) * 5.5,
      vy: (Math.random() - 0.5) * 5.5,
      vz: (Math.random() - 0.5) * 4.0,
      size: 0.08 + Math.random() * 0.08,
      life: 1.0,
      color,
    });
  }
}

function computeOpponentFormation(m) {
  const p = m.opponentPaddle;
  const style = m.oppDef.style;
  const t = m.elapsed;

  if (style === 'choir') {
    const gap = 1.45;
    return [
      { x: Math.max(-ROOM.halfW + 0.4, p.x - gap), y: p.y, width: p.width, height: p.height },
      { x: p.x, y: p.y + Math.sin(t * 2.5) * 0.25, width: p.width, height: p.height },
      { x: Math.min(ROOM.halfW - 0.4, p.x + gap), y: p.y, width: p.width, height: p.height },
    ];
  }
  if (style === 'quartet') {
    const spread = 0.55 + (Math.sin(t * 3.2) * 0.5 + 0.5) * 0.45;
    return [
      { x: p.x - spread * 1.5, y: p.y, width: p.width, height: p.height },
      { x: p.x - spread * 0.5, y: p.y, width: p.width, height: p.height },
      { x: p.x + spread * 0.5, y: p.y, width: p.width, height: p.height },
      { x: p.x + spread * 1.5, y: p.y, width: p.width, height: p.height },
    ];
  }
  if (style === 'boyzone') {
    const wave = Math.sin(t * 2.4) * 0.55;
    return [
      { x: p.x - 1.3, y: p.y + wave * 0.5, width: p.width, height: p.height },
      { x: p.x - 0.65, y: p.y - wave * 0.5, width: p.width, height: p.height },
      { x: p.x, y: p.y + wave * 0.3, width: p.width, height: p.height },
      { x: p.x + 0.65, y: p.y - wave * 0.5, width: p.width, height: p.height },
      { x: p.x + 1.3, y: p.y + wave * 0.5, width: p.width, height: p.height },
    ];
  }
  if (style === 'piano') {
    const keys = [];
    for (let k = -2; k <= 2; k++) {
      keys.push({
        x: p.x + k * 0.46,
        y: p.y + Math.sin(t * 4.5 + k * 0.9) * 0.35,
        width: p.width,
        height: p.height,
      });
    }
    return keys;
  }
  return null;
}

function updateHud() {
  audioStatusEl.textContent = audio.isMuted()
    ? 'Sound: MUTED'
    : audio.isRunning()
      ? 'Sound: ON'
      : 'Sound: Click / Press Key';

  if (runState) {
    const actDef = ACTS[Math.min(2, Math.floor(runState.matchIndex / 3))];
    catBadge.textContent = `${actDef.prefix}0${runState.matchIndex + 1}`;
    catBadge.style.color = actDef.accent;
    catBadge.style.borderColor = actDef.accent;
    topTitle.textContent = `${actDef.title} // MATCH ${Math.min(9, runState.matchIndex + 1)} OF 9`;
    seedHud.textContent = `SEED: ${runState.seed}`;

    let icons = '';
    for (let i = 0; i < runState.maxLives; i++) {
      icons += `<span class="licence-icon ${i < runState.lives ? '' : 'lost'}" title="TV Licence"></span>`;
    }
    livesHud.innerHTML = `LICENCES ${icons}`;

    const eff = getEffectivePickups(runState);
    pickupsHud.innerHTML = Object.entries(eff)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => `<span class="pickup-chip">${PICKUPS[id]?.short || id}${count > 1 ? 'x' + count : ''}</span>`)
      .join('');
  } else {
    catBadge.textContent = 'PDP 001';
    catBadge.style.color = '';
    catBadge.style.borderColor = '';
    topTitle.textContent = 'BBC / ROOM TEN — CONTINUITY TRANSMISSION';
    livesHud.innerHTML = `FEE PTS: ${computeUnspentPoints(saveDoc)}`;
    pickupsHud.innerHTML = '';
    seedHud.textContent = 'SEED: —';
  }

  if (matchState) {
    const m = matchState;
    const fmt = formatTennisScore(m.score);
    scorePlayerEl.textContent = fmt.playerLabel || '-';
    scoreOppEl.textContent = fmt.opponentLabel || '-';
    oppNameHud.innerHTML = `${m.oppDef.name.toUpperCase()} ${m.score.server === 'opponent' ? '<span id="srv-opp">*</span>' : ''}`;
    document.getElementById('srv-player').textContent = m.score.server === 'player' ? '*' : '';
    statusHud.textContent = fmt.statusText;
    const tempo = getTempoByIndex(m.tempoIndex);
    tempoHud.textContent = `${tempo.label} // ${tempo.bpm} BPM`;
    announcerHud.textContent = m.announcer;
    abilityHud.textContent = String(m.tempoCharges);
  }

  const method = input.getLastInputMethod();
  if (method === 'gamepad') {
    controlsHint.textContent = 'PAD: STICK/D-PAD MOVE · A: SERVE · LB/RB: TEMPO · START: PAUSE';
  } else if (method === 'keyboard') {
    controlsHint.textContent = 'KEYS: WASD/ARROWS MOVE · SPACE: SERVE · Q/SHIFT: TEMPO · ESC: PAUSE · M: MUTE';
  } else {
    controlsHint.textContent = input.isPointerLocked()
      ? 'MOUSE (LOCKED): MOVE BAT · CLICK: SERVE · R-CLICK: TEMPO · ESC: PAUSE'
      : 'MOUSE: MOVE BAT · CLICK: SERVE & LOCK · R-CLICK: TEMPO · ESC: PAUSE';
  }
}

function finishMatch(won) {
  if (!runState || !matchState) return;
  const pts = matchState.score.playerPoints;
  const prevMatchIdx = runState.matchIndex;
  audio.triggerStinger(won ? 'win' : 'loss');
  recordMatchResult(runState, { won, playerPointsScored: pts });
  lastInterstitial = pickInterstitialCard(matchState.rng, runState.matchIndex);

  if (won && (prevMatchIdx === 2 || prevMatchIdx === 5)) {
    charterReviewBanner = prevMatchIdx === 2
      ? 'CHARTER REVIEW IN PROGRESS — ENTERING ACT II: THE RUNNING ORDER'
      : 'CHARTER REVIEW IN PROGRESS — ENTERING ACT III: THE FINALE';
  } else {
    charterReviewBanner = '';
  }

  if (runState.status === 'won' || runState.status === 'lost') {
    const earned = computeRunFeePoints(runState);
    saveDoc.totalEarned += earned;
    saveDoc.revision += 1;
    saveDoc.updatedAt = new Date().toISOString();
    saveDoc.stats.runsPlayed += 1;
    if (runState.status === 'won') saveDoc.stats.runsWon += 1;
    if (runState.beatLouReed) saveDoc.stats.louReedWins += 1;
    saveDoc.stats.matchesWon += runState.matchesWon;
    saveDoc.stats.pointsScored += runState.pointsScored;
    persistSave();
    cloud.scheduleDebouncedSync(() => saveDoc, handleCloudSyncResult);

    lastRunSummary = {
      won: runState.status === 'won',
      earned,
      matchesWon: runState.matchesWon,
      pointsScored: runState.pointsScored,
      bossesBeaten: runState.bossesBeaten,
      borrowedTimeBonus: runState.borrowedTimeBonus,
      seed: runState.seed,
    };
    screen = 'run_end';
    renderOverlay();
  } else if (!won) {
    screen = 'match_lost_life';
    renderOverlay();
  } else if (runState.status === 'choose_pickup') {
    screen = 'choose_pickup';
    renderOverlay();
  }
}

function renderCloudBlockHtml() {
  if (!cloud.isConfigured()) {
    return `
      <div class="interstitial-box">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span>Google Cloud Save: <strong>Cloud save not set up yet</strong> (local save active)</span>
          <button id="btn-cloud-disabled" type="button" disabled>Cloud save not set up yet</button>
        </div>
      </div>
    `;
  }
  if (!cloud.isSignedIn()) {
    return `
      <div class="interstitial-box">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span>${cloudNotice || 'Optional Google Drive appDataFolder sync (guest mode is fully playable).'}</span>
          <button id="btn-google-signin" class="primary" type="button">Sign in with Google to save progress</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="interstitial-box">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <strong>Google connected, cloud save on</strong>
          <div class="choice-sub">Saved in a private, hidden folder in your Google Drive. This game cannot see your other files.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button id="btn-google-sync" type="button">Sync Now</button>
          <button id="btn-google-signout" type="button">Sign out</button>
        </div>
      </div>
      ${cloudNotice ? `<div class="choice-sub" style="margin-top:6px">${cloudNotice}</div>` : ''}
    </div>
  `;
}

function wireCloudButtons() {
  const si = document.getElementById('btn-google-signin');
  if (si) {
    si.onclick = async () => {
      const res = await cloud.signInFromClick();
      if (!res.ok) {
        cloudNotice = res.reason;
        renderOverlay();
        return;
      }
      cloudNotice = 'Google connected, cloud save on.';
      const syncRes = await cloud.syncBeforeUpload(saveDoc);
      handleCloudSyncResult(syncRes);
      renderOverlay();
    };
  }
  const syncBtn = document.getElementById('btn-google-sync');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      const syncRes = await cloud.syncBeforeUpload(saveDoc);
      handleCloudSyncResult(syncRes);
      renderOverlay();
    };
  }
  const so = document.getElementById('btn-google-signout');
  if (so) {
    so.onclick = () => {
      cloud.signOut();
      cloudNotice = 'Signed out. Local save active.';
      renderOverlay();
    };
  }
}

function renderOverlay() {
  updateHud();
  choiceLocked = false;
  if (screen === 'playing') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  overlayFocusIdx = 0;

  if (screen === 'title') {
    const unspent = computeUnspentPoints(saveDoc);
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="fac-cat">PDP 001</span>
            <h1>Perfect Day Pong</h1>
          </div>
          <span style="font-family:var(--mono);font-size:12px;color:var(--muted)">BBC / ROOM TEN ROGUELIKE</span>
        </div>
        <p>Nine matches across three Acts. True 3D tennis-scored Pong haunted by late-night continuity.</p>
        <div class="stat-strip">
          <span>FEE POINTS: ${unspent}</span>
          <span>RUNS: ${saveDoc.stats.runsPlayed}</span>
          <span>WINS: ${saveDoc.stats.runsWon}</span>
          <span>LOU REED BEATEN: ${saveDoc.stats.louReedWins}</span>
        </div>
        <div class="interstitial-box">“${lastInterstitial.text}”</div>
        ${renderCloudBlockHtml()}
        <p class="note-line">Pair Bluetooth controllers in Windows first, then press any button so the browser detects it.</p>
        <p class="note-line">Headphones recommended for true 3D HRTF spatial ball &amp; impact cues.</p>
        <div class="btn-row">
          <button class="primary" id="btn-new-run" type="button">Start New Run (Enter / A)</button>
          <button id="btn-upgrades" type="button">Licence Fee Review (${unspent} pts)</button>
          <button id="btn-open-settings" type="button">Settings &amp; Save</button>
        </div>
      </div>
    `;
    wireCloudButtons();
    document.getElementById('btn-new-run').onclick = () => {
      audio.unlockFromGesture();
      startNewRun();
    };
    document.getElementById('btn-upgrades').onclick = () => {
      screen = 'upgrades';
      renderOverlay();
    };
    document.getElementById('btn-open-settings').onclick = () => {
      prevScreenBeforeSettings = 'title';
      resetConfirmPending = false;
      saveNotice = '';
      screen = 'settings';
      renderOverlay();
    };
  } else if (screen === 'upgrades') {
    const unspent = computeUnspentPoints(saveDoc);
    const rowsHtml = Object.values(UPGRADES).map((u) => {
      const lvl = saveDoc.upgradeLevels[u.id] || 0;
      const maxed = lvl >= u.maxLevel;
      const cost = maxed ? null : u.costs[lvl];
      const canBuy = !maxed && unspent >= cost;
      return `
        <div class="upgrade-row">
          <div>
            <div style="font-weight:700">${u.name} <span style="font-family:var(--mono);color:var(--accent)">LV ${lvl}/${u.maxLevel}</span></div>
            <div class="choice-sub">${u.desc}</div>
          </div>
          <button class="btn-buy-upgrade ${canBuy ? 'primary' : ''}" data-up="${u.id}" ${canBuy ? '' : 'disabled'}>
            ${maxed ? 'MAXED' : `BUY (${cost})`}
          </button>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="fac-cat">CHARTER</span>
            <h2>Your Licence Fee at Work</h2>
          </div>
          <span style="font-family:var(--mono);color:var(--accent-2)">UNSPENT: ${unspent} PTS</span>
        </div>
        ${rowsHtml}
        <div class="btn-row">
          <button class="primary" id="btn-up-back" type="button">Back to Title</button>
        </div>
      </div>
    `;
    for (const btn of overlay.querySelectorAll('.btn-buy-upgrade')) {
      btn.onclick = () => {
        const res = purchaseUpgrade(saveDoc, btn.dataset.up);
        if (res.ok) {
          saveDoc = res.save;
          persistSave();
          cloud.scheduleDebouncedSync(() => saveDoc, handleCloudSyncResult);
          audio.playUiBeep(740, 0.06);
          renderOverlay();
        }
      };
    }
    document.getElementById('btn-up-back').onclick = () => {
      screen = 'title';
      renderOverlay();
    };
  } else if (screen === 'choose_opponent' && runState) {
    const actDef = ACTS[Math.min(2, Math.floor(runState.matchIndex / 3))];
    const choicesHtml = runState.offeredOpponents.map((id) => {
      const opp = OPPONENTS[id];
      return `
        <button class="choice-card btn-pick-opp" data-opp="${id}" type="button">
          <div class="choice-title">${opp.name}</div>
          <div class="choice-sub">${opp.vibe}</div>
          <div style="font-family:var(--mono);font-size:11px;color:${actDef.accent}">SELECT OPPONENT →</div>
        </button>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="card">
        ${charterReviewBanner ? `<div class="charter-bar">${charterReviewBanner}</div>` : ''}
        <div class="card-header">
          <div>
            <span class="fac-cat">${actDef.prefix}0${runState.matchIndex + 1}</span>
            <h2>${actDef.title}</h2>
          </div>
          <span style="font-family:var(--mono);font-size:12px">MATCH ${runState.matchIndex + 1} / 9</span>
        </div>
        <div class="interstitial-box">“${lastInterstitial.text}”</div>
        <p>Select the next artist on the running order.</p>
        <div class="choice-grid">${choicesHtml}</div>
      </div>
    `;
    for (const btn of overlay.querySelectorAll('.btn-pick-opp')) {
      btn.onclick = () => {
        if (choiceLocked) return;
        choiceLocked = true;
        audio.unlockFromGesture();
        pickOpponent(runState, btn.dataset.opp);
        beginCurrentMatch();
      };
    }
  } else if (screen === 'choose_pickup' && runState) {
    const choicesHtml = runState.offeredPickups.map((id) => {
      const p = PICKUPS[id];
      const cur = id === 'extra_life' ? runState.lives : (runState.pickups[id] || 0);
      return `
        <button class="choice-card btn-pick-up" data-pickup="${id}" type="button">
          <div class="choice-title">${p.name}</div>
          <div class="choice-sub">${p.desc}</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--accent-2)">
            ${id === 'extra_life' ? `LIVES: ${cur}/${runState.maxLives}` : `OWNED: ${cur}/${p.maxStacks}`}
          </div>
        </button>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="card">
        ${charterReviewBanner ? `<div class="charter-bar">${charterReviewBanner}</div>` : ''}
        <div class="card-header">
          <div>
            <span class="fac-cat">PICKUP</span>
            <h2>Charter Review — Commission</h2>
          </div>
          <span style="font-family:var(--mono);font-size:12px">MATCH ${runState.matchIndex + 1} WON</span>
        </div>
        <div class="interstitial-box">“${lastInterstitial.text}”</div>
        <div class="choice-grid">${choicesHtml}</div>
      </div>
    `;
    for (const btn of overlay.querySelectorAll('.btn-pick-up')) {
      btn.onclick = () => {
        if (choiceLocked) return;
        choiceLocked = true;
        choosePickup(runState, btn.dataset.pickup);
        audio.playUiBeep(820, 0.07);
        if (runState.status === 'playing') {
          beginCurrentMatch();
        } else {
          screen = 'choose_opponent';
          renderOverlay();
        }
      };
    }
  } else if (screen === 'match_lost_life' && runState) {
    const opp = OPPONENTS[runState.currentOpponentId];
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Licence Lapsed</h2>
          <span class="fac-cat">-1 LIFE</span>
        </div>
        <p>Match lost to ${opp.name}. ${runState.lives} TV Licence${runState.lives === 1 ? '' : 's'} remaining. Replaying same fixture.</p>
        <div class="interstitial-box">“${lastInterstitial.text}”</div>
        <div class="btn-row">
          <button class="primary" id="btn-retry-opp" type="button">Replay ${opp.name}</button>
        </div>
      </div>
    `;
    document.getElementById('btn-retry-opp').onclick = () => beginCurrentMatch();
  } else if (screen === 'run_end' && lastRunSummary) {
    const s = lastRunSummary;
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="fac-cat">${s.won ? 'TRANSMISSION COMPLETE' : 'OFF AIR'}</span>
            <h1>${s.won ? 'You Make It What It Is' : 'Licence Revoked'}</h1>
          </div>
          <span style="font-family:var(--mono);color:var(--accent-2)">+${s.earned} FEE PTS</span>
        </div>
        <p>${s.won
          ? 'Every musical taste was catered for — only possible thanks to the unique way the BBC is paid for by you.'
          : 'No TV Licences remaining. Return to the Licence Fee Review board to strengthen future broadcasts.'}</p>
        <div class="stat-strip">
          <span>SEED: ${s.seed}</span>
          <span>MATCHES WON: ${s.matchesWon}/9</span>
          <span>POINTS: ${s.pointsScored}</span>
          <span>BOSSES: ${s.bossesBeaten}</span>
          ${s.borrowedTimeBonus ? `<span>BORROWED TIME BONUS: +${s.borrowedTimeBonus}</span>` : ''}
        </div>
        <div class="btn-row">
          <button class="primary" id="btn-run-again" type="button">New Run</button>
          <button id="btn-run-upgrades" type="button">Licence Fee Review</button>
          <button id="btn-run-title" type="button">Title Card</button>
        </div>
      </div>
    `;
    document.getElementById('btn-run-again').onclick = () => startNewRun();
    document.getElementById('btn-run-upgrades').onclick = () => {
      runState = null;
      matchState = null;
      screen = 'upgrades';
      renderOverlay();
    };
    document.getElementById('btn-run-title').onclick = () => {
      runState = null;
      matchState = null;
      screen = 'title';
      renderOverlay();
    };
  } else if (screen === 'paused') {
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Transmission Paused</h2>
          <span class="fac-cat">STAND BY</span>
        </div>
        <p>The BBC apologises for the temporary interruption to this rally.</p>
        <div class="btn-row">
          <button class="primary" id="btn-resume" type="button">Resume</button>
          <button id="btn-pause-settings" type="button">Settings &amp; Save</button>
          <button id="btn-quit-title" type="button">Abandon Run</button>
        </div>
      </div>
    `;
    document.getElementById('btn-resume').onclick = () => {
      screen = 'playing';
      renderOverlay();
      syncAudioTrack();
    };
    document.getElementById('btn-pause-settings').onclick = () => {
      prevScreenBeforeSettings = 'paused';
      resetConfirmPending = false;
      saveNotice = '';
      screen = 'settings';
      renderOverlay();
    };
    document.getElementById('btn-quit-title').onclick = () => {
      runState = null;
      matchState = null;
      screen = 'title';
      syncAudioTrack();
      renderOverlay();
    };
  } else if (screen === 'conflict' && pendingConflict) {
    const loc = pendingConflict.localSave;
    const rem = pendingConflict.remoteSave;
    const sumLvls = (u) => Object.values(u || {}).reduce((a, b) => a + b, 0);
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Cloud Save Conflict</h2>
          <span class="fac-cat">CONFLICT</span>
        </div>
        <p>Both this device and Google Drive changed since your last sync. Choose which version becomes active (neither is merged; the replaced one is kept as a backup).</p>
        <div class="conflict-grid">
          <div class="conflict-col">
            <strong>THIS DEVICE</strong><br/>
            Total Earned: ${loc.totalEarned} pts<br/>
            Upgrade Levels: ${sumLvls(loc.upgradeLevels)}<br/>
            Runs Played: ${loc.stats?.runsPlayed ?? 0}<br/>
            Updated: ${loc.updatedAt}
          </div>
          <div class="conflict-col">
            <strong>GOOGLE CLOUD SAVE</strong><br/>
            Total Earned: ${rem.totalEarned} pts<br/>
            Upgrade Levels: ${sumLvls(rem.upgradeLevels)}<br/>
            Runs Played: ${rem.stats?.runsPlayed ?? 0}<br/>
            Updated: ${rem.updatedAt}
          </div>
        </div>
        <div class="btn-row">
          <button class="primary" id="btn-use-cloud" type="button">Use cloud save (this device backed up)</button>
          <button id="btn-use-local" type="button">Use this device's save (cloud backed up)</button>
          <button id="btn-decide-later" type="button">Decide later (play locally)</button>
          <button id="btn-dl-local-bak" type="button">Download device backup</button>
          <button id="btn-dl-cloud-bak" type="button">Download cloud backup</button>
        </div>
      </div>
    `;
    document.getElementById('btn-use-cloud').onclick = async () => {
      saveDoc = await cloud.resolveUseCloud(pendingConflict);
      persistSave();
      audio.applyVolumes();
      pendingConflict = null;
      cloudNotice = 'Cloud save is now active; device save backed up.';
      screen = 'title';
      renderOverlay();
    };
    document.getElementById('btn-use-local').onclick = async () => {
      await cloud.resolveUseLocal(pendingConflict);
      pendingConflict = null;
      cloudNotice = 'Device save is now active; cloud save backed up locally.';
      screen = 'title';
      renderOverlay();
    };
    document.getElementById('btn-decide-later').onclick = () => {
      pendingConflict = null;
      cloudNotice = 'Conflict deferred; playing locally.';
      screen = 'title';
      renderOverlay();
    };
    document.getElementById('btn-dl-local-bak').onclick = () => {
      triggerDownload('pdp-device-backup.json', exportSaveJson(loc));
    };
    document.getElementById('btn-dl-cloud-bak').onclick = () => {
      triggerDownload('pdp-cloud-backup.json', exportSaveJson(rem));
    };
  } else if (screen === 'settings') {
    const st = saveDoc.settings;
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Engineering, Audio &amp; Save Data</h2>
          <span class="fac-cat">PDP CFG</span>
        </div>
        <div class="setting-row">
          <label for="set-sens">Mouse Sensitivity (<span id="val-sens">${st.mouseSensitivity.toFixed(2)}</span>)</label>
          <input id="set-sens" type="range" min="0.4" max="2.2" step="0.05" value="${st.mouseSensitivity}" />
        </div>
        <div class="setting-row">
          <label for="set-spatial">Spatial Audio</label>
          <select id="set-spatial">
            <option value="hrtf" ${st.spatialMode === 'hrtf' ? 'selected' : ''}>Headphones (HRTF)</option>
            <option value="speakers" ${st.spatialMode === 'speakers' ? 'selected' : ''}>Speakers (Stereo)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="set-qd">Quick Deuce (3rd deuce decides)</label>
          <input id="set-qd" type="checkbox" ${st.quickDeuce ? 'checked' : ''} />
        </div>
        <div class="setting-row">
          <label for="set-master">Master Volume</label>
          <input id="set-master" type="range" min="0" max="1" step="0.05" value="${st.masterVolume}" />
        </div>
        <div class="setting-row">
          <label for="set-music">Music Volume</label>
          <input id="set-music" type="range" min="0" max="1" step="0.05" value="${st.musicVolume}" />
        </div>
        <div class="setting-row">
          <label for="set-sfx">SFX Volume</label>
          <input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${st.sfxVolume}" />
        </div>
        ${renderCloudBlockHtml()}
        <div class="btn-row">
          <button id="btn-export-save" type="button">Export Save (.json)</button>
          <button id="btn-import-save" type="button">Import Save (.json)</button>
          <input id="file-import-save" type="file" accept=".json,application/json" class="hidden" />
          <button id="btn-reset-save" type="button">${resetConfirmPending ? 'Click Again to Confirm Reset' : 'Reset Progress'}</button>
          <button class="primary" id="btn-settings-back" type="button">Done</button>
        </div>
        ${saveNotice ? `<p class="note-line" style="margin-top:10px">${saveNotice}</p>` : ''}
      </div>
    `;
    wireCloudButtons();
    document.getElementById('set-sens').oninput = (e) => {
      st.mouseSensitivity = parseFloat(e.target.value);
      document.getElementById('val-sens').textContent = st.mouseSensitivity.toFixed(2);
      persistSave();
    };
    document.getElementById('set-spatial').onchange = (e) => {
      st.spatialMode = e.target.value;
      persistSave();
    };
    document.getElementById('set-qd').onchange = (e) => {
      st.quickDeuce = e.target.checked;
      persistSave();
    };
    document.getElementById('set-master').oninput = (e) => {
      st.masterVolume = parseFloat(e.target.value);
      audio.applyVolumes();
      persistSave();
    };
    document.getElementById('set-music').oninput = (e) => {
      st.musicVolume = parseFloat(e.target.value);
      audio.applyVolumes();
      persistSave();
    };
    document.getElementById('set-sfx').oninput = (e) => {
      st.sfxVolume = parseFloat(e.target.value);
      audio.applyVolumes();
      persistSave();
    };
    document.getElementById('btn-export-save').onclick = () => {
      triggerDownload('perfect-day-pong-save.json', exportSaveJson(saveDoc));
      saveNotice = 'Exported save file.';
      renderOverlay();
    };
    const fileInput = document.getElementById('file-import-save');
    document.getElementById('btn-import-save').onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 256 * 1024) {
        saveNotice = 'Import rejected: file exceeds 256 KB limit.';
        renderOverlay();
        return;
      }
      const txt = await f.text();
      const res = validateImportedText(txt, saveDoc);
      if (!res.ok || !res.save) {
        saveNotice = `Import rejected: ${res.reason}. Existing save unchanged.`;
        renderOverlay();
        return;
      }
      saveDoc = res.save;
      persistSave();
      audio.applyVolumes();
      saveNotice = 'Save imported (previous save backed up).';
      renderOverlay();
    };
    document.getElementById('btn-reset-save').onclick = () => {
      if (!resetConfirmPending) {
        resetConfirmPending = true;
        saveNotice = 'Click Reset Progress a second time to confirm (a backup will be kept).';
        renderOverlay();
      } else {
        resetConfirmPending = false;
        saveDoc = resetProgress(saveDoc);
        saveNotice = 'Progress reset (previous save backed up locally).';
        renderOverlay();
      }
    };
    document.getElementById('btn-settings-back').onclick = () => {
      resetConfirmPending = false;
      screen = prevScreenBeforeSettings;
      renderOverlay();
    };
  }
  syncOverlayFocus();
}

input.on('gesture', () => { audio.unlockFromGesture(); });
input.on('mute', () => {
  audio.toggleMute();
  updateHud();
});
input.on('pause', () => {
  if (screen === 'playing') {
    screen = 'paused';
    input.exitPointerLock();
    syncAudioTrack();
    renderOverlay();
  } else if (screen === 'paused') {
    screen = 'playing';
    syncAudioTrack();
    renderOverlay();
  } else if (screen === 'settings') {
    screen = prevScreenBeforeSettings;
    renderOverlay();
  }
});
input.on('padDisconnect', () => {
  if (screen === 'playing') {
    screen = 'paused';
    syncAudioTrack();
    renderOverlay();
  }
});
function releaseStickyBall(m) {
  m.stickyTimer = 0;
  m.ball.vx += m.playerPaddle.vx * 0.4;
  m.ball.vy += m.playerPaddle.vy * 0.3;
}

input.on('nav', (dir) => {
  if (screen !== 'playing') {
    moveOverlayFocus(dir);
  }
});
input.on('back', () => {
  if (screen === 'settings') {
    resetConfirmPending = false;
    screen = prevScreenBeforeSettings;
    renderOverlay();
  } else if (screen === 'upgrades') {
    screen = 'title';
    renderOverlay();
  } else if (screen === 'paused') {
    screen = 'playing';
    syncAudioTrack();
    renderOverlay();
  }
});
input.on('confirm', () => {
  if (screen !== 'playing') {
    // Only trigger via keyboard/gamepad confirm; mouse clicks already fire button onclick directly
    if (input.getLastInputMethod() !== 'mouse') {
      activateOverlayFocus();
    }
    return;
  }
  if (matchState) {
    if (matchState.stickyTimer > 0) {
      releaseStickyBall(matchState);
    } else if (matchState.phase === 'awaiting_serve') {
      launchServe();
    }
    if (input.getLastInputMethod() === 'mouse') {
      input.requestPointerLock();
    }
  }
});
input.on('ability', () => useTempoControl());

btnMute.onclick = () => {
  audio.unlockFromGesture();
  audio.toggleMute();
  updateHud();
};
btnSettings.onclick = () => {
  if (screen !== 'settings') {
    prevScreenBeforeSettings = screen;
    resetConfirmPending = false;
    saveNotice = '';
    screen = 'settings';
    input.exitPointerLock();
    syncAudioTrack();
    renderOverlay();
  }
};
btnPause.onclick = () => {
  if (screen === 'playing') {
    screen = 'paused';
    input.exitPointerLock();
    syncAudioTrack();
    renderOverlay();
  } else if (screen === 'paused') {
    screen = 'playing';
    syncAudioTrack();
    renderOverlay();
  }
};

window.addEventListener('resize', () => renderer.resize());

const FIXED_DT = 1 / 120;
let accumulator = 0;
let lastTime = performance.now();

function stepFixed(dt, inp) {
  const m = matchState;
  if (!m) return;
  m.elapsed += dt;

  const pad = m.playerPaddle;
  pad.prevX = pad.x;
  pad.prevY = pad.y;
  const maxX = ROOM.halfW - pad.width * 0.5;
  const maxY = ROOM.halfH - pad.height * 0.5;

  if (inp.mode === 'absolute') {
    const tx = inp.targetNormX * maxX;
    const ty = inp.targetNormY * maxY;
    const alpha = 1 - Math.exp(-36 * dt);
    pad.x += (tx - pad.x) * alpha;
    pad.y += (ty - pad.y) * alpha;
  } else {
    const moveSpeed = 10.5 * m.playerSpeedMult;
    pad.x += inp.velX * moveSpeed * dt;
    pad.y += inp.velY * moveSpeed * dt;
    clampPaddle(pad, ROOM);
    input.setVirtualCursor(pad.x / Math.max(0.1, maxX), pad.y / Math.max(0.1, maxY));
  }
  clampPaddle(pad, ROOM);
  pad.vx = (pad.x - pad.prevX) / dt;
  pad.vy = (pad.y - pad.prevY) / dt;

  if (m.oppDef.id === 'heather_small') {
    const fatigue = Math.max(0.75, 1 - m.score.pointNumber * 0.035);
    m.ai.maxSpeed = m.oppDef.maxSpeed * fatigue;
  }
  if (m.oppDef.id === 'david_bowie' && !m.bowieGravityShifted && m.score.pointNumber >= 3) {
    m.bowieGravityShifted = true;
    m.gravityY = -2.35;
    m.announcer = 'Bowie shifts room gravity slightly.';
  }
  if (m.oppDef.id === 'lou_reed') {
    const lp = getLouReedPhase(m.score);
    m.isWarmPhase = lp.warm;
    if (lp.phase === 1) {
      m.ai.maxSpeed = 6.2;
      m.ai.predictionError = 0.56;
    } else if (lp.phase === 2) {
      m.ai.maxSpeed = 6.9;
      m.ai.predictionError = 0.48;
      if (m.ball.vz < 0) {
        m.ai.targetX = Math.sin(m.elapsed * 2.1) * 2.2;
      }
    } else {
      m.ai.maxSpeed = 7.3;
      m.ai.predictionError = 0.43;
      if (Math.random() < dt * 4) {
        spawnParticles((Math.random() - 0.5) * 7, 2.3, 2 + Math.random() * 12, '#f5c7a3', 1);
      }
    }
    syncAudioTrack();
  }

  stepAI(m.ai, m.opponentPaddle, m.ball, dt, m.rng, ROOM);
  m.opponentBoxes = computeOpponentFormation(m);

  if (m.oppDef.style === 'bono') {
    m.bonoDecoy = { x: -m.ball.x * 0.8, z: m.ball.z };
  }

  if (m.stickyTimer > 0) {
    m.stickyTimer -= dt;
    m.ball.x = pad.x;
    m.ball.y = pad.y;
    m.ball.z = 0.32;
    if (m.stickyTimer <= 0) {
      releaseStickyBall(m);
    }
    return;
  }

  if (m.phase === 'awaiting_serve') {
    if (m.score.server === 'opponent') {
      m.serveAutoTimer -= dt;
      if (m.serveAutoTimer <= 0) {
        launchServe();
      }
    }
  } else if (m.phase === 'point_pause') {
    m.phaseTimer -= dt;
    if (m.phaseTimer <= 0) {
      if (m.score.winner) {
        m.phase = 'done';
        input.exitPointerLock();
        syncAudioTrack();
        finishMatch(m.score.winner === 'player');
      } else {
        m.phase = 'awaiting_serve';
        m.serveAutoTimer = 0.85;
        m.ball = createBall({ x: 0, y: 0.2, z: m.score.server === 'player' ? 0.8 : ROOM.opponentZ - 0.8, vz: 0 });
        m.announcer = m.score.server === 'player'
          ? 'Your serve. Click or press A / Space.'
          : `${m.oppDef.name} serving...`;
      }
    }
  } else if (m.phase === 'rally') {
    if (m.oppDef.id === 'huey_morgan' && m.ball.vz < 0 && m.ball.z < 8.5 && !m.hueyShiftedThisFlight) {
      m.hueyShiftedThisFlight = true;
      m.ball.vz *= m.rng() < 0.5 ? 0.84 : 1.16;
    }

    const tempo = getTempoByIndex(m.tempoIndex);
    const playerServeTolerance = m.rallyHits === 0 && m.serveReturnBoostLeft
      ? 1 + (saveDoc.upgradeLevels.serveWindow || 0) * 0.06
      : 1.0;

    const effPaddle = playerServeTolerance > 1
      ? { ...m.playerPaddle, width: m.playerPaddle.width * playerServeTolerance, height: m.playerPaddle.height * playerServeTolerance }
      : m.playerPaddle;

    const { events, scoredBy } = stepBallPhysics(m.ball, effPaddle, m.opponentPaddle, dt, {
      gravityY: m.gravityY,
      spinMultiplier: m.spinMultiplier,
      maxZSpeed: 28 * tempo.speedScale,
      minZSpeed: 9.5 * tempo.speedScale,
      opponentBoxes: m.opponentBoxes,
      opponentSpinBias: m.oppDef.spinBias || 0,
      opponentReturnSpeedScale: m.oppDef.returnSpeedScale || 1.0,
    });

    for (const ev of events) {
      audio.playImpact(ev);
      if (ev.type === 'paddle') {
        m.rallyHits += 1;
        m.hueyShiftedThisFlight = false;
        if (ev.side === 'player' && m.stickyEnabled && m.rallyHits > 1) {
          m.stickyTimer = 0.28;
        }
        m.flashes.push({
          x: ev.x, y: ev.y, z: ev.z,
          radius: 0.9,
          alpha: 0.95,
          color: ev.side === 'player' ? '#f4f2eb' : m.actDef.accent,
        });
        m.shake.mag = Math.min(0.14, m.shake.mag + 0.05);
        spawnParticles(ev.x, ev.y, ev.z, ev.side === 'player' ? '#f4f2eb' : m.actDef.accent, 12);

        if (m.rallyHits % 7 === 0 && m.tempoIndex < TEMPOS.length - 1) {
          m.tempoIndex += 1;
          syncAudioTrack();
        }
      } else if (ev.type === 'wall') {
        spawnParticles(ev.x, ev.y, ev.z, '#d4a84f', 5);
      } else if (ev.type === 'miss') {
        m.shake.mag = 0.16;
        spawnParticles(ev.x, ev.y, ev.z, '#e0533c', 18);
      }
    }

    if (scoredBy) {
      if (scoredBy === 'opponent' && m.secondChanceLeft > 0) {
        m.secondChanceLeft -= 1;
        m.announcer = 'Second Chance! Point replayed.';
        m.phase = 'awaiting_serve';
        m.serveAutoTimer = 0.85;
        m.ball = createBall({ x: 0, y: 0.2, z: m.score.server === 'player' ? 0.8 : ROOM.opponentZ - 0.8, vz: 0 });
      } else {
        m.score = scorePoint(m.score, scoredBy);
        const fmt = formatTennisScore(m.score);
        m.announcer = fmt.announcerText;
        m.phase = 'point_pause';
        m.phaseTimer = 1.0;
        m.tempoIndex = Math.min(TEMPOS.length - 1, (m.oppDef.act === 3 ? 2 : 1) + Math.floor(m.score.deuceCount / 2));
        syncAudioTrack();
      }
    }
  }

  for (let i = m.flashes.length - 1; i >= 0; i--) {
    m.flashes[i].alpha -= dt * 2.4;
    m.flashes[i].radius += dt * 2.2;
    if (m.flashes[i].alpha <= 0) m.flashes.splice(i, 1);
  }
  for (let i = m.particles.length - 1; i >= 0; i--) {
    const p = m.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.life -= dt * 2.2;
    if (p.life <= 0) m.particles.splice(i, 1);
  }
  if (m.phase === 'rally') {
    m.ballTrail.push({ x: m.ball.x, y: m.ball.y, z: m.ball.z });
    if (m.ballTrail.length > 10) m.ballTrail.shift();
  }
  if (m.shake.mag > 0.001) {
    m.shake.x = (Math.random() - 0.5) * m.shake.mag;
    m.shake.y = (Math.random() - 0.5) * m.shake.mag;
    m.shake.mag *= Math.exp(-14 * dt);
  } else {
    m.shake.x = 0;
    m.shake.y = 0;
    m.shake.mag = 0;
  }
}

function frame(now) {
  const rawDt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  const clampedDt = Math.min(rawDt, 0.05);

  const inp = input.update(clampedDt);
  padHint.textContent = inp.padConnected
    ? `PAD: CONNECTED (${inp.padId.slice(0, 22)})`
    : 'PAD: NOT DETECTED';

  if (screen === 'playing' && matchState) {
    accumulator += clampedDt;
    while (accumulator >= FIXED_DT) {
      stepFixed(FIXED_DT, inp);
      accumulator -= FIXED_DT;
    }
    audio.updateBallVoice(matchState.ball, matchState.phase === 'rally');
    renderer.renderMatch(matchState);
  } else {
    audio.updateBallVoice({ x: 0, y: 0, z: 8, vx: 0, vy: 0, vz: 0 }, false);
    renderer.renderMatch(
      matchState || {
        ball: createBall({ x: Math.sin(now * 0.001) * 1.5, y: 0.3, z: 8 + Math.cos(now * 0.001) * 4 }),
        playerPaddle: createPaddle(),
        opponentPaddle: createPaddle(),
      }
    );
  }

  updateHud();
  requestAnimationFrame(frame);
}

renderOverlay();
requestAnimationFrame(frame);
