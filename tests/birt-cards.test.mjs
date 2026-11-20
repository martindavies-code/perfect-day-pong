import assert from 'node:assert/strict';
import { INTERSTITIAL_CARDS } from '../content.js';
const sourced = INTERSTITIAL_CARDS.filter(c => c.tag === 'SOURCED');
const satire = INTERSTITIAL_CARDS.filter(c => c.tag === 'SATIRE, INVENTED');
assert.ok(sourced.length >= 5 && sourced.every(c => /Wikipedia/.test(c.source)));
assert.ok(satire.length >= 5 && satire.every(c => !/["“]/.test(c.text) && !c.source));
console.log('Birt card labelling regressions passed.');
