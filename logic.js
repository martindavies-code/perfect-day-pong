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

export function generateRunSeed() {
  const words = ['ALPHA', 'VELVET', 'CABLE', 'TENOR', 'PRAWN', 'CHARTER', 'HACIENDA', 'TAPE', 'SIGNAL'];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${w}-${n}`;
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

// View fit: fraction of the viewport (per axis) that the room cross-section at
// the player plane (z=0, the largest projection) may occupy. The remaining
// outer margin keeps corner shots and the bat fully visible at any aspect
// ratio. Physics and room geometry are unchanged; only projection (renderer.js)
// and the absolute mouse mapping (input.js) use it. 1.0 = previous full-bleed
// framing, which cropped the near-plane corners.
export const VIEW_FIT = 0.88;

// Pixels per room unit at the player plane for a viewport of width x height.
export function viewScale(width, height) {
  return Math.min((width * VIEW_FIT * 0.5) / ROOM.halfW, (height * VIEW_FIT * 0.5) / ROOM.halfH);
}

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

// Difficulty modes. Lou Reed names with plain labels; regular preserves the
// long-standing balance, easy starts one tempo lower, ramps slower and caps lower.
export const DIFFICULTY_MODES = {
  take_a_walk: {
    id: 'take_a_walk',
    label: 'TAKE A WALK',
    plain: 'EASY',
    startTempoIndex: (act) => (act === 3 ? 1 : 0),
    rampEveryHits: 9,
    maxTempoIndex: 2,
  },
  waiting_for_the_man: {
    id: 'waiting_for_the_man',
    label: 'WAITING FOR THE MAN',
    plain: 'REGULAR',
    startTempoIndex: (act) => (act === 3 ? 2 : 1),
    rampEveryHits: 7,
    maxTempoIndex: 3,
  },
};
export const DEFAULT_DIFFICULTY = 'waiting_for_the_man';
export function getDifficultyMode(id) {
  return DIFFICULTY_MODES[id] || DIFFICULTY_MODES[DEFAULT_DIFFICULTY];
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

// ============================================================================
// 4b. TIMED STRIKES & ON FIRE (Martin, 2026-11-20)
// Optional timing layer on top of normal returns. Position-only returns are
// completely unaffected. A click within +/-TIMED_STRIKE_WINDOW of the ball
// crossing the player plane counts as a timed strike: the return gets a
// bounded speed boost. Clicks before contact boost the ball; clicks just
// after contact still count toward the streak (the ball is already gone).
// A click with no contact inside the window is a mistimed click: it drops
// the streak and the fire, never the return itself. A plain no-click return
// neither builds nor breaks the streak. Three consecutive timed strikes
// light ON FIRE: a bounded burst (ON_FIRE_DURATION seconds, ended early by a
// mistimed click or the point ending) with a stronger but still clamped
// boost and a flaming ball. The streak is only broken by a mistimed click
// (or by a lit fire ending); points ending do not break it. Timing is
// relative to the ball, not the music.
// ============================================================================
export const TIMED_STRIKE_WINDOW = 0.14;
export const TIMED_STRIKE_BOOST = 1.18;
export const ON_FIRE_STREAK = 3;
export const ON_FIRE_DURATION = 5.0;
export const ON_FIRE_BOOST = 1.25;

export function createTimedStrikeState() {
  return {
    streak: 0,
    lastClickAt: null,       // elapsed time of an unresolved click
    lastContactAt: null,     // elapsed time of the most recent player contact
    lastContactResolved: true,
    onFireUntil: 0,
    timedHits: 0,
    activations: 0,
  };
}

// Click during a rally. If the ball just crossed the player bat within the
// window and that contact has not been claimed yet, the click resolves it as
// timed immediately (late click). Otherwise it is parked for the next contact.
export function timedStrikeClick(ts, elapsed) {
  if (
    ts.lastContactAt !== null &&
    !ts.lastContactResolved &&
    elapsed - ts.lastContactAt <= TIMED_STRIKE_WINDOW
  ) {
    ts.lastContactResolved = true;
    const res = applyTimedStrike(ts, elapsed);
    res.late = true;
    return res;
  }
  ts.lastClickAt = elapsed;
  return { timed: false, mistimed: false, firedUp: false, late: false };
}

function applyTimedStrike(ts, elapsed) {
  ts.streak += 1;
  ts.timedHits += 1;
  let firedUp = false;
  if (ts.streak >= ON_FIRE_STREAK && elapsed >= ts.onFireUntil) {
    ts.onFireUntil = elapsed + ON_FIRE_DURATION;
    ts.activations += 1;
    firedUp = true;
  }
  return { timed: true, mistimed: false, firedUp, late: false };
}

// Player bat contact. A parked click inside the window makes it timed and is
// consumed; a parked click outside the window is a mistimed click. No click
// at all leaves the streak untouched.
export function timedStrikeContact(ts, elapsed) {
  ts.lastContactAt = elapsed;
  const clicked = ts.lastClickAt !== null && ts.lastClickAt !== undefined;
  if (clicked) {
    const within = Math.abs(elapsed - ts.lastClickAt) <= TIMED_STRIKE_WINDOW;
    ts.lastClickAt = null;
    if (within) {
      ts.lastContactResolved = true;
      return applyTimedStrike(ts, elapsed);
    }
    ts.streak = 0;
    ts.onFireUntil = 0;
    ts.lastContactResolved = true;
    return { timed: false, mistimed: true, firedUp: false, late: false };
  }
  ts.lastContactResolved = false;
  return { timed: false, mistimed: false, firedUp: false, late: false };
}

// Per-frame sweep: a parked click whose window has expired with no contact is
// a mistimed click. Also ends ON FIRE when its time runs out (streak resets
// so the burst must be re-earned).
export function timedStrikeFrame(ts, elapsed) {
  if (ts.lastClickAt !== null && elapsed - ts.lastClickAt > TIMED_STRIKE_WINDOW) {
    ts.lastClickAt = null;
    ts.streak = 0;
    ts.onFireUntil = 0;
    return { mistimed: true, fireEnded: false };
  }
  if (ts.onFireUntil > 0 && elapsed >= ts.onFireUntil) {
    ts.onFireUntil = 0;
    ts.streak = 0;
    return { mistimed: false, fireEnded: true };
  }
  return { mistimed: false, fireEnded: false };
}

// Point end: the fire burst ends, and a lit fire takes the streak with it
// (same as its time-out - the burst must be re-earned). A building streak
// SURVIVES the point ending: only mistimed clicks cost it (NBA Jam style -
// three consecutive timed strikes across the match, not inside one rally).
export function timedStrikePointEnd(ts) {
  const wasOnFire = ts.onFireUntil > 0;
  ts.onFireUntil = 0;
  ts.lastClickAt = null;
  ts.lastContactAt = null;
  ts.lastContactResolved = true;
  if (wasOnFire) ts.streak = 0;
}

export function timedStrikeReset(ts) {
  ts.streak = 0;
  ts.lastClickAt = null;
  ts.lastContactAt = null;
  ts.lastContactResolved = true;
  ts.onFireUntil = 0;
}

// Boost the outgoing ball after a late-but-accepted click. Only ever scales
// the live ball while it travels away from the player (vz > 0), only by the
// given factor, and always clamped to the mode's current max speed. Returns
// whether the boost was applied.
export function applyLateBoost(ball, factor, maxZSpeed) {
  if (ball.vz <= 0) return false;
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (speed <= 1e-9) return false;
  const target = Math.min(maxZSpeed, speed * factor);
  if (target <= speed) return false;
  const k = target / speed;
  ball.vx *= k;
  ball.vy *= k;
  ball.vz *= k;
  return true;
}

export function isOnFire(ts, elapsed) {
  return ts.onFireUntil > 0 && elapsed < ts.onFireUntil;
}

// Return-speed multiplier for the current frame. Fire boost wins; a parked
// in-window click gives the one-shot timed boost; otherwise normal physics.
// The physics clamp (maxZSpeed) still bounds the result either way.
export function timedStrikeBoost(ts, elapsed) {
  if (isOnFire(ts, elapsed)) return ON_FIRE_BOOST;
  if (ts.lastClickAt !== null && Math.abs(elapsed - ts.lastClickAt) <= TIMED_STRIKE_WINDOW) {
    return TIMED_STRIKE_BOOST;
  }
  return 1.0;
}

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

  ball.vx += ball.spinX * spinAccelFactor * dt;
  ball.vy += (gravityY + ball.spinY * spinAccelFactor) * dt;

  const spinDecay = Math.exp(-0.35 * dt);
  ball.spinX *= spinDecay;
  ball.spinY *= spinDecay;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

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
      events.push({ type: 'miss', side: 'player', x: hitX, y: hitY, z: room.playerZ });
    }
  }

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
      events.push({ type: 'miss', side: 'opponent', x: hitX, y: hitY, z: room.opponentZ });
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
    reactionDelayMs: Math.max(110, reactionDelayMs),
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

export function stepAI(ai, paddle, ball, dt, rng = Math.random, room = ROOM, options = {}) {
  const approaching = ball.vz > 0;
  ai.retargetTimer = Math.max(0, ai.retargetTimer - dt);

  if (approaching && !ai.wasApproaching) {
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
      const distZ = Math.max(0, room.opponentZ - ball.z);
      const timeToPlane = Math.min(1.5, distZ / Math.max(1, ball.vz));
      let predX = ball.x + ball.vx * timeToPlane * 0.78;
      let predY = ball.y + ball.vy * timeToPlane * 0.78;
      if (predX > room.halfW) predX = room.halfW - (predX - room.halfW);
      if (predX < -room.halfW) predX = -room.halfW - (predX + room.halfW);
      if (predY > room.halfH) predY = room.halfH - (predY - room.halfH);
      if (predY < -room.halfH) predY = -room.halfH - (predY + room.halfH);
      ai.targetX = predX + (ai.errorOffsetX || 0);
      ai.targetY = predY + (ai.errorOffsetY || 0);
      ai.retargetTimer = 0.08;
    }
  } else {
    ai.targetX = options.idleTargetX ?? 0;
    ai.targetY = options.idleTargetY ?? 0;
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
// 5. ROGUELIKE RUN: ACTS, OPPONENTS, LOU REED PHASES, PICKUPS
// ============================================================================

export const ACTS = [
  { id: 1, title: 'ACT I — THE WARM-UP SLOT', prefix: 'PDP 1', bg: '#111214', accent: '#4ea8de', opponentColor: '#4ea8de' },
  { id: 2, title: 'ACT II — THE RUNNING ORDER', prefix: 'PDP 2', bg: '#121116', accent: '#d4a84f', opponentColor: '#d4a84f' },
  { id: 3, title: 'ACT III — THE FINALE', prefix: 'PDP 3', bg: '#141111', accent: '#e0533c', opponentColor: '#e0533c' },
];

export const OPPONENTS = {
  // Act I pool (5)
  sheona_white: {
    id: 'sheona_white', callName: 'White', act: 1, name: 'Sheona White', vibe: 'Wide tenor-horn bat, long flat returns.',
    style: 'horn', width: 2.1, height: 1.0, reactionDelayMs: 250, maxSpeed: 4.5, predictionError: 0.78, missChance: 0.14,
  },
  visual_ministry: {
    id: 'visual_ministry', callName: 'Visual Ministry', act: 1, name: 'Visual Ministry Choir', vibe: 'Three small bats singing in unison.',
    style: 'choir', width: 0.7, height: 0.7, reactionDelayMs: 235, maxSpeed: 4.7, predictionError: 0.75, missChance: 0.13,
  },
  brodsky_quartet: {
    id: 'brodsky_quartet', callName: 'Brodsky Quartet', act: 1, name: 'Brodsky Quartet', vibe: 'Four thin strips opening and closing on the beat.',
    style: 'quartet', width: 0.42, height: 1.4, reactionDelayMs: 220, maxSpeed: 4.9, predictionError: 0.72, missChance: 0.12,
  },
  evan_dando: {
    id: 'evan_dando', callName: 'Dando', act: 1, name: 'Evan Dando', vibe: 'Unbothered. Slow and occasionally late to react.',
    style: 'default', width: 1.5, height: 1.05, reactionDelayMs: 310, maxSpeed: 4.3, predictionError: 0.85, missChance: 0.16,
  },
  courtney_pine: {
    id: 'courtney_pine', callName: 'Pine', act: 1, name: 'Courtney Pine', vibe: 'Curving returns laced with jazzy spin.',
    style: 'default', width: 1.45, height: 1.05, reactionDelayMs: 215, maxSpeed: 5.0, predictionError: 0.7, missChance: 0.11, spinBias: 1.6,
  },

  // Act II pool (7) + Bono mini-boss
  heather_small: {
    id: 'heather_small', callName: 'Small', act: 2, name: 'Heather Small', vibe: 'Fast off the mark, tires as the game deepens.',
    style: 'default', width: 1.5, height: 1.05, reactionDelayMs: 175, maxSpeed: 6.1, predictionError: 0.58, missChance: 0.1,
  },
  tom_jones: {
    id: 'tom_jones', callName: 'Jones', act: 2, name: 'Tom Jones', vibe: 'Big serve, booming flat returns down the middle.',
    style: 'default', width: 1.65, height: 1.15, reactionDelayMs: 185, maxSpeed: 5.7, predictionError: 0.6, missChance: 0.09, returnSpeedScale: 1.06,
  },
  gabrielle: {
    id: 'gabrielle', callName: 'Gabrielle', act: 2, name: 'Gabrielle', vibe: 'Returns pulse to a visible beat ring.',
    style: 'pulse', width: 1.45, height: 1.05, reactionDelayMs: 185, maxSpeed: 5.8, predictionError: 0.6, missChance: 0.1,
  },
  huey_morgan: {
    id: 'huey_morgan', callName: 'Morgan', act: 2, name: 'Huey Morgan', vibe: 'Off-kilter returns that shift pace mid-flight.',
    style: 'default', width: 1.45, height: 1.0, reactionDelayMs: 180, maxSpeed: 5.8, predictionError: 0.62, missChance: 0.1,
  },
  suzanne_vega: {
    id: 'suzanne_vega', callName: 'Vega', act: 2, name: 'Suzanne Vega', vibe: 'Small, quiet, precise bat near the centre.',
    style: 'default', width: 1.05, height: 0.9, reactionDelayMs: 165, maxSpeed: 6.2, predictionError: 0.48, missChance: 0.09,
  },
  boyzone: {
    id: 'boyzone', callName: 'Boyzone', act: 2, name: 'Boyzone', vibe: 'Five bats in synchronised crossfading formation.',
    style: 'boyzone', width: 0.58, height: 0.58, reactionDelayMs: 195, maxSpeed: 5.4, predictionError: 0.62, missChance: 0.1,
  },
  burning_spear: {
    id: 'burning_spear', callName: 'Burning Spear', act: 2, name: 'Burning Spear', vibe: 'Wide bat, heavy off-beat rhythm.',
    style: 'default', width: 1.9, height: 1.1, reactionDelayMs: 200, maxSpeed: 5.3, predictionError: 0.64, missChance: 0.1,
  },
  bono: {
    id: 'bono', callName: 'Bono', act: 2, name: 'Bono', isBoss: true, vibe: 'Mini-boss: corner shades and a faint decoy shadow.',
    style: 'bono', width: 1.65, height: 1.15, reactionDelayMs: 155, maxSpeed: 6.5, predictionError: 0.52, missChance: 0.08,
  },

  // Act III fixed order (3)
  elton_john: {
    id: 'elton_john', callName: 'Elton John', act: 3, name: 'Elton John', vibe: 'Piano-key bat rising in rolling arpeggios.',
    style: 'piano', width: 0.42, height: 1.15, reactionDelayMs: 145, maxSpeed: 6.8, predictionError: 0.48, missChance: 0.08,
  },
  david_bowie: {
    id: 'david_bowie', callName: 'Bowie', act: 3, name: 'David Bowie', vibe: 'Chameleon bat; shifts room gravity once per match.',
    style: 'bowie', width: 1.5, height: 1.1, reactionDelayMs: 138, maxSpeed: 7.0, predictionError: 0.46, missChance: 0.07,
  },
  lou_reed: {
    id: 'lou_reed', callName: 'Reed', act: 3, name: 'Lou Reed', isBoss: true, vibe: 'Ultimate Boss: deadpan NYC, three phases, Borrowed Time.',
    style: 'lou', width: 1.55, height: 1.1, reactionDelayMs: 125, maxSpeed: 7.3, predictionError: 0.44, missChance: 0.06,
  },
};

export const ACT1_POOL = ['sheona_white', 'visual_ministry', 'brodsky_quartet', 'evan_dando', 'courtney_pine'];
export const ACT2_POOL = ['heather_small', 'tom_jones', 'gabrielle', 'huey_morgan', 'suzanne_vega', 'boyzone', 'burning_spear'];

export const PICKUPS = {
  bat_size: { id: 'bat_size', name: 'Widescreen Aperture', short: 'BAT+', desc: '+18% bat size (stackable).', maxStacks: 3 },
  bat_speed: { id: 'bat_speed', name: 'Outside Broadcast Rig', short: 'SPD+', desc: '+18% bat speed (stackable).', maxStacks: 3 },
  tempo_control: { id: 'tempo_control', name: 'Second Engineer', short: 'ENG+', desc: '+10% bat speed this run. (Retired Tempo Control saves still read.)', maxStacks: 3 },
  extra_life: { id: 'extra_life', name: 'TV Licence Renewal', short: 'LIC+', desc: '+1 licence fee (max 5).', maxStacks: 5 },
  curve_master: { id: 'curve_master', name: 'Curve Master', short: 'CRV+', desc: '+35% ball spin curve.', maxStacks: 2 },
  shadow_sight: { id: 'shadow_sight', name: 'Shadow Sight', short: 'SHD+', desc: 'Stronger depth ring & floor cues.', maxStacks: 2 },
  second_chance: { id: 'second_chance', name: 'Second Chance', short: '2ND', desc: 'Replay your first lost point each match.', maxStacks: 1 },
  sticky_bat: { id: 'sticky_bat', name: 'Sticky Bat', short: 'STK', desc: 'Hold ball 0.3s on catch to aim.', maxStacks: 1 },
  fee_grant: { id: 'fee_grant', name: 'Charter Honorarium', short: 'FEE', desc: '+15 Fee Points added to run reward.', maxStacks: 99 },
};

export function getLouReedPhase(scoreState) {
  const maxPts = Math.max(scoreState.playerPoints, scoreState.opponentPoints);
  if (maxPts >= 3) {
    return { phase: 3, name: 'Perfect Day', warm: true };
  }
  if (maxPts >= 2) {
    return { phase: 2, name: 'Walk on the Wild Side', warm: false };
  }
  return { phase: 1, name: 'Transformer', warm: false };
}

export function computeOpponentFormation(paddle, style, elapsed, room = ROOM) {
  if (style === 'choir') {
    const gap = 1.45;
    return [
      { x: Math.max(-room.halfW + 0.4, paddle.x - gap), y: paddle.y, width: paddle.width, height: paddle.height },
      { x: paddle.x, y: paddle.y + Math.sin(elapsed * 2.5) * 0.25, width: paddle.width, height: paddle.height },
      { x: Math.min(room.halfW - 0.4, paddle.x + gap), y: paddle.y, width: paddle.width, height: paddle.height },
    ];
  }
  if (style === 'quartet') {
    const spread = 0.55 + (Math.sin(elapsed * 3.2) * 0.5 + 0.5) * 0.45;
    return [
      { x: paddle.x - spread * 1.5, y: paddle.y, width: paddle.width, height: paddle.height },
      { x: paddle.x - spread * 0.5, y: paddle.y, width: paddle.width, height: paddle.height },
      { x: paddle.x + spread * 0.5, y: paddle.y, width: paddle.width, height: paddle.height },
      { x: paddle.x + spread * 1.5, y: paddle.y, width: paddle.width, height: paddle.height },
    ];
  }
  if (style === 'boyzone') {
    const wave = Math.sin(elapsed * 2.4) * 0.55;
    return [
      { x: paddle.x - 1.3, y: paddle.y + wave * 0.5, width: paddle.width, height: paddle.height },
      { x: paddle.x - 0.65, y: paddle.y - wave * 0.5, width: paddle.width, height: paddle.height },
      { x: paddle.x, y: paddle.y + wave * 0.3, width: paddle.width, height: paddle.height },
      { x: paddle.x + 0.65, y: paddle.y - wave * 0.5, width: paddle.width, height: paddle.height },
      { x: paddle.x + 1.3, y: paddle.y + wave * 0.5, width: paddle.width, height: paddle.height },
    ];
  }
  if (style === 'piano') {
    const keys = [];
    for (let k = -2; k <= 2; k++) {
      keys.push({
        x: paddle.x + k * 0.46,
        y: paddle.y + Math.sin(elapsed * 4.5 + k * 0.9) * 0.35,
        width: paddle.width,
        height: paddle.height,
      });
    }
    return keys;
  }
  return null;
}

export function computeOpponentIdleTarget(oppDef, score, elapsed) {
  if (oppDef?.id === 'lou_reed' && getLouReedPhase(score).phase === 2) {
    return { idleTargetX: Math.sin(elapsed * 2.1) * 2.2, idleTargetY: 0 };
  }
  return { idleTargetX: 0, idleTargetY: 0 };
}

export function createRunState({ seed = generateRunSeed(), upgradeLevels = {} } = {}) {
  const startLives = Math.min(5, 3 + (upgradeLevels.startLives || 0));
  const run = {
    seed: String(seed),
    rngCounter: 0,
    matchIndex: 0, // 0..8 (9 matches)
    lives: startLives,
    maxLives: 5,
    status: 'choose_opponent', // 'choose_opponent' | 'playing' | 'choose_pickup' | 'won' | 'lost'
    offeredOpponents: [],
    currentOpponentId: null,
    offeredPickups: [],
    pickups: {}, // pickupId -> count
    extraLifeOffersCount: 0,
    matchesWon: 0,
    pointsScored: 0,
    bossesBeaten: 0,
    beatLouReed: false,
    borrowedPickupId: null,
    borrowedTimeBonus: 0,
    usedOpponents: [],
    upgradeLevels: { ...upgradeLevels },
  };
  prepareNextMatchSelection(run);
  return run;
}

function nextRunRng(run) {
  run.rngCounter += 1;
  return mulberry32(hashSeed(`${run.seed}#${run.rngCounter}`));
}

