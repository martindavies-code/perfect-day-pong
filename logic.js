/**
 * Pure game logic for Perfect Day Pong.
 * Runs in both browser (ES module) and Node.js tests with zero dependencies.
 */

// ============================================================================
// 1. SEEDED RNG
// ============================================================================

export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input) {
  const str = String(input ?? Date.now());
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

// ============================================================================
// 2. TENNIS SCORING STATE MACHINE
// ============================================================================

const POINT_LABELS = ['0', '15', '30', '40'];

export function createMatchScore({ quickDeuce = false, firstServer = 'player' } = {}) {
  const normalizedServer = firstServer === 'opponent' ? 'opponent' : 'player';
  return {
    playerPoints: 0,
    opponentPoints: 0,
    quickDeuce: Boolean(quickDeuce),
    firstServer: normalizedServer,
    server: normalizedServer,
    pointNumber: 0,
    deuceCount: 0,
    winner: null,
    lastScorer: null,
  };
}

export function isMatchWon(playerPoints, opponentPoints, quickDeuce = false) {
  if (playerPoints >= 4 || opponentPoints >= 4) {
    const diff = Math.abs(playerPoints - opponentPoints);
    if (diff >= 2) {
      return playerPoints > opponentPoints ? 'player' : 'opponent';
    }
    if (quickDeuce && Math.min(playerPoints, opponentPoints) >= 5 && diff >= 1) {
      return playerPoints > opponentPoints ? 'player' : 'opponent';
    }
  }
  return null;
}

export function getDeuceCount(playerPoints, opponentPoints) {
  if (playerPoints >= 3 && opponentPoints >= 3 && playerPoints === opponentPoints) {
    return playerPoints - 2;
  }
  return Math.max(0, Math.min(playerPoints, opponentPoints) - 2);
}

export function scorePoint(state, scorer) {
  if (scorer !== 'player' && scorer !== 'opponent') {
    throw new Error(`Invalid scorer: ${scorer}`);
  }
  if (state.winner) {
    return state;
  }

  const playerPoints = state.playerPoints + (scorer === 'player' ? 1 : 0);
  const opponentPoints = state.opponentPoints + (scorer === 'opponent' ? 1 : 0);
  const pointNumber = state.pointNumber + 1;
  const winner = isMatchWon(playerPoints, opponentPoints, state.quickDeuce);
  const deuceCount = getDeuceCount(playerPoints, opponentPoints);
  const otherServer = state.firstServer === 'player' ? 'opponent' : 'player';
  const server = pointNumber % 2 === 0 ? state.firstServer : otherServer;

  return {
    ...state,
    playerPoints,
    opponentPoints,
    pointNumber,
    deuceCount,
    winner,
    lastScorer: scorer,
    server: winner ? state.server : server,
  };
}

export function formatTennisScore(state) {
  const { playerPoints, opponentPoints, quickDeuce, winner, deuceCount } = state;

  if (winner) {
    return {
      playerLabel: winner === 'player' ? 'GAME' : '',
      opponentLabel: winner === 'opponent' ? 'GAME' : '',
      statusText: winner === 'player' ? 'GAME PLAYER' : 'GAME OPPONENT',
      announcerText: winner === 'player' ? 'Game.' : 'Game to opponent.',
      isDeuce: false,
      isAdvantage: false,
      isDecidingPoint: false,
      deuceCount,
      winner,
    };
  }

  if (playerPoints >= 3 && opponentPoints >= 3) {
    if (playerPoints === opponentPoints) {
      const isDecidingPoint = quickDeuce && deuceCount >= 3;
      return {
        playerLabel: '40',
        opponentLabel: '40',
        statusText: isDecidingPoint ? 'DECIDING POINT' : 'DEUCE',
        announcerText: isDecidingPoint ? 'Deuce. Deciding point.' : 'Deuce.',
        isDeuce: true,
        isAdvantage: false,
        isDecidingPoint,
        deuceCount,
        winner: null,
      };
    }
    const advPlayer = playerPoints > opponentPoints;
    return {
      playerLabel: advPlayer ? 'AD' : '40',
      opponentLabel: advPlayer ? '40' : 'AD',
      statusText: advPlayer ? 'ADVANTAGE PLAYER' : 'ADVANTAGE OPPONENT',
      announcerText: advPlayer ? 'Advantage, viewer.' : 'Advantage, broadcast.',
      isDeuce: false,
      isAdvantage: true,
      isDecidingPoint: false,
      deuceCount,
      winner: null,
    };
  }

  const pLabel = POINT_LABELS[playerPoints] ?? '40';
  const oLabel = POINT_LABELS[opponentPoints] ?? '40';
  const word = (l) => (l === '0' ? 'Love' : l);
  const announcerText =
    pLabel === oLabel
      ? pLabel === '0'
        ? 'Love all.'
        : `${word(pLabel)} all.`
      : `${word(pLabel)}. ${word(oLabel)}.`;

  return {
    playerLabel: pLabel,
    opponentLabel: oLabel,
    statusText: `${pLabel} - ${oLabel}`,
    announcerText,
    isDeuce: false,
    isAdvantage: false,
    isDecidingPoint: false,
    deuceCount,
    winner: null,
  };
}

// ============================================================================
// 3. 3D ROOM, TEMPOS & PHYSICS (1 unit = 1 metre)
// ============================================================================

export const ROOM = {
  width: 8.0,
  height: 5.0,
  depth: 16.0,
  halfW: 4.0,
  halfH: 2.5,
  playerZ: 0.0,
  opponentZ: 16.0,
  cameraZ: -3.4,
  ballRadius: 0.24,
  defaultGravityY: -1.6,
};

export const TEMPOS = [
  { id: 'adagio', label: 'ADAGIO', speedScale: 0.84, bpm: 120 },
  { id: 'andante', label: 'ANDANTE', speedScale: 1.0, bpm: 124 },
  { id: 'allegro', label: 'ALLEGRO', speedScale: 1.18, bpm: 127 },
  { id: 'vivace', label: 'VIVACE', speedScale: 1.38, bpm: 130 },
];

export function getTempoByIndex(idx) {
  const clamped = Math.max(0, Math.min(TEMPOS.length - 1, idx | 0));
  return TEMPOS[clamped];
}

export function createPaddle({
  x = 0,
  y = 0,
  width = 1.55,
  height = 1.1,
} = {}) {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    width,
    height,
  };
}

