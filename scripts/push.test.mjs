/* Node check for the device alarm queue.

   `node scripts/push.test.mjs`

   Everything else in push.js needs a phone or a service worker; the queue
   builders are where the decisions live, and the ones that bite (an occurrence
   earlier today has already gone, an all-day reminder has no moment to ring at,
   an inverted water window, which sound file a key maps to) are exactly the
   ones you cannot check by tapping around the app. */

import assert from 'node:assert/strict';
import {
  upcomingReminderAlarms,
  upcomingWaterAlarms,
  upcomingHabitAlarms,
  upcomingAlarms,
  usualDrinkHours,
  isQuietAt,
} from './push.js';
import {
  SILENT_CHANNEL,
  TIMER_ALARM_ID,
  idsToCancel,
  versionedChannel,
  isStaleChannel,
} from './native.js';

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

/* "Notify before": the reminder's own lead wins, null follows the default, and
   a lead can ring tomorrow's 00:10 tonight. Mirrors ReminderPrefs.leadFor. */
{
  const rems = [
    { id: 'a', text: 'own', date: '2026-09-16', time: '18:00', repeat: 'none', notifyBefore: 30 },
    { id: 'b', text: 'default', date: '2026-09-16', time: '18:00', repeat: 'none' },
    { id: 'c', text: 'at time', date: '2026-09-16', time: '18:00', repeat: 'none', notifyBefore: 0 },
    { id: 'd', text: 'early', date: '2026-09-17', time: '00:10', repeat: 'none' },
  ];
  const at = (list, body) => {
    const n = list.find((x) => x.body.startsWith(body));
    return n.at.getDate() + ' ' + n.at.getHours() + ':' + n.at.getMinutes();
  };
  const q = upcomingReminderAlarms(rems, NOW, 3, 15);
  assert.equal(at(q, 'own'), '16 17:30');
  assert.equal(at(q, 'default'), '16 17:45');
  assert.equal(at(q, 'at time'), '16 18:0');
  assert.equal(at(q, 'early'), '16 23:55', 'the evening before');
  assert.equal(q.find((x) => x.body.startsWith('own')).body, 'own · at 18:00');
  assert.equal(q.find((x) => x.body.startsWith('at time')).body, 'at time', 'no time line when it rings on time');
}

/* Inside its own lead: 09:20 with a 30-minute lead, at 09:00 — rings at 09:20. */
assert.equal(
  upcomingReminderAlarms([{ id: 'a', text: 'late', date: '2026-09-16', time: '09:20', repeat: 'none', notifyBefore: 30 }], NOW)[0].at.getMinutes(),
  20
);