export function prepareNextMatchSelection(run) {
  const idx = run.matchIndex;
  if (idx >= 9) {
    run.status = 'won';
    return run;
  }

  // Fixed slots: 5 (Bono), 6 (Elton John), 7 (David Bowie), 8 (Lou Reed)
  if (idx === 5) {
    run.offeredOpponents = ['bono'];
    run.currentOpponentId = 'bono';
    run.status = 'playing';
    return run;
  }
  if (idx === 6) {
    run.offeredOpponents = ['elton_john'];
    run.currentOpponentId = 'elton_john';
    run.status = 'playing';
    return run;
  }
  if (idx === 7) {
    run.offeredOpponents = ['david_bowie'];
    run.currentOpponentId = 'david_bowie';
    run.status = 'playing';
    return run;
  }
  if (idx === 8) {
    run.offeredOpponents = ['lou_reed'];
    run.currentOpponentId = 'lou_reed';
    const ownedIds = Object.keys(run.pickups).filter((k) => run.pickups[k] > 0);
    if (ownedIds.length > 0) {
      const r = nextRunRng(run);
      run.borrowedPickupId = ownedIds[Math.floor(r() * ownedIds.length)];
    } else {
      run.borrowedPickupId = null;
    }
    run.status = 'playing';
    return run;
  }

  // Choice slots: Act I (0, 1, 2) and Act II (3, 4)
  const pool = idx < 3 ? ACT1_POOL : ACT2_POOL;
  const available = pool.filter((id) => !run.usedOpponents.includes(id));
  const r = nextRunRng(run);
  const shuffled = [...available].sort(() => r() - 0.5);
  run.offeredOpponents = shuffled.slice(0, Math.min(2, shuffled.length));
  run.status = 'choose_opponent';
  return run;
}

