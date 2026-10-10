/* Run: node scripts/money-calc.test.mjs

   Money's engines read the clock (todayKey, daysInMonth), so the clock is
   pinned here: 2026-10-20, a 31-day month. Covers what the screen tells
   someone about their month — the forecast, which bills are due or overdue,
   budget status, logging streaks, what is still owed on a loan — plus the
   CSV export. */
import assert from 'node:assert/strict';

const RealDate = Date;
const FIXED = new RealDate(2026, 9, 20, 12, 0, 0).getTime();
globalThis.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [FIXED]));
  }
  static now() {
    return FIXED;
  }
};

const { _calc, normalizeMoney, ledgerCsv } = await import('./money.js');
const {
  forecast,
  upcomingSubs,
  budgetStatus,
  logStreak,
  bestStreak,
  loanLeft,
  loanOutstanding,
  loanMove,
  recurringDue,
  recurringToCome,
  materialiseRecurring,
  toHomeAmount,
} = _calc;

const doc = (over) => normalizeMoney({ ...over });
const ex = (id, amount, date, category = 'food') => ({ id, amount, date, category });

// ---- forecast ----
{
  // Day 20 of 31: 2,000 of day-to-day food spend runs at 100/day → 3,100.
  const m = doc({ expenses: [ex('a', 1000, '2026-10-05'), ex('b', 1000, '2026-10-15')] });
  assert.equal(forecast(m).projected, 3100, 'run-rate over the month');
}
{
  // A bill paid this month is in `spent` once, and is not projected or committed again.
  const m = doc({
    expenses: [
      ex('a', 1000, '2026-10-05'),
      ex('b', 1000, '2026-10-15'),
      ex('sub-s1-2026-10', 9000, '2026-10-01', 'home'),
    ],
    subscriptions: [
      { id: 's1', name: 'Rent', amount: 9000, dueDay: 1, paidFor: '2026-10' },
      { id: 's2', name: 'Phone', amount: 500, dueDay: 25 },
    ],
  });
  const f = forecast(m);
  assert.equal(f.committed, 500, 'only the unpaid bill is still to come');
  assert.equal(f.projected, 3100 + 9000 + 500, 'paid rent counted once, not run-rated');
}
{
  // A front-loaded one-off doesn't project as if it repeats every day.
  const m = doc({
    budgets: { shopping: 8000 },
    expenses: [ex('shoe', 6000, '2026-10-02', 'shopping'), ex('sock', 200, '2026-10-10', 'shopping')],
  });
  const f = forecast(m);
  assert.equal(f.willExceed.length, 0, 'one big purchase is not a pace: 6000 + 200/20*31 = 6310 < 8000');
  // ...but steady spending over budget pace still warns.
  const steady = doc({
    budgets: { food: 3000 },
    expenses: [ex('a', 1000, '2026-10-03'), ex('b', 1000, '2026-10-10'), ex('c', 1000, '2026-10-18')],
  });
  assert.deepEqual(forecast(steady).willExceed.map((w) => w.cat.key), ['food'], 'steady pace over budget');
  assert.equal(forecast(steady).willExceed[0].proj, 4650);
}

// ---- upcomingSubs ----
{
  const subs = (over) =>
    doc({
      subscriptions: [
        { id: 'late', name: 'Gym', amount: 800, dueDay: 5 },
        { id: 'soon', name: 'Phone', amount: 500, dueDay: 24 },
        { id: 'far', name: 'Cloud', amount: 100, dueDay: 30 },
        { id: 'paid', name: 'Rent', amount: 9000, dueDay: 1, paidFor: '2026-10' },
        { id: 'ahead', name: 'Netflix', amount: 600, dueDay: 22, paidFor: '2026-11' },
        ...(over || []),
      ],
    });
  const u = upcomingSubs(subs());
  assert.deepEqual(u.map((x) => x.sub.id), ['late', 'soon'], 'overdue first, then due within 7 days');
  assert.equal(u[0].overdue, true);
  assert.equal(u[0].inDays, -15);
  assert.equal(u[0].month, '2026-10', 'an overdue bill is marked paid for this month');
  assert.equal(u[1].overdue, false);
  assert.equal(u[1].inDays, 4);
  // Paid this month, due early next month and within 7 days: next month's occurrence.
  const early = upcomingSubs(doc({ subscriptions: [{ id: 'x', name: 'X', amount: 1, dueDay: 19, paidFor: '2026-10' }] }));
  assert.equal(early.length, 0, 'paid, next one is 30 days out');
}

