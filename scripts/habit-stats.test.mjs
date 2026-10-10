// node scripts/habit-stats.test.mjs — a habit's history as numbers (habit-stats.js).
import assert from 'node:assert/strict';
import {
  addDays,
  isoWeekStart,
  dayState,
  heatmapWeeks,
  completionRate,
  bestStreak,
  habitStats,
  pctLabel,
  canEditDay,
  suggestReminderTime,
  linkedHabitActivity,
  monthStart,
  quitStreak,
  longestQuitRun,
  recentNotes,
} from './habit-stats.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + err.message);
  }
}

// A Saturday; its ISO week starts Monday 2026-10-05.
const TODAY = '2026-10-10';
const done = (date) => ({ date, done: true, protectedDay: false });
const frozen = (date) => ({ date, done: false, protectedDay: true });
const undone = (date) => ({ date, done: false, protectedDay: false });
const back = (n) => addDays(TODAY, -n);

test('date keys move across a month and a leap day', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(isoWeekStart(TODAY), '2026-10-05');
  assert.equal(isoWeekStart('2026-10-05'), '2026-10-05');
  assert.equal(isoWeekStart('2026-10-11'), '2026-10-05'); // a Sunday ends the ISO week
});

test('a day reads future / before / done / frozen / today / missed', () => {
  const ctx = { today: TODAY, since: '2026-10-01', cadence: 'daily' };
  assert.equal(dayState(null, '2026-10-11', ctx), 'future');
  assert.equal(dayState(null, '2026-09-30', ctx), 'before');
  assert.equal(dayState(done('2026-10-02'), '2026-10-02', ctx), 'done');
  assert.equal(dayState(frozen('2026-10-03'), '2026-10-03', ctx), 'frozen');
  assert.equal(dayState(null, TODAY, ctx), 'today');
  assert.equal(dayState(null, '2026-10-04', ctx), 'missed');
  // Un-ticking leaves a done=false row: still a miss, not "nothing happened".
  assert.equal(dayState(undone('2026-10-04'), '2026-10-04', ctx), 'missed');
});

test('a weekly habit is never "missed" on a single day', () => {
  const ctx = { today: TODAY, since: '2026-10-01', cadence: 'weekly' };
  assert.equal(dayState(null, '2026-10-04', ctx), 'open');
  assert.equal(dayState(null, '2026-10-04', { ...ctx, cadence: 'custom' }), 'open');
});

test('the heatmap is 12 Monday-start weeks ending with this one', () => {
  const grid = heatmapWeeks({
    days: [done(TODAY)],
    since: '2026-01-01',
    today: TODAY,
    cadence: 'daily',
  });
  assert.equal(grid.length, 12);
  assert.ok(grid.every((w) => w.cells.length === 7));
  assert.equal(grid[11].start, '2026-10-05');
  assert.equal(grid[0].start, addDays('2026-10-05', -77));
  assert.equal(grid[11].cells[5].date, TODAY);
  assert.equal(grid[11].cells[5].state, 'done');
  assert.equal(grid[11].cells[6].state, 'future'); // Sunday the 11th
});

test('30-day rate: done over owed days, today only once ticked', () => {
  // 30 days back, every other day done; today not ticked yet.
  const days = [];
  for (let i = 1; i < 30; i++) if (i % 2 === 0) days.push(done(back(i)));
  const rate = completionRate({
    days,
    since: '2026-01-01',
    today: TODAY,
    cadence: 'daily',
    windowDays: 30,
  });
  // 29 past days count (today is left out until done), 14 done.
  assert.equal(Math.round(rate * 1000), Math.round((14 / 29) * 1000));
  const ticked = completionRate({
    days: days.concat(done(TODAY)),
    since: '2026-01-01',
    today: TODAY,
    cadence: 'daily',
    windowDays: 30,
  });
  assert.equal(Math.round(ticked * 1000), Math.round((15 / 30) * 1000));
});

test('a frozen day is not owed', () => {
  const days = [done(back(2)), frozen(back(1))];
  const rate = completionRate({
    days,
    since: back(2),
    today: TODAY,
    cadence: 'daily',
    windowDays: 30,
  });
  assert.equal(rate, 1);
});

test('days before the habit existed are not owed', () => {
  const rate = completionRate({
    days: [done(back(1))],
    since: back(1),
    today: TODAY,
    cadence: 'daily',
    windowDays: 30,
  });
  assert.equal(rate, 1);
});

