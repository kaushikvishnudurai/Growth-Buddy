/* Run with: node scripts/outlook.test.mjs (any TZ, e.g. TZ=Pacific/Kiritimati)
   Plain-assert self-check for Home's Outlook (no test runner). */
import assert from 'node:assert/strict';
import { topInsight, savingsPace, streakPace, outlook } from './outlook.js';
import { buildInsights } from './insights.js';

// Local noon, so the local day key is 2026-01-20 in every timezone.
const NOW = new Date(2026, 0, 20, 12).getTime();
const inc = (date, amount) => ({ date, amount });
const income = ['2025-10-23', '2025-11-15', '2025-12-01', '2025-12-20', '2026-01-10'].map((d) =>
  inc(d, 1000)
);
const expenses = [inc('2025-11-02', 500)];

// --- savings rate and a goal date across a month end ---
{
  // net 4500 over 90 days = 50/day; 1500 left = 30 days -> Feb 19
  const money = {
    income,
    expenses,
    goals: [
      { name: 'Later', target: 9000, dueDate: '2026-12-01', contribs: [] },
      { name: 'Bike', target: 2000, dueDate: '2026-03-01', contribs: [{ amount: 500 }] },
      { name: 'Done', target: 100, dueDate: '2026-01-25', contribs: [{ amount: 100 }] },
    ],
  };
  const s = savingsPace(money, NOW);
  assert.equal(s.kind, 'goal');
  assert.equal(s.name, 'Bike');
  assert.equal(s.rate, 50);
  assert.equal(s.byDate, '2026-02-19');
  assert.equal(s.onTime, true);
  assert.match(s.text, /^At this pace: Bike reached by Feb 19, 2026$/);
  money.goals[1].dueDate = '2026-02-10';
  const late = savingsPace(money, NOW);
  assert.equal(late.onTime, false);
  assert.match(late.text, /after its Feb 10 target/);
}

// --- no goal: amount by the end of the month 3 out (Apr 30 = 100 days) ---
{
  const s = savingsPace({ income, expenses }, NOW);
  assert.equal(s.kind, 'month');
  assert.equal(s.month, '2026-04');
  assert.equal(s.amount, 5000);
  assert.match(s.text, /^At this pace: .*5,000 more saved by the end of Apr 2026$/);
  // fmt's symbol comes from this money doc, not whichever screen painted last
  const usd = savingsPace({ income, expenses, settings: { currency: '$' } }, NOW);
  assert.match(usd.text, /\$5,000/);
  savingsPace({ income, expenses, settings: { currency: '\u20b9' } }, NOW);
  // a ledger older than the window divides by 90, not by the first row inside it
  const old = savingsPace(
    { income: income.slice(1), expenses: expenses.concat(inc('2025-06-01', 0)) },
    NOW
  );
  assert.equal(old.rate, 3500 / 90);
}

// --- one side of the ledger only: no projection either way ---
{
  assert.equal(savingsPace({ income, expenses: [] }, NOW), null);
  const g = [{ name: 'Trip', target: 500, dueDate: '2026-06-01' }];
  assert.equal(savingsPace({ income: [], expenses: income, goals: g }, NOW), null);
}

// --- a pace so slow the date would be centuries out: say so, no date ---
{
  const slow = savingsPace(
    {
      income,
      expenses: [inc('2025-11-02', 4400)],
      goals: [{ name: 'House', target: 10000000, dueDate: '2030-01-01' }],
    },
    NOW
  );
  assert.equal(slow.byDate, null);
  assert.equal(slow.onTime, false);
  assert.match(slow.text, /^House: over 10 years away at this pace$/);
}

// --- stalled / negative rate: a goal gets no date, no goal means nothing ---
{
  const spendy = { income, expenses: [inc('2025-11-02', 9000)] };
  assert.equal(savingsPace(spendy, NOW), null);
  const g = savingsPace(
    Object.assign({}, spendy, { goals: [{ name: 'Trip', target: 500, dueDate: '2026-06-01' }] }),
    NOW
  );
  assert.equal(g.byDate, null);
  assert.equal(g.onTime, false);
  assert.match(g.text, /no finish date yet/);
}