// ---- budgetStatus ----
{
  const m = doc({
    budgets: { food: 1000 },
    expenses: [ex('a', 250, '2026-10-02'), ex('old', 999, '2026-09-30')],
  });
  const food = budgetStatus(m).find((s) => s.cat.key === 'food');
  assert.equal(food.spent, 250, 'this month only');
  assert.equal(food.pct, 25);
  assert.equal(food.remaining, 750);
}

// ---- streaks ----
{
  const days = ['2026-10-20', '2026-10-19', '2026-10-18', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07'];
  const list = days.map((d, i) => ex('e' + i, 10, d));
  assert.equal(logStreak(list), 3, 'today and the two days before');
  assert.equal(bestStreak(list), 4);
  // Nothing today yet: the streak still counts from yesterday.
  assert.equal(logStreak(list.slice(1)), 2);
  assert.equal(logStreak([]), 0);
}

// ---- loans ----
{
  const l = { id: 'l1', direction: 'given', party: 'Asha', amount: 1000, date: '2026-10-01', accountId: 'bank' };
  assert.equal(loanLeft(l), 1000);
  const part = { ...l, repaid: [{ amount: 300.5, date: '2026-10-10' }] };
  assert.equal(loanLeft(part), 699.5, 'a part repayment, to the paisa');
  assert.equal(loanOutstanding(doc({ loans: [part, { ...l, id: 'l2', settled: true }] }), 'given'), 699.5);
  // What a set of loan moves does to each account's balance.
  const bal = (ts) => {
    const b = {};
    for (const t of ts) {
      if (t.from) b[t.from] = (b[t.from] || 0) - t.amount;
      if (t.to) b[t.to] = (b[t.to] || 0) + t.amount;
    }
    return b;
  };
  const m = { transfers: [{ id: 'x', amount: 5, from: 'bank', to: 'cash', date: '2026-10-01' }] };
  loanMove(m, part);
  loanMove(m, part);
  assert.equal(m.transfers.length, 3, 'loan out + one dated repayment back, kept once; the other move untouched');
  const out = m.transfers.find((t) => t.id === 'loan-l1');
  assert.deepEqual([out.from, out.to, out.amount], ['bank', undefined, 1000], 'lent: the whole amount leaves');
  const back = m.transfers.find((t) => t.id === 'loan-l1-r0');
  assert.deepEqual([back.from, back.to, back.amount, back.date], [undefined, 'bank', 300.5, '2026-10-10'], 'repaid on its own day');
  assert.equal(bal(m.transfers.filter((t) => t.id !== 'x')).bank, -699.5, 'only what is still out is out of the balance');
  // Repaid into another account than it left from.
  const elsewhere = { transfers: [] };
  loanMove(elsewhere, { ...l, repaid: [{ amount: 400, date: '2026-10-12', accountId: 'cash' }] });
  assert.deepEqual(bal(elsewhere.transfers), { bank: -1000, cash: 400 }, 'repaid into cash');
  // Settled the new way (the last part recorded as final) vs. a loan settled before
  // repayments were recorded: both net to zero on the account.
  const settled = { transfers: [] };
  loanMove(settled, { ...l, settled: true, repaid: [{ amount: 1000, date: '2026-10-15', final: true }] });
  assert.equal(settled.transfers.length, 2);
  assert.equal(bal(settled.transfers).bank, 0, 'all back');
  const legacy = { transfers: [] };
  loanMove(legacy, { ...l, settled: true });
  assert.equal(bal(legacy.transfers).bank, 0, 'a legacy settled loan still nets to zero');
  loanMove(legacy, l, true);
  assert.equal(legacy.transfers.length, 0, 'deleted: every move goes');
  // Borrowed into an account: money in with no "from"; paying it back takes it out.
  const b = { id: 'b1', direction: 'received', party: 'Ravi', amount: 2000, date: '2026-10-03', accountId: 'bank' };
  const borrowed = { transfers: [] };
  loanMove(borrowed, { ...b, repaid: [{ amount: 500, date: '2026-10-18', accountId: 'cash' }] });
  const inMove = borrowed.transfers.find((t) => t.id === 'loan-b1');
  assert.deepEqual([inMove.from, inMove.to], [undefined, 'bank'], 'borrowed: an inflow with no from');
  assert.deepEqual(bal(borrowed.transfers), { bank: 2000, cash: -500 }, 'paid back out of cash');
  const noAcc = { transfers: [] };
  loanMove(noAcc, { ...b, accountId: undefined });
  assert.equal(noAcc.transfers.length, 0, 'no account named: no balance moves');
}

// ---- recurring income & expenses ----
{
  const rules = [
    { id: 'rent', kind: 'expense', amount: 9000, category: 'home', day: 1, active: true, accountId: 'bank', note: 'Rent', start: '2026-09-01' },
    { id: 'pay', kind: 'income', amount: 50000, category: 'salary', day: 'last', active: true, start: '2026-09-01' },
    { id: 'sip', kind: 'expense', amount: 2000, category: 'others', day: 25, active: true, start: '2026-09-01' },
    { id: 'gym', kind: 'expense', amount: 800, category: 'others', day: 5, active: false, start: '2026-09-01' },
    // Made on the 20th for the 10th: this month's day was before it existed.
    { id: 'new', kind: 'expense', amount: 300, category: 'food', day: 10, active: true, start: '2026-10-20' },
  ];
  const m = doc({ recurring: rules.map((r) => ({ ...r })) });
  assert.deepEqual(recurringDue(m).map((x) => x.id), ['rec-rent-2026-10'], 'due by today, active, after its start');
  assert.deepEqual(recurringToCome(m).map((x) => [x.id, x.date]), [
    ['rec-pay-2026-10', '2026-10-31'],
    ['rec-sip-2026-10', '2026-10-25'],
  ], 'still ahead this month; "last" is the 31st');
  const f = forecast(m);
  assert.equal(f.recurringOut, 2000, 'the SIP is still to come');
  assert.equal(f.expectedIncome, 50000, 'salary expected');
  assert.equal(f.committed, 2000, 'repeats count as committed with the bills');
  assert.equal(materialiseRecurring(m), 1);
  assert.deepEqual(m.expenses[0], { id: 'rec-rent-2026-10', amount: 9000, category: 'home', note: 'Rent', date: '2026-10-01', accountId: 'bank' });
  assert.equal(m.recurring[0].postedFor, '2026-10');
  assert.equal(materialiseRecurring(m), 0, 'posting twice posts once');
  // Deleted occurrence: postedFor keeps it from coming back.
  m.expenses = [];
  assert.equal(materialiseRecurring(m), 0, 'a deleted occurrence is not re-posted');
  // Another device already posted it (same deterministic id): nothing new here.
  const other = doc({ recurring: [rules[0]], expenses: [{ id: 'rec-rent-2026-10', amount: 9000, date: '2026-10-01' }] });
  assert.equal(recurringDue(other).length, 0, 'same id already in the ledger');
  // A posted repeat is a fixed amount in projectSpend, not a pace.
  const fixed = doc({ expenses: [{ id: 'rec-rent-2026-10', amount: 9000, date: '2026-10-01', category: 'home' }] });
  assert.equal(forecast(fixed).projected, 9000, 'rent is not projected x31');
  // Income rule posts an income row.
  const inc = doc({ recurring: [{ ...rules[1], day: 15 }] });
  materialiseRecurring(inc);
  assert.deepEqual(inc.income[0], { id: 'rec-pay-2026-10', amount: 50000, source: 'salary', label: 'Salary', date: '2026-10-15' });
}

// ---- budget rollover ----
{
  const spend = [ex('s1', 600, '2026-09-10'), ex('s2', 300, '2026-10-05')];
  const food = (over) => budgetStatus(doc({ budgets: { food: 1000 }, expenses: spend, ...over })).find((s) => s.cat.key === 'food');
  assert.equal(food().carried, 0, 'off: nothing carries');
  const on = food({ rollover: { food: '2026-08' } });
  assert.equal(on.carried, 400, 'last month left 400');
  assert.equal(on.budget, 1400);
  assert.equal(on.base, 1000);
  assert.equal(on.remaining, 1100);
  assert.equal(food({ rollover: { food: '2026-10' } }).carried, 0, 'switched on this month: starts next month');
  assert.equal(food({ rollover: { food: null } }).carried, 0, 'switched off');
  const over = budgetStatus(
    doc({ budgets: { food: 1000 }, rollover: { food: '2026-01' }, expenses: [ex('o', 1250, '2026-09-02'), ex('n', 100, '2026-10-02')] })
  ).find((s) => s.cat.key === 'food');
  assert.equal(over.carried, -250, 'overspent last month comes off');
  assert.equal(over.budget, 750);
  assert.equal(over.pct, 13);
  const deep = budgetStatus(
    doc({ budgets: { food: 1000 }, rollover: { food: '2026-01' }, expenses: [ex('o', 3000, '2026-09-02'), ex('n', 100, '2026-10-02')] })
  ).find((s) => s.cat.key === 'food');
  assert.equal(deep.budget, 0, 'never below zero');
  assert.equal(deep.pct, 101, 'and anything spent then reads as over');
}

// ---- other currencies ----
{
  const m = doc({ settings: { currency: '₹', fx: { $: 83.25 }, accountCurrency: { usd: '$', eur: '€' } } });
  assert.deepEqual(toHomeAmount(m, 'cash', 250), { amount: 250 }, 'home account: as typed');
  assert.deepEqual(toHomeAmount(m, 'usd', 12.5), { amount: 1040.63, orig: { amount: 12.5, currency: '$', rate: 83.25 } });
  assert.throws(() => toHomeAmount(m, 'eur', 10), /rate for €/, 'no rate: refused, not booked 1:1');
}


// ---- CSV ----
{
  const csv = ledgerCsv(
    doc({
      accounts: [{ id: 'b', name: 'Bank' }],
      expenses: [{ id: 'e', amount: 250, category: 'food', note: 'Lunch, "big"', date: '2026-10-02', accountId: 'b' }],
      income: [{ id: 'i', amount: 5000, source: 'salary', label: '=SUM(A1)', date: '2026-10-01' }],
    })
  ).split('\r\n');
  assert.equal(csv[0], 'date,type,amount,category,note,account,original');
  assert.equal(csv[1], '2026-10-02,expense,-250,food,"Lunch, ""big""",Bank,', 'newest first, quoted');
  assert.equal(csv[2], "2026-10-01,income,5000,salary,'=SUM(A1),,", 'a formula is defused');
  const fx = ledgerCsv(
    doc({
      expenses: [{ id: 'u', amount: 1040.63, category: 'food', date: '2026-10-03', orig: { amount: 12.5, currency: '$', rate: 83.25 } }],
      transfers: [{ id: 'loan-b1', amount: 2000, to: 'b', date: '2026-10-01' }],
      accounts: [{ id: 'b', name: 'Bank' }],
    })
  ).split('\r\n');
  assert.equal(fx[1], '2026-10-03,expense,-1040.63,food,,,12.5 $', 'what was paid, in its currency');
  assert.equal(fx[2], '2026-10-01,transfer,2000,,,in → Bank,', 'an inflow reads "in →"');
}

console.log('money-calc.test.mjs: all assertions passed');
