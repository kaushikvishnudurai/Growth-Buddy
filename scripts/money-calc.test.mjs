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

const { _calc, normalizeMoney, ledgerCsv, searchExpenses } = await import('./money.js');
const { applyCurrency, fmt } = await import('./money-core.js');
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
  editedHomeAmount,
  challengeProgress,
  financialHealth,
  challengeEnd,
  newSubscription,
  suggestChallenges,
  advise,
  goalPlan,
  achievementTimeline,
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
  // A marked no-spend day is a logged day: it bridges the streak instead of breaking it.
  {
    const k = (n) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - n);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const spent = [{ date: k(0), amount: 50 }, { date: k(2), amount: 80 }];
    assert.equal(logStreak(spent), 1, 'yesterday unlogged breaks it');
    assert.equal(logStreak(spent, [k(1)]), 3, 'yesterday marked no-spend keeps it');
    assert.equal(bestStreak(spent, [k(1)]), 3);
    assert.equal(logStreak([], [k(0), k(1)]), 2, 'no-spend days alone are a streak');
  }
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
  // Editing a $50 row booked at 83.2 (INR 4160) after the account's currency was cleared.
  const usdRow = { id: 'x', amount: 4160, accountId: 'usd', orig: { amount: 50, currency: '$', rate: 83.2 } };
  const cleared = doc({ settings: { currency: '₹', fx: { $: 90 } } });
  assert.deepEqual(editedHomeAmount(cleared, usdRow, 'usd', 50), { amount: 4160, orig: usdRow.orig }, 'untouched amount: kept, not INR 50');
  assert.deepEqual(editedHomeAmount(m, usdRow, 'usd', 50), { amount: 4160, orig: usdRow.orig }, 'untouched amount: no re-convert at today\'s rate');
  assert.deepEqual(editedHomeAmount(cleared, usdRow, 'usd', 60), { amount: 4992, orig: { amount: 60, currency: '$', rate: 83.2 } }, 'changed amount, same account: row\'s own rate');
  assert.deepEqual(editedHomeAmount(m, usdRow, 'cash', 70), { amount: 70 }, 'moved to a home account with a new amount: as typed');
  assert.deepEqual(editedHomeAmount(m, { id: 'y', amount: 250, accountId: 'cash' }, 'cash', 300), { amount: 300 });
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

// ---- no-spend days count as logged: the "log N days" challenge and the health score ----
{
  const m = normalizeMoney({
    expenses: [ex('a', 120, '2026-10-18'), ex('b', 60, '2026-10-20')],
    noSpendDays: ['2026-10-19', '2026-10-17', '2026-09-30'], // last one is last month
  });
  const p = challengeProgress(m, { kind: 'logdays', days: 4, start: '2026-10-01', end: '2026-10-31' });
  assert.equal(p.detail, '4 of 4 days logged', 'two spend days + two no-spend days this month');
  assert.equal(p.state, 'won');
  const logging = financialHealth(m).parts.find((x) => x.label === 'Expense logging');
  assert.equal(logging.note, '4/14 recent days logged');
}
console.log('money-calc no-spend logging: ok');

