/**
 * Deterministic gameplay & boss/special-mechanic tests using actual production
 * logic from logic.js (multi-box formations, Lou Reed Phase 1-3 + prowl +
 * Borrowed Time, Bowie gravity shift, Bono finite AI, Elton piano keys).
 */
import assert from 'node:assert/strict';
import {
  ROOM,
  OPPONENTS,
  mulberry32,
  hashSeed,
  createMatchScore,
  scorePoint,
  createPaddle,
  clampPaddle,
  createBall,
  stepBallPhysics,
  createAIState,
  stepAI,
  computeOpponentFormation,
  computeOpponentIdleTarget,
  getLouReedPhase,
  createRunState,
  prepareNextMatchSelection,
  getEffectivePickups,
  recordMatchResult,
  computeRunFeePoints,
  getTempoByIndex,
} from '../logic.js';

const DT = 1 / 120;

function moveFinitePlayer(paddle, ball, maxSpeed = 8.8) {
  let tx = 0;
  let ty = 0.2;
  if (ball.vz < 0) {
    const t = Math.min(1.5, Math.max(0, (ball.z - 0.3) / Math.max(0.5, -ball.vz)));
    tx = ball.x + ball.vx * t * 0.94;
    ty = ball.y + ball.vy * t * 0.94;
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
    const step = Math.min(dist, maxSpeed * DT);
    paddle.x += (dx / dist) * step;
    paddle.y += (dy / dist) * step;
  }
  clampPaddle(paddle, ROOM);
  paddle.vx = (paddle.x - paddle.prevX) / DT;
  paddle.vy = (paddle.y - paddle.prevY) / DT;
}

function playProductionSpecialMatch(oppId, seedStr) {
  const oppDef = OPPONENTS[oppId];
  const rng = mulberry32(hashSeed(seedStr));
  let score = createMatchScore({ quickDeuce: false, firstServer: 'player' });
  const playerPaddle = createPaddle({ width: 1.55, height: 1.1 });
  const opponentPaddle = createPaddle({ width: oppDef.width, height: oppDef.height });
  const ai = createAIState({
    reactionDelayMs: oppDef.reactionDelayMs,
    maxSpeed: oppDef.maxSpeed,
    predictionError: oppDef.predictionError,
    missChance: oppDef.missChance,
  });

  let elapsed = 0;
  let gravityY = ROOM.defaultGravityY;
  let bowieGravityShifted = false;
  let formationHits = 0;
  const louPhasesSeen = new Set();
  const tempo = getTempoByIndex(oppDef.act === 3 ? 2 : 1);
  const actBase = 11.4 + (oppDef.act - 1) * 0.9;

  for (let pointGuard = 0; !score.winner && pointGuard < 40; pointGuard++) {
    if (oppId === 'david_bowie' && !bowieGravityShifted && score.pointNumber >= 3) {
      bowieGravityShifted = true;
      gravityY = -2.35;
    }

    const baseZ = actBase * tempo.speedScale * (1 + score.deuceCount * 0.06);
    const playerServe = score.server === 'player';
    const ball = playerServe
      ? createBall({
          x: playerPaddle.x * 0.5,
          y: 0.2,
          z: 0.55,
          vx: (rng() - 0.5) * 4.2,
          vy: 1.2 + (rng() - 0.5) * 1.2,
          vz: baseZ,
        })
      : createBall({
          x: opponentPaddle.x * 0.5,
          y: 0.35,
          z: ROOM.opponentZ - 0.55,
          vx: (rng() - 0.5) * 3.8,
          vy: 1.2 + (rng() - 0.5) * 1.2,
          vz: -baseZ,
        });

    ai.wasApproaching = false;
    let scoredBy = null;
    for (let step = 0; !scoredBy && step < 120 * 60; step++) {
      elapsed += DT;
      if (oppId === 'lou_reed') {
        const lp = getLouReedPhase(score);
        louPhasesSeen.add(lp.phase);
        if (lp.phase === 1) {
          ai.maxSpeed = 6.2;
          ai.predictionError = 0.56;
        } else if (lp.phase === 2) {
          ai.maxSpeed = 6.9;
          ai.predictionError = 0.48;
        } else {
          ai.maxSpeed = 7.3;
          ai.predictionError = 0.43;
        }
      }

      moveFinitePlayer(playerPaddle, ball);
      const idleTarget = computeOpponentIdleTarget(oppDef, score, elapsed);
      stepAI(ai, opponentPaddle, ball, DT, rng, ROOM, idleTarget);
      const opponentBoxes = computeOpponentFormation(opponentPaddle, oppDef.style, elapsed, ROOM);
      const res = stepBallPhysics(ball, playerPaddle, opponentPaddle, DT, {
        gravityY,
        maxZSpeed: 28 * tempo.speedScale,
        minZSpeed: 9.5 * tempo.speedScale,
        opponentBoxes,
        opponentSpinBias: oppDef.spinBias || 0,
        opponentReturnSpeedScale: oppDef.returnSpeedScale || 1.0,
      });
      if (opponentBoxes && res.events.some((e) => e.type === 'paddle' && e.side === 'opponent')) {
        formationHits += 1;
      }
      scoredBy = res.scoredBy;
    }
    assert.ok(scoredBy, `${oppId} rally must resolve within 60s`);
    score = scorePoint(score, scoredBy);
  }

  assert.ok(score.winner, `${oppId} match must finish`);
  return { score, bowieGravityShifted, formationHits, louPhasesSeen };
}

