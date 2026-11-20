import assert from 'node:assert/strict';
import { applyMouseSample, getScoreCall, getSpokenScoreCall, getRunRoute } from '../playtest.js';
import { createScoreAnnouncer } from '../announcer.js';
import { createInputManager } from '../input.js';
import { ROOM, createPaddle, createBall, stepBallPhysics, createRunState, pickOpponent, recordMatchResult, choosePickup, createMatchScore, scorePoint, createDefaultSave, validateAndSanitizeSave } from '../logic.js';

const pad = createPaddle();
applyMouseSample(pad, { targetNormX: .5, targetNormY: -.5 }, 1 / 60);
assert.equal(pad.x, (ROOM.halfW - pad.width / 2) * .5, 'Mouse reaches target in one sample, no easing');
assert.equal(pad.y, -(ROOM.halfH - pad.height / 2) * .5);
assert.ok(pad.vx > 0 && pad.vy < 0, 'Swipe velocity retained for collision spin');
applyMouseSample(pad, { targetNormX: .5, targetNormY: -.5 }, 1 / 60);
assert.equal(pad.vx, 0, 'Stationary target does not keep adding spin');
applyMouseSample(pad, { targetNormX: 10, targetNormY: -10 }, 0);
assert.equal(pad.x + pad.width / 2, ROOM.halfW);
assert.ok(Number.isFinite(pad.vx));
for (const hz of [30, 60, 120, 144]) {
  const p = createPaddle();
  applyMouseSample(p, { targetNormX: .3 / hz, targetNormY: 0 }, 1 / hz);
  assert.ok(Math.abs(p.vx - .3 * (ROOM.halfW - p.width / 2)) < 1e-9, 'Swipe speed independent of display rate');
}
// Source-grounded guide: edge contact aims outward; moving bat adds curve.
const still = createPaddle(), moving = createPaddle(); moving.vx = 4;
const edgeBall = createBall({ x: .5, y: 0, z: .05, vz: -12 });
stepBallPhysics(edgeBall, still, createPaddle(), .01);
assert.ok(edgeBall.vx > 0 && edgeBall.spinX < 0);
const swipeBall = createBall({ x: 0, y: 0, z: .05, vz: -12 });
stepBallPhysics(swipeBall, moving, createPaddle(), .01);
assert.ok(swipeBall.vx > 0 && swipeBall.spinX > 0);

let score = createMatchScore();
assert.match(getScoreCall(score), /You love. Opponent love/);
score = scorePoint(score, 'opponent'); score = scorePoint(score, 'opponent'); score = scorePoint(score, 'opponent');
assert.match(getScoreCall(score), /Match point, opponent/);
assert.match(getSpokenScoreCall(score), /^Match point, opponent. Love. 40./, 'Urgent spoken match point comes first');
score = scorePoint(score, 'opponent');
assert.equal(getScoreCall(score), 'Match to opponent.');
assert.match(getScoreCall({ ...createMatchScore({ quickDeuce: true }), playerPoints: 5, opponentPoints: 5, deuceCount: 3 }), /Deciding point/);

const run = createRunState({ seed: 'ROUTE-1234' });
for (let i = 0; i < 9; i++) {
  const before = JSON.stringify(run), route = getRunRoute(run);
  assert.equal(JSON.stringify(run), before, 'Route never consumes RNG or changes run');
  assert.deepEqual(route.slice(5).map(n => n.ids[0]), ['bono', 'elton_john', 'david_bowie', 'lou_reed']);
  if (run.status === 'choose_opponent') {
    assert.deepEqual(route[i].ids, run.offeredOpponents, 'Current branch is the real offer');
    for (const n of route.slice(i + 1, 5)) { assert.equal(n.type, 'pool'); assert.ok(n.ids.every(id => !run.usedOpponents.includes(id))); }
    pickOpponent(run, run.offeredOpponents[0]);
  }
  recordMatchResult(run, { won: true, playerPointsScored: 4 });
  if (run.status === 'choose_pickup') choosePickup(run, run.offeredPickups[0]);
}

let calls = [], canceled = 0, settings = { masterVolume: .8, sfxVolume: .5, announcerEnabled: true }, muted = false;
const remoteVoice = { lang: 'en-GB', localService: false };
const localVoice = { lang: 'en-GB', localService: true };
const env = { SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { getVoices: () => [remoteVoice, localVoice], cancel() { canceled++; }, speak(line) { calls.push(line); } } };
const voice = createScoreAnnouncer(() => settings, () => muted, env);
assert.equal(voice.say('You fifteen.'), false, 'No voice before a user gesture');
voice.unlock(); assert.equal(voice.say('You fifteen.'), true);
assert.equal(calls[0].voice, localVoice); assert.equal(calls[0].volume, .4); assert.equal(calls[0].pitch, .55);
muted = true; assert.equal(voice.say('Muted'), false); muted = false;
settings.announcerEnabled = false; assert.equal(voice.say('Off'), false); settings.announcerEnabled = true;
env.speechSynthesis.getVoices = () => [remoteVoice];
assert.equal(voice.say('Unavailable'), false, 'Never falls back to a network voice');
assert.match(voice.status(), /on screen/);
assert.ok(canceled >= 5); voice.destroy();
const save = createDefaultSave(); save.settings.announcerEnabled = false;
assert.equal(validateAndSanitizeSave(save).save.settings.announcerEnabled, false, 'Setting survives save validation');

// High-rate input must use cached bounds, not force a layout read per event.
const oldWindow = globalThis.window, oldDocument = globalThis.document;
const w = new EventTarget(), d = new EventTarget(), c = new EventTarget(); let reads = 0;
c.getBoundingClientRect = () => { reads++; return { left: 0, top: 0, width: 1000, height: 600 }; };
globalThis.window = w; globalThis.document = d;
try {
  const input = createInputManager(c, () => ({ mouseSensitivity: 1 }));
  for (let i = 0; i < 100; i++) { const e = new Event('mousemove'); Object.assign(e, { clientX: 500 + i, clientY: 300, movementX: 1, movementY: 0 }); c.dispatchEvent(e); }
  assert.equal(reads, 1); assert.equal(input.update(1 / 60).mode, 'absolute');
  w.dispatchEvent(new Event('resize')); assert.equal(reads, 2);
  input.destroy();
} finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
console.log('Playtest controls, spin guide, scoring, route, local-only voice and input-layout regressions passed.');
