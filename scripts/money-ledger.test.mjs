/* Run: node scripts/money-ledger.test.mjs

   Every save of expenses, income and transfers is whatever ledgerDiff says
   changed. A missed item is an expense that never reaches the server; a false
   delete removes one the user still has. Both are lost money, so both are pinned. */
import assert from 'node:assert/strict';
import {
  ledgerDiff,
  applyLedgerDiff,
  docPart,
  normalizeMoney,
  searchExpenses,
  splitShares,
} from './money.js';

const doc = (over) => normalizeMoney({ ...over });
const lunch = { id: 'e1', amount: 250, category: 'food', note: 'Lunch', date: '2026-09-30' };

// Nothing changed → nothing sent.
{
  const d = ledgerDiff(doc({ expenses: [lunch] }), doc({ expenses: [lunch] }));
  assert.deepEqual(d, { upserts: [], deletes: [] });
}

// The same expense with its fields in another order (as the server returns it) is unchanged.
{
  const reordered = { date: '2026-09-30', note: 'Lunch', id: 'e1', category: 'food', amount: 250 };
  assert.deepEqual(
    ledgerDiff(doc({ expenses: [lunch] }), doc({ expenses: [reordered] })).upserts,
    []
  );
}

// An add, an edit (including inside a nested reflection) and a delete, each once.
{
  const before = doc({
    expenses: [
      lunch,
      { id: 'e2', amount: 90, date: '2026-09-29', reflection: { satisfaction: 3 } },
    ],
    income: [{ id: 'i1', amount: 45000, source: 'salary', date: '2026-09-01' }],
  });
  const after = doc({
    expenses: [
      { id: 'e2', amount: 90, date: '2026-09-29', reflection: { satisfaction: 5 } },
      { id: 'e3', amount: 40, date: '2026-09-30', accountId: 'cash-1' },
    ],
    income: [{ id: 'i1', amount: 45000, source: 'salary', date: '2026-09-01' }],
  });
  const d = ledgerDiff(before, after);
  assert.deepEqual(d.upserts.map((u) => u.kind + ':' + u.id).sort(), ['expense:e2', 'expense:e3']);
  assert.deepEqual(d.deletes, ['e1']);
  assert.equal(d.upserts.find((u) => u.id === 'e3').accountId, 'cash-1', 'the account rides along');
}

// A loan's one-sided moves are transfers too: money borrowed into an account has
// no "from", and goes to the server as it is (MoneyLedger.toRow takes either side).
{
  const inflow = { id: 'loan-b1', amount: 2000, to: 'bank-1', date: '2026-09-30', note: 'Borrowed from Ravi' };
  const d = ledgerDiff(doc({}), doc({ transfers: [inflow] }));
  assert.deepEqual(d.upserts, [{ kind: 'transfer', ...inflow }]);
  assert.equal('from' in d.upserts[0], false, 'no from is sent, not an empty one');
}

// A posted repeat is an ordinary expense with a deterministic id: two devices
// posting the same month send the same upsert.
{
  const a = { id: 'rec-r1-2026-09', amount: 9000, category: 'home', note: 'Rent', date: '2026-09-01' };
  assert.deepEqual(
    ledgerDiff(doc({}), doc({ expenses: [a] })).upserts,
    ledgerDiff(doc({}), doc({ expenses: [{ ...a }] })).upserts
  );
  assert.deepEqual(ledgerDiff(doc({ expenses: [a] }), doc({ expenses: [{ ...a }] })).upserts, [], 'already there: nothing sent');
}

// A transfer is its own kind, so it is never counted as spending.
{
  const t = { id: 't1', amount: 2000, from: 'bank-1', to: 'cash-1', date: '2026-09-30' };
  const d = ledgerDiff(doc({}), doc({ transfers: [t] }));
  assert.deepEqual(d.upserts, [{ kind: 'transfer', ...t }]);
}

// First load after the move: the document had no ledger arrays at all. Loading
// must not turn into "delete everything" or "re-send everything".
{
  assert.deepEqual(ledgerDiff(null, doc({ expenses: [lunch] })).deletes, []);
  assert.deepEqual(ledgerDiff(doc({ expenses: [lunch] }), doc({ expenses: [lunch] })).upserts, []);
}

// The stored document never carries ledger rows or live balances.
{
  const part = docPart(
    doc({ expenses: [lunch], accounts: [{ id: 'a', balance: 5 }], budgets: { food: 9000 } })
  );
  assert.equal(
    'expenses' in part || 'income' in part || 'transfers' in part || 'accounts' in part,
    false
  );
  assert.equal(part.budgets.food, 9000, 'everything else is kept');
}

// A day marked "I spent nothing" stops being one the moment an expense lands on it.
{
  const m = normalizeMoney({ noSpendDays: ['2026-09-29', '2026-09-30'], expenses: [lunch] });
  assert.deepEqual(m.noSpendDays, ['2026-09-29']);
}

