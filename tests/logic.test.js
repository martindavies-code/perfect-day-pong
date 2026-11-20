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
  createRunState,
  pickOpponent,
  recordMatchResult,
  choosePickup,
  getLouReedPhase,
  computeRunFeePoints,
  computeUnspentPoints,
  purchaseUpgrade,
  createDefaultSave,
  validateAndSanitizeSave,
  detectCloudConflict,
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

// --- 6. Roguelike 9-match run, lives, Extra Life guarantee, Lou Reed phases ---
{
  let run = createRunState({ seed: 'TEST-RUN-1', upgradeLevels: { startLives: 2 } });
  assert.equal(run.lives, 5, 'Starting lives upgrade capped at 5');
  assert.equal(run.status, 'choose_opponent');

  // Lose a match -> lose 1 life, replay same opponent
  pickOpponent(run, run.offeredOpponents[0]);
  const firstOpp = run.currentOpponentId;
  recordMatchResult(run, { won: false, playerPointsScored: 2 });
  assert.equal(run.lives, 4);
  assert.equal(run.currentOpponentId, firstOpp);
  assert.equal(run.status, 'playing');

  // Win matches 0..7
  for (let m = 0; m < 8; m++) {
    if (run.status === 'choose_opponent') {
      pickOpponent(run, run.offeredOpponents[0]);
    }
    assert.equal(run.status, 'playing');
    if (m === 5) assert.equal(run.currentOpponentId, 'bono');
    if (m === 6) assert.equal(run.currentOpponentId, 'elton_john');
    if (m === 7) assert.equal(run.currentOpponentId, 'david_bowie');

    recordMatchResult(run, { won: true, playerPointsScored: 4 });
    assert.equal(run.status, 'choose_pickup');
    // Pick bat_size if offered, else first
    const choice = run.offeredPickups.includes('bat_size') ? 'bat_size' : run.offeredPickups[0];
    choosePickup(run, choice);
  }

  assert.ok(run.extraLifeOffersCount >= 2, 'Must guarantee at least 2 Extra Life offers per run');
  assert.equal(run.matchIndex, 8);
  assert.equal(run.currentOpponentId, 'lou_reed');
  assert.equal(run.status, 'playing');

  // Win Lou Reed
  recordMatchResult(run, { won: true, playerPointsScored: 4 });
  assert.equal(run.status, 'won');
  assert.equal(run.beatLouReed, true);

  const fp = computeRunFeePoints(run);
  assert.ok(fp >= 9 * 10 + 38 + 2 * 5 + 50, `Unexpected Fee Points total: ${fp}`);
}

// Pickup offer never empty even when all pickups maxed and lives == 5
{
  const run = createRunState({ seed: 'FULL-MAX', upgradeLevels: { startLives: 2 } });
  run.pickups = {
    bat_size: 3,
    bat_speed: 3,
    tempo_control: 3,
    curve_master: 2,
    shadow_sight: 2,
    second_chance: 1,
    sticky_bat: 1,
  };
  run.lives = 5;
  pickOpponent(run, run.offeredOpponents[0]);
  recordMatchResult(run, { won: true, playerPointsScored: 4 });
  assert.ok(run.offeredPickups.length >= 1, 'Pickup offer must never be empty');
  assert.equal(run.offeredPickups[0], 'fee_grant');
  choosePickup(run, 'fee_grant');
  assert.equal(run.pickupFeeBonus, 15);
}

// Lou Reed phases by scoreline
{
  let s = createMatchScore();
  assert.equal(getLouReedPhase(s).phase, 1);
  s = scorePoint(s, 'player'); // 15-0
  assert.equal(getLouReedPhase(s).phase, 1);
  s = scorePoint(s, 'player'); // 30-0 -> Phase 2
  assert.equal(getLouReedPhase(s).phase, 2);
  s = scorePoint(s, 'player'); // 40-0 -> Phase 3
  assert.equal(getLouReedPhase(s).phase, 3);
  assert.equal(getLouReedPhase(s).warm, true);
}

// --- 7. Fee Points, upgrades, save validation & cloud conflict ---
{
  let save = createDefaultSave('test-dev');
  save.totalEarned = 50;
  assert.equal(computeUnspentPoints(save), 50);

  const p1 = purchaseUpgrade(save, 'startBatSize');
  assert.equal(p1.ok, true);
  save = p1.save;
  assert.equal(computeUnspentPoints(save), 35);

  const tooExpensive = purchaseUpgrade(save, 'startLives'); // costs 40, only 35 left
  assert.equal(tooExpensive.ok, false);

  // Strict import rejects unknown keys, future schemaVersion, and negative unspent balance
  const badKey = validateAndSanitizeSave({ totalEarned: 100, bogus: 1 }, { strict: true });
  assert.equal(badKey.ok, false);

  const badVer = validateAndSanitizeSave({ schemaVersion: 99, totalEarned: 10 }, { strict: true });
  assert.equal(badVer.ok, false);

  const badNeg = validateAndSanitizeSave(
    { totalEarned: 5, upgradeLevels: { startBatSize: 3 } },
    { strict: true }
  );
  assert.equal(badNeg.ok, false);

  // Corrupt non-strict load falls back safely
  const corrupt = validateAndSanitizeSave('not an object', { strict: false });
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.save.totalEarned, 0);

  // Cloud conflict detection
  const conflict = detectCloudConflict({
    localSave: { revision: 4 },
    remoteSave: { revision: 5 },
    lastSyncedRevision: 3,
    lastSyncedRemoteVersion: 'v1',
    remoteVersion: 'v2',
  });
  assert.equal(conflict.status, 'conflict');

  const noConflictUpload = detectCloudConflict({
    localSave: { revision: 4 },
    remoteSave: { revision: 3 },
    lastSyncedRevision: 3,
    lastSyncedRemoteVersion: 'v1',
    remoteVersion: 'v1',
  });
  assert.equal(noConflictUpload.status, 'upload_local');
}

console.log('All Step 2 logic, physics, AI, run, upgrades & save tests passed.');


// First-device safety: no baseline must never overwrite either copy.
for (const localSave of [createDefaultSave('fresh'), {...createDefaultSave('used'), revision: 9, totalEarned: 300}]) {
  for (const meta of [{}, {lastSyncedRevision: null, lastSyncedRemoteVersion: null}, {lastSyncedRevision: 0}]) {
    assert.equal(detectCloudConflict({localSave, remoteSave: createDefaultSave('cloud'), remoteVersion: 'remote-v1', ...meta}).status, 'conflict');
  }
}
assert.equal(detectCloudConflict({localSave: createDefaultSave(), remoteSave: null}).status, 'no_remote');
assert.equal(detectCloudConflict({localSave: {revision: 2}, remoteSave: {revision: 3}, lastSyncedRevision: 2, lastSyncedRemoteVersion: 'v2', remoteVersion: 'v3'}).status, 'pull_remote');
console.log('Fresh-device and missing-baseline safety regressions passed.');
