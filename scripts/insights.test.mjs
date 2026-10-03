/* Run with: node scripts/insights.test.mjs
   Plain-assert self-check for the insights correlation math (no test runner). */
import assert from 'node:assert/strict';
import {
  compare,
  signals,
  buildInsights,
  shift,
  focusHours,
  habitDays,
  habitWeekdayMiss,
  missTwice,
  keystoneHabit,
  goalPace,
  taskTiming,
  pushedTask,
  taskWeekday,
  unusualExpense,
  hiddenSubscription,
  waterGap,
  scoreChange,
} from './insights.js';

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
  // Two equal camps of bedtimes have no usual bedtime, so no drift to report.
  assert.deepEqual(sig.bedShift, {});
}

// --- bedtime drift: distance from the median bedtime, across midnight ---
{
  const sleepByDate = {};
  for (let i = 0; i < 10; i++) {
    sleepByDate[day(i)] = {
      bedtime: i < 7 ? '23:30' : '01:00',
      wakeTime: '07:00',
      quality: 'good',
    };
  }
  const sig = signals({ wellness: { sleepByDate }, trends: {} });
  assert.equal(sig.bedShift[day(0)], 0);
  assert.equal(sig.bedShift[day(9)], 1.5);
}

// --- focusHours: morning sessions twice as long are found; 9 sessions say nothing ---
{
  const at = (d, h, min) => ({
    durationSec: min * 60,
    completedAt: new Date(2026, 5, 1 + d, h, min).toISOString(), // started on the hour, local
  });
  const s = [];
  for (let d = 0; d < 5; d++) s.push(at(d, 9, 40), at(d, 15, 20));
  const c = focusHours(s);
  assert.ok(c && /between 09:00 and 11:00/.test(c.text), c && c.text);
  assert.equal(focusHours(s.slice(0, 9)), null);
}

// --- habits: weekday misses, never-miss-twice, keystone ---
{
  // Gym since a Monday, 28 days to yesterday; missed every Friday.
  const today = day(28);
  const days = [];
  for (let i = 0; i < 28; i++) if (i % 7 !== 4) days.push({ date: day(i), done: true });
  const hd = habitDays(
    [
      { id: 'g', name: 'Gym', cadence: 'daily' },
      { id: 'w', name: 'Weekly', cadence: 'weekly' },
    ],
    { g: { since: day(0), days }, w: { since: day(0), days: [] } },
    today
  );
  assert.equal(hd.length, 1, 'weekly habits have no daily misses');
  assert.equal(hd[0].days.length, 28);
  const c = habitWeekdayMiss(hd);
  assert.ok(c && /Gym most on Fridays: missed 4 of 4/.test(c.text), c && c.text);

  // A frozen day is not a miss.
  const frozen = habitDays(
    [{ id: 'g', name: 'Gym', cadence: 'daily' }],
    { g: { since: day(0), days: [{ date: day(0), protectedDay: true }] } },
    day(1)
  );
  assert.equal(frozen[0].days[0].done, true);

  // Pattern done,miss,miss repeated, ending done then a miss yesterday.
  const pat = [];
  for (let i = 0; i < 15; i++) pat.push({ key: day(i), done: i % 3 === 0 });
  pat.push({ key: day(15), done: true }, { key: day(16), done: false });
  const two = missTwice([{ name: 'Read', doneToday: false, days: pat }]);
  assert.ok(two && /Read slipped yesterday/.test(two.text), two && two.text);
  assert.equal(missTwice([{ name: 'Read', doneToday: true, days: pat }]), null);

  // Mood great on meditation days, low otherwise.
  const md = [];
  const moodByDate = {};
  for (let i = 0; i < 10; i++) {
    md.push({ key: day(i), done: i % 2 === 0 });
    moodByDate[day(i)] = { mood: i % 2 === 0 ? 'great' : 'low' };
  }
  const k = keystoneHabit([{ name: 'Meditate', days: md }], signals({ wellness: { moodByDate } }));
  assert.ok(
    k && /On days you do Meditate, mood runs higher: 4\/4 vs 1\/4/.test(k.text),
    k && k.text
  );
}

