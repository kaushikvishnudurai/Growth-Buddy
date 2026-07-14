/* Run with: node scripts/insights.test.mjs
   Plain-assert self-check for the insights correlation math (no test runner). */
import assert from 'node:assert/strict';
import { compare, signals, buildInsights } from './insights.js';

// --- compare(): median split detects a clear positive relationship ---
{
  const xs = { d1: 1, d2: 2, d3: 8, d4: 9 };
  const ys = { d1: 10, d2: 20, d3: 80, d4: 90 };
  const r = compare(xs, ys);
  assert.ok(r, 'expected a result with 4 paired days');
  assert.equal(r.n, 4);
  assert.ok(r.meanHigh > r.meanLow, 'high-x half should have higher y');
  assert.ok(r.diff > 0);
}

// --- compare(): too few paired days -> null ---
assert.equal(compare({ a: 1, b: 2 }, { a: 1, b: 2 }), null);

// --- compare(): all-equal predictor -> null (no usable split) ---
assert.equal(compare({ a: 5, b: 5, c: 5, d: 5 }, { a: 1, b: 2, c: 3, d: 4 }), null);

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
  // 6 days: long sleep -> great mood, short sleep -> low mood.
  const rows = [
    ['d1', '22:00', '07:00', 'great'], // 9h
    ['d2', '22:30', '07:00', 'great'], // 8.5h
    ['d3', '23:00', '07:00', 'good'], // 8h
    ['d4', '01:00', '05:00', 'low'], // 4h
    ['d5', '02:00', '06:00', 'low'], // 4h
    ['d6', '01:30', '05:30', 'okay'], // 4h
  ];
  const moods = { d1: 'great', d2: 'great', d3: 'good', d4: 'low', d5: 'low', d6: 'okay' };
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
  assert.ok(out.length <= 3, 'capped at 3');
}

// --- buildInsights(): sparse data -> no insights ---
assert.deepEqual(buildInsights({ wellness: {}, trends: {} }), []);

console.log('insights.test.mjs: all assertions passed');
