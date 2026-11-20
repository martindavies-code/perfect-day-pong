import assert from 'node:assert/strict';
import {
  ROOM,
  createMatchScore,
  scorePoint,
  formatTennisScore,
  createPaddle,
  createBall,
  stepBallPhysics,
  createAIState,
  stepAI,
  mulberry32,
  hashSeed,
  gameToAudioCoords,
  computeDistanceGain,
  computeDopplerRate,
  quantizeToNextStep,
  createVoiceTracker,
} from '../logic.js';

function playSequence(seq, opts = {}) {
  let state = createMatchScore(opts);
  for (const who of seq) {
    state = scorePoint(state, who);
  }
  return state;
}

// --- 1. Tennis scoring state machine ---
{
  const s = createMatchScore();
  const fmt = formatTennisScore(s);
  assert.equal(fmt.playerLabel, '0');
  assert.equal(fmt.opponentLabel, '0');
  assert.equal(fmt.winner, null);
  assert.equal(s.server, 'player');
}

{
  let s = createMatchScore();
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '15 - 0');
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '30 - 0');
  s = scorePoint(s, 'player');
  assert.equal(formatTennisScore(s).statusText, '40 - 0');
  s = scorePoint(s, 'player');
  assert.equal(s.winner, 'player');
  assert.equal(formatTennisScore(s).statusText, 'GAME PLAYER');
}

{
  const s42 = playSequence(['player', 'opponent', 'player', 'opponent', 'player', 'player']);
  assert.equal(s42.winner, 'player');

  const s53 = playSequence([
    'player', 'player', 'player',
    'opponent', 'opponent', 'opponent',
    'opponent', 'opponent',
  ]);
  assert.equal(s53.winner, 'opponent');
}

{
  let s = playSequence(['player', 'opponent', 'player', 'opponent', 'player', 'opponent']);
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).isDeuce, true);
  assert.equal(formatTennisScore(s).deuceCount, 1);

  s = scorePoint(s, 'player'); // 4-3 Ad
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).isAdvantage, true);

  s = scorePoint(s, 'opponent'); // 4-4 Deuce 2
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).deuceCount, 2);

  s = scorePoint(s, 'player'); // 5-4 Ad
  s = scorePoint(s, 'opponent'); // 5-5 Deuce 3
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).isDecidingPoint, false);

  s = scorePoint(s, 'player'); // 6-5 Ad
  assert.equal(s.winner, null);
  s = scorePoint(s, 'player'); // 7-5 Win
  assert.equal(s.winner, 'player');
}

{
  let s = playSequence(
    [
      'player', 'opponent', 'player', 'opponent', 'player', 'opponent',
      'player', 'opponent',
      'player', 'opponent',
    ],
    { quickDeuce: true }
  );
  assert.equal(s.winner, null);
  assert.equal(formatTennisScore(s).isDecidingPoint, true);
  s = scorePoint(s, 'opponent');
  assert.equal(s.winner, 'opponent');
}

{
  let s = createMatchScore({ firstServer: 'player' });
  assert.equal(s.server, 'player');
  s = scorePoint(s, 'player');
  assert.equal(s.server, 'opponent');
  s = scorePoint(s, 'opponent');
  assert.equal(s.server, 'player');
}

// --- 2. Seeded RNG repeatability ---
{
  const r1 = mulberry32(hashSeed('PDP-SEED-42'));
  const r2 = mulberry32(hashSeed('PDP-SEED-42'));
  const seq1 = Array.from({ length: 10 }, () => r1());
  const seq2 = Array.from({ length: 10 }, () => r2());
  assert.deepEqual(seq1, seq2);
}

