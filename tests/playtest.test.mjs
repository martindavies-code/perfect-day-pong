import assert from 'node:assert/strict';
import { applyMouseSample, getScoreCall, getSpokenScoreCall, getRunRoute } from '../playtest.js';
import { createScoreAnnouncer } from '../announcer.js';
import { createInputManager } from '../input.js';
import { ROOM, OPPONENTS, createPaddle, createBall, stepBallPhysics, createRunState, pickOpponent, recordMatchResult, choosePickup, createMatchScore, scorePoint, createDefaultSave, validateAndSanitizeSave } from '../logic.js';

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
assert.ok(Math.hypot(pad.vx, pad.vy) <= 24.000001, 'Cursor warp does not create an excessive spin impulse');
for (const hz of [30, 60, 120, 144]) {
  const p = createPaddle();
  applyMouseSample(p, { targetNormX: .3 / hz, targetNormY: 0 }, 1 / hz);
  assert.ok(Math.abs(p.vx - .3 * (ROOM.halfW - p.width / 2)) < 1e-9, 'Swipe speed independent of display rate');
}
// Holding a frame's swipe velocity across 120 Hz physics substeps must cause
// only the single physical contact, not repeatedly add another spin impulse.
const framePad = createPaddle();
applyMouseSample(framePad, { targetNormX: .25, targetNormY: 0 }, 1 / 60);
const crossing = createBall({ x: framePad.x, y: 0, z: .15, vz: -12 });
let contacts = 0;
for (let i = 0; i < 6; i++) {
  const result = stepBallPhysics(crossing, framePad, createPaddle(), 1 / 120);
  contacts += result.events.filter(e => e.type === 'paddle' && e.side === 'player').length;
}
assert.equal(contacts, 1);
assert.ok(Math.abs(crossing.spinX) <= 24 * .22 + .01);
applyMouseSample(framePad, { targetNormX: .25, targetNormY: 0 }, 1 / 60);
assert.equal(framePad.vx, 0, 'No stale swipe velocity in a stationary next frame');

// Source-grounded guide: edge contact aims outward; moving bat adds curve.
const still = createPaddle(), moving = createPaddle(); moving.vx = 4;
const edgeBall = createBall({ x: .5, y: 0, z: .05, vz: -12 });
stepBallPhysics(edgeBall, still, createPaddle(), .01);
assert.ok(edgeBall.vx > 0 && edgeBall.spinX < 0);
const swipeBall = createBall({ x: 0, y: 0, z: .05, vz: -12 });
stepBallPhysics(swipeBall, moving, createPaddle(), .01);
assert.ok(swipeBall.vx > 0 && swipeBall.spinX > 0);

let score = createMatchScore();
assert.equal(getScoreCall(score), 'Love all.');
assert.equal(getSpokenScoreCall(score), 'Love all.');
for (const [n, word] of [[1, '15'], [2, '30']]) {
  const level = { ...createMatchScore(), playerPoints: n, opponentPoints: n };
  assert.equal(getScoreCall(level), `${word} all.`);
  assert.equal(getSpokenScoreCall(level), `${word} all.`);
  assert.doesNotMatch(getSpokenScoreCall(level), /\b15\. 15|30\. 30|Love\. Love/);
}
assert.equal(getSpokenScoreCall({ ...createMatchScore(), playerPoints: 1, opponentPoints: 0 }), '15. Love.');
score = scorePoint(score, 'opponent'); score = scorePoint(score, 'opponent'); score = scorePoint(score, 'opponent');
assert.match(getScoreCall(score), /Match point, opponent/);
assert.match(getSpokenScoreCall(score), /^Match point, opponent. Love. 40./, 'Urgent spoken match point comes first');
score = scorePoint(score, 'opponent');
assert.equal(getScoreCall(score), 'Match to opponent.');
assert.match(getScoreCall({ ...createMatchScore({ quickDeuce: true }), playerPoints: 5, opponentPoints: 5, deuceCount: 3 }), /Deciding point/);

// Advantage calls name the players (Birt and the opponent's call name), on
// screen and in speech, while every other call keeps its generic wording.
const names = { player: 'Birt', opponent: 'Dando' };
const advP = { ...createMatchScore(), playerPoints: 4, opponentPoints: 3 };
const advO = { ...createMatchScore(), playerPoints: 3, opponentPoints: 4 };
assert.equal(getScoreCall(advP, names), 'Advantage, Birt. Match point, you.');
assert.equal(getScoreCall(advO, names), 'Advantage, Dando. Match point, opponent.');
assert.equal(getSpokenScoreCall(advP, names), 'Advantage, Birt. Match point, you.');
assert.equal(getSpokenScoreCall(advO, names), 'Advantage, Dando. Match point, opponent.');
assert.equal(getScoreCall(advP), 'Advantage, you. Match point, you.', 'No names falls back to generic wording');
assert.equal(getScoreCall({ ...createMatchScore(), playerPoints: 3, opponentPoints: 3 }, names), 'Deuce.', 'Deuce stays unnamed');
assert.equal(getSpokenScoreCall({ ...createMatchScore(), playerPoints: 1, opponentPoints: 0 }, names), '15. Love.', 'Point calls stay unnamed');
assert.match(getScoreCall(advP, { player: 'Birt', opponent: 'Brodsky Quartet' }), /^Advantage, Birt\./);
assert.match(getScoreCall(advO, { player: 'Birt', opponent: 'Brodsky Quartet' }), /^Advantage, Brodsky Quartet\./, 'Group call names work');
// Every opponent has a call name for the announcer.
for (const [id, opp] of Object.entries(OPPONENTS)) {
  assert.ok(opp.callName && opp.callName.length > 0, `${id} has a callName`);
  assert.ok(!/you|opponent/i.test(opp.callName), `${id} callName is a real name`);
}

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