export function clampPaddle(paddle, room = ROOM) {
  const maxX = Math.max(0.2, room.halfW - paddle.width * 0.5);
  const maxY = Math.max(0.2, room.halfH - paddle.height * 0.5);
  paddle.x = Math.max(-maxX, Math.min(maxX, paddle.x));
  paddle.y = Math.max(-maxY, Math.min(maxY, paddle.y));
  return paddle;
}

export function createBall({
  x = 0,
  y = 0.2,
  z = 1.2,
  vx = 0,
  vy = 0,
  vz = 11.5,
  spinX = 0,
  spinY = 0,
  radius = ROOM.ballRadius,
} = {}) {
  return {
    x,
    y,
    z,
    vx,
    vy,
    vz,
    spinX,
    spinY,
    radius,
  };
}

export function checkPaddleHit(paddle, hitX, hitY, ballRadius, hitBoxes = null) {
  const boxes = hitBoxes && hitBoxes.length > 0
    ? hitBoxes
    : [{ x: paddle.x, y: paddle.y, width: paddle.width, height: paddle.height }];

  for (const box of boxes) {
    const hw = box.width * 0.5 + ballRadius * 0.85;
    const hh = box.height * 0.5 + ballRadius * 0.85;
    if (Math.abs(hitX - box.x) <= hw && Math.abs(hitY - box.y) <= hh) {
      return {
        hit: true,
        box,
        normX: (hitX - box.x) / Math.max(0.1, box.width * 0.5),
        normY: (hitY - box.y) / Math.max(0.1, box.height * 0.5),
      };
    }
  }
  return { hit: false, box: null, normX: 0, normY: 0 };
}

/**
 * Advances 3D ball physics by dt seconds using swept plane checks at z=0 and z=room.depth.
 * Returns { events: Array, scoredBy: 'player'|'opponent'|null }.
 */
