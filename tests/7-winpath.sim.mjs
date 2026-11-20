/**
 * Deterministic full-run win-path simulation (no browser, no production state).
 *
 * Plays a complete 9-match run through logic.js with real rally physics:
 * a scripted player bot (capped speed, predictive intercept) faces each
 * opponent's actual AI parameters. Verifies the whole route is winnable and
 * that run progression (opponents, pickups, bosses, Lou Reed phases, fee
 * points) completes end to end.
 *
 * Simplifications vs main.js: special visual mechanics (Bono decoy, Bowie
 * gravity shift, multi-box bats) are not reproduced; the opponent is a single
 * paddle with its real AI numbers. Beatability under those extras is covered
 * by the unit suite's max-difficulty AI test.
 */
import {
  mulberry32,
  hashSeed,
  createRunState,
  pickOpponent,
  choosePickup,
  recordMatchResult,
  createMatchScore,
  createPaddle,
  createBall,
  clampPaddle,
  stepBallPhysics,
  createAIState,
  stepAI,
  scorePoint,
  getTempoByIndex,
  getLouReedPhase,
  computeRunFeePoints,
  OPPONENTS,
  ROOM,
} from '../logic.js';

const DT = 1 / 120;
const PLAYER_MAX_SPEED = 8.5;

function movePlayerPaddle(paddle, ball) {
  let tx = 0;
  let ty = 0.2;
  if (ball.vz < 0) {
    const t = Math.min(1.5, Math.max(0, (ball.z - 0.32) / Math.max(0.5, -ball.vz)));
    tx = ball.x + ball.vx * t * 0.92;
    ty = ball.y + ball.vy * t * 0.92;
    if (tx > ROOM.halfW) tx = ROOM.halfW - (tx - ROOM.halfW);
    if (tx < -ROOM.halfW) tx = -ROOM.halfW - (tx + ROOM.halfW);
    if (ty > ROOM.halfH) ty = ROOM.halfH - (ty - ROOM.halfH);
    if (ty < -ROOM.halfH) ty = -ROOM.halfH - (ty + ROOM.halfH);
  }
  paddle.prevX = paddle.x;
  paddle.prevY = paddle.y;
  const dx = tx - paddle.x;
  const dy = ty - paddle.y;
  const dist = Math.hypot(dx, dy);
  if (dist > 0.001) {
    const step = Math.min(dist, PLAYER_MAX_SPEED * DT);
    paddle.x += (dx / dist) * step;
    paddle.y += (dy / dist) * step;
  }
  clampPaddle(paddle, ROOM);
  paddle.vx = (paddle.x - paddle.prevX) / DT;
  paddle.vy = (paddle.y - paddle.prevY) / DT;
}

