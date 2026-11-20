import assert from 'node:assert/strict';
import { parseMidi, buildMotif, validMotif, loadMotif, saveMotif, motifFromMidiBytes } from '../midi.js';
import { INTERSTITIAL_CARDS } from '../content.js';

// Synthetic MIDI (written here, not a third-party song): format 0, 96 ppq, one track.
function vlq(n) { const o = [n & 0x7f]; while ((n >>= 7)) o.unshift((n & 0x7f) | 0x80); return o; }
function makeMidi(notes, ppq = 96) {
  const ev = [];
  let t = 0;
  for (const [pitch, startStep, lenSteps] of notes) {
    const on = startStep * ppq / 4, off = on + lenSteps * ppq / 4;
    ev.push([on, [0x90, pitch, 90]], [off, [0x80, pitch, 0]]);
  }
  ev.sort((a, b) => a[0] - b[0]);
  const body = [];
  for (const [tick, bytes] of ev) { body.push(...vlq(tick - t), ...bytes); t = tick; }
  body.push(0, 0xff, 0x2f, 0);
  const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255];
  const trk = [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
  return new Uint8Array([...hdr, ...trk, ...body]);
}
const tune = [[62, 0, 2], [66, 2, 2], [69, 4, 2], [66, 6, 2], [62, 8, 2], [64, 10, 2], [66, 12, 2], [62, 16, 4]];
const m = motifFromMidiBytes(makeMidi(tune));
assert.ok(validMotif(m));
assert.equal(m.notes.length, 8);
assert.deepEqual(m.notes.map(n => n.step), [0, 2, 4, 6, 8, 10, 12, 16]);
assert.equal(m.length, 32);
assert.equal(m.tonicPitchClass, 2, 'D is the longest-weighted pitch class');
assert.ok(m.notes.every(n => n.midi >= 60 && n.midi <= 84));
assert.throws(() => parseMidi(new Uint8Array([1, 2, 3])), /standard MIDI/);
assert.throws(() => parseMidi(new Uint8Array(600 * 1024)), /too large/);
assert.throws(() => motifFromMidiBytes(makeMidi([[60, 0, 1]])), /Too few/);
// Storage is local-only and rejects tampered data.
const store = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
assert.equal(loadMotif(store), null);
saveMotif(m, store);
assert.deepEqual(loadMotif(store), m);
store.d['pdp.motif.v1'] = JSON.stringify({ ...m, notes: [{ step: -1, midi: 60, len: 1 }] });
assert.equal(loadMotif(store), null);
saveMotif(null, store);
assert.equal(loadMotif(store), null);

// Birt cards: every sourced card cites its source; satire is labelled as invented.
const birt = INTERSTITIAL_CARDS.filter(c => c.tag === 'SOURCED' || c.tag === 'SATIRE, INVENTED');
assert.ok(birt.filter(c => c.tag === 'SOURCED').length >= 5);
assert.ok(birt.filter(c => c.tag === 'SOURCED').every(c => /Wikipedia/.test(c.source)));
assert.ok(birt.filter(c => c.tag === 'SATIRE, INVENTED').every(c => !/["“]/.test(c.text) && !c.source));
console.log('MIDI motif and Birt card regressions passed.');