export function stepBallPhysics(ball, playerPaddle, opponentPaddle, dt, options = {}) {
  const room = options.room || ROOM;
  const gravityY = options.gravityY ?? room.defaultGravityY;
  const spinAccelFactor = options.spinAccelFactor ?? 4.8;
  const spinMultiplier = options.spinMultiplier ?? 1.0;
  const speedMultiplier = options.speedMultiplier ?? 1.0;
  const maxZSpeed = options.maxZSpeed ?? 30.0;
  const minZSpeed = options.minZSpeed ?? 9.0;
  const playerBoxes = options.playerBoxes || null;
  const opponentBoxes = options.opponentBoxes || null;

  const events = [];
  let scoredBy = null;

  const prevX = ball.x;
  const prevY = ball.y;
  const prevZ = ball.z;

  // Magnus-style curve from spin + gentle Room Ten low gravity
  ball.vx += ball.spinX * spinAccelFactor * dt;
  ball.vy += (gravityY + ball.spinY * spinAccelFactor) * dt;

  // Slight air damping on spin so extreme curves stay readable
  const spinDecay = Math.exp(-0.35 * dt);
  ball.spinX *= spinDecay;
  ball.spinY *= spinDecay;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  // Wall bounces (left/right)
  const limitX = room.halfW - ball.radius;
  if (ball.x < -limitX) {
    ball.x = -limitX - (ball.x + limitX);
    ball.vx = Math.abs(ball.vx);
    events.push({ type: 'wall', surface: 'left', x: -room.halfW, y: ball.y, z: ball.z });
  } else if (ball.x > limitX) {
    ball.x = limitX - (ball.x - limitX);
    ball.vx = -Math.abs(ball.vx);
    events.push({ type: 'wall', surface: 'right', x: room.halfW, y: ball.y, z: ball.z });
  }

  // Floor / ceiling bounces
  const limitY = room.halfH - ball.radius;
  if (ball.y < -limitY) {
    ball.y = -limitY - (ball.y + limitY);
    ball.vy = Math.max(1.2, Math.abs(ball.vy) * 0.96);
    events.push({ type: 'wall', surface: 'floor', x: ball.x, y: -room.halfH, z: ball.z });
  } else if (ball.y > limitY) {
    ball.y = limitY - (ball.y - limitY);
    ball.vy = -Math.abs(ball.vy) * 0.96;
    events.push({ type: 'wall', surface: 'ceiling', x: ball.x, y: room.halfH, z: ball.z });
  }

  // Swept check against player bat plane (z = room.playerZ, moving negative)
  if (ball.vz < 0 && prevZ >= room.playerZ && ball.z <= room.playerZ) {
    const denom = prevZ - ball.z;
    const t = denom > 1e-9 ? (prevZ - room.playerZ) / denom : 0;
    const hitX = prevX + (ball.x - prevX) * t;
    const hitY = prevY + (ball.y - prevY) * t;
    const hitCheck = checkPaddleHit(playerPaddle, hitX, hitY, ball.radius, playerBoxes);

    if (hitCheck.hit) {
      const nextSpeed = Math.min(
        maxZSpeed,
        Math.max(minZSpeed, Math.abs(ball.vz) * 1.035 * speedMultiplier)
      );
      ball.z = room.playerZ + (room.playerZ - ball.z) * 0.5 + 0.01;
      ball.x = hitX;
      ball.y = hitY;
      ball.vz = nextSpeed;
      ball.vx = hitCheck.normX * nextSpeed * 0.42 + playerPaddle.vx * 0.34;
      ball.vy = hitCheck.normY * nextSpeed * 0.34 + playerPaddle.vy * 0.28 + 0.95;
      ball.spinX = (playerPaddle.vx * 0.22 - hitCheck.normX * 0.4) * spinMultiplier;
      ball.spinY = (playerPaddle.vy * 0.18 - hitCheck.normY * 0.25) * spinMultiplier;
      events.push({
        type: 'paddle',
        side: 'player',
        x: hitX,
        y: hitY,
        z: room.playerZ,
        speed: nextSpeed,
        normX: hitCheck.normX,
        normY: hitCheck.normY,
      });
    } else {
      scoredBy = 'opponent';
      events.push({
        type: 'miss',
        side: 'player',
        x: hitX,
        y: hitY,
        z: room.playerZ,
      });
    }
  }

  // Swept check against opponent bat plane (z = room.opponentZ, moving positive)
  if (!scoredBy && ball.vz > 0 && prevZ <= room.opponentZ && ball.z >= room.opponentZ) {
    const denom = ball.z - prevZ;
    const t = denom > 1e-9 ? (room.opponentZ - prevZ) / denom : 0;
    const hitX = prevX + (ball.x - prevX) * t;
    const hitY = prevY + (ball.y - prevY) * t;
    const hitCheck = checkPaddleHit(opponentPaddle, hitX, hitY, ball.radius, opponentBoxes);

    if (hitCheck.hit) {
      const returnScale = options.opponentReturnSpeedScale ?? 1.0;
      const nextSpeed = Math.min(
        maxZSpeed,
        Math.max(minZSpeed, Math.abs(ball.vz) * 1.02 * returnScale)
      );
      ball.z = room.opponentZ - (ball.z - room.opponentZ) * 0.5 - 0.01;
      ball.x = hitX;
      ball.y = hitY;
      ball.vz = -nextSpeed;
      const oppSpin = options.opponentSpinBias ?? 0;
      ball.vx = hitCheck.normX * nextSpeed * 0.36 + opponentPaddle.vx * 0.26;
      ball.vy = hitCheck.normY * nextSpeed * 0.28 + opponentPaddle.vy * 0.22 + 0.85;
      ball.spinX = (opponentPaddle.vx * 0.18 + oppSpin) * spinMultiplier;
      ball.spinY = opponentPaddle.vy * 0.14 * spinMultiplier;
      events.push({
        type: 'paddle',
        side: 'opponent',
        x: hitX,
        y: hitY,
        z: room.opponentZ,
        speed: nextSpeed,
        normX: hitCheck.normX,
        normY: hitCheck.normY,
      });
    } else {
      scoredBy = 'player';
      events.push({
        type: 'miss',
        side: 'opponent',
        x: hitX,
        y: hitY,
        z: room.opponentZ,
      });
    }
  }

  return { events, scoredBy };
}

