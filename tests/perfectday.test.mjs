import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PERFECT_DAY_MOTIF as m } from '../perfectday.js';
import { validMotif } from '../midi.js';
assert.ok(validMotif(m), 'built-in Perfect Day lead line is a valid motif');
// The lead is the full chorus of the owner-supplied karaoke MIDI, not the verse:
// 16 bars of 16ths, opening "Oh it's such a perfect day" on F F Bb A A G G (+12).
assert.equal(m.length, 256);
assert.ok(m.notes.length >= 30);
assert.deepEqual(m.notes.slice(0, 7).map(n => n.midi), [77, 77, 82, 81, 81, 79, 79], 'chorus opening phrase');
// The "you just keep me hanging on" hook appears twice, a minor third descent G A Bb ... A G.
const hook = m.notes.filter(n => n.step >= 140 && n.step <= 172).map(n => n.midi);
assert.deepEqual(hook, [79, 81, 82, 82, 81, 81, 79], 'first hanging-on hook contour');
const hook2 = m.notes.filter(n => n.step >= 188).map(n => n.midi);
assert.deepEqual(hook2, [79, 81, 82, 82, 84, 82, 81, 79], 'second hanging-on hook peaks on C then resolves to G');
assert.equal(m.notes[m.notes.length - 1].step + m.notes[m.notes.length - 1].len <= m.length, true, 'last note ends inside the loop');
assert.equal(m.tonicPitchClass, 3, 'bass root/fifth sits on Eb, the chorus cadence centre');
assert.ok(/import \{ PERFECT_DAY_MOTIF \}/.test(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8')), 'main.js loads it');
console.log('Perfect Day lead line checks passed.');