export function pickOpponent(run, opponentId) {
  if (!run.offeredOpponents.includes(opponentId)) {
    throw new Error(`Opponent ${opponentId} not offered`);
  }
  run.currentOpponentId = opponentId;
  if (!run.usedOpponents.includes(opponentId)) {
    run.usedOpponents.push(opponentId);
  }
  run.status = 'playing';
  return run;
}

export function buildPickupOffer(run) {
  const choiceCount = (run.upgradeLevels.pickupChoices || 0) >= 3 ? 4 : 3;
  const r = nextRunRng(run);

  const eligible = Object.values(PICKUPS)
    .filter((p) => {
      if (p.id === 'fee_grant') return false;
      if (p.id === 'extra_life') return run.lives < run.maxLives;
      return (run.pickups[p.id] || 0) < p.maxStacks;
    })
    .map((p) => p.id);

  const shuffled = [...eligible].sort(() => r() - 0.5);
  const offers = shuffled.slice(0, choiceCount);

  // Guarantee at least two Extra Life offers per run
  const matchesLeft = 8 - run.matchIndex;
  const neededLifeOffers = Math.max(0, 2 - run.extraLifeOffersCount);
  if (neededLifeOffers > 0 && matchesLeft <= neededLifeOffers && !offers.includes('extra_life')) {
    if (offers.length > 0) {
      offers[offers.length - 1] = 'extra_life';
    } else {
      offers.push('extra_life');
    }
  }
  if (offers.includes('extra_life')) {
    run.extraLifeOffersCount += 1;
  }
  if (offers.length === 0) {
    offers.push('fee_grant');
  }
  return offers;
}

