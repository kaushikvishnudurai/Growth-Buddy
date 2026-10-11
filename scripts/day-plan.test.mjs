// node scripts/day-plan.test.mjs: Plan my day's draft, without the AI.
import assert from 'node:assert/strict';
import { buildDayPlan } from './day-plan.js';

const today = '2026-10-14'; // a Wednesday
const plan = buildDayPlan({
  today,
  nowMin: 9 * 60 + 40, // 09:40
  tasks: [
    { id: 't1', title: 'Someday', done: false },
    { id: 't2', title: 'Report', done: false, dueAt: '2026-10-14T12:00:00' },
    { id: 't3', title: 'Late thing', done: false, dueAt: '2026-10-12T12:00:00' },
    { id: 't4', title: 'Done one', done: true, dueAt: '2026-10-12T12:00:00' },
    { id: 't5', title: 'Paused', done: false, paused: true, priority: 'High' },
    { id: 't6', title: 'Important', done: false, priority: 'High' },
  ],
  habits: [
    { id: 'h1', name: 'Read', doneToday: false, reminderTime: '21:30:00' },
    { id: 'h2', name: 'Walk', doneToday: true },
    { id: 'h3', name: 'Stretch', doneToday: false },
  ],
  reminders: [
    { text: 'Standup', date: '2026-10-01', repeat: 'daily', time: '10:30' },
    { text: 'Tomorrow only', date: '2026-10-15', repeat: 'none', time: '08:00' },
    { text: 'Ticked', date: today, repeat: 'none', time: '15:00', doneDates: [today] },
  ],
  subscriptions: [
    { name: 'Netflix', amount: 199, dueDay: 14 },
    { name: 'Gym', amount: 999, dueDay: 2, paidFor: '2026-10' },
    { name: 'Rent', amount: 20000, dueDay: 5 },
    { name: 'Later', amount: 5, dueDay: 28 },
  ],
});

const tasks = plan.filter((x) => x.kind === 'task');
// Most pressing first: overdue, due today, high priority. Done and paused never.
assert.deepEqual(
  tasks.map((x) => x.title),
  ['Late thing', 'Report', 'Important']
);
// Blocks start on the next half hour and step around the 10:30 standup.
assert.deepEqual(
  tasks.map((x) => x.time),
  ['11:00', '12:00', '13:00']
);
assert.equal(tasks[0].detail, 'overdue');

const rem = plan.filter((x) => x.kind === 'reminder').map((x) => x.title);
assert.deepEqual(rem, ['Standup'], 'only today, and not one already ticked');

const bills = plan.filter((x) => x.kind === 'bill');
assert.deepEqual(
  bills.map((x) => x.title),
  ['Pay Netflix', 'Pay Rent']
);
assert.match(bills[1].detail, /overdue/);

const habits = plan.filter((x) => x.kind === 'habit');
assert.deepEqual(
  habits.map((x) => [x.title, x.time]),
  [
    ['Read', '21:30'],
    ['Stretch', null],
  ]
);

// Timed first in time order, untimed after.
const times = plan.map((x) => x.time);
const firstNull = times.indexOf(null);
assert.ok(times.slice(firstNull).every((t) => t === null));
assert.deepEqual(times.slice(0, firstNull), [...times.slice(0, firstNull)].sort());

// Late in the day there's no hour left: the task is still listed, unblocked.
const late = buildDayPlan({ today, nowMin: 21 * 60 + 10, tasks: [{ id: 'x', title: 'X' }] });
assert.equal(late[0].time, null);
assert.equal(late[0].block, false);

// Nothing at all is an empty plan, not a throw.
assert.deepEqual(buildDayPlan({ today, nowMin: 0 }), []);

console.log('day-plan: ok');
