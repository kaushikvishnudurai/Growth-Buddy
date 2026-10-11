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
  resolveHealthLayout,
  moveHealthMetric,
  moveHealthSection,
  healthInsights,
  HEALTH_TYPES,
  HEALTH_METRICS,
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

// ---- layout: saved order kept, junk dropped, new things appended and shown ----
{
  const L = resolveHealthLayout({ sections: [{ id: 'ledger' }, { id: 'nope' }, { id: 'ledger' }, { id: 'sleep', on: false }], metrics: [{ type: 'weight' }, { type: 'steps', on: false }] });
  assert.deepEqual(L.sections, [{ id: 'ledger', on: true }, { id: 'sleep', on: false }, { id: 'insights', on: true }]);
  assert.equal(L.metrics.length, HEALTH_TYPES.length);
  assert.deepEqual(L.metrics.slice(0, 2), [{ type: 'weight', on: true }, { type: 'steps', on: false }]);
  assert.deepEqual(resolveHealthLayout(null).sections.map((x) => x.id), ['insights', 'sleep', 'ledger']);
  assert.deepEqual(resolveHealthLayout('junk').metrics.map((x) => x.type), HEALTH_TYPES);
  // Moving a metric swaps it with the next one in its own group, skipping other groups' rows.
  const D = resolveHealthLayout(null);
  const moved = moveHealthMetric(D, 'distance', -1);
  const activity = moved.metrics.filter((m) => HEALTH_METRICS[m.type].group === 'activity').map((m) => m.type);
  assert.deepEqual(activity.slice(0, 2), ['distance', 'steps']);
  assert.equal(moveHealthMetric(D, 'steps', -1), null, 'first in its group cannot go up');
  const W = { ...D, metrics: [{ type: 'weight', on: true }, ...D.metrics.filter((m) => m.type !== 'weight')] };
  assert.equal(moveHealthMetric(W, 'weight', -1), null);
  assert.equal(moveHealthMetric(W, 'bodyFat', -1).metrics[0].type, 'bodyFat', 'swaps across an other-group row');
  assert.deepEqual(moveHealthSection(D, 'ledger', -1).sections.map((x) => x.id), ['insights', 'ledger', 'sleep']);
  assert.equal(moveHealthSection(D, 'insights', -1), null);
}

// ---- insights: the user against themselves, only with enough days ----
{
  const T = '2026-10-11';
  const day = (n) => addDays(T, -n);
  const rs2 = [];
  for (let n = 1; n <= 7; n++) rs2.push(R('steps', 9000, day(n), 'phone'));
  for (let n = 8; n <= 14; n++) rs2.push(R('steps', 6000, day(n), 'phone'));
  for (let n = 0; n < 7; n++) rs2.push(R('restingHeartRate', 66, day(n), 'phone'));
  for (let n = 7; n < 37; n++) rs2.push(R('restingHeartRate', 60, day(n), 'phone'));
  for (let n = 27; n >= 0; n -= 3) rs2.push(R('weight', 78 - (27 - n) * 0.05, day(n)));
  for (let n = 0; n < 4; n++) rs2.push(R('bloodPressure', 132, day(n * 3), 'manual', { value2: 84 }));
  const sleep = {};
  for (let n = 0; n < 14; n++) sleep[day(n)] = n % 2 ? { bedtime: '23:00', wakeTime: '07:00' } : { bedtime: '23:30', wakeTime: '06:30' };
  const all = healthInsights(rs2, sleep, T, { max: 10 });
  const ids = all.map((x) => x.id);
  assert.ok(ids.includes('steps-week') && ids.includes('rhr-usual') && ids.includes('weight-trend') && ids.includes('bp-average'));
  const steps = all.find((x) => x.id === 'steps-week');
  assert.equal(steps.tone, 'good');
  assert.match(steps.text, /9000 steps a day.*50% more.*6000/);
  assert.equal(all.find((x) => x.id === 'rhr-usual').tone, 'watch');
  assert.match(all.find((x) => x.id === 'weight-trend').text, /^Down 1\.\d kg in 4 weeks/);
  assert.match(all.find((x) => x.id === 'bp-average').text, /both numbers are at or above 130\/80/);
  // 126/81: high on the bottom number alone, and it says so.
  const bp = [0, 3, 6].map((n) => R('bloodPressure', 126, day(n), 'manual', { value2: 81 }));
  const one = healthInsights(bp, {}, T).find((x) => x.id === 'bp-average');
  assert.equal(one.title, 'Blood pressure averages 126/81');
  assert.match(one.text, /the bottom number is 80 or more/);
  // Watch items lead, and the list is capped.
  assert.equal(all[0].tone, 'watch');
  assert.equal(healthInsights(rs2, sleep, T).length, 3);
  // A hidden metric says nothing.
  assert.ok(!healthInsights(rs2, sleep, T, { max: 10, shown: (t) => t !== 'bloodPressure' }).some((x) => x.metric === 'bloodPressure'));
  // Too little data: nothing.
  assert.deepEqual(healthInsights([R('steps', 9000, day(1))], {}, T), []);
  // No emoji, ever.
  assert.ok(all.every((x) => !/\p{Extended_Pictographic}/u.test(x.title + x.text)));
  // Steps and sleep: needs 3+ nights each side of the median, then says the gap.
  const rs3 = [], sl3 = {};
  for (let n = 1; n <= 10; n++) {
    rs3.push(R('steps', n % 2 ? 11000 : 4000, day(n), 'phone'));
    sl3[day(n - 1)] = n % 2 ? { bedtime: '22:30', wakeTime: '07:00' } : { bedtime: '23:30', wakeTime: '06:30' };
  }
  const ss = healthInsights(rs3, sl3, T, { max: 10 }).find((x) => x.id === 'steps-sleep');
  assert.ok(ss, 'steps-sleep insight');
  assert.match(ss.text, /longer/);
}

console.log('health-logic: ok');