/* A snooze rings once more at snoozedUntil; one already past rings nothing. */
{
  const rems = [
    { id: 'a', text: 'snoozed', date: '2026-09-15', time: '08:50', repeat: 'none', snoozedUntil: new Date(2026, 8, 16, 9, 10).toISOString() },
    { id: 'b', text: 'stale', date: '2026-09-15', time: '08:00', repeat: 'none', snoozedUntil: new Date(2026, 8, 16, 8, 30).toISOString() },
  ];
  const q = upcomingReminderAlarms(rems, NOW);
  assert.deepEqual(bodies(q), ['snoozed']);
  assert.equal(q[0].title, 'Snoozed reminder');
  assert.equal(q[0].at.getMinutes(), 10);
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

/* Hours they already drink in drop the nudge right after: a glass at 10:xx on
   most days means 11:00 stays quiet, while the forgotten afternoon still rings. */
{
  const times = [];
  for (let d = 0; d < 5; d++) times.push(new Date(2026, 0, 1 + d, 10, 15).toISOString());
  assert.deepEqual(usualDrinkHours(times), [10]);
  assert.deepEqual(usualDrinkHours(times.slice(0, 4)), [], 'under 5 days');
  const got = upcomingWaterAlarms(
    { on: true, everyMins: 120, from: '09:00', to: '21:00', usualHours: usualDrinkHours(times) },
    NOW,
    1
  );
  assert.deepEqual(got.map((n) => n.at.getHours()), [13, 15, 17, 19, 21]);
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
    q.every((n) => n.sound === 'gb_marimba.wav'),
    'the chosen chime rides on every notification'
  );
  /* The banner fix. Every audible notification has to NAME a channel: leave it
     undefined and the plugin invents one at IMPORTANCE_DEFAULT, which rings
     without ever showing anything on screen. Nothing on a phone can catch that
     regression — the sound still plays, so it looks like it works. */
  assert.ok(
    q.every((n) => n.channelId === 'gb-tone-marimba'),
    'every audible notification names a channel we control'
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
  assert.equal(q.find((n) => n.body === 'own tone').sound, 'gb_droplet.wav');
  assert.equal(q.find((n) => n.body === 'default tone').sound, 'gb_marimba.wav');
  assert.ok(
    q.filter((n) => n.title === 'Time for water').every((n) => n.sound === 'gb_marimba.wav'),
    'the water nudge always follows the default tone'
  );
}

/* Twenty reminders at the same minute. Ids used to clamp into 16 slots, so the
   17th onward quietly took an id another alarm already held and one of them
   never fired. */
{
  const many = Array.from({ length: 20 }, (_, i) => ({
    id: 'r' + i,
    text: 'stand up ' + i,
    date: '2026-09-16',
    time: '18:00',
    repeat: 'none',
  }));
  const q = upcomingAlarms({ reminders: many, sound: 'bloom' }, NOW);
  assert.equal(q.length, 20, 'all twenty are queued');
  assert.equal(new Set(q.map((n) => n.id)).size, 20, 'twenty distinct ids, no clamping');
  const floor = Math.floor(new Date(2026, 8, 16, 18, 0).getTime() / 60000) * 16;
  assert.ok(
    q.every((n) => n.id >= floor),
    'every id still sits at or above its own minute, clear of anything delivered'
  );
}

/* 'Silent' is still queued — it just gets the silent channel and no sound file.
   Dropping it was the old behaviour and it cost the user the notification as
   well as the sound: the reminder reached the in-app bell and WhatsApp and
   never the phone, while the Test button (which ignored the tone) still rang. */
{
  const q = upcomingAlarms(
    {
      reminders: [
        { id: 'a', text: 'quiet one', date: '2026-09-16', time: '18:00', sound: 'off' },
        { id: 'b', text: 'loud one', date: '2026-09-16', time: '19:00', sound: 'bloom' },
      ],
      sound: 'marimba',
    },
    NOW
  );
  assert.deepEqual(q.map((n) => n.body), ['quiet one', 'loud one'], 'the silent reminder is still queued');
  assert.equal(q[0].channelId, SILENT_CHANNEL, 'on the silent channel');
  assert.equal(q[0].sound, undefined, 'and with no sound file');
  assert.equal(q[1].channelId, 'gb-tone-bloom', 'the loud one names its own tone channel');
  assert.equal(q[1].sound, 'gb_bloom.wav');
}

/* Silent as the DEFAULT tone applies to everything that doesn't override it,
   water included — but again, silences rather than cancels. */
{
  const q = upcomingAlarms(
    {
      reminders: [
        { id: 'a', text: 'follows default', date: '2026-09-16', time: '18:00' },
        { id: 'b', text: 'own tone', date: '2026-09-16', time: '19:00', sound: 'droplet' },
      ],
      water: { on: true, everyMins: 120, from: '09:00', to: '21:00' },
      sound: 'off',
    },
    NOW
  );
  const byBody = Object.fromEntries(q.map((n) => [n.body, n]));
  assert.equal(byBody['follows default'].channelId, SILENT_CHANNEL);
  assert.equal(
    byBody['own tone'].channelId,
    'gb-tone-droplet',
    'its own tone overrides a silent default'
  );
  assert.equal(byBody['own tone'].sound, 'gb_droplet.wav');
  assert.ok(q.some((n) => n.title === 'Time for water'), 'the water nudge is queued too, silently');
}

/* A time that doesn't parse must not become an alarm: NaN passes every check
   below it and the whole batch is rejected with a NaN id in it. */
{
  const q = upcomingAlarms(
    { reminders: [{ id: 'x', text: 'broken', date: '2026-09-16', time: 'not-a-time' }] },
    NOW
  );
  assert.equal(q.length, 0, 'an unparseable time is skipped, not queued');
}

/* The user's own upload and anything unknown have no rendered file, so they
   fall through to the phone's own sound rather than pointing a channel at
   nothing — the user picked a real tone, we just can't ship that one. They
   share one audible channel of ours, which is what makes them banner; only
   'off' is routed to the silent channel, where nothing rings at all. What they
   must never be is channel-less, which hands them back to the plugin. */
for (const key of ['custom', 'nope', undefined]) {
  const q = upcomingAlarms(
    { reminders: [{ id: 'a', text: 'x', date: '2026-09-16', time: '18:00' }], sound: key },
    NOW
  );
  assert.equal(q[0].sound, undefined, 'no file for ' + key);
  assert.equal(q[0].channelId, 'gb-tone-default', 'an audible channel of ours for ' + key);
}

/* ---- habits ---- */

/* No reminder time set means nothing to schedule. */
assert.deepEqual(
  upcomingHabitAlarms([{ id: 'h1', name: 'Workout', reminderTime: null, doneToday: false }], NOW),
  []
);

/* Already checked in today: don't nag about something already done. */
assert.deepEqual(
  upcomingHabitAlarms([{ id: 'h1', name: 'Workout', reminderTime: '09:00', doneToday: true }], NOW, 1),
  []
);

/* doneToday only describes today. A habit checked in this morning still
   needs tomorrow's (and the rest of the horizon's) alarm — doneToday must
   not suppress the whole multi-day queue, only day 0. */
{
  const got = upcomingHabitAlarms(
    [{ id: 'h1', name: 'Workout', reminderTime: '09:00', doneToday: true }],
    NOW,
    3
  );
  assert.equal(got.length, 2, 'day 0 suppressed by doneToday, days 1 and 2 still queue');
  assert.deepEqual(
    got.map((n) => n.at.toISOString()),
    [new Date(2026, 8, 17, 9, 0, 0, 0).toISOString(), new Date(2026, 8, 18, 9, 0, 0, 0).toISOString()]
  );
}

/* A habit's own tone rides on the queued alarm, same as a reminder's. */
{
  const got = upcomingHabitAlarms(
    [{ id: 'h1', name: 'Workout', reminderTime: '18:00', doneToday: false, sound: 'buzz' }],
    NOW,
    1
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].sound, 'buzz');
  assert.equal(got[0].body, 'Workout');
}