export function recordMatchResult(run, { won, playerPointsScored }) {
  run.pointsScored += Math.max(0, playerPointsScored | 0);

  if (!won) {
    run.lives = Math.max(0, run.lives - 1);
    if (run.lives <= 0) {
      run.status = 'lost';
    } else {
      // Replay same opponent
      run.status = 'playing';
    }
    return run;
  }

  // Match won
  run.matchesWon += 1;
  const opp = OPPONENTS[run.currentOpponentId];
  if (opp?.isBoss) {
    run.bossesBeaten += 1;
  }
  if (run.currentOpponentId === 'lou_reed') {
    run.beatLouReed = true;
    if (run.borrowedPickupId) {
      run.borrowedTimeBonus = 25;
    }
    run.matchIndex = 9;
    run.status = 'won';
    return run;
  }

  run.offeredPickups = buildPickupOffer(run);
  run.status = 'choose_pickup';
  return run;
}

export function choosePickup(run, pickupId) {
  if (!run.offeredPickups.includes(pickupId)) {
    throw new Error(`Pickup ${pickupId} not offered`);
  }
  if (pickupId === 'extra_life') {
    run.lives = Math.min(run.maxLives, run.lives + 1);
  } else if (pickupId === 'fee_grant') {
    run.pickupFeeBonus = (run.pickupFeeBonus || 0) + 15;
  } else {
    const cap = PICKUPS[pickupId]?.maxStacks ?? 1;
    run.pickups[pickupId] = Math.min(cap, (run.pickups[pickupId] || 0) + 1);
  }
  run.matchIndex += 1;
  return prepareNextMatchSelection(run);
}

