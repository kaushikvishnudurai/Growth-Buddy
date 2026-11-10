/* The camera router's guess is a hint, never a command: only the three known
   kinds may preselect a choice; anything else is the no-AI picker.
   Run: node scripts/snap.test.mjs */
import assert from 'node:assert/strict';
import { pickDefault, kindsFor, readFor, KINDS } from './snap.js';

assert.deepEqual(
  KINDS.map((k) => k.kind),
  ['receipt', 'plate', 'groceries']
);
for (const k of ['receipt', 'plate', 'groceries']) assert.equal(pickDefault(k), k);
for (const k of [null, undefined, '', 'selfie', 'Receipt', {}, 'toString'])
  assert.equal(pickDefault(k), null);
// A switched-off feature has no route, so it is neither offered nor guessed.
const noMoney = kindsFor({ plate() {}, groceries() {} });
assert.deepEqual(noMoney.map((k) => k.kind), ['plate', 'groceries']);
assert.equal(pickDefault('receipt', noMoney), null);
assert.equal(pickDefault('plate', noMoney), 'plate');
assert.deepEqual(kindsFor({}), []);
// The one-call read hands a route its answer only when it read the photo as that kind.
const answer = { kind: 'receipt', receipt: { items: [{ name: 'Tea', amount: 250 }] } };
assert.deepEqual(readFor('receipt', answer), answer.receipt);
assert.equal(readFor('plate', answer), null, 'tapped another kind: that route reads it itself');
assert.equal(readFor('receipt', { kind: 'receipt' }), null, 'a kind with no answer (its reader refused)');
assert.equal(readFor('receipt', null), null, 'no AI');
console.log('snap: ok');
