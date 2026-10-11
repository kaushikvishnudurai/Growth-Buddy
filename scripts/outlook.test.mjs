/* Run with: node scripts/outlook.test.mjs (any TZ, e.g. TZ=Pacific/Kiritimati)
   Plain-assert self-check for Home's Outlook (no test runner). */
import assert from 'node:assert/strict';
import { topInsight, savingsPace, streakPace, outlook, yearOf } from './outlook.js';
import { buildInsights } from './insights.js';

// Local noon, so the local day key is 2026-01-20 in every timezone.
const NOW = new Date(2026, 0, 20, 12).getTime();
const inc = (date, amount) => ({ date, amount });
// Irregular income (1000s 10 to 40 days apart): measured over whole months, Nov + Dec =
// 3050 over 61 days = 50/day. Spend 450 over the 90-day span = 5/day. Net 45/day.
const income = [
  inc('2025-10-23', 1000),
  inc('2025-11-02', 1000),
  inc('2025-11-15', 525),
  inc('2025-12-01', 1000),
  inc('2025-12-20', 525),
  inc('2026-01-10', 1000),
];
const expenses = [inc('2025-11-02', 450)];

// --- savings rate and a goal date across a month end ---
{
  // 45/day; 1500 left = 34 days -> Feb 23
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
  assert.equal(s.rate, 45);
  assert.equal(s.byDate, '2026-02-23');
  assert.equal(s.onTime, true);
  assert.match(
    s.text,
    /^At this pace: Bike reached by 23 Feb 2026, based on .*1,522 a month income and .*5 a day spending$/
  );
  money.goals[1].dueDate = '2026-02-10';
  const late = savingsPace(money, NOW);
  assert.equal(late.onTime, false);
  assert.match(late.text, /after its 10 Feb target/);
}

// --- no goal: amount by the end of the month 3 out (Apr 30 = 100 days x 45) ---
{
  const s = savingsPace({ income, expenses }, NOW);
  assert.equal(s.kind, 'month');
  assert.equal(s.month, '2026-04');
  assert.equal(s.amount, 4500);
  assert.match(s.text, /^At this pace: .*4,500 more saved by the end of Apr 2026, based on /);
  // fmt's symbol comes from this money doc, not whichever screen painted last
  const usd = savingsPace({ income, expenses, settings: { currency: '$' } }, NOW);
  assert.match(usd.text, /\$4,500/);
  savingsPace({ income, expenses, settings: { currency: '\u20b9' } }, NOW);
  // a ledger older than the window divides by 90, not by the first row inside it
  const old = savingsPace(
    { income: income.slice(1), expenses: expenses.concat(inc('2025-06-01', 0)) },
    NOW
  );
  assert.equal(old.rate, 50 - 450 / 90);
}

// --- a salary: two 60,000s a month apart in a 45-day ledger are one a month, not 1.33 ---
{
  const now = new Date(2026, 9, 11, 12).getTime(); // 11 Oct 2026
  const expenses = [];
  for (let d = Date.UTC(2026, 7, 28); d <= Date.UTC(2026, 9, 11); d += 86400000)
    expenses.push(inc(new Date(d).toISOString().slice(0, 10), 342));
  assert.equal(expenses.length, 45);
  const money = {
    income: [inc('2026-09-01', 60000), inc('2026-10-01', 60000)],
    expenses,
    settings: { currency: '\u20b9' },
  };
  const s = savingsPace(money, now);
  // Paydays 1 Nov, 1 Dec, 1 Jan by 31 Jan (112 days): 3 x 60,000 - 112 x 342
  assert.equal(s.amount, 180000 - 112 * 342);
  assert.equal(
    s.text,
    'At this pace: \u20b91,41,696 more saved by the end of Jan 2027, based on \u20b960,000 a month and \u20b9342 a day spending'
  );
  // the old straight line said (120,000 - 15,390) / 45 x 112 = 2,60,360
  assert.ok(s.amount < 0.6 * ((120000 - 45 * 342) / 45) * 112);
  // a goal counts paydays too: 50,000 left needs the 1 Nov salary (60,000 - 21 x 342 = 52,818)
  const g = savingsPace(
    Object.assign({}, money, { goals: [{ name: 'Trip', target: 50000, dueDate: '2027-01-01' }] }),
    now
  );
  assert.equal(g.byDate, '2026-11-01');
  assert.equal(g.onTime, true);
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
  assert.equal(s.text, 'Read: 14 days in a row by 22 Jan');
  // A milestone landing today (6 done, not ticked yet: today makes 7) looks one further,
  // and says today still needs doing.
  const t = streakPace([{ name: 'Read 10 pages', streak: 6 }], NOW);
  assert.equal(t.next, 14);
  assert.equal(t.byDate, '2026-01-27');
  assert.equal(t.text, 'Read 10 pages: do it today for 7 in a row; 14 by 27 Jan');
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

// --- yearOf: the server's finished-day scores replace the last-open snapshot ---
{
  const t = { byDate: { '2026-10-11': { score: 10 }, '2026-10-10': { score: 0, waterMl: 500 } } };
  const scores = [
    { date: '2026-10-09', score: 40 },
    { date: '2026-10-10', score: 50 },
  ];
  const y = yearOf(t, {}, { scores });
  assert.deepEqual(y.trends.byDate['2026-10-10'], { score: 50, waterMl: 500, date: '2026-10-10' });
  assert.equal(y.trends.byDate['2026-10-09'].score, 40);
  assert.equal(y.trends.byDate['2026-10-11'].score, 10);
  assert.equal(t.byDate['2026-10-10'].score, 0, 'live store untouched');
  assert.equal(yearOf(t, {}, {}).trends, t);
}

// --- yearOf: the /api/score/range year fills days the app was never opened on ---
{
  const t = { byDate: { '2026-10-11': { score: 10 } } };
  const scoreRange = [
    { date: '2026-01-02', score: 70 },
    { date: '2026-10-10', score: 20 },
  ];
  const y = yearOf(t, {}, { scoreRange, scores: [{ date: '2026-10-10', score: 55 }] });
  assert.equal(y.trends.byDate['2026-01-02'].score, 70, 'a never-opened day gets its score');
  assert.equal(y.trends.byDate['2026-10-10'].score, 55, 'the two-day fetch is newer and wins');
  assert.equal(y.trends.byDate['2026-10-11'].score, 10, "today stays the live store's");
}

console.log('outlook tests passed');
