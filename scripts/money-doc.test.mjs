/* Run: node scripts/money-doc.test.mjs

   The document part of a Money save (loans, goals, bills, budgets, tags...) is
   sent as docDiff ops and laid onto whatever copy is live with applyDocDiff.
   Each case below is an edit that used to be lost: dropped by the next load,
   reverted by a conflict merge, or overwritten by a save from a stale copy. */
import assert from 'node:assert/strict';
import { docDiff, applyDocDiff, normalizeMoney, removeDocItem } from './money-core.js';

const doc = (over) => normalizeMoney({ ...over });
const loan = { id: 'l1', direction: 'given', party: 'Ravi', amount: 2000, settled: false, repaid: [] };
const goal = (id, contribs = []) => ({ id, name: id, target: 5000, contribs });

// FN-01: a loan repayment made offline, then the next load brings the server's
// copy (which never got it). The pending ops replay it; the server's own news stays.
{
  const before = doc({ loans: [loan] });
  const after = doc({ loans: [{ ...loan, repaid: [{ amount: 500, date: '2026-10-11' }] }] });
  const pending = docDiff(before, after);
  const server = doc({ loans: [loan], goals: [goal('laptop')] });
  const out = normalizeMoney(applyDocDiff(server, pending));
  assert.equal(out.loans[0].repaid.length, 1, 'the offline repayment survives the load');
  assert.deepEqual(out.goals.map((g) => g.id), ['laptop'], 'the server goal is kept');
  // Replaying the same ops twice (a load, then another) changes nothing more.
  assert.deepEqual(applyDocDiff(out, pending), out);
}

// FN-06: Home's "Add expense" built its save from the copy it painted with; a
// goal from the laptop arrived in between. The save must not delete it.
{
  const stale = doc({ goals: [goal('g1')] });
  const live = doc({ goals: [goal('g1'), goal('laptop')] });
  const next = doc({ goals: [goal('g1')], settings: { lastAccountId: 'cash' } });
  const out = applyDocDiff(live, docDiff(stale, next));
  assert.deepEqual(out.goals.map((g) => g.id), ['g1', 'laptop'], 'laptop goal kept');
  assert.equal(out.settings.lastAccountId, 'cash', 'the save itself lands');
}

// FN-05: conflict. The server copy changed first; our edit to an EXISTING goal
// must win over theirs (a union by id kept theirs), and theirs elsewhere stays.
{
  const base = doc({ goals: [goal('g1')], subscriptions: [{ id: 's1', amount: 199 }] });
  const mine = doc({
    goals: [goal('g1', [{ amount: 300, date: '2026-10-11' }])],
    subscriptions: [{ id: 's1', amount: 249 }],
  });
  // WhatsApp "Mark as paid" landed on the server meanwhile.
  const theirs = doc({ goals: [goal('g1')], subscriptions: [{ id: 's1', amount: 199, paidFor: '2026-10' }] });
  const out = applyDocDiff(theirs, docDiff(base, mine));
  assert.equal(out.goals[0].contribs.length, 1, 'goal contribution kept');
  assert.equal(out.subscriptions[0].amount, 249, 'our edit to the bill wins');
  assert.equal(out.subscriptions[0].paidFor, '2026-10', 'their Mark as paid is kept (forward-only)');
}

// FN-05: a budget cleared here and a tag deleted here stay gone after a merge.
{
  const tag = { key: 'pets', label: 'Pets' };
  const base = doc({ budgets: { food: 5000, fun: 2000 }, customCategories: [tag] });
  const mine = doc({ budgets: { fun: 2000 }, customCategories: [] });
  const theirs = doc({ budgets: { food: 5000, fun: 2500 }, customCategories: [tag] });
  const out = applyDocDiff(theirs, docDiff(base, mine));
  assert.deepEqual(out.budgets, { fun: 2500 }, 'cleared budget stays cleared; their other edit stays');
  assert.deepEqual(out.customCategories, [], 'deleted tag stays deleted');
}

// A delete on the other device wins over an edit here: no resurrection.
{
  const base = doc({ goals: [goal('g1')] });
  const mine = doc({ goals: [goal('g1', [{ amount: 1, date: '2026-10-11' }])] });
  const theirs = doc({ goals: [goal('g1')] });
  removeDocItem(theirs, 'goals', 'g1');
  const out = applyDocDiff(theirs, docDiff(base, mine));
  assert.deepEqual(out.goals, [], 'a goal deleted elsewhere is not brought back');
}

// Two saves' ops combine with Object.assign: the newest value of a key wins,
// an earlier op for another key is kept.
{
  const a = doc({ budgets: { food: 1000 } });
  const b = doc({ budgets: { food: 2000 } });
  const c = doc({ budgets: { food: 3000 }, noSpendDays: ['2026-10-10'] });
  const ops = Object.assign(docDiff(a, b), docDiff(b, c));
  const out = applyDocDiff(doc({ budgets: { food: 1000, rent: 9 } }), ops);
  assert.deepEqual(out.budgets, { food: 3000, rent: 9 });
  assert.deepEqual(out.noSpendDays, ['2026-10-10']);
  // Ops survive the JSON round trip they take through storage.
  assert.deepEqual(applyDocDiff(doc({}), JSON.parse(JSON.stringify(ops))).budgets, { food: 3000 });
}

// Nothing changed → no ops (a ledger-only save must not re-send the document).
{
  const m = doc({ goals: [goal('g1')], expenses: [{ id: 'e1', amount: 5 }] });
  const n = doc({ goals: [goal('g1')], expenses: [{ id: 'e1', amount: 5 }, { id: 'e2', amount: 9 }] });
  assert.deepEqual(docDiff(m, n), {});
}

console.log('money-doc: ok');
