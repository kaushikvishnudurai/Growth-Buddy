/* Run with: node scripts/review.test.mjs
   Plain-assert self-check for the Report's look-backs (no test runner). */
import assert from 'node:assert/strict';
import { daysEnding, pixelValues, personalRecords, periodDelta, monthReview } from './review.js';

// --- daysEnding walks keys, across a month end and a DST change ---
assert.deepEqual(daysEnding('2026-03-02', 3), ['2026-02-28', '2026-03-01', '2026-03-02']);
assert.deepEqual(daysEnding('2026-03-30', 2), ['2026-03-29', '2026-03-30']);

// --- pixelValues: blank days stay absent, not 0 ---
{
  const v = pixelValues('score', { trends: { byDate: { '2026-06-01': { score: 50 } } } });
  assert.equal(v['2026-06-01'], 0.5);
  assert.equal('2026-06-02' in v, false);
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
      },
    },
    habits: [{ streak: 4 }],
    history: { finished: [{ doneAt: '2026-06-02T09:00:00' }, { doneAt: '2026-05-02T09:00:00' }] },
  });
  assert.equal(card.headline, '70%');
  assert.deepEqual(
    card.stats.map((s) => s.label),
    ['Tasks finished', 'Habit streak', 'Water goal hit']
  );
  assert.equal(card.stats[0].value, '1');
}

console.log('review.test.mjs: all assertions passed');