// ---- challenges are judged on their own window (CRM-1..3) ----
{
  // CRM-1: "Cut food 15%" ran in September (Aug 5,000 -> aim 4,250). Judged now, on 20 Oct.
  const food = (sep) =>
    doc({ expenses: [ex('a', 5000, '2026-08-10'), ex('b', sep, '2026-09-10'), ex('c', 100, '2026-10-02')] });
  const ch = { kind: 'reduce', scope: 'food', pct: 15, start: '2026-09-05', end: '2026-09-30' };
  assert.equal(challengeProgress(food(9000), ch).state, 'broken', 'September went up: broken, not won');
  const won = challengeProgress(food(4000), ch);
  assert.equal(won.state, 'won', 'September came in under the aim');
  assert.match(won.detail, /4,000.*4,250/, 'the challenge month against 85% of the month before');
  // Still running this month: October against September.
  const live = challengeProgress(food(3000), { ...ch, start: '2026-10-05', end: '2026-10-31' });
  assert.equal(live.state, 'active');
  assert.match(live.detail, /100.*2,550/, 'October so far against 85% of September');
}
{
  // CRM-2: a September save challenge that fell short is over, and October's money is not its.
  const m = doc({
    goals: [{ id: 'g', name: 'Trip', target: 5000, contribs: [{ amount: 400, date: '2026-09-10' }, { amount: 800, date: '2026-10-02' }] }],
  });
  const p = challengeProgress(m, { kind: 'save', amount: 1000, start: '2026-09-05', end: '2026-09-30' });
  assert.equal(p.state, 'broken', 'ended short of its target');
  assert.match(p.detail, /400 of .*1,000/, 'counts only its own window');
  const live = challengeProgress(m, { kind: 'save', amount: 1000, start: '2026-10-01', end: '2026-10-31' });
  assert.equal(live.state, 'active');
}
{
  // CRM-2: an old "30 days" log challenge capped at month end: the target is the days it has.
  const days = ['25', '26', '27', '28', '29', '30'].map((d, i) => ex('l' + i, 10, '2026-09-' + d));
  const m = doc({ expenses: days.concat(ex('o', 10, '2026-10-01')) });
  const p = challengeProgress(m, { kind: 'logdays', days: 30, start: '2026-09-25', end: '2026-09-30' });
  assert.equal(p.detail, '6 of 6 days logged');
  assert.equal(p.state, 'won');
  const short = challengeProgress(doc({ expenses: days.slice(1) }), { kind: 'logdays', days: 30, start: '2026-09-25', end: '2026-09-30' });
  assert.equal(short.state, 'broken', 'ended with a day missed');
  // A new one runs its full length, past the month end.
  assert.equal(challengeEnd({ kind: 'logdays', days: 30 }), '2026-11-18', '30 days from today');
  assert.equal(challengeEnd({ kind: 'logdays', days: 14 }), '2026-11-02');
  assert.equal(challengeEnd({ kind: 'save' }), '2026-10-31', 'a month challenge ends with the month');
  assert.equal(challengeEnd({ kind: 'cap', days: 1 }), '2026-10-20', 'a one-day cap is today');
}
{
  // CRM-3: a daily cap is only won once its day is over.
  const m = doc({ expenses: [] });
  assert.equal(challengeProgress(m, { kind: 'cap', amount: 500, start: '2026-10-20', end: '2026-10-20' }).state, 'active');
  assert.equal(challengeProgress(m, { kind: 'cap', amount: 500, start: '2026-10-19', end: '2026-10-19' }).state, 'won');
}
// ---- CRM-4: a bill added after its due day is already paid for this month ----
{
  const fields = { name: 'Netflix', amount: 649, category: 'entertainment' };
  const late = newSubscription({ ...fields, dueDay: 5 });
  assert.equal(late.paidFor, '2026-10', 'due day 5 passed: paid for October');
  assert.ok(late.id && late.createdAt);
  assert.equal(newSubscription({ ...fields, dueDay: 20 }).paidFor, undefined, 'due today: still to pay');
  assert.equal(newSubscription({ ...fields, dueDay: 25 }).paidFor, undefined, 'still ahead');
  const m = doc({ subscriptions: [late] });
  assert.deepEqual(upcomingSubs(m), [], 'not overdue');
  assert.equal(forecast(m).committed, 0, 'not committed again');
}
console.log('money-calc challenges + new bills: ok');

// ---- CNT-12: challenge labels and search hints follow the user's currency ----
{
  const m = doc({ settings: { currency: '$' }, expenses: [ex('a', 700, '2026-10-19'), ex('b', 90, '2026-10-19')] });
  applyCurrency(m);
  const labels = suggestChallenges(doc({ settings: { currency: '$' } })).map((c) => c.label).join(' | ');
  assert.ok(!labels.includes('₹'), 'no rupee sign in ' + labels);
  assert.match(labels, /Spend under \$500 today/);
  assert.deepEqual(searchExpenses(m, 'expenses over $500').results.map((e) => e.id), ['a'], '"over $500" is read');
  assert.match(searchExpenses(m, 'zzzz').answer, /over \$500/, 'the hint uses $');
  applyCurrency(doc({}));
}
console.log('money-calc currency: ok');


