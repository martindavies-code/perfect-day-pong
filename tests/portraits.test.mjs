// Portrait coverage: every opponent has embedded pixel art, small enough to
// ship inline. Run with: node tests/portraits.test.mjs
import { OPPONENTS } from '../logic.js';
import { OPPONENT_PORTRAITS } from '../portraits.js';

let failures = 0;
function ok(cond, name) {
  if (cond) { console.log(`ok - ${name}`); }
  else { failures += 1; console.error(`FAIL - ${name}`); }
}

const ids = Object.keys(OPPONENTS);
ok(ids.length === 16, `16 opponents defined (got ${ids.length})`);
for (const id of ids) {
  const uri = OPPONENT_PORTRAITS[id];
  ok(typeof uri === 'string' && uri.startsWith('data:image/png;base64,'), `${id} has an embedded PNG portrait`);
  const bytes = uri ? Buffer.from(uri.split(',')[1], 'base64') : Buffer.alloc(0);
  ok(bytes.length > 400 && bytes.length < 32768, `${id} portrait is a real but small PNG (${bytes.length} bytes)`);
}
ok(Object.keys(OPPONENT_PORTRAITS).length === ids.length, 'no orphan portraits without an opponent');

if (failures) { console.error(`${failures} portrait test(s) FAILED`); process.exit(1); }
console.log('all portrait tests passed');
