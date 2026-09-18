/* Node check for the device alarm queue.

   `node scripts/push.test.mjs`

   Everything else in push.js needs a phone or a service worker; the queue
   builders are where the decisions live, and the ones that bite (an occurrence
   earlier today has already gone, an all-day reminder has no moment to ring at,
   an inverted water window, which sound file a key maps to) are exactly the
   ones you cannot check by tapping around the app. */

import assert from 'node:assert/strict';
import { upcomingReminderAlarms, upcomingWaterAlarms, upcomingAlarms } from './push.js';

// Wednesday, 09:00 local.
const NOW = new Date(2026, 8, 16, 9, 0, 0, 0);
const bodies = (list) => list.map((n) => n.body);

/* ---- reminders ---- */

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
assert.equal(
  upcomingReminderAlarms([{ id: 'a', text: 'all day', date: '2026-09-17' }], NOW).length,
  0
);

/* Recurrence comes from the same occursOn the calendar draws with, bounds and
   per-occurrence skips included. */
{
  const rems = [
    { id: 'a', text: 'daily', date: '2026-09-16', time: '18:00', repeat: 'daily', skip: ['2026-09-18'] },
  ];
  assert.deepEqual(
    upcomingReminderAlarms(rems, NOW, 4).map((n) => n.at.getDate()),
    [16, 17, 19]
  );
}
{
  const rems = [
    { id: 'a', text: 'bounded', date: '2026-09-16', time: '18:00', repeat: 'daily', until: '2026-09-17' },
  ];
  assert.equal(upcomingReminderAlarms(rems, NOW, 7).length, 2);
}

/* ---- water ---- */

/* Off is the default, and off means nothing queued at all. */
assert.deepEqual(upcomingWaterAlarms(undefined, NOW), []);
assert.deepEqual(upcomingWaterAlarms({ on: false, everyMins: 60 }, NOW), []);

/* A drumbeat inside the window, skipping what today has already passed:
   09:00 is `now`, so today starts at 11:00 and runs to 21:00. */
{
  const got = upcomingWaterAlarms({ on: true, everyMins: 120, from: '09:00', to: '21:00' }, NOW, 1);
  assert.deepEqual(
    got.map((n) => n.at.getHours()),
    [11, 13, 15, 17, 19, 21]
  );
}

/* An inverted or empty window is an unfinished edit, not a request to nudge all
   night — silence beats guessing. */
assert.deepEqual(upcomingWaterAlarms({ on: true, from: '21:00', to: '09:00' }, NOW), []);

/* Nobody wants a nudge every five minutes; the floor also stops one bad pref
   from filling the whole queue. */
{
  const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const got = upcomingWaterAlarms({ on: true, everyMins: 5, from: '09:00', to: '12:00' }, NOW, 1);
  assert.deepEqual(got.map((n) => hhmm(n.at)), [
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
  ]);
}

/* ---- the merged queue ---- */

{
  const q = upcomingAlarms(
    {
      reminders: [{ id: 'a', text: 'evening', date: '2026-09-16', time: '18:00', repeat: 'daily' }],
      water: { on: true, everyMins: 120, from: '09:00', to: '21:00' },
      sound: 'marimba',
    },
    NOW
  );
  for (let i = 1; i < q.length; i++) {
    assert.ok(q[i - 1].at <= q[i].at, 'queue must be in firing order');
  }
  assert.equal(new Set(q.map((n) => n.id)).size, q.length, 'ids must be unique in a batch');
  // The id has to be a function of when it fires, so a rebuilt queue never
  // reuses the id of a notification already delivered to the shade — Android
  // would replace it, and deleting one reminder would erase past ones.
  assert.ok(
    q.every((n) => Math.floor(n.id / 16) === Math.floor(n.at.getTime() / 60000)),
    'ids are derived from the firing minute'
  );
  assert.ok(
    q.every((n) => n.id > Math.floor(NOW.getTime() / 60000) * 16 && n.id < 2 ** 31 - 1),
    'ids sit above every past minute and inside a signed 32-bit int'
  );
  assert.ok(
    q.some((n) => n.body === 'evening') && q.some((n) => n.title === 'Time for water'),
    'both sources land in one queue'
  );
  assert.ok(
    q.every((n) => n.sound === 'gb-marimba.wav'),
    'the chosen chime rides on every notification'
  );
}

/* A reminder can carry its own tone. The default is for the ones that don't —
   including every water nudge, which has no reminder to carry anything. */
{
  const q = upcomingAlarms(
    {
      reminders: [
        { id: 'a', text: 'own tone', date: '2026-09-16', time: '18:00', sound: 'droplet' },
        { id: 'b', text: 'default tone', date: '2026-09-16', time: '19:00' },
      ],
      water: { on: true, everyMins: 120, from: '09:00', to: '21:00' },
      sound: 'marimba',
    },
    NOW
  );
  assert.equal(q.find((n) => n.body === 'own tone').sound, 'gb-droplet.wav');
  assert.equal(q.find((n) => n.body === 'default tone').sound, 'gb-marimba.wav');
  assert.ok(
    q.filter((n) => n.title === 'Time for water').every((n) => n.sound === 'gb-marimba.wav'),
    'the water nudge always follows the default tone'
  );
}

/* 'off', the user's own upload and anything unknown have no rendered file, so
   they fall through to the phone's own sound rather than pointing a channel at
   nothing. */
for (const key of ['off', 'custom', 'nope', undefined]) {
  const q = upcomingAlarms(
    { reminders: [{ id: 'a', text: 'x', date: '2026-09-16', time: '18:00' }], sound: key },
    NOW
  );
  assert.equal(q[0].sound, undefined, 'no file for ' + key);
}

/* Nothing to queue is a normal state, not a crash. */
assert.deepEqual(upcomingAlarms({}, NOW), []);
assert.deepEqual(upcomingAlarms({ reminders: [null, {}] }, NOW), []);
assert.deepEqual(upcomingAlarms(undefined, NOW), []);

console.log('push.test.mjs: all assertions passed');