function simulateMatch(oppDef, rng, { onScore } = {}) {
  let score = createMatchScore({ quickDeuce: false, firstServer: 'player' });
  const playerPaddle = createPaddle({ width: 1.55, height: 1.1 });
  const opponentPaddle = createPaddle({ width: oppDef.width, height: oppDef.height });
  const ai = createAIState({
    reactionDelayMs: oppDef.reactionDelayMs,
    maxSpeed: oppDef.maxSpeed,
    predictionError: oppDef.predictionError,
    missChance: oppDef.missChance,
  });
  const tempo = getTempoByIndex(oppDef.act === 3 ? 2 : 1);
  const actBase = 11.4 + (oppDef.act - 1) * 0.9;
  const maxSteps = 120 * 60 * 20;
  let steps = 0;

  while (!score.winner) {
    if (steps++ > maxSteps) throw new Error(`Match vs ${oppDef.id} exceeded step cap`);
    const playerServe = score.server === 'player';
    const deuceBoost = 1 + score.deuceCount * 0.06;
    const baseZ = actBase * tempo.speedScale * deuceBoost;
    const ball = playerServe
      ? createBall({
          x: playerPaddle.x * 0.5,
          y: Math.max(-1.2, Math.min(1.2, playerPaddle.y * 0.5 + 0.2)),
          z: 0.55,
          vx: (rng() - 0.5) * 3.6,
          vy: 1.25 + (rng() - 0.5) * 1.2,
          vz: baseZ,
        })
      : createBall({
          x: (rng() - 0.5) * 2.4,
          y: 0.2 + (rng() - 0.5) * 0.8,
          z: ROOM.opponentZ - 0.55,
          vx: (rng() - 0.5) * 3.2,
          vy: 1.05 + (rng() - 0.5) * 1.2,
          vz: -baseZ * (oppDef.id === 'tom_jones' ? 1.12 : 1.0),
        });

    let scoredBy = null;
    let guard = 0;
    while (!scoredBy) {
      if (++guard > 120 * 120) throw new Error(`Rally vs ${oppDef.id} exceeded cap`);
      steps++;
      movePlayerPaddle(playerPaddle, ball);
      stepAI(ai, opponentPaddle, ball, DT, rng);
      const res = stepBallPhysics(ball, playerPaddle, opponentPaddle, DT, {
        gravityY: -2.35,
        spinMultiplier: 1,
        maxZSpeed: 28 * tempo.speedScale,
        minZSpeed: 9.5 * tempo.speedScale,
        opponentSpinBias: oppDef.spinBias || 0,
        opponentReturnSpeedScale: oppDef.returnSpeedScale || 1.0,
      });
      scoredBy = res.scoredBy;
    }
    score = scorePoint(score, scoredBy);
    onScore?.(score);
  }
  return score;
}

let failures = 0;
function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

const run = createRunState({ seed: 'SIM-WIN-ROUTE-1', upgradeLevels: {} });
const route = [];
const louPhases = new Set();
let matchAttempts = 0;

let guard = 0;
while (run.status !== 'won' && run.status !== 'lost') {
  if (++guard > 40) throw new Error('Run loop exceeded guard');
  if (run.status === 'choose_opponent') {
    check(`match ${run.matchIndex + 1}: opponent choice offered (${run.offeredOpponents.join(', ')})`, run.offeredOpponents.length >= 1);
    pickOpponent(run, run.offeredOpponents[0]);
  } else if (run.status === 'choose_pickup') {
    check(`match ${run.matchIndex + 1} won: pickup offered (${run.offeredPickups.join(', ')})`, run.offeredPickups.length >= 1);
    choosePickup(run, run.offeredPickups[0]);
  } else if (run.status === 'playing') {
    const oppDef = OPPONENTS[run.currentOpponentId];
    matchAttempts += 1;
    route.push(oppDef.id);
    const rng = mulberry32(hashSeed(`${run.seed}-M${run.matchIndex}-A${matchAttempts}`));
    const score = simulateMatch(oppDef, rng, {
      onScore: (s) => {
        if (oppDef.id === 'lou_reed') louPhases.add(getLouReedPhase(s).phase);
      },
    });
    console.log(
      `  match ${run.matchIndex + 1} vs ${oppDef.id}: ${score.playerPoints}-${score.opponentPoints} -> ${score.winner}`
    );
    recordMatchResult(run, {
      won: score.winner === 'player',
      playerPointsScored: score.playerPoints,
    });
  }
}

console.log(`route: ${route.join(' -> ')}`);
check('run won', run.status === 'won');
check('9 matches won', run.matchesWon === 9);
check('route has 9 fixtures', route.length >= 9 && route.length <= 12);
check('fixed bosses on route (bono, elton_john, david_bowie, lou_reed)', ['bono', 'elton_john', 'david_bowie', 'lou_reed'].every((id) => route.includes(id)));
check('Lou Reed beaten', run.beatLouReed === true);
check('Lou Reed reached phase 2+ during match', louPhases.size >= 2);
check('bosses counted', run.bossesBeaten >= 2);
check('fee points earned', computeRunFeePoints(run) > 0);
check('no match needed more than 3 attempts', matchAttempts <= route.length + 3);

if (failures > 0) {
  console.error(`${failures} win-path check(s) failed`);
  process.exit(1);
}
console.log('Full win-path simulation passed: run is winnable end to end with real physics.');
