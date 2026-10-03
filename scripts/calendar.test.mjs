/* Run with: node scripts/calendar.test.mjs
   Plain-assert self-check for isPastSlot — it decides whether a one-off reminder
   is refused and whether a row claims it will reach WhatsApp, so getting the
   boundary wrong is silently wrong in two places. */
import assert from 'node:assert/strict';
import { isPastSlot, freeBusy, wholeHours } from './calendar.js';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const now = new Date();
const today = keyOf(now);
const yesterday = keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const tomorrow = keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

// --- whole days ---
assert.equal(isPastSlot(yesterday, '23:59'), true, 'yesterday is past whatever the time');
assert.equal(isPastSlot(tomorrow, '00:00'), false, 'tomorrow is not past whatever the time');

// --- today, around the current minute ---
const minutesFromNow = (delta) => {
  const d = new Date(now.getTime() + delta * 60000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
};
if (now.getHours() * 60 + now.getMinutes() >= 5) {
  assert.equal(isPastSlot(today, minutesFromNow(-5)), true, 'five minutes ago is past');
}
if (now.getHours() * 60 + now.getMinutes() < 24 * 60 - 5) {
  assert.equal(isPastSlot(today, minutesFromNow(5)), false, 'five minutes from now is not');
}

// --- a reminder with no time is "sometime today", which has not gone by ---
assert.equal(isPastSlot(today, ''), false);
assert.equal(isPastSlot(today, null), false);
assert.equal(isPastSlot(yesterday, ''), true, 'but an untimed day that is over has');

console.log('isPastSlot: all assertions pass');

// --- freeBusy: blocks merge, gaps are free, point reminders ignored ---
const segs = freeBusy([
  { text: 'Meeting', time: '15:00:00', endTime: '16:00:00' },
  { text: 'Call', time: '15:30', endTime: '17:00' },
  { text: 'Pills', time: '09:00' },
]);
assert.deepEqual(
  segs.map((s) => [s.free, s.start, s.end]),
  [[true, '08:00', '15:00'], [false, '15:00', '17:00'], [true, '17:00', '22:00']]
);
assert.deepEqual(segs[1].titles, ['Meeting', 'Call']);
assert.deepEqual(freeBusy([]).map((s) => s.free), [true], 'an empty day is one free span');

// --- freeBusy with a routine: the whole 24 hours ---
const R = { bed: '23:00', wake: '07:00', lunchFrom: '13:00', lunchTo: '13:45', lunchDays: 'all' };
const spans = (segs) => segs.map((s) => [s.kind, s.start, s.end]);
assert.deepEqual(
  spans(freeBusy([{ text: 'Call', time: '13:30', endTime: '14:00' }], '2026-10-05', R)),
  [
    ['sleep', '00:00', '07:00'],
    ['free', '07:00', '13:00'],
    ['lunch', '13:00', '13:30'],
    ['busy', '13:30', '14:00'],
    ['free', '14:00', '23:00'],
    ['sleep', '23:00', '24:00'],
  ],
  'sleep wraps midnight, a meeting wins over lunch'
);
// Lunch on work days only: 2026-10-04 is a Sunday, outside the default Mon-Fri.
assert.ok(
  !freeBusy([], '2026-10-04', { ...R, lunchDays: 'work' }).some((s) => s.kind === 'lunch'),
  'no work-day lunch on a Sunday'
);
assert.ok(
  freeBusy([], '2026-10-05', { ...R, lunchDays: 'work' }).some((s) => s.kind === 'lunch'),
  'work-day lunch on a Monday'
);
// A bedtime after midnight does not wrap.
assert.deepEqual(
  spans(freeBusy([], '2026-10-05', { bed: '01:00', wake: '09:00', lunchFrom: null, lunchTo: null })),
  [['free', '00:00', '01:00'], ['sleep', '01:00', '09:00'], ['free', '09:00', '24:00']]
);
// No routine: the 08:00-22:00 window stretches to a block outside it.
assert.equal(freeBusy([{ text: 'Gym', time: '06:00', endTime: '07:00' }])[0].start, '06:00');
// Custom routine blocks: each keeps its own name, a meeting still wins, and
// 'off' means the days outside the working week.
const C = {
  ...R,
  lunchFrom: null,
  lunchTo: null,
  items: [
    { name: 'Gym', from: '07:00', to: '08:00', days: 'off' },
    { name: 'Commute', from: '08:00', to: '08:30', days: 'all' },
    { name: 'Study', from: '18:00', to: '20:00', days: 'all' },
  ],
};
const sunday = freeBusy([{ text: 'Call', time: '19:00', endTime: '19:30' }], '2026-10-04', C);
assert.deepEqual(
  sunday.filter((s) => s.kind === 'custom').map((s) => [s.titles[0], s.start, s.end]),
  [
    ['Gym', '07:00', '08:00'],
    ['Commute', '08:00', '08:30'],
    ['Study', '18:00', '19:00'],
    ['Study', '19:30', '20:00'],
  ],
  'back-to-back blocks stay apart, a meeting cuts through one'
);
assert.ok(
  !freeBusy([], '2026-10-05', C).some((s) => s.titles[0] === 'Gym'),
  'a days-off block is not on a Monday'
);

// Week tiles in whole hours add up to the week, not one more.
const wk = { free: 6285, busy: 150, custom: 0, lunch: 270, sleep: 3375 };
const hrs = wholeHours(wk);
assert.equal(Object.values(hrs).reduce((a, b) => a + b, 0), 168, 'tiles sum to 168h');
console.log('freeBusy: all assertions pass');
