import {
  ROOM,
  TEMPOS,
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
} from './logic.js';
import { createInputManager } from './input.js';
import { createAudioEngine } from './audio.js';
import { createRenderer } from './renderer.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('screen-overlay');
const scorePlayerEl = document.getElementById('score-player');
const scoreOppEl = document.getElementById('score-opp');
const oppNameHud = document.getElementById('opp-name-hud');
const tempoHud = document.getElementById('tempo-hud');
const announcerHud = document.getElementById('announcer-hud');
const statusHud = document.getElementById('status-hud');
const abilityHud = document.getElementById('ability-hud');
const controlsHint = document.getElementById('controls-hint');
const padHint = document.getElementById('pad-hint');
const audioStatusEl = document.getElementById('audio-status');
const btnMute = document.getElementById('btn-mute');
const btnSettings = document.getElementById('btn-settings');
const btnPause = document.getElementById('btn-pause');

const settings = {
  mouseSensitivity: 1.0,
  quickDeuce: false,
  spatialMode: 'hrtf',
  masterVolume: 0.8,
  musicVolume: 0.42,
  sfxVolume: 0.88,
};

const renderer = createRenderer(canvas);
const input = createInputManager(canvas, () => settings);
const audio = createAudioEngine(() => settings);

let screen = 'title'; // 'title' | 'playing' | 'paused' | 'settings' | 'match_over'
let prevScreenBeforeSettings = 'title';
let matchState = null;

function createSingleMatch(seedStr = 'PDP-001') {
  const rng = mulberry32(hashSeed(seedStr));
  return {
    rng,
    score: createMatchScore({ quickDeuce: settings.quickDeuce, firstServer: 'player' }),
    playerPaddle: createPaddle({ width: 1.6, height: 1.15 }),
    opponentPaddle: createPaddle({ width: 1.6, height: 1.15 }),
    ai: createAIState({
      reactionDelayMs: 175,
      maxSpeed: 6.4,
      predictionError: 0.58,
      missChance: 0.08,
    }),
    ball: createBall({ x: 0, y: 0.25, z: 0.9, vx: 0, vy: 0, vz: 0 }),
    phase: 'awaiting_serve', // 'awaiting_serve' | 'rally' | 'point_pause' | 'done'
    phaseTimer: 0,
    serveAutoTimer: 1.1,
    tempoIndex: 1, // starts at ANDANTE
    tempoCharges: 3,
    rallyHits: 0,
    flashes: [],
    particles: [],
    ballTrail: [],
    shake: { x: 0, y: 0, mag: 0 },
    announcer: 'Viewer to serve. Click or press A / Space.',
  };
}

function startMatch() {
  matchState = createSingleMatch(String(Date.now()));
  screen = 'playing';
  overlay.classList.add('hidden');
  audio.resetRally();
  syncAudioTrack();
  renderOverlay();
}

function launchServe() {
  if (!matchState || matchState.phase !== 'awaiting_serve') return;
  const m = matchState;
  const isPlayerServe = m.score.server === 'player';
  const deuceBoost = 1 + m.score.deuceCount * 0.06;
  const tempo = getTempoByIndex(m.tempoIndex);
  const baseZ = 12.2 * tempo.speedScale * deuceBoost;

  m.rallyHits = 0;
  m.ballTrail = [];
  if (isPlayerServe) {
    m.ball = createBall({
      x: m.playerPaddle.x * 0.5,
      y: Math.max(-1.2, Math.min(1.2, m.playerPaddle.y * 0.5 + 0.2)),
      z: 0.55,
      vx: (m.rng() - 0.5) * 3.8,
      vy: 1.2 + (m.rng() - 0.5) * 1.4,
      vz: baseZ,
    });
  } else {
    m.ball = createBall({
      x: m.opponentPaddle.x * 0.5,
      y: 0.35,
      z: ROOM.opponentZ - 0.55,
      vx: (m.rng() - 0.5) * 4.2,
      vy: 1.2 + (m.rng() - 0.5) * 1.4,
      vz: -baseZ,
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
  audio.setMatchState({
    playing: screen === 'playing' && m.phase !== 'done',
    bpm: tempo.bpm,
    intensity,
    deuce: fmt.isDeuce,
    root: 45,
  });
}

function useTempoControl() {
  if (!matchState || screen !== 'playing') return;
  const m = matchState;
  if (m.phase !== 'rally' || m.tempoCharges <= 0 || m.tempoIndex <= 0) return;
  m.tempoCharges -= 1;
  m.tempoIndex -= 1;
  // Scale active ball velocity down one tempo step
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
      x,
      y,
      z,
      vx: (Math.random() - 0.5) * 5.5,
      vy: (Math.random() - 0.5) * 5.5,
      vz: (Math.random() - 0.5) * 4.0,
      size: 0.09 + Math.random() * 0.08,
      life: 1.0,
      color,
    });
  }
}