// --- goalPace: 25% done after 30 days, target in 10 days -> late; on pace -> nothing ---
{
  const now = Date.parse('2026-06-30T12:00:00Z');
  const goal = (target, ms) => ({
    id: 'a',
    title: 'Read 12 books',
    createdAt: '2026-05-31T12:00:00Z',
    targetDate: target,
    progress: { milestones: ms },
  });
  const quarter = [{ done: true }, { done: false }, { done: false }, { done: false }];
  const c = goalPace([goal('2026-07-10', quarter)], {}, now);
  assert.ok(c && /behind pace/.test(c.title) && /25% of the way/.test(c.text), c && c.text);
  assert.equal(goalPace([goal('2026-10-30', quarter)], {}, now), null);
  // Local progress (state.goalProgress) wins over the server copy.
  assert.equal(
    goalPace([goal('2026-07-10', quarter)], { a: { milestones: [{ done: true }] } }, now),
    null
  );
}

// --- tasks: timing per priority, pushed, best weekday ---
{
  const fin = [];
  for (let i = 0; i < 12; i++)
    fin.push({
      priority: i < 6 ? 'High' : 'Low',
      createdAt: new Date(2026, 5, 1 + (i % 6), 10).toISOString(),
      // 1 day for High, 4 for Low; every one finished on a Tuesday (2026-06-09 is one).
      doneAt: new Date(2026, 5, 9, 10).toISOString(),
    });
  assert.ok(taskTiming(fin) && /High/.test(taskTiming(fin).text));
  const one = (p) => ({
    priority: p,
    createdAt: '2026-06-01T10:00:00Z',
    doneAt: '2026-06-02T10:00:00Z',
  });
  assert.match(taskTiming([one('High'), one('High'), one('High')]).text, /High 1 day\./);
  assert.ok(/Tuesdays: 12 of 12/.test(taskWeekday(fin).text));
  assert.equal(pushedTask([{ title: 'x', done: false, pushCount: 2 }]), null);
  assert.ok(
    /moved to a later day 4 times/.test(
      pushedTask([{ title: 'Tax', done: false, pushCount: 4 }]).text
    )
  );
}

// --- money: one-off spike, and a monthly payment that isn't a subscription yet ---
{
  const expenses = [];
  for (let i = 0; i < 6; i++) expenses.push({ amount: 200, category: 'Food', date: day(i) });
  expenses.push({ amount: 1000, category: 'Food', date: day(20), note: 'party' });
  for (const d of ['2026-03-05', '2026-04-04', '2026-05-05', '2026-06-04'])
    expenses.push({ amount: 649, category: 'Bills', date: d, note: 'Netflix' });
  const u = unusualExpense({ expenses }, day(21));
  assert.ok(u && /1,000 on Food \(party\) is 5x your usual 200/.test(u.text), u && u.text);
  assert.equal(unusualExpense({ expenses }, day(40)), null, 'only this week');
  const h = hiddenSubscription({ expenses }, '2026-06-20');
  assert.ok(h && /Netflix/.test(h.text), h && h.text);
  assert.equal(
    hiddenSubscription({ expenses, subscriptions: [{ name: 'netflix' }] }, '2026-06-20'),
    null
  );
}

// --- water: a dry afternoon over 5 days ---
{
  const times = [];
  for (let d = 0; d < 5; d++)
    for (const h of [8, 9, 10, 11, 17, 18, 19])
      times.push(new Date(2026, 5, 1 + d, h, 5).toISOString());
  const w = waterGap(times);
  assert.ok(w && /between 12:00 and 17:00/.test(w.text), w && w.text);
  assert.equal(waterGap(times.slice(0, 20)), null, 'under 5 days');
}

// --- scoreChange: habits fell, tasks held ---
{
  const a = { score: 90, tasksDone: 4, tasksTotal: 5, habitsDone: 5, habitsTotal: 5 };
  const b = { score: 60, tasksDone: 4, tasksTotal: 5, habitsDone: 2, habitsTotal: 5 };
  const c = scoreChange([a, b]);
  assert.ok(
    c && /30 points down/.test(c.text) && /habits: 2 of 5 done vs 5 of 5/.test(c.text),
    c && c.text
  );
  assert.equal(scoreChange([a, { ...a, score: 85 }]), null);
}

// --- buildInsights: no history at all still works ---
assert.deepEqual(buildInsights({}), []);

console.log('insights.test.mjs: all assertions passed');