export function getEffectivePickups(run) {
  const effective = { ...run.pickups };
  if (run.currentOpponentId === 'lou_reed' && run.borrowedPickupId && effective[run.borrowedPickupId]) {
    effective[run.borrowedPickupId] = Math.max(0, effective[run.borrowedPickupId] - 1);
  }
  return effective;
}

// ============================================================================
// 6. PERMANENT PROGRESSION: FEE POINTS, UPGRADES, SAVE VALIDATION
// ============================================================================

export const UPGRADES = {
  startBatSize: {
    id: 'startBatSize',
    name: 'Starting Bat Size',
    desc: '+8% initial bat width & height per level.',
    costs: [15, 30, 50, 80],
    maxLevel: 4,
  },
  startBatSpeed: {
    id: 'startBatSpeed',
    name: 'Starting Bat Speed',
    desc: '+10% pad/key bat speed per level.',
    costs: [15, 30, 50, 80],
    maxLevel: 4,
  },
  startLives: {
    id: 'startLives',
    name: 'Starting Licence Fees',
    desc: '+1 starting licence fee per level (cap 5).',
    costs: [40, 90],
    maxLevel: 2,
  },
  pickupChoices: {
    id: 'pickupChoices',
    name: 'Commissioning Panel',
    desc: 'Level 3 widens post-win pickup offers from 3 to 4.',
    costs: [25, 45, 75],
    maxLevel: 3,
  },
  tempoCharges: {
    id: 'tempoCharges',
    name: 'Staff Engineer',
    desc: '+4% bat speed per level. (Retired Tempo Control saves still read.)',
    costs: [20, 40, 70],
    maxLevel: 3,
  },
  serveWindow: {
    id: 'serveWindow',
    name: 'Wider Serve Tolerance',
    desc: '+6% effective reach on first return per level.',
    costs: [15, 35, 65],
    maxLevel: 3,
  },
};