function updateHud() {
  audioStatusEl.textContent = audio.isMuted()
    ? 'Sound: MUTED'
    : audio.isRunning()
      ? 'Sound: ON'
      : 'Sound: Click / Press Key';

  if (!matchState) return;
  const m = matchState;
  const fmt = formatTennisScore(m.score);
  scorePlayerEl.textContent = fmt.playerLabel || '-';
  scoreOppEl.textContent = fmt.opponentLabel || '-';
  oppNameHud.innerHTML = `TEST SIGNAL ${m.score.server === 'opponent' ? '<span id="srv-opp">*</span>' : ''}`;
  document.getElementById('srv-player').textContent = m.score.server === 'player' ? '*' : '';
  statusHud.textContent = fmt.statusText;
  const tempo = getTempoByIndex(m.tempoIndex);
  tempoHud.textContent = `${tempo.label} // ${tempo.bpm} BPM`;
  announcerHud.textContent = m.announcer;
  abilityHud.textContent = String(m.tempoCharges);

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

function renderOverlay() {
  if (screen === 'playing') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');

  if (screen === 'title') {
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <span class="fac-cat">PDP 001</span>
            <h1>Perfect Day Pong</h1>
          </div>
          <span style="font-family:var(--mono);font-size:12px;color:var(--muted)">ROOM TEN // BBC CONTINUITY</span>
        </div>
        <p>First-person 3D tennis-scored Pong in a low-gravity wireframe room. Step 1 playable transmission.</p>
        <p class="note-line">Pair Bluetooth controllers in Windows first, then press any button so the browser detects it.</p>
        <p class="note-line">Headphones recommended for true 3D HRTF spatial ball &amp; impact cues.</p>
        <div class="btn-row">
          <button class="primary" id="btn-start-match" type="button">Start Match (Enter / A)</button>
          <button id="btn-open-settings" type="button">Settings</button>
        </div>
      </div>
    `;
    document.getElementById('btn-start-match').onclick = async () => {
      await audio.unlockFromGesture();
      startMatch();
    };
    document.getElementById('btn-open-settings').onclick = () => {
      prevScreenBeforeSettings = 'title';
      screen = 'settings';
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
          <button id="btn-restart" type="button">Restart Match</button>
          <button id="btn-pause-settings" type="button">Settings</button>
          <button id="btn-quit-title" type="button">Title Card</button>
        </div>
      </div>
    `;
    document.getElementById('btn-resume').onclick = () => {
      screen = 'playing';
      renderOverlay();
      syncAudioTrack();
    };
    document.getElementById('btn-restart').onclick = () => startMatch();
    document.getElementById('btn-pause-settings').onclick = () => {
      prevScreenBeforeSettings = 'paused';
      screen = 'settings';
      renderOverlay();
    };
    document.getElementById('btn-quit-title').onclick = () => {
      matchState = null;
      screen = 'title';
      syncAudioTrack();
      renderOverlay();
    };
  } else if (screen === 'match_over' && matchState) {
    const won = matchState.score.winner === 'player';
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>${won ? 'Game Viewer' : 'Licence Lapsed'}</h2>
          <span class="fac-cat">${won ? 'WIN' : 'LOSS'}</span>
        </div>
        <p>${won ? 'You make it what it is. Clean match victory.' : 'The broadcast continues without you.'}</p>
        <div class="btn-row">
          <button class="primary" id="btn-play-again" type="button">Play Again (Enter / A)</button>
          <button id="btn-back-title" type="button">Title Card</button>
        </div>
      </div>
    `;
    document.getElementById('btn-play-again').onclick = () => startMatch();
    document.getElementById('btn-back-title').onclick = () => {
      matchState = null;
      screen = 'title';
      syncAudioTrack();
      renderOverlay();
    };
  } else if (screen === 'settings') {
    overlay.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2>Engineering &amp; Audio Settings</h2>
          <span class="fac-cat">PDP CFG</span>
        </div>
        <div class="setting-row">
          <label for="set-sens">Mouse Sensitivity (<span id="val-sens">${settings.mouseSensitivity.toFixed(2)}</span>)</label>
          <input id="set-sens" type="range" min="0.4" max="2.2" step="0.05" value="${settings.mouseSensitivity}" />
        </div>
        <div class="setting-row">
          <label for="set-spatial">Spatial Audio</label>
          <select id="set-spatial">
            <option value="hrtf" ${settings.spatialMode === 'hrtf' ? 'selected' : ''}>Headphones (HRTF)</option>
            <option value="speakers" ${settings.spatialMode === 'speakers' ? 'selected' : ''}>Speakers (Stereo)</option>
          </select>
        </div>
        <div class="setting-row">
          <label for="set-qd">Quick Deuce (3rd deuce decides)</label>
          <input id="set-qd" type="checkbox" ${settings.quickDeuce ? 'checked' : ''} />
        </div>
        <div class="setting-row">
          <label for="set-master">Master Volume</label>
          <input id="set-master" type="range" min="0" max="1" step="0.05" value="${settings.masterVolume}" />
        </div>
        <div class="setting-row">
          <label for="set-music">Music Volume</label>
          <input id="set-music" type="range" min="0" max="1" step="0.05" value="${settings.musicVolume}" />
        </div>
        <div class="setting-row">
          <label for="set-sfx">SFX Volume</label>
          <input id="set-sfx" type="range" min="0" max="1" step="0.05" value="${settings.sfxVolume}" />
        </div>
        <div class="btn-row">
          <button class="primary" id="btn-settings-back" type="button">Done</button>
        </div>
      </div>
    `;
    document.getElementById('set-sens').oninput = (e) => {
      settings.mouseSensitivity = parseFloat(e.target.value);
      document.getElementById('val-sens').textContent = settings.mouseSensitivity.toFixed(2);
    };
    document.getElementById('set-spatial').onchange = (e) => {
      settings.spatialMode = e.target.value;
    };
    document.getElementById('set-qd').onchange = (e) => {
      settings.quickDeuce = e.target.checked;
    };
    document.getElementById('set-master').oninput = (e) => {
      settings.masterVolume = parseFloat(e.target.value);
      audio.applyVolumes();
    };
    document.getElementById('set-music').oninput = (e) => {
      settings.musicVolume = parseFloat(e.target.value);
      audio.applyVolumes();
    };
    document.getElementById('set-sfx').oninput = (e) => {
      settings.sfxVolume = parseFloat(e.target.value);
      audio.applyVolumes();
    };
    document.getElementById('btn-settings-back').onclick = () => {
      screen = prevScreenBeforeSettings;
      renderOverlay();
    };
  }
}

// Wire topbar buttons and input events
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
input.on('confirm', () => {
  if (screen === 'title') {
    startMatch();
  } else if (screen === 'match_over') {
    startMatch();
  } else if (screen === 'playing' && matchState) {
    if (matchState.phase === 'awaiting_serve') {
      launchServe();
    }
    if (input.getLastInputMethod() === 'mouse') {
      input.requestPointerLock();
    }
  }
});
input.on('ability', () => useTempoControl());

btnMute.onclick = async () => {
  await audio.unlockFromGesture();
  audio.toggleMute();
  updateHud();
};
btnSettings.onclick = () => {
  if (screen !== 'settings') {
    prevScreenBeforeSettings = screen;
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

// Fixed-timestep loop
const FIXED_DT = 1 / 120;
let accumulator = 0;
let lastTime = performance.now();

function stepFixed(dt, inp) {
  const m = matchState;
  if (!m) return;

  // Player bat control
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
    const moveSpeed = 10.5;
    pad.x += inp.velX * moveSpeed * dt;
    pad.y += inp.velY * moveSpeed * dt;
    clampPaddle(pad, ROOM);
    input.setVirtualCursor(pad.x / Math.max(0.1, maxX), pad.y / Math.max(0.1, maxY));
  }
  clampPaddle(pad, ROOM);
  pad.vx = (pad.x - pad.prevX) / dt;
  pad.vy = (pad.y - pad.prevY) / dt;

  // AI opponent
  stepAI(m.ai, m.opponentPaddle, m.ball, dt, m.rng, ROOM);

  // Timers & state
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
        screen = 'match_over';
        input.exitPointerLock();
        syncAudioTrack();
        renderOverlay();
      } else {
        m.phase = 'awaiting_serve';
        m.serveAutoTimer = 0.85;
        m.ball = createBall({ x: 0, y: 0.2, z: m.score.server === 'player' ? 0.8 : ROOM.opponentZ - 0.8, vz: 0 });
        m.announcer = m.score.server === 'player'
          ? 'Your serve. Click or press A / Space.'
          : 'Opponent serving...';
      }
    }
  } else if (m.phase === 'rally') {
    const tempo = getTempoByIndex(m.tempoIndex);
    const { events, scoredBy } = stepBallPhysics(m.ball, m.playerPaddle, m.opponentPaddle, dt, {
      speedMultiplier: 1.0,
      maxZSpeed: 28 * tempo.speedScale,
      minZSpeed: 9.5 * tempo.speedScale,
    });

    for (const ev of events) {
      audio.playImpact(ev);
      if (ev.type === 'paddle') {
        m.rallyHits += 1;
        m.flashes.push({
          x: ev.x,
          y: ev.y,
          z: ev.z,
          radius: 0.9,
          alpha: 0.95,
          color: ev.side === 'player' ? '#f4f2eb' : '#e0533c',
        });
        m.shake.mag = Math.min(0.14, m.shake.mag + 0.05);
        spawnParticles(ev.x, ev.y, ev.z, ev.side === 'player' ? '#f4f2eb' : '#e0533c', 12);

        // Gradually climb tempo on long rallies
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
      m.score = scorePoint(m.score, scoredBy);
      const fmt = formatTennisScore(m.score);
      m.announcer = fmt.announcerText;
      m.phase = 'point_pause';
      m.phaseTimer = 1.0;
      m.tempoIndex = Math.min(TEMPOS.length - 1, 1 + Math.floor(m.score.deuceCount / 2));
      syncAudioTrack();
    }
  }

  // Update visual FX
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
