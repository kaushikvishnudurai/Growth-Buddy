/* Run with: node scripts/insights.test.mjs
   Plain-assert self-check for the insights correlation math (no test runner). */
import assert from 'node:assert/strict';
import { compare, signals, buildInsights, shift } from './insights.js';

// Consecutive YYYY-MM-DD keys starting 2026-06-01 (a Monday).
const day = (i) => new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);

// --- compare(): median split detects a clear positive relationship ---
{
  const xs = { d1: 1, d2: 2, d3: 3, d4: 7, d5: 8, d6: 9, d7: 10 };
  const ys = { d1: 10, d2: 20, d3: 30, d4: 70, d5: 80, d6: 90, d7: 100 };
  const r = compare(xs, ys);
  assert.ok(r, 'expected a result with 7 paired days');
  assert.equal(r.n, 7);
  assert.ok(r.meanHigh > r.meanLow, 'high-x half should have higher y');
  assert.ok(r.diff > 0);
}

// --- compare(): too few paired days -> null (4 days is noise, not a pattern) ---
assert.equal(compare({ a: 1, b: 2, c: 8, d: 9 }, { a: 1, b: 2, c: 8, d: 9 }), null);

// --- compare(): all-equal predictor -> null (no usable split) ---
assert.equal(
  compare(
    { a: 5, b: 5, c: 5, d: 5, e: 5, f: 5, g: 5 },
    { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }
  ),
  null
);

// --- shift(): out[d] holds the value from the next day ---
assert.deepEqual(shift({ '2026-06-02': 7, '2026-03-01': 1 }, 1), {
  '2026-06-01': 7,
  '2026-02-28': 1,
});

// --- signals(): derives sleep hours across midnight + maps ordinals ---
{
  const sig = signals({
    wellness: {
      sleepByDate: { '2026-06-20': { bedtime: '23:00', wakeTime: '07:00', quality: 'great' } },
      moodByDate: { '2026-06-20': { mood: 'good', energy: 'high', stress: 'calm' } },
    },
    trends: { byDate: { '2026-06-20': { score: 80, waterMl: 2000 } } },
  });
  assert.equal(sig.sleepHours['2026-06-20'], 8, 'midnight-wrapping sleep hours');
  assert.equal(sig.sleepQuality['2026-06-20'], 4);
  assert.equal(sig.mood['2026-06-20'], 3);
  assert.equal(sig.energy['2026-06-20'], 3);
  assert.equal(sig.stress['2026-06-20'], 1);
  assert.equal(sig.score['2026-06-20'], 80);
}

// --- buildInsights(): surfaces a real sleep↔mood correlation ---
{
  const sleepByDate = {};
  const moodByDate = {};
  // 8 days: long sleep -> great mood, short sleep -> low mood.
  const rows = [
    ['d1', '22:00', '07:00', 'great'], // 9h
    ['d2', '22:30', '07:00', 'great'], // 8.5h
    ['d3', '23:00', '07:00', 'good'], // 8h
    ['d4', '22:00', '06:00', 'good'], // 8h
    ['d5', '01:00', '05:00', 'low'], // 4h
    ['d6', '02:00', '06:00', 'low'], // 4h
    ['d7', '01:30', '05:30', 'okay'], // 4h
    ['d8', '01:00', '06:00', 'low'], // 5h
  ];
  const moods = {
    d1: 'great',
    d2: 'great',
    d3: 'good',
    d4: 'good',
    d5: 'low',
    d6: 'low',
    d7: 'okay',
    d8: 'low',
  };
  for (const [d, bedtime, wakeTime, quality] of rows) {
    sleepByDate[d] = { bedtime, wakeTime, quality };
    moodByDate[d] = { mood: moods[d], energy: 'medium', stress: 'normal' };
  }
  const out = buildInsights({ wellness: { sleepByDate, moodByDate }, trends: { byDate: {} } });
  assert.ok(out.length >= 1, 'expected at least one insight');
  assert.ok(
    out.some((i) => /sleep/i.test(i.title) && /mood/i.test(i.title)),
    'expected a sleep↔mood insight'
  );
  assert.ok(out.length <= 4, 'capped at 4');
}

// --- buildInsights(): sparse data -> no insights ---
assert.deepEqual(buildInsights({ wellness: {}, trends: {} }), []);

// --- stress today -> worse sleep the following night (lagged pair) ---
{
  const sleepByDate = {};
  const moodByDate = {};
  for (let i = 0; i < 10; i++) {
    const tense = i % 2 === 0; // even days stressful
    moodByDate[day(i)] = { mood: 'okay', energy: 'medium', stress: tense ? 'high' : 'calm' };
    // Sleep keyed on the wake date: the night after a tense day is poor.
    sleepByDate[day(i + 1)] = {
      bedtime: '23:00',
      wakeTime: '07:00',
      quality: tense ? 'low' : 'great',
    };
  }
  const out = buildInsights({ wellness: { sleepByDate, moodByDate }, trends: {} });
  assert.ok(
    out.some((i) => i.title === 'Stress → next-day sleep quality' && /lower/.test(i.text)),
    'expected the lagged stress -> sleep insight'
  );
}

// --- sleep debt + mood dip: this week vs the weeks before ---
{
  const sleepByDate = {};
  const moodByDate = {};
  for (let i = 0; i < 21; i++) {
    const late = i >= 14; // the last 7 days
    sleepByDate[day(i)] = { bedtime: late ? '01:00' : '23:00', wakeTime: '07:00', quality: 'good' };
    moodByDate[day(i)] = { mood: late ? 'low' : 'good', energy: 'medium', stress: 'normal' };
  }
  const out = buildInsights({ wellness: { sleepByDate, moodByDate }, trends: {} });
  const debt = out.find((i) => i.title === 'Sleep debt this week');
  assert.ok(debt, 'expected sleep debt');
  assert.match(debt.text, /6h a night/);
  assert.match(debt.text, /14h short/);
  assert.ok(
    out.some((i) => i.title === 'Mood dipping this week'),
    'expected mood dip'
  );
}

// --- weekday pattern: Mondays low ---
{
  const moodByDate = {};
  for (let i = 0; i < 28; i++) {
    moodByDate[day(i)] = { mood: i % 7 === 0 ? 'low' : 'good', energy: 'medium', stress: 'normal' };
  }
  const out = buildInsights({ wellness: { moodByDate }, trends: {} });
  const wd = out.find((i) => i.title === 'Mondays and your mood');
  assert.ok(wd, 'expected a Monday mood insight');
  assert.match(wd.text, /lowest-mood/);
}

// --- best bedtime: in bed in the 22:00 hour sleeps best ---
{
  const sleepByDate = {};
  for (let i = 0; i < 12; i++) {
    const early = i % 2 === 0;
    sleepByDate[day(i)] = {
      bedtime: early ? '22:15' : '00:30',
      wakeTime: '07:00',
      quality: early ? 'great' : 'okay',
    };
  }
  const sig = signals({ wellness: { sleepByDate }, trends: {} });
  const best = buildInsights({ wellness: { sleepByDate }, trends: {} }).find(
    (i) => i.title === 'Your best bedtime'
  );
  assert.ok(best, 'expected a best-bedtime insight');
  assert.match(best.text, /between 22:00 and 23:00/);
  // Bedtime drift is distance from the median bedtime, across midnight.
  assert.equal(sig.bedShift[day(0)] + sig.bedShift[day(1)], 2.25);
}

console.log('insights.test.mjs: all assertions passed');
