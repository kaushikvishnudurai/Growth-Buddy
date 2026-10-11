// node scripts/goal-merge.test.mjs — merging a stale goal progress save onto the server's (goal-merge.js).
import assert from 'node:assert/strict';
import { mergeProgress } from './goal-merge.js';

const a = { id: 'a', title: 'Plan', done: false };
const b = { id: 'b', title: 'Build', done: false };
const base = { milestones: [a, b], durationDays: 30 };

// Tab 1 added "c"; tab 2 (the server now) added "d": both kept, theirs first.
const c = { id: 'c', title: 'Tab one', done: false };
const d = { id: 'd', title: 'Tab two', done: false };
let out = mergeProgress(base, { ...base, milestones: [a, b, c] }, { ...base, milestones: [a, b, d] });
assert.deepEqual(out.milestones.map((x) => x.id), ['a', 'b', 'd', 'c']);

// We ticked "a", they renamed "b": both edits survive.
out = mergeProgress(
  base,
  { ...base, milestones: [{ ...a, done: true }, b] },
  { ...base, milestones: [a, { ...b, title: 'Build it' }] }
);
assert.deepEqual(out.milestones, [{ ...a, done: true }, { ...b, title: 'Build it' }]);

// We deleted "b": it stays deleted. They deleted "a" and we did not touch it: gone too.
out = mergeProgress(base, { ...base, milestones: [a] }, { ...base, milestones: [b] });
assert.deepEqual(out.milestones, []);

// Both edited "a": the newest edit, ours, wins.
out = mergeProgress(base, { ...base, milestones: [{ ...a, title: 'Mine' }, b] }, { ...base, milestones: [{ ...a, title: 'Theirs' }, b] });
assert.equal(out.milestones[0].title, 'Mine');

// Other fields: ours where we changed them, theirs otherwise.
out = mergeProgress(base, { ...base, durationDays: 60 }, { ...base, daysFollowed: 4 });
assert.equal(out.durationDays, 60);
assert.equal(out.daysFollowed, 4);

// No base (never saved before) and milestones without ids (older data).
out = mergeProgress(null, { milestones: [{ title: 'x' }] }, { milestones: [{ title: 'y' }] });
assert.deepEqual(out.milestones.map((x) => x.title), ['y', 'x']);

console.log('goal-merge: ok');