// --- under 30 days of ledger, or under 5 rows: null ---
{
  const recent = ['2026-01-01', '2026-01-05', '2026-01-10', '2026-01-15', '2026-01-19'];
  assert.equal(
    savingsPace({ income: recent.map((d) => inc(d, 100)), expenses: [inc('2026-01-02', 10)] }, NOW),
    null
  );
  assert.equal(savingsPace({ income: income.slice(0, 4), expenses: [] }, NOW), null);
  assert.equal(savingsPace(null, NOW), null);
}

// --- streak: best daily one, next milestone; weekly and paused ignored ---
{
  const habits = [
    { name: 'Read', streak: 12, doneToday: true },
    { name: 'Run', streak: 20, cadence: 'weekly' },
    { name: 'Old', streak: 40, active: false },
  ];
  const s = streakPace(habits, NOW);
  assert.deepEqual(
    { name: s.name, streak: s.streak, next: s.next, byDate: s.byDate },
    { name: 'Read', streak: 12, next: 14, byDate: '2026-01-22' }
  );
  assert.equal(s.text, 'Keep it up: a 14-day Read streak on Jan 22');
  // not ticked yet today: today is day 13
  assert.equal(streakPace([{ name: 'Read', streak: 12 }], NOW).byDate, '2026-01-21');
  assert.equal(streakPace([{ name: 'Read', streak: 30, doneToday: true }], NOW).next, 50);
  assert.equal(streakPace([{ name: 'Read', streak: 1 }], NOW), null);
  assert.equal(streakPace([], NOW), null);
}

// --- feature off drops that part; nothing at all is null ---
{
  const data = {
    money: { income, expenses },
    habits: [{ name: 'Read', streak: 5, doneToday: true }],
    now: NOW,
  };
  const all = outlook(data);
  assert.ok(all.savings && all.streak);
  const noMoney = outlook(Object.assign({}, data, { features: { money: false } }));
  assert.equal(noMoney.savings, null);
  assert.ok(noMoney.streak);
  const noHabits = outlook(Object.assign({}, data, { features: { habits: false } }));
  assert.equal(noHabits.streak, null);
  assert.equal(
    outlook(Object.assign({}, data, { features: { money: false, habits: false } })),
    null
  );
  assert.equal(outlook({ now: NOW }), null);
}

// --- topInsight ranks exactly like Report ---
{
  const sleepByDate = {};
  const moodByDate = {};
  const rows = [
    ['22:00', '07:00', 'great'],
    ['22:30', '07:00', 'great'],
    ['23:00', '07:00', 'good'],
    ['22:00', '06:00', 'good'],
    ['01:00', '05:00', 'low'],
    ['02:00', '06:00', 'low'],
    ['01:30', '05:30', 'okay'],
    ['01:00', '06:00', 'low'],
  ];
  rows.forEach(([bedtime, wakeTime, mood], i) => {
    const d = '2026-01-' + String(10 + i);
    sleepByDate[d] = { bedtime, wakeTime, quality: mood };
    moodByDate[d] = { mood, energy: 'medium', stress: 'normal' };
  });
  const data = { wellness: { sleepByDate, moodByDate }, trends: { byDate: {} }, now: NOW };
  const top = topInsight(data);
  assert.ok(top, 'expected an insight');
  assert.deepEqual(top, buildInsights(data)[0]);
  assert.deepEqual(outlook(data).insight, top);
  assert.equal(
    outlook(Object.assign({}, data, { dismissed: [top.id] })).insight?.id === top.id,
    false
  );
  assert.equal(topInsight({}), null);
  // Report's year fetch (history.year) feeds Home too, so both rank the same days
  const viaYear = topInsight({
    wellness: {},
    trends: { byDate: {} },
    history: { year: { sleepByDate, moodByDate, byDate: {} } },
    now: NOW,
  });
  assert.deepEqual(viaYear, top);
}

console.log('outlook tests passed');
