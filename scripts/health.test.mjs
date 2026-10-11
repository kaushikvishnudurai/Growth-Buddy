// node scripts/health.test.mjs — nightFromSamples: which stretch of sleep
// becomes "last night". Times are local, like the phone's.
import assert from 'node:assert/strict';
import { nightFromSamples } from './native.js';

const at = (d, hh, mm = 0) => new Date(2026, 9, d, hh, mm).toISOString();
const s = (d1, h1, m1, d2, h2, m2, sleepState) => ({
  startDate: at(d1, h1, m1),
  endDate: at(d2, h2, m2),
  sleepState,
});
const DAY = '2026-10-11';

// One Health Connect session across midnight.
assert.deepEqual(nightFromSamples([s(10, 23, 10, 11, 6, 50)], DAY), {
  bedtime: '23:10',
  wakeTime: '06:50',
  minutes: 460,
});

// HealthKit stages, out of order, with an awake stretch that must not extend it.
assert.deepEqual(
  nightFromSamples(
    [
      s(11, 2, 0, 11, 6, 30, 'deep'),
      s(10, 23, 30, 11, 2, 0, 'light'),
      s(11, 6, 30, 11, 7, 15, 'awake'),
    ],
    DAY
  ),
  { bedtime: '23:30', wakeTime: '06:30', minutes: 420 }
);

// A 60-min gap (up for a bit) joins; the night is one stretch.
assert.equal(nightFromSamples([s(10, 23, 0, 11, 2, 0), s(11, 3, 0, 11, 7, 0)], DAY).bedtime, '23:00');

// An afternoon nap is not last night, and neither is a night that ended yesterday.
assert.equal(nightFromSamples([s(11, 14, 0, 11, 15, 30)], DAY), null);
assert.equal(nightFromSamples([s(9, 23, 0, 10, 7, 0)], DAY), null);

// Nap + night: the night wins.
assert.equal(nightFromSamples([s(11, 14, 0, 11, 15, 30), s(11, 0, 30, 11, 8, 0)], DAY).wakeTime, '08:00');

// Nothing, garbage, and only-awake all come back null.
assert.equal(nightFromSamples([], DAY), null);
assert.equal(nightFromSamples(null, DAY), null);
assert.equal(nightFromSamples([s(10, 23, 0, 11, 7, 0, 'awake')], DAY), null);

console.log('health: ok');
