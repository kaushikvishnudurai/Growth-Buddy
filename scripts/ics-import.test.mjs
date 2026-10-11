/* Run: node scripts/ics-import.test.mjs

   ics-import.js: another calendar's .ics read into reminder bodies. Our own
   export (the exact lines ReminderIcs.java writes) reads back as the same
   reminders; a Google Calendar export reads with its zones, alerts and
   repeats; what the app can't repeat comes in once, flagged. */
import assert from 'node:assert/strict';
import { unfold, unescapeText, parseIcs, readTime, triggerMinutes, readRule, toReminders } from './ics-import.js';
import { occursOn } from './recurrence.js';

const ZONE = 'Asia/Kolkata';
const TODAY = '2026-10-11';
const run = (text, extra) => toReminders(parseIcs(text), { zone: ZONE, today: TODAY, now: '10:00', ...extra });
const cal = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n') + '\r\n';
const byTitle = (items) => Object.fromEntries(items.map((i) => [i.title, i]));

// Unfolding, text escapes.
assert.deepEqual(unfold('A:one\r\n two\r\n\tthree\r\nB:x'), ['A:onetwothree', 'B:x']);
assert.equal(unescapeText('Call mom\\, then dad\\; ok\\nbye \\\\o/'), 'Call mom, then dad; ok\nbye \\o/');
assert.throws(() => parseIcs('hello'), /isn’t a calendar/);
assert.deepEqual(parseIcs(cal()), [], 'an empty calendar is no events, not an error');

// Times into the user's zone.
assert.deepEqual(readTime({ value: '20261020T033000Z', params: {} }, ZONE), { date: '2026-10-20', time: '09:00', unknownZone: false });
assert.deepEqual(readTime({ value: '20261020T210000', params: { TZID: 'America/New_York' } }, ZONE), {
  date: '2026-10-21',
  time: '06:30',
  unknownZone: false,
});
assert.deepEqual(readTime({ value: '20261020T090000', params: {} }, ZONE).time, '09:00', 'floating = already local');
assert.deepEqual(readTime({ value: '20261020', params: { VALUE: 'DATE' } }, ZONE), { date: '2026-10-20', time: null });
assert.equal(readTime({ value: '20261020T090000', params: { TZID: 'Pacific Standard Time' } }, ZONE).unknownZone, true);
// A DST edge: 09:00 in London in winter and in summer is 14:30 and 13:30 in Kolkata.
assert.equal(readTime({ value: '20260115T090000', params: { TZID: 'Europe/London' } }, ZONE).time, '14:30');
assert.equal(readTime({ value: '20260715T090000', params: { TZID: 'Europe/London' } }, ZONE).time, '13:30');

// Alarms.
assert.equal(triggerMinutes({ value: '-PT15M', params: {} }), 15);
assert.equal(triggerMinutes({ value: '-PT1H', params: {} }), 60);
assert.equal(triggerMinutes({ value: '-P1D', params: {} }), 1440);
assert.equal(triggerMinutes({ value: '-P0DT0H30M0S', params: {} }), 30, 'Google writes every part');
assert.equal(triggerMinutes({ value: 'PT0M', params: {} }), 0);
assert.equal(triggerMinutes({ value: 'PT5M', params: {} }), null, 'after the start');
assert.equal(triggerMinutes({ value: '20261020T080000Z', params: { VALUE: 'DATE-TIME' } }), null);

// Rules.
assert.equal(readRule('FREQ=DAILY;INTERVAL=2').repeat, 'daily');
assert.deepEqual(readRule('FREQ=WEEKLY;WKST=MO;BYDAY=MO,FR').days, ['MO', 'FR']);
assert.deepEqual([readRule('FREQ=MONTHLY;BYDAY=2TU').nth, readRule('FREQ=MONTHLY;BYDAY=-1FR').nth], [2, -1]);
assert.equal(readRule('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=3').nth, 3, 'Outlook writes the nth as BYSETPOS');
assert.equal(readRule('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1').monthDay, 31, 'our month-end clamp');
assert.equal(readRule('FREQ=MONTHLY;BYMONTHDAY=-1').monthDay, 31);
assert.ok(readRule('FREQ=HOURLY').unsupported);
assert.ok(readRule('FREQ=MONTHLY;BYDAY=MO').unsupported, 'every Monday of the month');
assert.ok(readRule('FREQ=MONTHLY;BYDAY=1MO,3MO').unsupported);
assert.ok(readRule('FREQ=WEEKLY;BYDAY=1MO').unsupported);
assert.ok(readRule('FREQ=YEARLY;BYWEEKNO=20').unsupported);
assert.ok(readRule('FREQ=DAILY;INTERVAL=120').unsupported);