/* No tone chosen falls back to null, resolved later by upcomingAlarms's own
   default — same contract upcomingReminderAlarms already has. */
{
  const got = upcomingHabitAlarms(
    [{ id: 'h1', name: 'Workout', reminderTime: '18:00', doneToday: false }],
    NOW,
    1
  );
  assert.equal(got[0].sound, null);
}

/* Nothing to queue is a normal state, not a crash. */
assert.deepEqual(upcomingAlarms({}, NOW), []);
assert.deepEqual(upcomingAlarms({ reminders: [null, {}] }, NOW), []);
assert.deepEqual(upcomingAlarms(undefined, NOW), []);

/* A reminder re-sync cancels the queue before rebuilding it, and used to take
   the focus timer's session-end alarm with it. */
assert.deepEqual(idsToCancel([{ id: 2 }, { id: 90001 }, { id: 90002 }], [TIMER_ALARM_ID]), [90001, 90002]);
assert.deepEqual(idsToCancel([{ id: 2 }, { id: 90001 }]), [2, 90001]);
assert.deepEqual(idsToCancel(null, [TIMER_ALARM_ID]), []);


/* ---- channel versions ---- */

/* Version 1 is the ids already frozen on phones: they must stay exactly as
   they were, or every install gets a second set of channels. A bump suffixes
   every id and marks the old ones (and only ours) for deletion. */
assert.equal(versionedChannel('gb-tone-chime', 1), 'gb-tone-chime');
assert.equal(versionedChannel('gb-tone-chime', 2), 'gb-tone-chime-v2');
assert.equal(SILENT_CHANNEL, 'gb-silent');
assert.equal(isStaleChannel('gb-tone-chime', 1), false);
assert.equal(isStaleChannel('gb-tone-chime', 2), true);
assert.equal(isStaleChannel('gb-tone-chime-v2', 2), false);
assert.equal(isStaleChannel('gb-silent-v2', 3), true);
assert.equal(isStaleChannel('sound_chime', 2), false, 'never a channel we did not name');
assert.equal(isStaleChannel(undefined, 2), false);

/* ---- done, a second alert, quiet hours ---- */