let calls = [], queue = [], canceled = 0, settings = { masterVolume: .8, sfxVolume: .5, announcerEnabled: true }, muted = false;
const remoteVoice = { lang: 'en-GB', localService: false };
const localVoice = { lang: 'en-GB', localService: true };
const speechDocument = new EventTarget();
speechDocument.hidden = false;
const env = { document: speechDocument, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }, speechSynthesis: { getVoices: () => [remoteVoice, localVoice], cancel() { canceled++; queue = []; }, speak(line) { calls.push(line); queue.push(line); } } };
const voice = createScoreAnnouncer(() => settings, () => muted, env);
assert.equal(voice.say('You fifteen.'), false, 'No voice before a user gesture');
voice.unlock(); assert.equal(voice.say('You fifteen.'), true);
voice.say('Latest score.');
assert.equal(queue.length, 1, 'Rapid score changes replace, rather than queue, stale speech');
assert.equal(queue[0].text, 'Latest score.');
speechDocument.hidden = true; speechDocument.dispatchEvent(new Event('visibilitychange'));
assert.equal(queue.length, 0, 'Hiding the page cancels queued speech');
speechDocument.hidden = false;
assert.equal(calls[0].voice, localVoice); assert.equal(calls[0].volume, .4); assert.equal(calls[0].pitch, .55);
muted = true; assert.equal(voice.say('Muted'), false); muted = false;
settings.announcerEnabled = false; assert.equal(voice.say('Off'), false); settings.announcerEnabled = true;
env.speechSynthesis.getVoices = () => [remoteVoice];
assert.equal(voice.say('Unavailable'), false, 'Never falls back to a network voice');
assert.match(voice.status(), /on screen/);
assert.ok(canceled >= 5);
env.speechSynthesis.getVoices = () => [localVoice];
assert.equal(voice.say('Voice installed later.'), true);
queue[0].onerror({ error: 'synthesis-failed' });
assert.equal(voice.say('Failed voice'), false);
assert.match(voice.status(), /on screen/);
voice.destroy();
const noApiVoice = createScoreAnnouncer(() => settings, () => false, {});
noApiVoice.unlock(); assert.equal(noApiVoice.say('No API'), false); noApiVoice.destroy();
const save = createDefaultSave(); save.settings.announcerEnabled = false;
assert.equal(validateAndSanitizeSave(save).save.settings.announcerEnabled, false, 'Setting survives save validation');

// High-rate input must use cached bounds, not force a layout read per event.
const oldWindow = globalThis.window, oldDocument = globalThis.document;
const w = new EventTarget(), d = new EventTarget(), c = new EventTarget(); let reads = 0;
let bounds = { left: 0, top: 0, width: 1000, height: 600 };
const oldGetGamepads = navigator.getGamepads;
const gamepad = { index: 0, connected: true, axes: [.8, 0], buttons: Array.from({length:16}, () => ({pressed:false})), id: 'test-pad' };
navigator.getGamepads = () => [gamepad];
c.getBoundingClientRect = () => { reads++; return bounds; };
globalThis.window = w; globalThis.document = d;
try {
  const input = createInputManager(c, () => ({ mouseSensitivity: 1 }));
  assert.equal(input.update(1 / 60).method, 'gamepad');
  for (let i = 0; i < 100; i++) { const e = new Event('mousemove'); Object.assign(e, { clientX: 500 + i, clientY: 300, movementX: 1, movementY: 0 }); c.dispatchEvent(e); }
  assert.equal(reads, 1); assert.equal(input.update(1 / 60).mode, 'absolute');
  assert.equal(input.update(1 / 60).method, 'mouse', 'A held gamepad stick cannot steal mouse control');
  gamepad.axes[0] = -.8;
  assert.equal(input.update(1 / 60).method, 'gamepad', 'A fresh stick movement deliberately switches back');
  bounds = { left: 100, top: 50, width: 500, height: 300 };
  w.dispatchEvent(new Event('resize')); assert.equal(reads, 2);
  const centred = new Event('mousemove'); Object.assign(centred, { clientX: 350, clientY: 200, movementX: 0, movementY: 0 }); c.dispatchEvent(centred);
  assert.equal(input.update(1 / 60).targetNormX, 0, 'Resized canvas uses new CSS bounds');
  bounds = { ...bounds, left: 150 };
  w.dispatchEvent(new Event('scroll')); assert.equal(reads, 3);
  c.dispatchEvent(centred); assert.ok(input.update(1 / 60).targetNormX < 0, 'Scroll refreshes the cached canvas origin');
  input.destroy();
} finally { globalThis.window = oldWindow; globalThis.document = oldDocument; navigator.getGamepads = oldGetGamepads; }
console.log('Playtest controls, spin guide, scoring, route, local-only voice and input-layout regressions passed.');
