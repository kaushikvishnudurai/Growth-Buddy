/* Run with: node scripts/review.test.mjs
   Plain-assert self-check for the Report's look-backs (no test runner). */
import assert from 'node:assert/strict';
import {
  daysEnding,
  pixelValues,
  personalRecords,
  periodDelta,
  monthReview,
  weeklyBuckets,
  monthTicks,
  correlate,
  correlationWords,
  focusMinutesByDay,
  weekOverWeek,
} from './review.js';

// --- daysEnding walks keys, across a month end and a DST change ---
assert.deepEqual(daysEnding('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
assert.deepEqual(daysEnding('2026-03-30', 2), ['2026-03-29', '2026-03-30']);

// --- pixelValues: blank days stay absent, not 0 ---
{
  const v = pixelValues('score', {
    today: '2026-06-03',
    trends: { byDate: { '2026-06-01': { score: 50 }, '2026-06-03': { score: 0 } } },
  });
  assert.equal(v['2026-06-01'], 0.5);
  assert.equal('2026-06-02' in v, false);
  assert.equal('2026-06-03' in v, false, "today's unfinished score is not a day's result");
  const m = pixelValues('mood', {
    wellness: { moodByDate: { a: { mood: 'low' }, b: { mood: 'great' }, c: { mood: '??' } } },
  });
  assert.deepEqual(m, { a: 0, b: 1 });
}
// habits: share of daily habits done; frozen counts; today is not judged yet
{
  const habitHistory = {
    h1: {
      since: '2026-06-01',
      days: [
        { date: '2026-06-01', done: true },
        { date: '2026-06-03', done: true },
      ],
    },
    h2: { since: '2026-06-02', days: [{ date: '2026-06-02', protectedDay: true }] },
  };
  const v = pixelValues('habits', { habitHistory, today: '2026-06-03' });
  assert.deepEqual(v, { '2026-06-01': 1, '2026-06-02': 0.5 });
}

// --- personalRecords ---
{
  const recs = personalRecords({
    today: '2026-06-17', // Wednesday
    habits: [
      { name: 'Read', longestStreak: 12 },
      { name: 'Run', longestStreak: 30 },
    ],
    focus: [
      { durationSec: 1500, completedAt: '2026-06-10T10:00:00' },
      { durationSec: 1500, completedAt: '2026-06-10T15:00:00' },
      { durationSec: 2400, completedAt: '2026-06-11T10:00:00' },
    ],
    trends: {
      byDate: {
        '2026-06-01': { waterMl: 2000, waterGoalMl: 2000 },
        '2026-06-02': { waterMl: 2100, waterGoalMl: 2000 },
        '2026-06-03': { waterMl: 500, waterGoalMl: 2000 },
        '2026-06-04': { waterMl: 2000, waterGoalMl: 2000 },
        // 06-05 missing: a gap ends the run
        '2026-06-06': { waterMl: 2000, waterGoalMl: 2000 },
        '2026-06-07': { waterMl: 2000, waterGoalMl: 2000 },
        '2026-06-08': { waterMl: 2000, waterGoalMl: 2000 },
      },
    },
    money: {
      expenses: [
        { date: '2026-06-01', amount: 300 },
        { date: '2026-06-03', amount: 200 }, // week of 06-01: 500
        { date: '2026-06-09', amount: 900 }, // week of 06-08: 900
        { date: '2026-06-16', amount: 10 }, // this week: not finished, not a record
      ],
      noSpendDays: [],
    },
    fmtMoney: (v) => 'Rs' + v,
  });
  const by = Object.fromEntries(recs.map((r) => [r.label, r]));
  assert.equal(by['Longest streak'].value, '30 days');
  assert.equal(by['Longest streak'].sub, 'Run');
  assert.equal(by['Best focus day'].value, '50 min');
  assert.equal(by['Longest water streak'].value, '3 days');
  assert.equal(by['Lowest-spend week'].value, 'Rs500');
}
// nothing loaded -> no records, and one spend week is not a record
{
  assert.deepEqual(personalRecords({}), []);
  const one = personalRecords({
    today: '2026-06-17',
    money: { expenses: [{ date: '2026-06-01', amount: 5 }] },
  });
  assert.equal(one.length, 0);
}

// --- periodDelta ---
assert.equal(periodDelta([1, null], [1, 2]), null);
{
  const d = periodDelta([60, 80], [40, 60]);
  assert.equal(d.diff, 20);
  assert.equal(d.pct, 0.4);
}

// --- monthReview ---
assert.equal(monthReview({ today: '2026-06-17' }), null);
{
  const card = monthReview({
    today: '2026-06-17',
    trends: {
      byDate: {
        '2026-05-31': { score: 0 }, // last month: ignored
        '2026-06-01': { score: 60, waterMl: 2000, waterGoalMl: 2000 },
        '2026-06-02': { score: 80 },
        '2026-06-17': { score: 0 }, // today, still in progress: left out
      },
    },
    habits: [{ streak: 4 }],
    history: { finished: [{ doneAt: '2026-06-02T09:00:00' }, { doneAt: '2026-05-02T09:00:00' }] },
  });
  assert.equal(card.headline, '70%');
  assert.deepEqual(
    card.stats.map((s) => s.label),
    ['Tasks finished', 'Current streak', 'Water goal hit']
  );
  assert.equal(card.stats[0].value, '1');
}

// On the 2nd, last month: its own days, its own name, and no streak (today's, not May's).
{
  const card = monthReview({
    today: '2026-06-02',
    month: '2026-05',
    trends: { byDate: { '2026-05-10': { score: 40 }, '2026-05-20': { score: 60 }, '2026-06-01': { score: 99 } } },
    habits: [{ streak: 4 }],
    history: { finished: [{ doneAt: '2026-05-02T09:00:00' }] },
  });
  assert.equal(card.headline, '50%');
  assert.equal(card.month, '2026-05');
  assert.match(card.eyebrow, /in review$/);
  assert.deepEqual(
    card.stats.map((s) => s.label),
    ['Tasks finished']
  );
}

// 3 Oct: (33 + 61) / 2 = 47%, not (33 + 61 + 0) / 3 = 31%
{
  const card = monthReview({
    today: '2026-10-03',
    trends: {
      byDate: {
        '2026-10-01': { score: 33 },
        '2026-10-02': { score: 61 },
        '2026-10-03': { score: 0 },
      },
    },
  });
  assert.equal(card.headline, '47%');
}
// Only today logged: no finished day, so no score headline
assert.equal(
  monthReview({ today: '2026-10-01', trends: { byDate: { '2026-10-01': { score: 20 } } } }),
  null
);

// --- weeklyBuckets: Monday weeks, gaps stay null, nulls skipped not zeroed ---
{
  // 2026-06-07 is a Sunday, 06-08 a Monday.
  const days = daysEnding('2026-06-16', 10); // 06-07 .. 06-16
  const vals = [4, null, 2, 4, NaN, null, null, null, null, null];
  const b = weeklyBuckets(days, vals);
  assert.deepEqual(b.keys, ['2026-06-01', '2026-06-08', '2026-06-15']);
  assert.deepEqual(b.values, [4, 3, null]);
  assert.deepEqual(b.counts, [1, 2, 0]);
  // A year of days lands in 53 or 54 weeks, never more.
  const year = daysEnding('2026-10-10', 365);
  const yb = weeklyBuckets(year, year.map(() => 1));
  assert.ok(yb.keys.length >= 53 && yb.keys.length <= 54);
  assert.ok(yb.values.every((v) => v === 1));
}
// --- monthTicks: first index of each month; a stub month too close is dropped ---
{
  const keys = ['2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02'];
  assert.deepEqual(monthTicks(keys), [
    { i: 0, month: '2026-01' },
    { i: 1, month: '2026-02' },
    { i: 5, month: '2026-03' },
  ]);
  assert.deepEqual(
    monthTicks(keys, 2).map((t) => t.month),
    ['2026-02', '2026-03'],
    'January had one week: its label would sit on February'
  );
}
// --- correlate: Pearson r over shared days only ---
{
  const xs = {};
  const ys = {};
  const neg = {};
  const days = daysEnding('2026-06-30', 20);
  days.forEach((k, i) => {
    xs[k] = i;
    ys[k] = 2 * i + 1;
    neg[k] = -i;
  });
  const r = correlate(xs, ys);
  assert.equal(r.n, 20);
  assert.ok(Math.abs(r.r - 1) < 1e-9);
  assert.equal(r.points[0].key, '2026-06-11', 'points oldest first');
  assert.ok(Math.abs(correlate(xs, neg).r + 1) < 1e-9);
  // Hand-checked: x 1..5, y 2,4,5,4,5 -> r = 0.7746
  const a = { a1: 1, a2: 2, a3: 3, a4: 4, a5: 5 };
  const b = { a1: 2, a2: 4, a3: 5, a4: 4, a5: 5 };
  assert.ok(Math.abs(correlate(a, b, { min: 5 }).r - 0.7745967) < 1e-6);
  // Under 14 shared days: hidden, not a noisy r.
  const short = {};
  days.slice(0, 13).forEach((k) => (short[k] = Math.random()));
  assert.equal(correlate(xs, short), null);
  // `before` drops today (and later).
  assert.equal(correlate(xs, ys, { before: '2026-06-30' }).n, 19);
  assert.equal(correlate(xs, ys, { before: '2026-06-30', min: 20 }), null);
  // A side that never varies has no r.
  const flat = {};
  days.forEach((k) => (flat[k] = 3));
  assert.equal(correlate(xs, flat), null);
  // Missing / non-finite on either side is not a shared day.
  const holes = { ...ys, [days[0]]: null, [days[1]]: NaN };
  assert.equal(correlate(xs, holes).n, 18);
}
assert.equal(correlationWords(0.05).strength, 'none');
assert.equal(correlationWords(-0.2).strength, 'weak');
assert.equal(correlationWords(0.42).strength, 'moderate');
assert.equal(correlationWords(-0.8).strength, 'strong');
assert.match(correlationWords(0.6).text, /rise together/);
assert.match(correlationWords(-0.6).text, /lower/);
// --- focusMinutesByDay: local days, unfinished sessions ignored ---
{
  const at = (d, h) => new Date(2026, 5, d, h).toISOString();
  const m = focusMinutesByDay([
    { completedAt: at(1, 9), durationSec: 1500 },
    { completedAt: at(1, 20), durationSec: 600 },
    { completedAt: at(2, 9), durationSec: 0 },
    { durationSec: 900 },
    null,
  ]);
  assert.deepEqual(m, { '2026-06-01': 35 });
}
// --- weekOverWeek: Monday to yesterday vs the whole week before ---
{
  // 2026-06-10 is a Wednesday: this week = Mon 08 + Tue 09; last week = 01..07.
  const byDate = {
    '2026-06-01': { waterMl: 2000, kcal: 1800 },
    '2026-06-03': { waterMl: 1000, kcal: 0 },
    '2026-06-07': { waterMl: 0, kcal: 2200 },
    '2026-06-08': { waterMl: 2500, kcal: 2100, proteinG: 80 },
    '2026-06-09': { waterMl: 1500, kcal: 1900 },
    '2026-06-10': { waterMl: 200, kcal: 300 }, // today, half-logged
  };
  const rows = weekOverWeek(byDate, '2026-06-10', ['waterMl', 'kcal', 'proteinG', 'fiberG']);
  assert.deepEqual(rows[0], {
    field: 'waterMl',
    cur: 2000,
    prev: 1500,
    curDays: 2,
    prevDays: 2,
    diff: 500,
  });
  assert.equal(rows[1].prev, 2000, '0 kcal is a day not logged, not a fast');
  assert.equal(rows[1].cur, 2000);
  assert.deepEqual(
    rows[2],
    { field: 'proteinG', cur: 80, prev: null, curDays: 1, prevDays: 0, diff: null },
    'protein only this week: no change to show'
  );
  assert.equal(rows.length, 3, 'a field neither week logged is left out');
  // On a Monday, this week has no finished day yet.
  const mon = weekOverWeek(byDate, '2026-06-08', ['waterMl']);
  assert.equal(mon[0].cur, null);
  assert.equal(mon[0].prevDays, 2);
}

console.log('review.test.mjs: all assertions passed');