/* ---- Our own export, line for line as ReminderIcs.build writes it ---- */
const ours = cal(
  'PRODID:-//Growth Buddy//Reminders//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Growth Buddy reminders',
  'X-WR-TIMEZONE:Asia/Kolkata',
  // Weekly on Mon + Wed, a 30-minute block, two alerts, one skipped day.
  'BEGIN:VEVENT',
  'UID:11111111-1111-1111-1111-111111111111@growthbuddy',
  'DTSTAMP:20261011T040000Z',
  'SUMMARY:Standup\\, team',
  'DESCRIPTION:Bring notes\\nand coffee',
  'CATEGORIES:work',
  'DTSTART;TZID=Asia/Kolkata:20261012T093000',
  'DTEND;TZID=Asia/Kolkata:20261012T100000',
  'RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=MO,WE',
  'EXDATE;TZID=Asia/Kolkata:20261014T093000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Standup\\, team',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Standup\\, team',
  'TRIGGER:-PT60M',
  'END:VALARM',
  'END:VEVENT',
  // Monthly on the 31st (clamped), 6 times left, a folded long title with a multi-byte character.
  'BEGIN:VEVENT',
  'UID:22222222-2222-2222-2222-222222222222@growthbuddy',
  'DTSTAMP:20261011T040000Z',
  'SUMMARY:Pay rent and the maintenance bill for the flat \u2014 before the end of ',
  ' the month',
  'CATEGORIES:personal',
  'DTSTART;TZID=Asia/Kolkata:20261031T200000',
  'RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1;COUNT=6',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Pay rent',
  'TRIGGER:PT0M',
  'END:VALARM',
  'END:VEVENT',
  // A one-off, all day.
  'BEGIN:VEVENT',
  'UID:33333333-3333-3333-3333-333333333333@growthbuddy',
  'DTSTAMP:20261011T040000Z',
  'SUMMARY:Passport renewal',
  'CATEGORIES:urgent',
  'DTSTART;VALUE=DATE:20261105',
  'DTEND;VALUE=DATE:20261106',
  'END:VEVENT',
  // Daily every 2 days until a UTC end (the end of that local day).
  'BEGIN:VEVENT',
  'UID:44444444-4444-4444-4444-444444444444@growthbuddy',
  'DTSTAMP:20261011T040000Z',
  'SUMMARY:Water the plants',
  'CATEGORIES:health',
  'DTSTART;TZID=Asia/Kolkata:20261011T180000',
  'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261031T182959Z',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Water the plants',
  'TRIGGER:-PT5M',
  'END:VALARM',
  'END:VEVENT'
);
{
  const items = byTitle(run(ours));
  const standup = items['Standup, team'];
  assert.equal(standup.status, 'new');
  assert.deepEqual(standup.flags, []);
  assert.deepEqual(standup.body, {
    text: 'Standup, team',
    date: '2026-10-12',
    time: '09:30',
    endTime: '10:00',
    tag: 'work',
    repeat: 'weekly',
    until: null,
    notes: 'Bring notes\nand coffee',
    notifyBefore: 10,
    notifyBefore2: 60,
    repeatInterval: null,
    repeatDays: 'MO,WE',
    repeatNth: null,
    repeatCount: null,
  });
  assert.deepEqual(standup.skips, ['2026-10-14']);

  const rent = items['Pay rent and the maintenance bill for the flat \u2014 before the end of the month'];
  assert.ok(rent, 'the folded title is joined back');
  assert.deepEqual(
    [rent.body.repeat, rent.body.date, rent.body.repeatCount, rent.body.notifyBefore, rent.body.repeatNth],
    ['monthly', '2026-10-31', 6, 0, null]
  );
  assert.ok(occursOn({ ...rent.body, skip: [] }, '2026-11-30'), 'still clamps to the end of a short month');

  const passport = items['Passport renewal'];
  assert.deepEqual([passport.body.date, passport.body.time, passport.body.tag, passport.body.repeat], ['2026-11-05', null, 'urgent', 'none']);

  const plants = items['Water the plants'];
  assert.deepEqual([plants.body.repeat, plants.body.repeatInterval, plants.body.until], ['daily', 2, '2026-10-31']);

  // Importing it into the account it came from: every one is already there.
  const existing = Object.values(items).map((i) => ({ ...i.body, skip: [] }));
  assert.ok(run(ours, { existing }).every((i) => i.dup === 'existing'));
}