// ---- EXM-11: a half rounds the same way signed or not ----
applyCurrency(doc({}));
assert.equal(fmt(-1200.5), '\u2212₹1,201');
assert.equal(fmt(1200.5), '₹1,201');
assert.equal(fmt(-0.4), '₹0', 'no minus on a zero');
console.log('money-calc fmt: ok');

// ---- EXM-4: the advisor doesn't wave through any price with no reason given ----
{
  const m = doc({ goals: [{ id: 'g', name: 'Emergency fund', target: 50000, contribs: [{ amount: 3000, date: '2026-10-01' }] }] });
  const phone = advise(m, 'New phone', 25000, '');
  assert.notEqual(phone.verdict, 'Go for it', 'no reason and half a goal: not a yes');
  assert.equal(advise(doc({}), 'Earbuds', 500, '').verdict, 'Depends on why', 'no words either way: undecided');
  assert.equal(advise(doc({}), 'Workout shoes', 500, '').isWant, false);
  assert.equal(advise(doc({}), 'Workout shoes', 500, '').verdict, 'Depends on why', '"workout" is not "work"');
  assert.equal(advise(doc({}), 'Refund fee', 500, '').isWant, false, '"refund" is not "fun"');
  assert.equal(advise(doc({}), 'Charger', 500, 'my old one broke, I need it').verdict, 'Go for it');
}
// ---- EXM-10: the pace for a dated goal reaches the target ----
{
  const g = { id: 'g', name: 'Car', target: 50000, dueDate: '2027-04-10', contribs: [] }; // 172 days out
  const p = goalPlan(g);
  assert.ok((p.requiredWeekly * 172) / 7 >= 50000, 'weekly x weeks covers it: ' + p.requiredWeekly);
  assert.ok(p.requiredDaily * 172 >= 50000, 'daily x days covers it: ' + p.requiredDaily);
  assert.equal(p.requiredDaily, 291);
}
console.log('money-calc advisor + goal pace: ok');
// ---- QA round (Money): week-over-week, salary repeat, big-jump, today's cap ----
{
  const { buildInsights, weekVsLast } = await import('./money-core.js');
  const { salaryPattern, amountJumpQuestion, suggestChallenges } = _calc;
  // Mon 19 + Tue 20 against Mon 12 + Tue 13 only: last week's Sunday is not in the window.
  const m = doc({
    expenses: [
      ex('a', 100, '2026-10-19'),
      ex('b', 100, '2026-10-20', 'transport'),
      ex('c', 140, '2026-10-12'),
      ex('d', 60, '2026-10-13', 'transport'),
      ex('e', 5000, '2026-10-18'),
    ],
  });
  const w = weekVsLast(m);
  assert.equal(w.curT, 200);
  assert.equal(w.prevT, 200, 'same days of last week, not the whole week');
  const lines = buildInsights(m).map((x) => x.text);
  // Total flat, but Transport +67%: "steady" would contradict the next line.
  assert.ok(!lines.some((t) => /steady/.test(t)), 'no steady beside a 67% move');
  assert.ok(lines.some((t) => /Transport is up 67%/.test(t)));
  const up = buildInsights(doc({ expenses: [ex('a', 300, '2026-10-20'), ex('c', 100, '2026-10-13')] }));
  assert.ok(up[0].text.startsWith('This week'), 'the week line names its period for Home');

  // Two equal salaries on the 1st offer a repeat; an active salary repeat stops the offer.
  const inc = [
    { id: 'i1', amount: 60000, source: 'salary', label: '', date: '2026-10-01' },
    { id: 'i2', amount: 60000, source: 'salary', label: '', date: '2026-09-01' },
  ];
  const p = salaryPattern(doc({ income: inc }));
  assert.equal(p.last.id, 'i1');
  assert.deepEqual(p.repeat, { amount: 60000, day: 1 });
  assert.equal(
    salaryPattern(doc({ income: inc, recurring: [{ id: 'r', kind: 'income', category: 'salary', active: true, amount: 1, day: 1 }] })).repeat,
    null
  );
  assert.equal(salaryPattern(doc({ income: [inc[0], { ...inc[1], amount: 59000 }] })).repeat, null, 'amounts differ');

  // salaryDue (clock: 2026-10-20): pattern on the 1st, October's not logged -> due on the 1st.
  const { salaryDue } = _calc;
  const sep = [
    { id: 's1', amount: 60000, source: 'salary', label: '', date: '2026-09-01', accountId: 'b' },
    { id: 's2', amount: 60000, source: 'salary', label: '', date: '2026-08-01' },
  ];
  const d = salaryDue(doc({ income: sep }));
  assert.equal(d.date, '2026-10-01');
  assert.equal(d.amount, 60000);
  assert.equal(d.last.id, 's1');
  assert.equal(salaryDue(doc({ income: inc })), null, 'this month already logged');
  const late = sep.map((i) => ({ ...i, date: i.date.slice(0, 8) + '25' }));
  assert.equal(salaryDue(doc({ income: late })), null, 'its day (the 25th) has not come yet');
  assert.equal(salaryDue(doc({ income: [sep[0]] })), null, 'no pattern from one salary');

  // 349 -> 349399 asks; 349 -> 400 doesn't.
  const old = ex('x', 349, '2026-10-20');
  assert.ok(amountJumpQuestion(doc({ expenses: [old] }), old, 'food', 349399, 349399));
  assert.equal(amountJumpQuestion(doc({ expenses: [old] }), old, 'food', 400, 400), '');

  // 789 spent today: no "spend under X today" can be offered.
  const busy = doc({
    expenses: [1, 2, 3, 4, 5, 6, 7].map((d) => ex('s' + d, 400, '2026-10-0' + d)).concat(ex('t', 789, '2026-10-20')),
  });
  assert.ok(!suggestChallenges(busy).some((c) => c.kind === 'cap'), 'no daily cap already blown');
}
console.log('money-calc QA round: ok');

