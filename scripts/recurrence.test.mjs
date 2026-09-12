/* Run: node scripts/recurrence.test.mjs
   Guards the one shared answer to "does this reminder land on this day?".
   ReminderService.occursOn (Java) must agree with every case below —
   ReminderServiceOccursOnTest is its mirror. */
import assert from 'node:assert/strict';
import { occursOn } from './recurrence.js';

const rem = (over) => ({ date: '2026-09-14', repeat: 'none', skip: [], ...over }); // a Monday

// --- Mon-Fri ---
const wd = rem({ repeat: 'weekdays' });
for (const [day, name] of [
  ['2026-09-14', 'Mon'], ['2026-09-15', 'Tue'], ['2026-09-16', 'Wed'],
  ['2026-09-17', 'Thu'], ['2026-09-18', 'Fri'],
]) assert.equal(occursOn(wd, day), true, name + ' should fire');
for (const [day, name] of [['2026-09-19', 'Sat'], ['2026-09-20', 'Sun']])
  assert.equal(occursOn(wd, day), false, name + ' should not fire');

// Anchored on a Saturday: the weekend it starts on is skipped, Monday is the first hit.
const satAnchored = rem({ date: '2026-09-12', repeat: 'weekdays' });
assert.equal(occursOn(satAnchored, '2026-09-12'), false, 'its own Saturday');
assert.equal(occursOn(satAnchored, '2026-09-14'), true, 'the Monday after');

// Bounds and skips apply to weekdays like every other frequency.
assert.equal(occursOn(rem({ repeat: 'weekdays', until: '2026-09-16' }), '2026-09-17'), false);
assert.equal(occursOn(rem({ repeat: 'weekdays', skip: ['2026-09-16'] }), '2026-09-16'), false);
assert.equal(occursOn(rem({ repeat: 'weekdays' }), '2026-09-11'), false, 'before the anchor');

// --- the rest, so the extraction didn't change them ---
assert.equal(occursOn(rem({ repeat: 'daily' }), '2026-09-19'), true, 'daily covers weekends');
assert.equal(occursOn(rem({ repeat: 'weekly' }), '2026-09-21'), true, 'weekly = same weekday');
assert.equal(occursOn(rem({ repeat: 'weekly' }), '2026-09-22'), false);
assert.equal(occursOn(rem(), '2026-09-14'), true, 'one-off on its own day');
assert.equal(occursOn(rem(), '2026-09-15'), false, 'one-off, next day');

// The clamp the Home mini calendar used to get wrong: anchored to the 31st,
// February fires on the 28th rather than not at all.
const m31 = rem({ date: '2026-01-31', repeat: 'monthly' });
assert.equal(occursOn(m31, '2026-02-28'), true, 'Jan 31 monthly -> Feb 28');
assert.equal(occursOn(m31, '2026-02-27'), false);
assert.equal(occursOn(m31, '2026-03-31'), true);

assert.equal(occursOn(rem({ date: '2026-02-29', repeat: 'yearly' }), '2027-02-28'), true, 'leap-day yearly');

console.log('recurrence.test.mjs: all assertions passed');
