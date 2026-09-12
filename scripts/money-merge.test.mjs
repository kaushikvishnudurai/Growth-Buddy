/* Run: node scripts/money-merge.test.mjs

   mergeMoney runs exactly once per conflict — after the server has refused a
   write as stale — and whatever it returns is what gets stored as the user's
   money. A wrong merge here is lost or duplicated money, so the cases that
   matter are pinned: both sides' additions survive, nothing is duplicated, and
   a value someone SET (a budget) is not unioned like a log entry. */
import assert from 'node:assert/strict';
import { mergeMoney, normalizeMoney } from './money.js';

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

console.log('money-merge.test.mjs: all assertions passed');