// Ask about your spending: a question it can't narrow must not return everything.
{
  const today = new Date().toISOString().slice(0, 10);
  const m = normalizeMoney({
    expenses: [
      {
        id: 'a',
        amount: 2570,
        category: 'entertainment',
        note: 'Concert',
        date: today,
        reflection: { satisfaction: 2 },
      },
      {
        id: 'b',
        amount: 450,
        category: 'shopping',
        note: 'Car',
        date: today,
        reflection: { satisfaction: 4, planned: false },
      },
      {
        id: 'c',
        amount: 90,
        category: 'food',
        note: 'biscuit',
        date: today,
        reflection: { satisfaction: 5, planned: true },
      },
    ],
  });
  const skip = searchExpenses(m, 'What expense can be skkiped');
  assert.deepEqual(
    skip.results.map((e) => e.id),
    ['a'],
    'low-rated; an impulse buy rated 4/5 is not one to skip'
  );
  assert.equal(skip.results[0].why, 'rated 2/5');
  assert.match(skip.answer, /could skip/);
  const vague = searchExpenses(m, 'what is going on');
  assert.equal(vague.results.length, 0, 'not understood -> nothing, not everything');
  assert.match(vague.answer, /didn't catch|Nothing matches/);
  assert.deepEqual(
    searchExpenses(m, 'biscuit').results.map((e) => e.id),
    ['c'],
    'a plain word still finds the note'
  );
  assert.equal(
    searchExpenses(m, 'how much on food').results.length,
    1,
    'the old questions still work'
  );
  // The opposite question gets the opposite answer, however it is phrased.
  for (const q of [
    'what is not skipable',
    "what shouldn't I skip",
    'what was worth it',
    'what is unskippable',
  ]) {
    const r = searchExpenses(m, q);
    assert.deepEqual(
      r.results.map((e) => e.id),
      ['b', 'c'],
      q + ' -> the spends rated 4/5 or more'
    );
    assert.match(r.answer, /worth keeping/, q);
  }
  assert.deepEqual(
    searchExpenses(m, 'what was not worth it').results.map((e) => e.id),
    ['a'],
    '"not worth it" is still a skip question'
  );
  assert.deepEqual(
    searchExpenses(m, 'what could I skip, not food').results.map((e) => e.id),
    ['a'],
    'a negation after "skip" does not flip it'
  );
}

// "Unavoidable" asks for needs, not for "worth it", and never for the skip list.
{
  const today = new Date().toISOString().slice(0, 10);
  const m = normalizeMoney({
    expenses: [
      { id: 'rent', amount: 18000, category: 'others', note: 'Rent', date: today },
      { id: 'veg', amount: 400, category: 'food', note: 'Groceries', date: today },
      {
        id: 'toy',
        amount: 900,
        category: 'shopping',
        note: 'Gadget',
        date: today,
        reflection: { satisfaction: 1 },
      },
    ],
  });
  for (const q of [
    'What is unavoidable',
    'what are my essential spends',
    'what is necessary',
    'non-avoidable costs',
  ]) {
    const r = searchExpenses(m, q);
    assert.deepEqual(
      r.results.map((e) => e.id),
      ['rent', 'veg'],
      q + ' -> needs, biggest first'
    );
    assert.match(r.answer, /essential/, q);
  }
  assert.deepEqual(
    searchExpenses(m, 'what was unnecessary').results.map((e) => e.id),
    ['toy'],
    '"unnecessary" stays a skip question'
  );
  assert.deepEqual(
    searchExpenses(m, 'what should I avoid').results.map((e) => e.id),
    ['toy'],
    '"avoid" stays a skip question'
  );
  assert.match(
    searchExpenses(m, "what shouldn't I avoid").answer,
    /worth keeping|worth it/,
    'a negated avoid flips'
  );
}

// Quick add pushed onto a normalised copy; when that shared the live array, the
// live state changed before the diff and the expense was never sent.
{
  const live = normalizeMoney({ expenses: [lunch] });
  const next = normalizeMoney(live);
  next.expenses.unshift({ id: 'q1', amount: 50, date: '2026-09-30' });
  assert.equal(live.expenses.length, 1, 'normalizeMoney must not share arrays with its input');
  assert.deepEqual(
    ledgerDiff(live, next).upserts.map((u) => u.id),
    ['q1']
  );
}

// A save built from an older snapshot must not delete what arrived after it.
{
  const snapshot = normalizeMoney({ expenses: [lunch] }); // the dialog opened here
  const live = normalizeMoney({
    expenses: [{ id: 'phone', amount: 99, date: '2026-09-30' }, lunch],
  }); // then this arrived
  const next = normalizeMoney(snapshot);
  next.expenses.unshift({ id: 'new', amount: 10, date: '2026-09-30' }); // the user adds one
  const diff = ledgerDiff(snapshot, next);
  assert.deepEqual(diff.deletes, [], 'nothing the user did not delete');
  const after = applyLedgerDiff(live, diff);
  assert.deepEqual(
    after.expenses.map((e) => e.id),
    ['new', 'phone', 'e1'],
    'the newer item survives'
  );
  // and a real delete from the snapshot still lands
  const del = ledgerDiff(snapshot, normalizeMoney({ expenses: [] }));
  assert.deepEqual(
    applyLedgerDiff(live, del).expenses.map((e) => e.id),
    ['phone']
  );
}

// Split a bill: the IOUs keep paise (they were rounded to whole rupees, so a
// 99.60 bill saved IOUs that did not add up to it), and ride in the document.
{
  assert.deepEqual(splitShares(99.6, ['A'], true), [{ party: 'A', amount: 49.8 }]);
  const sh = splitShares(1000, ['A', 'B'], true);
  assert.deepEqual(sh.map((x) => x.amount), [333.34, 333.33], 'odd paise go to the others');
  const m = doc({ loans: sh.map((x, i) => ({ id: 'l' + i, direction: 'given', amount: x.amount })) });
  assert.deepEqual(docPart(m).loans.map((l) => l.amount), [333.34, 333.33]);
  assert.deepEqual(ledgerDiff(doc({}), m).upserts, [], 'a loan is not a ledger row');
}

console.log('money-ledger.test.mjs: all assertions passed');
