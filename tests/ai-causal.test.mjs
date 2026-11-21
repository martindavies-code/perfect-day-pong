// Seeded simulation FIXTURE for the causal opponent AI (not real-input proof).
// Same initial conditions are replayed, varying one factor at a time, using the
// real stepAI and stepBallPhysics. Prints a table with PDP_AI_REPORT=1.
import assert from 'node:assert/strict';
import {
  ROOM, OPPONENTS, createAIState, createBall, createPaddle, stepAI, stepBallPhysics,
} from '../logic.js';

const DT = 1 / 120;
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ball leaves the player plane at x0,y0 with vz and a landing target (lx,ly) at
// the opponent plane assuming straight flight; spin curves it afterwards.
function trial(def, { lx, ly = 0.3, vz, spinX = 0, seed }) {
  const rng = mulberry32(seed);
  const ai = createAIState({ reactionDelayMs: def.reactionDelayMs, maxSpeed: def.maxSpeed, predictionError: def.predictionError });
  const pad = createPaddle({ x: 0, y: 0, width: def.width, height: def.height });
  const tau = ROOM.opponentZ / vz;
  const ball = createBall({ x: 0, y: 0, z: 0.3, vz, vx: lx / tau, vy: (ly + 0.5 * 1.6 * tau * tau) / tau, spinX, spinY: 0 });
  const dummy = createPaddle({ x: 0, y: 0, width: 9, height: 9 });
  let maxV = 0;
  let maxJump = 0;
  for (let i = 0; i < 2000; i++) {
    const px = pad.x, py = pad.y;
    stepAI(ai, pad, ball, DT, rng, ROOM);
    maxV = Math.max(maxV, Math.hypot(pad.x - px, pad.y - py) / DT);
    maxJump = Math.max(maxJump, Math.hypot(pad.x - px, pad.y - py));
    const r = stepBallPhysics(ball, dummy, pad, DT, { maxZSpeed: 60 });
    if (r.scoredBy === 'player') return { ret: false, maxV, maxJump };
    if (ball.vz < 0) return { ret: true, maxV, maxJump };
  }
  return { ret: false, maxV, maxJump };
}

function rate(def, opts, n = 120) {
  let r = 0, mv = 0, mj = 0;
  for (let k = 0; k < n; k++) {
    const t = trial(def, { ...opts, seed: 1000 + k * 7 });
    if (t.ret) r++;
    mv = Math.max(mv, t.maxV); mj = Math.max(mj, t.maxJump);
  }
  return { rate: r / n, maxV: mv, maxJump: mj };
}

const ids = ['evan_dando', 'sheona_white', 'bono', 'david_bowie', 'lou_reed'].filter((id) => OPPONENTS[id]);
const report = process.env.PDP_AI_REPORT === '1';
const rows = [];
for (const id of ids) {
  const def = OPPONENTS[id];
  const central = rate(def, { lx: 0.3, vz: 16 });
  const corner = rate(def, { lx: 3.2, ly: 1.8, vz: 16 });
  const slowC = rate(def, { lx: 3.2, ly: 1.8, vz: 11 });
  const fastC = rate(def, { lx: 3.2, ly: 1.8, vz: 28 });
  const mid = rate(def, { lx: 3.2, ly: 1.8, vz: 20 });
  const straight = rate(def, { lx: 2.0, vz: 16 });
  const spun = rate(def, { lx: 2.0, vz: 16, spinX: 2.5 });
  const centralFast = rate(def, { lx: 0.3, vz: 28 });
  rows.push({ id, mid20: mid.rate, central: central.rate, corner: corner.rate, slowC: slowC.rate, fastC: fastC.rate, straight: straight.rate, spun: spun.rate, centralFast: centralFast.rate });
  for (const m of [central, corner, fastC, spun]) {
    assert.ok(m.maxV <= def.maxSpeed + 1e-6, `${id}: bat speed ${m.maxV} must not exceed cap ${def.maxSpeed}`);
    assert.ok(m.maxJump <= def.maxSpeed * DT + 1e-6, `${id}: bat teleported ${m.maxJump}`);
  }
  assert.ok(central.rate >= 0.6, `${id}: ordinary central shot should usually be returned (${central.rate})`);
  assert.ok(corner.rate <= central.rate, `${id}: far corner not returned more than central`);
  assert.ok(fastC.rate <= slowC.rate, `${id}: faster hard-to-reach shot not returned more than slower`);
  assert.ok(spun.rate <= straight.rate, `${id}: spun shot not returned more than straight`);
}
if (report) console.table(rows);
console.log('Causal AI fixture checks passed (seeded simulation, real stepAI/stepBallPhysics).');