// ============================================================================
// 4. FINITE BEATABLE OPPONENT AI
// ============================================================================

export function createAIState({
  reactionDelayMs = 180,
  maxSpeed = 6.2,
  predictionError = 0.65,
  missChance = 0.08,
} = {}) {
  return {
    reactionDelayMs: Math.max(110, reactionDelayMs), // never below 110ms
    maxSpeed,
    predictionError,
    missChance,
    reactionTimer: 0,
    targetX: 0,
    targetY: 0,
    wasApproaching: false,
    intentionalMiss: false,
    retargetTimer: 0,
  };
}

export function stepAI(ai, paddle, ball, dt, rng = Math.random, room = ROOM) {
  const approaching = ball.vz > 0;
  ai.retargetTimer = Math.max(0, ai.retargetTimer - dt);

  if (approaching && !ai.wasApproaching) {
    // Ball just started heading toward AI: start reaction delay & roll finite error
    ai.reactionTimer = Math.max(0.11, ai.reactionDelayMs / 1000);
    ai.intentionalMiss = rng() < ai.missChance;
    const errAngle = (rng() - 0.5) * 2;
    const errY = (rng() - 0.5) * 2;
    if (ai.intentionalMiss) {
      const dir = rng() < 0.5 ? -1 : 1;
      ai.errorOffsetX = dir * (paddle.width * 0.95 + 0.6);
      ai.errorOffsetY = errY * 0.8;
    } else {
      ai.errorOffsetX = errAngle * ai.predictionError;
      ai.errorOffsetY = errY * ai.predictionError * 0.75;
    }
  }
  ai.wasApproaching = approaching;

  if (approaching) {
    if (ai.reactionTimer > 0) {
      ai.reactionTimer -= dt;
    } else if (ai.retargetTimer <= 0) {
      // Predict rough intercept ignoring full spin curve so sharp spin beats AI
      const distZ = Math.max(0, room.opponentZ - ball.z);
      const timeToPlane = Math.min(1.5, distZ / Math.max(1, ball.vz));
      let predX = ball.x + ball.vx * timeToPlane * 0.78;
      let predY = ball.y + ball.vy * timeToPlane * 0.78;
      // Reflect prediction roughly off side walls once before applying AI error
      if (predX > room.halfW) predX = room.halfW - (predX - room.halfW);
      if (predX < -room.halfW) predX = -room.halfW - (predX + room.halfW);
      if (predY > room.halfH) predY = room.halfH - (predY - room.halfH);
      if (predY < -room.halfH) predY = -room.halfH - (predY + room.halfH);
      ai.targetX = predX + (ai.errorOffsetX || 0);
      ai.targetY = predY + (ai.errorOffsetY || 0);
      ai.retargetTimer = 0.08;
    }
  } else {
    // Drift calmly back toward centre when ball goes away
    ai.targetX = 0;
    ai.targetY = 0;
  }

  paddle.prevX = paddle.x;
  paddle.prevY = paddle.y;

  const dx = ai.targetX - paddle.x;
  const dy = ai.targetY - paddle.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.001) {
    const step = Math.min(dist, ai.maxSpeed * dt);
    paddle.x += (dx / dist) * step;
    paddle.y += (dy / dist) * step;
  }

  clampPaddle(paddle, room);
  paddle.vx = dt > 0 ? (paddle.x - paddle.prevX) / dt : 0;
  paddle.vy = dt > 0 ? (paddle.y - paddle.prevY) / dt : 0;
}