export function computeRunFeePoints(run) {
  return (
    run.matchesWon * 10 +
    run.pointsScored * 1 +
    run.bossesBeaten * 5 +
    (run.beatLouReed ? 50 : 0) +
    (run.borrowedTimeBonus || 0) +
    (run.pickupFeeBonus || 0)
  );
}

export function computeUpgradeSpent(upgradeLevels = {}) {
  let spent = 0;
  for (const [key, def] of Object.entries(UPGRADES)) {
    const lvl = Math.max(0, Math.min(def.maxLevel, (upgradeLevels[key] || 0) | 0));
    for (let i = 0; i < lvl; i++) {
      spent += def.costs[i];
    }
  }
  return spent;
}

export function computeUnspentPoints(saveDoc) {
  return (saveDoc.totalEarned || 0) - computeUpgradeSpent(saveDoc.upgradeLevels);
}

export function purchaseUpgrade(saveDoc, upgradeId) {
  const def = UPGRADES[upgradeId];
  if (!def) return { ok: false, reason: 'Unknown upgrade', save: saveDoc };
  const currentLvl = saveDoc.upgradeLevels[upgradeId] || 0;
  if (currentLvl >= def.maxLevel) return { ok: false, reason: 'Max level reached', save: saveDoc };
  const cost = def.costs[currentLvl];
  const unspent = computeUnspentPoints(saveDoc);
  if (unspent < cost) return { ok: false, reason: 'Insufficient Fee Points', save: saveDoc };

  const nextLevels = { ...saveDoc.upgradeLevels, [upgradeId]: currentLvl + 1 };
  const nextDoc = {
    ...saveDoc,
    revision: (saveDoc.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
    upgradeLevels: nextLevels,
  };
  if (computeUnspentPoints(nextDoc) < 0) {
    return { ok: false, reason: 'Negative balance rejected', save: saveDoc };
  }
  return { ok: true, save: nextDoc };
}

export const SAVE_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 256 * 1024;

export function createDefaultSave(deviceId = 'local-device') {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    revision: 0,
    deviceId,
    updatedAt: new Date().toISOString(),
    totalEarned: 0,
    upgradeLevels: {
      startBatSize: 0,
      startBatSpeed: 0,
      startLives: 0,
      pickupChoices: 0,
      tempoCharges: 0,
      serveWindow: 0,
    },
    stats: {
      runsPlayed: 0,
      runsWon: 0,
      matchesWon: 0,
      pointsScored: 0,
      louReedWins: 0,
    },
    settings: {
      mouseSensitivity: 1.0,
      announcerEnabled: true,
      difficulty: DEFAULT_DIFFICULTY,
      quickDeuce: false,
      spatialMode: 'hrtf',
      masterVolume: 0.8,
      musicVolume: 0.42,
      sfxVolume: 0.88,
    },
  };
}

