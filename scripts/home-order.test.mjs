// node scripts/home-order.test.mjs — Home's pure rules (home-order.js).
import assert from 'node:assert/strict';
import {
  HOME_WIDGETS,
  resolveHomeLayout,
  sortTasksForHome,
  sortHabitsForHome,
  topStreaks,
  homeGoals,
  daysBetween,
  todayKey,
  shiftDayKey,
  localDayKey,
  tasksForToday,
  taskWhen,
} from './home-order.js';

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

test('an empty saved layout is the catalog, all on', () => {
  const out = resolveHomeLayout(null);
  assert.deepEqual(
    out.map((x) => x.id),
    HOME_WIDGETS.map((w) => w.id)
  );
  assert.ok(out.every((x) => x.enabled));
});

test('saved order and switches are kept; unknown and duplicate ids dropped; new widgets appended on', () => {
  const out = resolveHomeLayout([
    { id: 'money', enabled: false },
    { id: 'gone-widget', enabled: true },
    { id: 'score' },
    { id: 'money', enabled: true },
  ]);
  assert.equal(out[0].id, 'money');
  assert.equal(out[0].enabled, false);
  assert.equal(out[1].id, 'score');
  assert.equal(out[1].enabled, true);
  assert.equal(out.filter((x) => x.id === 'money').length, 1);
  assert.ok(!out.some((x) => x.id === 'gone-widget'));
  assert.equal(out.length, HOME_WIDGETS.length);
  assert.ok(out.find((x) => x.id === 'goals').enabled, 'the new Goals widget arrives on');
});

test('tasks: overdue, today, upcoming, no date, paused, done', () => {
  const now = new Date(2026, 9, 10, 12, 0);
  const at = (d, hr) => new Date(2026, 9, d, hr, 0).toISOString();
  const tasks = [
    { id: 'done', done: true, dueAt: at(9, 9) },
    { id: 'nodate' },
    { id: 'upcoming', dueAt: at(12, 9) },
    { id: 'paused', paused: true, dueAt: at(9, 9) },
    { id: 'today-late', dueAt: at(10, 18) },
    { id: 'overdue', dueAt: at(9, 9), overdue: true },
    { id: 'today-soon', dueAt: at(10, 14) },
  ];
  assert.deepEqual(
    sortTasksForHome(tasks, now).map((t) => t.id),
    ['overdue', 'today-soon', 'today-late', 'upcoming', 'nodate', 'paused', 'done']
  );
});

test('habits: owed and unticked first, then not owed today, done, paused', () => {
  const out = sortHabitsForHome([
    { id: 'done', doneToday: true, dueToday: true },
    { id: 'paused', active: false, dueToday: false },
    { id: 'weekly-met', dueToday: false },
    { id: 'due', dueToday: true },
  ]);
  assert.deepEqual(
    out.map((x) => x.id),
    ['due', 'weekly-met', 'done', 'paused']
  );
});

test('streaks keep days and weeks apart and skip paused habits', () => {
  assert.deepEqual(
    topStreaks([
      { cadence: 'daily', streak: 4 },
      { cadence: 'weekly', streak: 9 },
      { cadence: 'custom', streak: 3 },
      { cadence: 'daily', streak: 40, active: false },
    ]),
    { days: 4, weeks: 9 }
  );
});

test('home goals: open only, nearest target first, undated last, with what is next', () => {
  const sections = [
    {
      goals: [
        { id: 'a', title: 'Undated' },
        { id: 'b', title: 'Done', completed: true, targetDate: '2026-10-11' },
        { id: 'c', title: 'Soon', targetDate: '2026-10-15' },
      ],
    },
    { goals: [{ id: 'd', title: 'Late', targetDate: '2026-10-01' }] },
  ];
  const progress = {
    c: {
      milestones: [
        { title: 'Buy shoes', done: true },
        { title: 'First 5k', done: false },
      ],
    },
    d: { durationDays: 30, daysFollowed: 12 },
  };
  const rows = homeGoals(sections, progress, '2026-10-10');
  assert.deepEqual(
    rows.map((r) => r.goal.id),
    ['d', 'c', 'a']
  );
  assert.equal(rows[0].daysLeft, -9);
  assert.deepEqual(rows[0].days, { done: 12, total: 30 });
  assert.equal(rows[1].daysLeft, 5);
  assert.equal(rows[1].nextMilestone, 'First 5k');
  assert.equal(rows[2].daysLeft, null);
});

test('days between crosses a month and a DST change without drifting', () => {
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
});

test('todayKey: the zone decides the day; no zone or a junk one is the device date', () => {
  const now = new Date('2026-03-08T20:30:00Z'); // already the 9th in Auckland, still the 8th in LA
  assert.equal(todayKey('Pacific/Auckland', now), '2026-03-09');
  assert.equal(todayKey('America/Los_Angeles', now), '2026-03-08');
  assert.equal(todayKey('', now), localDayKey(now));
  assert.equal(todayKey('Not/AZone', now), localDayKey(now));
});

test('shiftDayKey crosses months and years on local dates', () => {
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDayKey('2026-10-11', -7), '2026-10-04');
});

test('a task row says when, relative to now', () => {
  const now = new Date(2026, 9, 12, 12, 0);
  const at = (d, hh) => new Date(2026, 9, d, hh, 0).toISOString();
  const t = (d) => String(d.getHours()).padStart(2, '0') + ':00';
  const dt = (d) => d.getDate() + ' Oct';
  assert.equal(taskWhen(at(10, 18), now, t, dt), '2 days overdue');
  assert.equal(taskWhen(at(11, 18), now, t, dt), '1 day overdue');
  assert.equal(taskWhen(at(12, 9), now, t, dt), 'Overdue · 09:00');
  assert.equal(taskWhen(at(12, 18), now, t, dt), 'Today 18:00');
  assert.equal(taskWhen(at(13, 10), now, t, dt), 'Tomorrow 10:00');
  assert.equal(taskWhen(at(20, 10), now, t, dt), '20 Oct · 10:00');
  assert.equal(taskWhen(null, now, t, dt), null);
  assert.equal(taskWhen('nope', now, t, dt), null);
});

test("the score counts today's tasks: due by tonight or done today", () => {
  const now = new Date(2026, 9, 12, 12, 0);
  const at = (d, hh) => new Date(2026, 9, d, hh, 0).toISOString();
  const tasks = [
    { id: 'overdue', dueAt: at(10, 9) },
    { id: 'tonight', dueAt: at(12, 22) },
    { id: 'tomorrow', dueAt: at(13, 9) },
    { id: 'undated' },
    { id: 'paused', dueAt: at(12, 9), paused: true },
    { id: 'doneToday', done: true, doneAt: at(12, 8), dueAt: at(14, 9) },
    { id: 'doneYesterday', done: true, doneAt: at(11, 8), dueAt: at(11, 9) },
    { id: 'justTicked', done: true },
  ];
  assert.deepEqual(
    tasksForToday(tasks, now).map((t) => t.id),
    ['overdue', 'tonight', 'doneToday', 'justTicked']
  );
  assert.deepEqual(tasksForToday(null, now), []);
});

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nall passing');