/* ---- A Google Calendar export ---- */
const google = cal(
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:me@gmail.com',
  'X-WR-TIMEZONE:Asia/Kolkata',
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Kolkata',
  'X-LIC-LOCATION:Asia/Kolkata',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'TZNAME:IST',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
  // A UTC one-off with Google's alarm format.
  'BEGIN:VEVENT',
  'DTSTART:20261020T033000Z',
  'DTEND:20261020T043000Z',
  'DTSTAMP:20261011T000000Z',
  'UID:dentist@google.com',
  'CREATED:20261001T000000Z',
  'DESCRIPTION:',
  'LAST-MODIFIED:20261001T000000Z',
  'LOCATION:Smile Clinic',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'SUMMARY:Dentist',
  'TRANSP:OPAQUE',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H30M0S',
  'END:VALARM',
  'END:VEVENT',
  // A weekly series that started in January: it starts again at its next Monday,
  // one cancelled Monday is skipped, one moved Monday comes in on its own.
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20260105T190000',
  'DTEND;TZID=Asia/Kolkata:20260105T200000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Asia/Kolkata:20261019T190000',
  'UID:yoga@google.com',
  'SUMMARY:Yoga',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20261027T070000',
  'DTEND;TZID=Asia/Kolkata:20261027T080000',
  'RECURRENCE-ID;TZID=Asia/Kolkata:20261026T190000',
  'UID:yoga@google.com',
  'SUMMARY:Yoga (moved)',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20261102T190000',
  'RECURRENCE-ID;TZID=Asia/Kolkata:20261102T190000',
  'UID:yoga@google.com',
  'SUMMARY:Yoga',
  'STATUS:CANCELLED',
  'END:VEVENT',
  // Book club, 2nd Tuesday, 10 times from March: 3 left after the 7 before October 13th.
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20260310T183000',
  'RRULE:FREQ=MONTHLY;COUNT=10;BYDAY=2TU',
  'UID:book@google.com',
  'SUMMARY:Book club',
  'END:VEVENT',
  // A birthday, all day, every year since 1990.
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:19900315',
  'DTEND;VALUE=DATE:19900316',
  'RRULE:FREQ=YEARLY',
  'UID:bday@google.com',
  'SUMMARY:Amma’s birthday',
  'END:VEVENT',
  // A call set in New York on Tuesday evenings: Wednesday morning here.
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20261020T210000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'UID:ny@google.com',
  'SUMMARY:Call with Sam',
  'END:VEVENT',
  // What the app can't repeat: every Monday of the month, every hour.
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20261012T080000',
  'RRULE:FREQ=MONTHLY;BYDAY=MO',
  'UID:odd@google.com',
  'SUMMARY:Odd rule',
  'END:VEVENT',
  // Gone already.
  'BEGIN:VEVENT',
  'DTSTART:20260101T050000Z',
  'UID:old@google.com',
  'SUMMARY:New year brunch',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20250101T090000',
  'RRULE:FREQ=DAILY;COUNT=3',
  'UID:ended@google.com',
  'SUMMARY:Short course',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Asia/Kolkata:20261011T083000',
  'UID:earlier@google.com',
  'SUMMARY:Earlier today',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:nostart@google.com',
  'SUMMARY:No start',
  'END:VEVENT'
);
{
  const list = run(google);
  const items = byTitle(list);
  assert.equal(list.filter((i) => i.title === 'Yoga').length, 1, 'the cancelled instance is not an event of its own');

  const dentist = items.Dentist;
  assert.deepEqual(
    [dentist.status, dentist.body.date, dentist.body.time, dentist.body.endTime, dentist.body.notifyBefore, dentist.body.notes],
    ['new', '2026-10-20', '09:00', '10:00', 30, null]
  );

  const yoga = items.Yoga;
  assert.deepEqual([yoga.status, yoga.body.repeat, yoga.body.date, yoga.body.repeatDays], ['new', 'weekly', '2026-10-12', 'MO']);
  assert.deepEqual(yoga.skips, ['2026-10-19', '2026-10-26', '2026-11-02'], 'removed, moved and cancelled Mondays');
  assert.deepEqual([items['Yoga (moved)'].body.date, items['Yoga (moved)'].body.time, items['Yoga (moved)'].body.repeat], ['2026-10-27', '07:00', 'none']);

  const book = items['Book club'];
  assert.deepEqual([book.body.repeat, book.body.repeatNth, book.body.date, book.body.repeatCount], ['monthly', 2, '2026-10-13', 3]);

  const bday = items['Amma’s birthday'];
  assert.deepEqual([bday.status, bday.body.repeat, bday.body.date, bday.body.time], ['new', 'yearly', '2027-03-15', null]);

  const sam = items['Call with Sam'];
  assert.deepEqual([sam.body.date, sam.body.time, sam.body.repeatDays], ['2026-10-21', '06:30', 'WE'], 'the weekday moves with the zone');

  const odd = items['Odd rule'];
  assert.equal(odd.body.repeat, 'none');
  assert.match(odd.flags[0], /only its first date/);
  assert.equal(odd.status, 'new');

  assert.equal(items['New year brunch'].status, 'past');
  assert.equal(items['Short course'].status, 'ended');
  assert.equal(items['Earlier today'].status, 'past', 'today, but the time has gone');
  assert.equal(items['No start'].status, 'bad');

  // Everything that would be sent passes the server's rules: today or later, until after the date.
  for (const i of list.filter((x) => x.status === 'new')) {
    assert.ok(i.body.date >= TODAY, i.title);
    assert.ok(!i.body.until || i.body.until >= i.body.date, i.title);
    assert.ok(i.body.text.length <= 255 && (!i.body.notes || i.body.notes.length <= 1000));
  }
}

// Repeated within one file: the second is a duplicate.
{
  const ev = ['BEGIN:VEVENT', 'DTSTART;TZID=Asia/Kolkata:20261020T090000', 'SUMMARY:Gym', 'END:VEVENT'];
  const list = run(cal(...ev, ...ev));
  assert.deepEqual(list.map((i) => i.dup || null), [null, 'file']);
}

console.log('ics-import: all checks passed');
