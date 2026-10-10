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

if (failures) {
  console.log('\n' + failures + ' failing');
  process.exit(1);
}
console.log('\nall passing');