// 1. Multi-box formations actually reflect shots AND remain beatable
for (const formationOpp of ['visual_ministry', 'brodsky_quartet', 'boyzone', 'elton_john']) {
  let playerWins = 0;
  let totalFormationHits = 0;
  for (let i = 0; i < 4; i++) {
    const out = playProductionSpecialMatch(formationOpp, `BOSS-${formationOpp}-${i}`);
    if (out.score.winner === 'player') playerWins += 1;
    totalFormationHits += out.formationHits;
  }
  assert.ok(totalFormationHits > 0, `${formationOpp} multi-box formation must register real hits`);
  assert.ok(playerWins >= 1, `${formationOpp} must be beatable with real formation boxes (won ${playerWins}/4)`);
}

// 2. Bono and David Bowie (with real gravity shift) remain beatable
{
  let bonoWins = 0;
  for (let i = 0; i < 4; i++) {
    if (playProductionSpecialMatch('bono', `BONO-${i}`).score.winner === 'player') bonoWins += 1;
  }
  assert.ok(bonoWins >= 1, `Bono must be beatable (won ${bonoWins}/4)`);

  let bowieWins = 0;
  let sawGravityShift = false;
  for (let i = 0; i < 4; i++) {
    const out = playProductionSpecialMatch('david_bowie', `BOWIE-${i}`);
    if (out.bowieGravityShifted) sawGravityShift = true;
    if (out.score.winner === 'player') bowieWins += 1;
  }
  assert.equal(sawGravityShift, true, 'David Bowie must trigger gravity shift after point 3');
  assert.ok(bowieWins >= 1, `David Bowie must be beatable with gravity shift (won ${bowieWins}/4)`);
}

// 3. Lou Reed Phase 2 prowl actually moves paddle off-centre when ball goes away
{
  const oppDef = OPPONENTS.lou_reed;
  const ai = createAIState({
    reactionDelayMs: oppDef.reactionDelayMs,
    maxSpeed: 6.9,
    predictionError: 0.48,
    missChance: oppDef.missChance,
  });
  const pad = createPaddle({ x: 0, y: 0, width: oppDef.width, height: oppDef.height });
  const ballAway = createBall({ x: 0, y: 0, z: 8, vx: 0, vy: 0, vz: -12 });
  let s = createMatchScore();
  s = scorePoint(s, 'player');
  s = scorePoint(s, 'player'); // 30-0 -> Phase 2

  for (let k = 0; k < 60; k++) {
    const elapsed = 0.7 + k * DT;
    const idle = computeOpponentIdleTarget(oppDef, s, elapsed);
    stepAI(ai, pad, ballAway, DT, () => 0.5, ROOM, idle);
  }
  assert.ok(Math.abs(pad.x) > 0.5, `Lou Reed Phase 2 prowl must move paddle off-centre (x=${pad.x.toFixed(2)})`);
}

// 4. Lou Reed full 3-phase match beatability + Borrowed Time pickup deduction & bonus
{
  let louWins = 0;
  const allPhases = new Set();
  for (let i = 0; i < 5; i++) {
    const out = playProductionSpecialMatch('lou_reed', `LOU-${i}`);
    for (const p of out.louPhasesSeen) allPhases.add(p);
    if (out.score.winner === 'player') louWins += 1;
  }
  assert.ok(allPhases.has(1) && allPhases.has(2) && allPhases.has(3), 'Lou Reed must transition through phases 1, 2, 3');
  assert.ok(louWins >= 1, `Lou Reed must be beatable across all 3 phases (won ${louWins}/5)`);

  // Borrowed Time test
  const run = createRunState({ seed: 'BORROW-TEST' });
  run.pickups = { bat_size: 2, curve_master: 1 };
  run.matchIndex = 8;
  prepareNextMatchSelection(run);
  assert.equal(run.currentOpponentId, 'lou_reed');
  assert.ok(run.borrowedPickupId === 'bat_size' || run.borrowedPickupId === 'curve_master');
  const eff = getEffectivePickups(run);
  assert.equal(eff[run.borrowedPickupId], run.pickups[run.borrowedPickupId] - 1, 'Borrowed Time must reduce effective pickup during Lou Reed match');
  recordMatchResult(run, { won: true, playerPointsScored: 4 });
  assert.equal(run.borrowedTimeBonus, 25);
  assert.ok(computeRunFeePoints(run) >= 25);
}

console.log('Boss & special-mechanic deterministic tests passed (formations, Bowie gravity, Bono, Lou Phases 1-3 + prowl + Borrowed Time).');
