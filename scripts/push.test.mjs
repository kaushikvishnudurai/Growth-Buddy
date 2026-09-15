/* Node check for the reminder -> device-alarm expansion.

   `node scripts/push.test.mjs`

   Everything else in push.js needs a phone or a service worker;
   `upcomingReminderAlarms` is the part with the decisions in it, and the
   decisions that bite (an occurrence earlier today has already gone, an
   all-day reminder has no moment to ring at, recurrence and skips) are exactly
   the ones you cannot check by tapping around the app. */

import assert from 'node:assert/strict';
import { upcomingReminderAlarms } from './push.js';

// Wednesday, 09:00 local.
const NOW = new Date(2026, 8, 16, 9, 0, 0, 0);
const bodies = (list) => list.map((n) => n.body);

/* An occurrence still ahead today is queued; one already past is not. Getting
   this backwards means every launch re-rings the morning's reminders. */
{
  const rems = [
    { id: 'a', text: 'later', date: '2026-09-16', time: '18:00', repeat: 'none' },
    { id: 'b', text: 'gone', date: '2026-09-16', time: '08:00', repeat: 'none' },
  ];
  assert.deepEqual(bodies(upcomingReminderAlarms(rems, NOW)), ['later']);
}

/* No time = an all-day note on the calendar. 00:00 would ring at midnight. */
{
  const rems = [{ id: 'a', text: 'all day', date: '2026-09-17', repeat: 'none' }];
  assert.equal(upcomingReminderAlarms(rems, NOW).length, 0);
}

/* Recurrence comes from the same occursOn the calendar draws with, bounds and
   per-occurrence skips included. */
{
  const rems = [
    {
      id: 'a',
      text: 'daily',
      date: '2026-09-16',
      time: '18:00',
      repeat: 'daily',
      skip: ['2026-09-18'],
    },
  ];
  const got = upcomingReminderAlarms(rems, NOW, 4);
  assert.deepEqual(
    got.map((n) => n.at.getDate()),
    [16, 17, 19]
  );
}

{
  const rems = [
    { id: 'a', text: 'bounded', date: '2026-09-16', time: '18:00', repeat: 'daily', until: '2026-09-17' },
  ];
  assert.equal(upcomingReminderAlarms(rems, NOW, 7).length, 2);
}

/* Sorted by time and capped, because Android will not hold an unbounded queue
   — and the cap has to keep the SOONEST ones, not whichever the loop met first. */
{
  const rems = [
    { id: 'a', text: 'evening', date: '2026-09-16', time: '18:00', repeat: 'daily' },
    { id: 'b', text: 'noon', date: '2026-09-16', time: '12:00', repeat: 'daily' },
  ];
  const got = upcomingReminderAlarms(rems, NOW, 5, 3);
  assert.deepEqual(bodies(got), ['noon', 'evening', 'noon']);
  assert.deepEqual(
    got.map((n) => n.id),
    [1000, 1001, 1002]
  );
  for (let i = 1; i < got.length; i++) {
    assert.ok(got[i - 1].at <= got[i].at, 'queue must be in firing order');
  }
}

/* Nothing to queue is a normal state, not a crash. */
assert.deepEqual(upcomingReminderAlarms(null, NOW), []);
assert.deepEqual(upcomingReminderAlarms([null, {}], NOW), []);

console.log('push.test.mjs: all assertions passed');
