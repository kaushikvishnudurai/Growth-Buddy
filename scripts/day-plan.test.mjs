// node scripts/day-plan.test.mjs: Plan my day's draft, without the AI.
import assert from 'node:assert/strict';
import { buildDayPlan, planTarget } from './day-plan.js';

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

// A reminder whose time has gone today is not on the plan (FRC-8: 08:00 listed at 23:30).
const evening = buildDayPlan({
  today,
  nowMin: 18 * 60,
  reminders: [
    { text: 'Vitamins', date: '2026-10-01', repeat: 'daily', time: '08:00' },
    { text: 'Call home', date: today, repeat: 'none', time: '19:00' },
    { text: 'Untimed', date: today, repeat: 'none' },
  ],
});
assert.deepEqual(
  evening.filter((x) => x.kind === 'reminder').map((x) => x.title),
  ['Call home', 'Untimed']
);

// After 21:00 no block fits today, so the plan is tomorrow's, from the morning.
assert.deepEqual(planTarget(today, 10 * 60), { day: today, nowMin: 600, tomorrow: false });
assert.deepEqual(planTarget(today, 20 * 60 + 29), { day: today, nowMin: 1229, tomorrow: false });
assert.deepEqual(planTarget(today, 23 * 60 + 30), { day: '2026-10-15', nowMin: 0, tomorrow: true });
assert.deepEqual(planTarget('2026-10-31', 22 * 60).day, '2026-11-01', 'month rolls over');
// Tomorrow's draft lists tomorrow's 08:00 and gives the task a 09:00 block.
const t = planTarget(today, 23 * 60 + 30);
const tom = buildDayPlan({
  today: t.day,
  nowMin: t.nowMin,
  tasks: [{ id: 'x', title: 'X' }],
  reminders: [{ text: 'Vitamins', date: '2026-10-01', repeat: 'daily', time: '08:00' }],
});
assert.deepEqual(
  tom.map((x) => [x.kind, x.time]),
  [
    ['reminder', '08:00'],
    ['task', '09:00'],
  ]
);

// A task's day is read in the account's zone, the zone `today` is in.
const lateUtc = [{ id: 'z', title: 'Call', dueAt: '2026-10-15T02:00:00Z' }]; // 19:00 on the 14th in LA
assert.equal(buildDayPlan({ today: '2026-10-14', nowMin: 600, tasks: lateUtc, zone: 'America/Los_Angeles' })[0].detail, 'due today');
assert.equal(buildDayPlan({ today: '2026-10-14', nowMin: 600, tasks: lateUtc, zone: 'Asia/Kolkata' })[0].detail, '');

console.log('day-plan: ok');