test('created today and nothing done yet has no rate', () => {
  const rate = completionRate({
    days: [],
    since: TODAY,
    today: TODAY,
    cadence: 'daily',
    windowDays: 30,
  });
  assert.equal(rate, null);
  assert.equal(pctLabel(rate), '—');
});

test('N-a-week owes target/7 a day and caps at 100%', () => {
  // 3x a week over 28 counted days owes 12; 12 done is 100%, 6 is 50%.
  const since = back(28);
  const twelve = [];
  for (let i = 1; i <= 28 && twelve.length < 12; i += 2) twelve.push(done(back(i)));
  const rate = completionRate({
    days: twelve,
    since,
    today: TODAY,
    cadence: 'custom',
    targetPerWeek: 3,
    windowDays: 30,
  });
  assert.equal(rate, 1);
  const six = twelve.slice(0, 6);
  const half = completionRate({
    days: six,
    since,
    today: TODAY,
    cadence: 'custom',
    targetPerWeek: 3,
    windowDays: 30,
  });
  assert.equal(Math.round(half * 100), 50);
  // Every day of a weekly habit: still 100%, not 700%.
  const daily = [];
  for (let i = 1; i <= 28; i++) daily.push(done(back(i)));
  assert.equal(
    completionRate({ days: daily, since, today: TODAY, cadence: 'weekly', windowDays: 30 }),
    1
  );
});

test('all-time starts at since, not at the 30-day window', () => {
  const days = [done(back(60)), done(back(1))];
  const all = completionRate({
    days,
    since: back(60),
    today: TODAY,
    cadence: 'daily',
    windowDays: Infinity,
  });
  assert.equal(Math.round(all * 1000), Math.round((2 / 60) * 1000));
});

test('daily best streak: a freeze bridges the gap but adds nothing', () => {
  const days = [
    done(back(10)),
    done(back(9)),
    frozen(back(8)),
    done(back(7)),
    done(back(3)),
    done(back(2)),
  ];
  assert.deepEqual(bestStreak({ days, cadence: 'daily' }), { best: 3, unit: 'day' });
});

test('daily best streak: an un-ticked day breaks the run', () => {
  const days = [done(back(5)), undone(back(4)), done(back(3)), done(back(2))];
  assert.equal(bestStreak({ days, cadence: 'daily' }).best, 2);
});

test('weekly best streak counts consecutive weeks that met the quota', () => {
  // 3x a week: weeks of 09-14 and 09-21 met it, 09-28 had 2, 10-05 met it.
  const days = [
    done('2026-09-14'),
    done('2026-09-15'),
    done('2026-09-16'),
    done('2026-09-21'),
    done('2026-09-23'),
    done('2026-09-25'),
    done('2026-09-28'),
    done('2026-09-29'),
    done('2026-10-05'),
    done('2026-10-06'),
    done('2026-10-07'),
  ];
  assert.deepEqual(bestStreak({ days, cadence: 'custom', targetPerWeek: 3 }), {
    best: 2,
    unit: 'week',
  });
  assert.equal(bestStreak({ days, cadence: 'weekly' }).best, 4);
});

test('habitStats bundles the panel', () => {
  const s = habitStats({
    days: [done(back(1)), done(TODAY)],
    since: back(1),
    today: TODAY,
    cadence: 'daily',
  });
  assert.equal(s.rate30, 1);
  assert.equal(s.rateAll, 1);
  assert.equal(s.best, 2);
  assert.equal(s.unit, 'day');
  assert.equal(s.doneTotal, 2);
});

test('a past day can be edited within 7 days, never future or before creation', () => {
  const ctx = { today: TODAY, since: back(30) };
  assert.equal(canEditDay(TODAY, ctx), true);
  assert.equal(canEditDay(back(7), ctx), true);
  assert.equal(canEditDay(back(8), ctx), false);
  assert.equal(canEditDay(addDays(TODAY, 1), ctx), false);
  assert.equal(canEditDay(back(3), { today: TODAY, since: back(2) }), false);
});

