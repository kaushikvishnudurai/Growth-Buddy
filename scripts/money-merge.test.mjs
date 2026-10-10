/* Run: node scripts/money-merge.test.mjs

   mergeMoney runs exactly once per conflict — after the server has refused a
   write as stale — and whatever it returns is what gets stored as the user's
   money. A wrong merge here is lost or duplicated money, so the cases that
   matter are pinned: both sides' additions survive, nothing is duplicated, and
   a value someone SET (a budget) is not unioned like a log entry. */
import assert from 'node:assert/strict';
import { mergeMoney, normalizeMoney, removeDocItem } from './money.js';

const doc = (over) => normalizeMoney({ expenses: [], income: [], budgets: {}, ...over });

// The real case: a phone and a laptop each added an expense to the same copy.
{
  const mine = doc({ expenses: [{ id: 'shared', amount: 100 }, { id: 'phone', amount: 300 }] });
  const theirs = doc({ expenses: [{ id: 'shared', amount: 100 }, { id: 'laptop', amount: 500 }] });
  const out = mergeMoney(mine, theirs);
  const ids = out.expenses.map((e) => e.id).sort();
  assert.deepEqual(ids, ['laptop', 'phone', 'shared'], 'both additions survive, shared is not doubled');
  assert.equal(out.expenses.length, 3, 'no duplicates');
}

// Every log-shaped collection merges the same way, not just expenses.
{
  const mine = doc({ income: [{ id: 'i-mine', amount: 1000 }] });
  const theirs = doc({ income: [{ id: 'i-theirs', amount: 2000 }] });
  assert.deepEqual(mergeMoney(mine, theirs).income.map((i) => i.id).sort(), ['i-mine', 'i-theirs']);
}

// Items with no id are compared by value, so an identical row is not doubled...
{
  const out = mergeMoney(doc({ noSpendDays: ['2026-09-13'] }), doc({ noSpendDays: ['2026-09-13'] }));
  assert.deepEqual(out.noSpendDays, ['2026-09-13'], 'identical id-less entries collapse');
}

// ...but a genuinely different one is kept.
{
  const out = mergeMoney(doc({ noSpendDays: ['2026-09-12'] }), doc({ noSpendDays: ['2026-09-13'] }));
  assert.deepEqual(out.noSpendDays.sort(), ['2026-09-12', '2026-09-13']);
}

// A budget is a value a person SET, not a log they appended to. Unioning it would
// be meaningless; the local edit is the one the user just made, so it wins.
{
  const mine = doc({ budgets: { food: 9000 } });
  const theirs = doc({ budgets: { food: 8000, transport: 4000 } });
  const out = mergeMoney(mine, theirs);
  assert.equal(out.budgets.food, 9000, 'my edit wins for a value I set');
  assert.equal(out.budgets.transport, 4000, "the other device's other budget is kept");
}

// The merge must never lose a collection the other side had and this one didn't.
{
  const out = mergeMoney(doc({}), doc({ loans: [{ id: 'l1', amount: 200 }] }));
  assert.equal(out.loans.length, 1, 'a collection only they had survives');
}

// "Mark as paid" is a field on an existing item, which theirs-wins would drop — the
// later month survives from either side, and never rolls back.
{
  const sub = (paidFor) => ({ subscriptions: [{ id: 's1', name: 'Spotify', dueDay: 30, paidFor }] });
  assert.equal(mergeMoney(doc(sub('2026-09')), doc(sub(undefined))).subscriptions[0].paidFor, '2026-09',
    'paid here while the other device saved: still paid');
  assert.equal(mergeMoney(doc(sub(undefined)), doc(sub('2026-09'))).subscriptions[0].paidFor, '2026-09',
    'paid over WhatsApp, stale tab merges: still paid');
  assert.equal(mergeMoney(doc(sub('2026-08')), doc(sub('2026-09'))).subscriptions[0].paidFor, '2026-09',
    'an older local month never wins');
}

// A delete sticks: a loan / goal / subscription removed on one device does not
// come back from the other device's copy of the document (tombstones).
{
  const both = { loans: [{ id: 'l1', amount: 200 }, { id: 'l2', amount: 50 }], goals: [{ id: 'g1', name: 'Bike' }] };
  const mine = doc(both);
  removeDocItem(mine, 'loans', 'l1');
  removeDocItem(mine, 'goals', 'g1');
  const theirs = doc(both); // the laptop never saw the delete
  const out = mergeMoney(mine, theirs);
  assert.deepEqual(out.loans.map((l) => l.id), ['l2'], 'my delete wins over their stale copy');
  assert.equal(out.goals.length, 0);
  assert.ok(out.tombstones['loans:l1'], 'the tombstone is kept, for the next merge');
  // And the other way round: deleted there, still here.
  const back = mergeMoney(doc(both), mine);
  assert.deepEqual(back.loans.map((l) => l.id), ['l2'], 'their delete wins over my stale copy');
  // An unrelated addition on the other side survives.
  const added = doc({ subscriptions: [{ id: 's9', name: 'New' }], ...both });
  assert.equal(mergeMoney(mine, added).subscriptions.length, 1);
}

// Tombstones expire, so the document doesn't grow forever.
{
  const old = normalizeMoney({ tombstones: { 'loans:x': Date.now() - 200 * 86400000, 'loans:y': Date.now() } });
  assert.deepEqual(Object.keys(old.tombstones), ['loans:y']);
}

// Repeats: postedFor is forward-only (the later month wins), rollover merges like
// budgets, and a deleted repeat stays deleted.
{
  const rule = { id: 'r1', kind: 'expense', amount: 9000, day: 1, active: true };
  const mine = { recurring: [{ ...rule, postedFor: '2026-10' }], rollover: { food: '2026-09' } };
  const theirs = { recurring: [{ ...rule }], rollover: { shopping: null } };
  const out = mergeMoney(mine, theirs);
  assert.equal(out.recurring[0].postedFor, '2026-10', 'posted here: not posted again there');
  assert.deepEqual(out.rollover, { shopping: null, food: '2026-09' });
  const gone = mergeMoney({ recurring: [], tombstones: { 'recurring:r1': Date.now() } }, { recurring: [rule] });
  assert.equal(gone.recurring.length, 0, 'a deleted repeat does not come back');
}

console.log('money-merge.test.mjs: all assertions passed');