/* A checked-off occurrence queues nothing; the days around it still ring. */
{
  const rems = [
    { id: 'a', text: 'pills', date: '2026-09-16', time: '18:00', repeat: 'daily', doneDates: ['2026-09-17'] },
  ];
  assert.deepEqual(
    upcomingReminderAlarms(rems, NOW, 3).map((n) => n.at.getDate()),
    [16, 18]
  );
}

/* A second alert rings too, with its own lead; one equal to the first, or
   already gone, adds nothing. Mirrors ReminderDeliveryScheduler.secondDueDay. */
{
  const at = (n) => n.at.getDate() + ' ' + n.at.getHours() + ':' + n.at.getMinutes();
  const both = upcomingReminderAlarms(
    [{ id: 'a', text: 'call', date: '2026-09-16', time: '18:00', repeat: 'none', notifyBefore: 10, notifyBefore2: 60 }],
    NOW
  );
  assert.deepEqual(both.map(at).sort(), ['16 17:0', '16 17:50']);
  assert.ok(both.every((n) => n.body === 'call · at 18:00'));
  assert.equal(
    upcomingReminderAlarms(
      [{ id: 'a', text: 'x', date: '2026-09-16', time: '18:00', repeat: 'none', notifyBefore: 10, notifyBefore2: 10 }],
      NOW
    ).length,
    1,
    'the same lead twice is one ring'
  );
  assert.equal(
    upcomingReminderAlarms(
      [{ id: 'a', text: 'x', date: '2026-09-16', time: '09:30', repeat: 'none', notifyBefore2: 60 }],
      NOW
    ).length,
    1,
    'a second alert already gone is dropped, the reminder itself still rings'
  );
  // Inside the first alert's lead the first falls back to on time; a second
  // alert of 0 would then be the same ring.
  assert.equal(
    upcomingReminderAlarms(
      [{ id: 'a', text: 'x', date: '2026-09-16', time: '09:10', repeat: 'none', notifyBefore: 30, notifyBefore2: 0 }],
      NOW
    ).length,
    1
  );
  // The default lead counts as the first alert's lead.
  assert.equal(
    upcomingReminderAlarms([{ id: 'a', text: 'x', date: '2026-09-16', time: '18:00', notifyBefore2: 15 }], NOW, 1, 15)
      .length,
    1
  );
}

/* Quiet hours: wraps midnight, end exclusive, off when unset or equal. */
{
  const q = { start: '22:00', end: '07:00' };
  assert.equal(isQuietAt(q, new Date(2026, 8, 16, 23, 30)), true);
  assert.equal(isQuietAt(q, new Date(2026, 8, 16, 6, 59)), true);
  assert.equal(isQuietAt(q, new Date(2026, 8, 16, 7, 0)), false);
  assert.equal(isQuietAt(q, new Date(2026, 8, 16, 12, 0)), false);
  assert.equal(isQuietAt({ start: '13:00', end: '14:00' }, new Date(2026, 8, 16, 13, 15)), true);
  assert.equal(isQuietAt({ start: '09:00', end: '09:00' }, new Date(2026, 8, 16, 9, 0)), false);
  assert.equal(isQuietAt(null, new Date(2026, 8, 16, 23, 0)), false);
  assert.equal(isQuietAt({ start: 'late' }, new Date(2026, 8, 16, 23, 0)), false);
}

/* ...and they hold back the water nudge and habit reminders, never a reminder
   the user timed themselves. */
{
  const queue = upcomingAlarms(
    {
      reminders: [{ id: 'r', text: 'late call', date: '2026-09-16', time: '22:30', repeat: 'none' }],
      habits: [{ id: 'h', name: 'Read', reminderTime: '22:15' }, { id: 'h2', name: 'Walk', reminderTime: '18:00' }],
      water: { on: true, everyMins: 60, from: '20:00', to: '23:00' },
      quiet: { start: '21:00', end: '07:00' },
    },
    NOW
  );
  const today = queue.filter((n) => n.at.getDate() === 16).map((n) => n.at.getHours() + ':' + n.at.getMinutes());
  assert.deepEqual(today, ['18:0', '20:0', '22:30'], 'Walk and the 20:00 glass; the late call still rings');
}

console.log('push.test.mjs: all assertions passed');
