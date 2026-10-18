import assert from 'node:assert/strict';
import { isStreakMilestone, habitMoment, tasksMoment, waterMoment, noSpendMoment } from './moments.js';

const D = '2026-10-12';
assert.ok(isStreakMilestone(7) && isStreakMilestone(500) && !isStreakMilestone(8) && !isStreakMilestone(450));

const a = { id: 'a', name: 'Read', doneToday: true, streak: 7 };
const b = { id: 'b', name: 'Walk', doneToday: true, streak: 2 };
const paused = { id: 'c', name: 'Gym', doneToday: false, active: false };
const notDue = { id: 'd', name: 'Swim', doneToday: false, dueToday: false };
assert.equal(habitMoment(a, [a, b], D).kicker, 'Streak milestone'); // milestone wins
assert.equal(habitMoment(a, [a, b], D).title, '7 days in a row');
assert.equal(habitMoment({ ...a, cadence: 'weekly' }, [a, b], D).title, '7 weeks in a row'); // weeks, not days
assert.equal(habitMoment(b, [a, b, paused, notDue], D).kicker, 'All habits done'); // paused + not due don't count
assert.equal(habitMoment(b, [b, { ...a, doneToday: false }], D), null); // one still owed
assert.equal(habitMoment(b, [b], D), null); // a single habit is not "all"
assert.equal(habitMoment({ ...b, doneToday: false }, [b], D), null); // an un-tick

assert.equal(tasksMoment([{ done: true }, { done: true }], D).key, 'tasks:' + D);
assert.equal(tasksMoment([{ done: true }, { done: false }], D), null);
assert.equal(tasksMoment([{ done: true }], D), null);

assert.ok(waterMoment(1800, 2050, 2000, D)); // crossed
assert.equal(waterMoment(2000, 2250, 2000, D), null); // already there
assert.equal(waterMoment(1000, 1250, 2000, D), null); // not yet

assert.match(noSpendMoment(['2026-10-01', '2026-09-30', D], D).desc, /^2 no-spend/);
assert.match(noSpendMoment([D], D).desc, /first/);
console.log('moments.test.mjs: passed');