test('reminder suggestion: median of the other habits’ times, else 19:00', () => {
  assert.equal(suggestReminderTime([]), '19:00');
  assert.equal(suggestReminderTime([{ reminderTime: null }]), '19:00');
  assert.equal(suggestReminderTime([{ reminderTime: '07:30:00' }]), '07:30');
  assert.equal(
    suggestReminderTime([
      { reminderTime: '21:00' },
      { reminderTime: '06:45' },
      { reminderTime: '08:00' },
    ]),
    '08:00'
  );
  // Even count: the earlier middle, a time the user really chose.
  assert.equal(
    suggestReminderTime([{ reminderTime: '06:00' }, { reminderTime: '20:00' }]),
    '06:00'
  );
  // A paused habit's reminder doesn't ring, so it says nothing about the user.
  assert.equal(suggestReminderTime([{ reminderTime: '05:00', active: false }]), '19:00');
});

test('linked habits: check-ins this month and distinct days', () => {
  const hist = {
    a: [done('2026-10-02'), done('2026-10-03'), done('2026-09-30'), undone('2026-10-04')],
    b: [done('2026-10-03'), done('2026-10-09')],
  };
  const from = monthStart(TODAY);
  assert.equal(from, '2026-10-01');
  assert.deepEqual(linkedHabitActivity(hist, ['a', 'b'], from, TODAY), { checkins: 4, days: 3 });
  // A repeated id counts once; an unknown one counts nothing.
  assert.deepEqual(linkedHabitActivity(hist, ['a', 'a', 'zz'], from, TODAY), {
    checkins: 2,
    days: 2,
  });
  assert.deepEqual(linkedHabitActivity(hist, [], from, TODAY), { checkins: 0, days: 0 });
});

/* ---- "Break a habit" (kind: 'quit') — mirrors HabitQuitTest ---- */

test('quit streak: days since the last slip, today included unless slipped', () => {
  const since = back(5);
  assert.equal(quitStreak({ days: [], since, today: TODAY }), 6);
  assert.equal(quitStreak({ days: [], since: TODAY, today: TODAY }), 1);
  assert.equal(quitStreak({ days: [undone(back(3))], since, today: TODAY }), 3);
  assert.equal(quitStreak({ days: [undone(TODAY)], since, today: TODAY }), 0);
  // A freeze row or a taken-back slip (done) is not a slip.
  assert.equal(quitStreak({ days: [frozen(back(1)), done(back(2))], since, today: TODAY }), 6);
});

test('quit best streak is the widest clean gap between slips', () => {
  const since = back(20);
  const days = [undone(back(14)), undone(back(3))];
  assert.equal(longestQuitRun({ days, since, today: TODAY }), 10);
  assert.deepEqual(bestStreak({ days, since, today: TODAY, kind: 'quit' }), {
    best: 10,
    unit: 'day',
  });
  assert.equal(longestQuitRun({ days: [], since, today: TODAY }), 21);
});

test('a quit day reads clean or slipped, and today is already clean', () => {
  const ctx = { today: TODAY, since: '2026-10-01', cadence: 'daily', kind: 'quit' };
  assert.equal(dayState(null, '2026-10-04', ctx), 'clean');
  assert.equal(dayState(null, TODAY, ctx), 'clean');
  assert.equal(dayState(undone('2026-10-04'), '2026-10-04', ctx), 'slipped');
  assert.equal(dayState(null, '2026-09-30', ctx), 'before');
  assert.equal(dayState(null, '2026-10-11', ctx), 'future');
});

test('quit rate is the share of clean days; habitStats counts slips', () => {
  const days = [undone(back(1)), undone(back(3))];
  const s = habitStats({ days, since: back(9), today: TODAY, cadence: 'daily', kind: 'quit' });
  assert.equal(s.rate30, 8 / 10);
  assert.equal(s.slips, 2);
  assert.equal(s.doneTotal, 0);
  assert.equal(s.best, 6); // back 9..4
});

test('recent notes: newest first, blank ones skipped, capped', () => {
  const days = [
    { ...done(back(4)), note: 'easy one' },
    { ...undone(back(1)), note: 'cake at work' },
    { ...done(back(2)), note: '   ' },
    done(back(3)),
  ];
  const notes = recentNotes({ days, since: back(9), today: TODAY, cadence: 'daily', kind: 'quit' });
  assert.deepEqual(
    notes.map((n) => [n.date, n.note, n.state]),
    [
      [back(1), 'cake at work', 'slipped'],
      [back(4), 'easy one', 'clean'],
    ]
  );
  assert.equal(recentNotes({ days, since: back(9), today: TODAY, limit: 1 }).length, 1);
});

if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nall passed');
