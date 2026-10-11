// node scripts/health-logic.test.mjs — how a day's health value is built from
// phone + hand-typed readings, the form's limits, and the sleep band.
import assert from 'node:assert/strict';
import {
  dayValue,
  series,
  latestValue,
  readingError,
  nightOnBand,
  nights,
  addDays,
  lastDays,
  durationLabel,
  entriesFor,
} from './health-logic.js';

const R = (type, value, day, source = 'manual', extra = {}) => ({ id: Math.random().toString(36), type, value, day, source, ...extra });

// Sum metrics: the phone's total plus what was typed in (what the phone missed).
const rs = [R('steps', 6000, '2026-10-11', 'phone'), R('steps', 2500, '2026-10-11'), R('steps', 900, '2026-10-10')];
assert.deepEqual(dayValue(rs, 'steps', '2026-10-11'), { value: 8500, phone: true, manual: true });
assert.equal(dayValue(rs, 'steps', '2026-10-09'), null);
// Two phone rows for one day (syncs raced): counted once, not twice.
assert.equal(dayValue([...rs, R('steps', 6100, '2026-10-11', 'phone')], 'steps', '2026-10-11').value, 8600);
assert.equal(dayValue(rs, 'nope', '2026-10-11'), null);

// Latest metrics: the newest reading of the day wins, whoever wrote it.
const w = [
  R('weight', 71.24, '2026-10-11', 'phone', { measuredAt: '2026-10-11T06:00:00Z' }),
  R('weight', 70.9, '2026-10-11', 'manual', { measuredAt: '2026-10-11T08:00:00Z' }),
];
assert.deepEqual(dayValue(w, 'weight', '2026-10-11'), { value: 70.9, phone: false, manual: true });
const bp = [R('bloodPressure', 121, '2026-10-11', 'manual', { value2: 79, measuredAt: '2026-10-11T07:00:00Z' })];
assert.equal(dayValue(bp, 'bloodPressure', '2026-10-11').value2, 79);

// Series: oldest first, gaps null.
assert.deepEqual(
  series(rs, 'steps', '2026-10-11', 3).map((p) => p.value),
  [null, 900, 8500]
);
assert.equal(latestValue(w, 'weight', '2026-10-20').day, '2026-10-11');
assert.equal(latestValue(w, 'weight', '2026-10-20', 5), null);
assert.equal(entriesFor(rs, 'steps')[0].day, '2026-10-11');

// Days: across a month end and a DST change.
assert.equal(addDays('2026-10-31', 1), '2026-11-01');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.deepEqual(lastDays('2026-10-02', 3), ['2026-09-30', '2026-10-01', '2026-10-02']);

// Form limits mirror the server.
assert.equal(readingError('steps', '8000'), null);
assert.match(readingError('steps', ''), /number/);
assert.match(readingError('steps', '0'), /1 to 100,000/);
assert.match(readingError('bloodPressure', '120'), /both/);
assert.match(readingError('bloodPressure', '80', '120'), /higher/);
assert.equal(readingError('bloodPressure', '120', '80'), null);
assert.match(readingError('', '1'), /Pick/);

// Sleep band: minutes after 18:00, across midnight.
assert.deepEqual(
  (({ from, to, minutes }) => ({ from, to, minutes }))(nightOnBand({ bedtime: '23:10', wakeTime: '06:50' })),
  { from: 310, to: 770, minutes: 460 }
);
// Asleep before 18:00 (a nap-day shift worker) still lands on the band.
assert.equal(nightOnBand({ bedtime: '17:00', wakeTime: '01:00' }).minutes, 480);
// Woke after noon: clipped to the band's end, duration kept.
const late = nightOnBand({ bedtime: '03:00', wakeTime: '13:00' });
assert.equal(late.to, 1080);
assert.equal(late.minutes, 600);
assert.equal(nightOnBand({ bedtime: '', wakeTime: '07:00' }), null);
assert.equal(nightOnBand(null), null);
assert.deepEqual(
  nights({ '2026-10-11': { bedtime: '23:00', wakeTime: '07:00' } }, '2026-10-11', 2).map((n) => !!n.night),
  [false, true]
);
assert.equal(durationLabel(460), '7h 40m');
assert.equal(durationLabel(45), '45m');

console.log('health-logic: ok');