const ALLOWED_SAVE_KEYS = new Set([
  'schemaVersion', 'revision', 'deviceId', 'updatedAt',
  'totalEarned', 'upgradeLevels', 'stats', 'settings',
]);

export function validateAndSanitizeSave(rawInput, { strict = false, fallbackDeviceId = 'local-device' } = {}) {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return { ok: false, reason: 'Save must be a JSON object', save: createDefaultSave(fallbackDeviceId) };
  }

  if (strict) {
    for (const k of Object.keys(rawInput)) {
      if (!ALLOWED_SAVE_KEYS.has(k)) {
        return { ok: false, reason: `Unknown key: ${k}`, save: null };
      }
    }
    if (
      rawInput.schemaVersion !== undefined &&
      (typeof rawInput.schemaVersion !== 'number' ||
        !Number.isInteger(rawInput.schemaVersion) ||
        rawInput.schemaVersion < 0 ||
        rawInput.schemaVersion > SAVE_SCHEMA_VERSION)
    ) {
      return { ok: false, reason: `Unsupported schemaVersion: ${rawInput.schemaVersion}`, save: null };
    }
    if (typeof rawInput.totalEarned !== 'number' || !Number.isFinite(rawInput.totalEarned) || rawInput.totalEarned < 0) {
      return { ok: false, reason: 'Invalid totalEarned', save: null };
    }
  }

  const def = createDefaultSave(fallbackDeviceId);
  const clampInt = (v, min, max, d) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(min, Math.min(max, Math.floor(n)));
  };
  const clampNum = (v, min, max, d) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    return Math.max(min, Math.min(max, n));
  };

  const upgradeLevels = {};
  const rawUp = (rawInput.upgradeLevels && typeof rawInput.upgradeLevels === 'object') ? rawInput.upgradeLevels : {};
  if (strict) {
    for (const k of Object.keys(rawUp)) {
      if (!UPGRADES[k]) return { ok: false, reason: `Unknown upgrade key: ${k}`, save: null };
    }
  }
  for (const [k, uDef] of Object.entries(UPGRADES)) {
    upgradeLevels[k] = clampInt(rawUp[k], 0, uDef.maxLevel, 0);
  }

  const totalEarned = clampInt(rawInput.totalEarned, 0, 10000000, 0);
  const rawStats = (rawInput.stats && typeof rawInput.stats === 'object') ? rawInput.stats : {};
  const rawSet = (rawInput.settings && typeof rawInput.settings === 'object') ? rawInput.settings : {};

  const sanitized = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    revision: clampInt(rawInput.revision, 0, 100000000, 0),
    deviceId: typeof rawInput.deviceId === 'string' && rawInput.deviceId.length > 0
      ? rawInput.deviceId.slice(0, 64)
      : def.deviceId,
    updatedAt: typeof rawInput.updatedAt === 'string' ? rawInput.updatedAt.slice(0, 40) : def.updatedAt,
    totalEarned,
    upgradeLevels,
    stats: {
      runsPlayed: clampInt(rawStats.runsPlayed, 0, 1000000, 0),
      runsWon: clampInt(rawStats.runsWon, 0, 1000000, 0),
      matchesWon: clampInt(rawStats.matchesWon, 0, 10000000, 0),
      pointsScored: clampInt(rawStats.pointsScored, 0, 100000000, 0),
      louReedWins: clampInt(rawStats.louReedWins, 0, 1000000, 0),
    },
    settings: {
      announcerEnabled: rawSet.announcerEnabled !== false,
      mouseSensitivity: clampNum(rawSet.mouseSensitivity, 0.4, 2.2, def.settings.mouseSensitivity),
      difficulty: DIFFICULTY_MODES[rawSet.difficulty] ? rawSet.difficulty : def.settings.difficulty,
      quickDeuce: Boolean(rawSet.quickDeuce),
      spatialMode: rawSet.spatialMode === 'speakers' ? 'speakers' : 'hrtf',
      masterVolume: clampNum(rawSet.masterVolume, 0, 1, def.settings.masterVolume),
      musicVolume: clampNum(rawSet.musicVolume, 0, 1, def.settings.musicVolume),
      sfxVolume: clampNum(rawSet.sfxVolume, 0, 1, def.settings.sfxVolume),
    },
  };

  if (computeUnspentPoints(sanitized) < 0) {
    return {
      ok: false,
      reason: 'Unspent Fee Points would be negative',
      save: strict ? null : createDefaultSave(fallbackDeviceId),
    };
  }

  return { ok: true, save: sanitized };
}

