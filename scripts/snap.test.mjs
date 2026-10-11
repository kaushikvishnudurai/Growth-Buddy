/* The camera router's guess is a hint, never a command: only the three known
   kinds may preselect a choice; anything else is the no-AI picker.
   Run: node scripts/snap.test.mjs */
import assert from 'node:assert/strict';
import { pickDefault, KINDS } from './snap.js';

assert.deepEqual(
  KINDS.map((k) => k.kind),
  ['receipt', 'plate', 'groceries']
);
for (const k of ['receipt', 'plate', 'groceries']) assert.equal(pickDefault(k), k);
for (const k of [null, undefined, '', 'selfie', 'Receipt', {}, 'toString'])
  assert.equal(pickDefault(k), null);
console.log('snap: ok');