// ============================================================================
// 5. SPATIAL AUDIO & QUANTISER PURE MATH (shared with audio.js & node tests)
// ============================================================================

/**
 * Maps game room (x, y, z) where camera faces +z into Web Audio right-handed
 * space where listener faces -z.
 * Left (-x) stays -x; Up (+y) stays +y; Forward (+z) maps to -z.
 */
export function gameToAudioCoords(x, y, z) {
  return { x, y, z: -z };
}

export function computeDistanceGain(distance, refDistance = 2.5, maxDistance = 24.0, rolloff = 1.15) {
  const d = Math.max(refDistance, Math.min(maxDistance, distance));
  return refDistance / (refDistance + rolloff * (d - refDistance));
}

export function computeDopplerRate(ballPos, ballVel, listenerPos = { x: 0, y: 0, z: ROOM.cameraZ }) {
  const dx = ballPos.x - listenerPos.x;
  const dy = ballPos.y - listenerPos.y;
  const dz = ballPos.z - listenerPos.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  // Radial velocity toward listener (>0 when approaching)
  const vToward = -((ballVel.x * dx + ballVel.y * dy + ballVel.z * dz) / dist);
  // Subtle, musical Doppler range: ~0.82 to ~1.24
  return Math.max(0.8, Math.min(1.28, 1 + vToward / 95));
}

export function quantizeToNextStep(nowSec, gridStartSec, bpm, subdiv = 4) {
  const stepSec = 60 / bpm / subdiv;
  if (nowSec <= gridStartSec) {
    return { stepTime: gridStartSec + stepSec, stepIndex: 1, stepSec };
  }
  const elapsed = nowSec - gridStartSec;
  const nextIdx = Math.floor(elapsed / stepSec) + 1;
  return {
    stepTime: gridStartSec + nextIdx * stepSec,
    stepIndex: nextIdx,
    stepSec,
  };
}

export function createVoiceTracker({ maxVoices = 24, minSurfaceIntervalMs = 40 } = {}) {
  const active = [];
  const lastSurfaceTime = new Map();

  return {
    canTriggerSurface(surface, nowMs) {
      const prev = lastSurfaceTime.get(surface);
      if (prev !== undefined && nowMs - prev < minSurfaceIntervalMs) {
        return false;
      }
      lastSurfaceTime.set(surface, nowMs);
      return true;
    },
    registerVoice(voice) {
      let stolen = null;
      if (active.length >= maxVoices) {
        // Steal oldest quietest voice
        let stealIdx = 0;
        for (let i = 1; i < active.length; i++) {
          if (active[i].priority < active[stealIdx].priority ||
            (active[i].priority === active[stealIdx].priority && active[i].startedAt < active[stealIdx].startedAt)) {
            stealIdx = i;
          }
        }
        stolen = active.splice(stealIdx, 1)[0];
      }
      active.push(voice);
      return stolen;
    },
    releaseVoice(id) {
      const idx = active.findIndex((v) => v.id === id);
      if (idx !== -1) active.splice(idx, 1);
    },
    count() {
      return active.length;
    },
  };
}

// Minor pentatonic / Detroit house chord scale offsets (semitones)
export const HOUSE_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19];

export function pickScaleMidi(rootMidi, rallyHits, stepOffset = 0) {
  const idx = (rallyHits + stepOffset) % HOUSE_SCALE.length;
  return rootMidi + HOUSE_SCALE[idx];
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