// ---- EXM-13: the best saving month is dated by its last contribution, never ahead of today ----
{
  const m = doc({ goals: [{ id: 'g', name: 'Trip', target: 9000, contribs: [{ amount: 500, date: '2026-10-03' }, { amount: 2000, date: '2026-10-08' }] }] });
  const best = achievementTimeline(m).find((e) => /Best saving month/.test(e.title));
  assert.equal(best.date, '2026-10-08');
}
console.log('money-calc journey date: ok');

// ---- NEW-1: one-tap budgets need two weeks of history, round down, never start used up ----
{
  const { suggestBudgets } = _calc;
  const amts = (m) => suggestBudgets(m).map((x) => [x.c.key, x.amt]);
  assert.deepEqual(amts(doc({ expenses: [ex('a', 250, '2026-10-20')] })), [], 'one lunch is not a month');
  // 30 days of history: 250 x 0.9 = 225, down to 200 (to the nearest it came back as 250).
  assert.deepEqual(amts(doc({ expenses: [ex('a', 250, '2026-09-21')] })), [['food', 200]]);
  // 14 days: 700 scaled to 30 days is 1,500, 10% under is 1,350.
  assert.deepEqual(amts(doc({ expenses: [ex('a', 400, '2026-10-07'), ex('b', 300, '2026-10-12')] })), [['food', 1350]]);
  // This month already at the amount: not offered (it would read 100% used on the day it is set).
  assert.deepEqual(amts(doc({ expenses: [ex('a', 100, '2026-09-21'), ex('b', 900, '2026-10-20')] })), []);
}
console.log('money-calc budget suggestions: ok');