// --- 3. 3D Physics & Swept Collision (no tunneling at max speed) ---
{
  const player = createPaddle({ x: 0, y: 0, width: 1.5, height: 1.1 });
  const opp = createPaddle({ x: 0, y: 0, width: 1.5, height: 1.1 });
  // Ball very close to z=0 moving at extreme speed -35 m/s over dt=0.05 (moves 1.75m in one step!)
  const ball = createBall({ x: 0.1, y: 0.1, z: 0.3, vx: 0, vy: 0, vz: -35 });
  const res = stepBallPhysics(ball, player, opp, 0.05, { gravityY: 0 });
  assert.equal(res.scoredBy, null);
  assert.ok(ball.vz > 0, 'Ball must reflect cleanly without tunneling past z=0');
  assert.ok(res.events.some((e) => e.type === 'paddle' && e.side === 'player'));

  // Opposite plane at z=ROOM.opponentZ
  const ball2 = createBall({ x: 0, y: 0, z: ROOM.opponentZ - 0.25, vx: 0, vy: 0, vz: 35 });
  const res2 = stepBallPhysics(ball2, player, opp, 0.05, { gravityY: 0 });
  assert.equal(res2.scoredBy, null);
  assert.ok(ball2.vz < 0, 'Ball must reflect cleanly without tunneling past opponent plane');

  // Miss outside paddle
  const ballMiss = createBall({ x: 3.5, y: 2.0, z: 0.2, vx: 0, vy: 0, vz: -20 });
  const resMiss = stepBallPhysics(ballMiss, player, opp, 0.05, { gravityY: 0 });
  assert.equal(resMiss.scoredBy, 'opponent');
}

// --- 4. Finite beatable AI test (max-difficulty AI still loses points) ---
{
  const rng = mulberry32(12345);
  // Even hardest AI config: reactionDelay clamped >=110ms, finite speed/error/miss
  const ai = createAIState({
    reactionDelayMs: 60, // should clamp to >= 110ms
    maxSpeed: 7.4,
    predictionError: 0.52,
    missChance: 0.07,
  });
  assert.ok(ai.reactionDelayMs >= 110, 'Reaction delay must never be below 110ms');

  const oppPaddle = createPaddle({ x: 0, y: 0, width: 1.5, height: 1.1 });
  const playerPaddle = createPaddle({ x: 0, y: 0, width: 1.6, height: 1.15 });
  let playerPointsWon = 0;

  for (let rally = 0; rally < 40; rally++) {
    ai.wasApproaching = false; // simulates ball previously moving away before player hit
    const cornerX = rally % 2 === 0 ? 3.2 : -3.2;
    const cornerY = rally % 3 === 0 ? 1.8 : -1.5;
    const ball = createBall({
      x: 0,
      y: 0,
      z: 0.4,
      vx: cornerX * 1.4,
      vy: cornerY * 1.2,
      vz: 23.0,
      spinX: rally % 2 === 0 ? 3.2 : -3.2,
      spinY: 0.8,
    });
    for (let step = 0; step < 300; step++) {
      stepAI(ai, oppPaddle, ball, 1 / 120, rng, ROOM);
      const { scoredBy } = stepBallPhysics(ball, playerPaddle, oppPaddle, 1 / 120);
      if (scoredBy === 'player') {
        playerPointsWon += 1;
        break;
      }
      if (scoredBy === 'opponent' || ball.vz < 0) {
        break;
      }
    }
  }
  assert.ok(playerPointsWon > 0, `Hardest AI must be beatable; player won ${playerPointsWon}/40 shots`);
}

// --- 5. Spatial Audio mapping, distance gain, Doppler, quantiser & voice caps ---
{
  const leftNear = gameToAudioCoords(-3, 0, 1);
  const rightNear = gameToAudioCoords(3, 0, 1);
  assert.ok(leftNear.x < 0 && rightNear.x > 0);
  assert.ok(leftNear.z < 0, 'Game +z maps to Web Audio -z');

  const gNear = computeDistanceGain(3.0);
  const gFar = computeDistanceGain(19.0);
  assert.ok(gNear > gFar, 'Far sounds must be quieter than near sounds');

  const dopApproaching = computeDopplerRate({ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: -15 });
  const dopReceding = computeDopplerRate({ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 15 });
  assert.ok(dopApproaching > 1.0 && dopReceding < 1.0);

  const q = quantizeToNextStep(10.123, 0, 120, 4);
  assert.ok(q.stepTime > 10.123, 'Quantized step must never be in the past');

  const vt = createVoiceTracker({ maxVoices: 4, minSurfaceIntervalMs: 40 });
  assert.equal(vt.canTriggerSurface('left', 100), true);
  assert.equal(vt.canTriggerSurface('left', 115), false);
  assert.equal(vt.canTriggerSurface('left', 145), true);
  for (let i = 0; i < 6; i++) {
    vt.registerVoice({ id: i, priority: 1, startedAt: i });
  }
  assert.equal(vt.count(), 4, 'Voice tracker must enforce maxVoices cap');
}

console.log('All Step 1 logic, physics, AI & audio math tests passed.');
