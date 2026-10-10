// node scripts/goal-tasks.test.mjs — a goal's linked tasks and how they feed its progress.
import assert from 'node:assert/strict';
import { goalTaskStats, combinedGoalProgress, goalFinishedBy } from './goal-tasks.js';

const goal = { id: 'g1', clearedTaskCount: 0 };
const tasks = [
  { id: 't1', goalId: 'g1', done: true },
  { id: 't2', goalId: 'g1', done: false },
  { id: 't3', goalId: 'g2', done: false },
  { id: 't4', done: true },
];

// Only this goal's tasks; the open ones listed.
let s = goalTaskStats(goal, tasks);
assert.equal(s.done, 1);
assert.equal(s.total, 2);
assert.deepEqual(
  s.open.map((t) => t.id),
  ['t2']
);

// Swept-away finished tasks count on both sides.
s = goalTaskStats({ id: 'g1', clearedTaskCount: 3 }, tasks);
assert.equal(s.done, 4);
assert.equal(s.total, 5);
assert.deepEqual(goalTaskStats(null, tasks), { done: 0, total: 0, open: [] });
assert.equal(goalTaskStats({ id: 'g9' }, null).total, 0);

const ms = [
  { id: 'a', done: true },
  { id: 'b', done: false },
];

// Switch off: milestones alone, whatever the tasks say.
let p = combinedGoalProgress({ milestones: ms }, { done: 4, total: 4 });
assert.deepEqual(p, { done: 1, total: 2, pct: 50, withTasks: false });

// Switch on: each milestone and each task is one step.
p = combinedGoalProgress({ milestones: ms, countTasks: true }, { done: 4, total: 6 });
assert.deepEqual(p, { done: 5, total: 8, pct: 63, withTasks: true });

// Switch on, no milestones: tasks alone.
p = combinedGoalProgress({ countTasks: true }, { done: 1, total: 3 });
assert.deepEqual(p, { done: 1, total: 3, pct: 33, withTasks: true });

// Switch on but no linked tasks: plain milestones, not "with tasks".
p = combinedGoalProgress({ milestones: ms, countTasks: true }, { done: 0, total: 0 });
assert.equal(p.withTasks, false);
assert.equal(p.total, 2);

// Nothing at all.
assert.deepEqual(combinedGoalProgress(null, null), { done: 0, total: 0, pct: 0, withTasks: false });

// The last open linked task ticked: that goal is finished off.
const goals = [{ id: 'g1', completed: false, clearedTaskCount: 1 }];
const after = tasks.map((t) => (t.id === 't2' ? { ...t, done: true } : t));
assert.equal(goalFinishedBy('t2', tasks, after, goals), goals[0]);
// Not when another linked task is still open.
const two = [...tasks, { id: 't5', goalId: 'g1', done: false }];
const twoAfter = two.map((t) => (t.id === 't2' ? { ...t, done: true } : t));
assert.equal(goalFinishedBy('t2', two, twoAfter, goals), null);
// Not on an un-tick, a task on no goal, or a goal already done.
assert.equal(goalFinishedBy('t2', after, tasks, goals), null);
assert.equal(
  goalFinishedBy(
    't4',
    tasks.map((t) => (t.id === 't4' ? { ...t, done: false } : t)),
    tasks,
    goals
  ),
  null
);
assert.equal(goalFinishedBy('t2', tasks, after, [{ id: 'g1', completed: true }]), null);

console.log('goal-tasks: all checks passed');
