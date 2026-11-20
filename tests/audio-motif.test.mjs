// Drives the real audio engine against a recording fake Web Audio API (no sound, no network).
import assert from 'node:assert/strict';
const started = []; // { type, freq, t }
function param(rec) { return new Proxy({ value: 0 }, { get(t, k) { if (k === 'value') return t.value; return (...a) => { if (k === 'setValueAtTime' && rec) rec.freq = a[0]; return param(null); }; }, set(t, k, v) { t[k] = v; return true; } }); }
function node(kind) {
  const rec = kind === 'osc' ? { freq: 0, type: '' } : null;
  const target = { connect() { return this; }, disconnect() {}, start(t) { if (rec) started.push({ type: rec.type, freq: rec.freq, t }); }, stop() {}, setPosition() {}, setOrientation() {} };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'type' && rec) return rec.type;
      if (['frequency', 'gain', 'Q', 'detune', 'delayTime', 'positionX', 'positionY', 'positionZ', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release'].includes(k)) return param(kind === 'osc' && k === 'frequency' ? rec : null);
      if (k === 'getChannelData') return () => new Float32Array(2048);
      return undefined;
    },
    set(t, k, v) { if (k === 'type' && rec) rec.type = v; else t[k] = v; return true; },
  });
}
class FakeCtx {
  constructor() { this.currentTime = 1; this.state = 'running'; this.sampleRate = 44100; this.destination = node('dest'); this.listener = { setPosition() {}, setOrientation() {} }; }
  createOscillator() { return node('osc'); }
  createBuffer() { return { getChannelData: () => new Float32Array(2048) }; }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
}
for (const k of ['createGain', 'createBiquadFilter', 'createPanner', 'createStereoPanner', 'createDelay', 'createDynamicsCompressor', 'createBufferSource', 'createWaveShaper', 'createConvolver']) FakeCtx.prototype[k] = () => node('other');
globalThis.window = { AudioContext: FakeCtx };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
const { createAudioEngine } = await import('../audio.js');
const { midiToFreq } = await import('../logic.js');

const settings = { masterVolume: 1, musicVolume: 1, sfxVolume: 1, spatialMode: 'speakers' };
const motif = { notes: [{ step: 0, midi: 74, len: 2 }, { step: 4, midi: 78, len: 2 }, { step: 8, midi: 81, len: 2 }, { step: 12, midi: 78, len: 4 }], length: 16, tonicPitchClass: 2 };
const eng = createAudioEngine(() => settings);
assert.equal(await eng.unlockFromGesture(), true);
eng.setMatchState({ playing: true, bpm: 124, intensity: 1 });
eng.setMotif(motif);
assert.equal(eng.hasMotif(), true);
await new Promise(r => setTimeout(r, 120)); // sequencer loop runs on a real 25 ms timer
const motifFreqs = new Set(motif.notes.map(n => Math.round(midiToFreq(n.midi))));
const leadHits = started.filter(s => s.type === 'square' && motifFreqs.has(Math.round(s.freq)));
assert.ok(leadHits.length >= 1, 'Lead tune notes are scheduled on the beat grid');
// Racket hits play the next tune note instead of a scale note.
started.length = 0;
eng.playImpact({ type: 'paddle', side: 'player', x: 0, y: 0, z: 1 });
const hit = started.find(s => Math.abs(s.freq - midiToFreq(74) * 1.4) < 0.5);
assert.ok(hit, 'First racket hit plays the first lead note');
eng.playImpact({ type: 'wall', surface: 'left', x: 1, y: 0, z: 1 });
eng.playImpact({ type: 'miss', side: 'opponent', x: 0, y: 0, z: 1 });
// Removing the tune restores the built-in house track.
eng.setMotif(null);
assert.equal(eng.hasMotif(), false);
eng.destroy();
console.log('Audio engine lead-tune scheduling and racket-hit integration passed.');
process.exit(0);