export function detectCloudConflict({ localSave, remoteSave, lastSyncedRevision, lastSyncedRemoteVersion, remoteVersion }) {
  if (!remoteSave) return { status: 'no_remote' };
  // No shared baseline: neither copy is safe to replace automatically.
  if (lastSyncedRevision == null || !lastSyncedRemoteVersion || !remoteVersion) {
    return { status: 'conflict', reason: 'no_baseline' };
  }
  const localChanged = (localSave?.revision ?? 0) !== (lastSyncedRevision ?? -1);
  const remoteChanged = Boolean(lastSyncedRemoteVersion && remoteVersion && lastSyncedRemoteVersion !== remoteVersion);

  if (!localChanged && !remoteChanged) return { status: 'in_sync' };
  if (localChanged && !remoteChanged) return { status: 'upload_local' };
  if (!localChanged && remoteChanged) return { status: 'pull_remote' };
  return { status: 'conflict', reason: 'diverged' };
}

// ============================================================================
// 7. SPATIAL AUDIO & QUANTISER PURE MATH
// ============================================================================

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
  const vToward = -((ballVel.x * dx + ballVel.y * dy + ballVel.z * dz) / dist);
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

export const HOUSE_SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19];

export function pickScaleMidi(rootMidi, rallyHits, stepOffset = 0) {
  const idx = (rallyHits + stepOffset) % HOUSE_SCALE.length;
  return rootMidi + HOUSE_SCALE[idx];
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
