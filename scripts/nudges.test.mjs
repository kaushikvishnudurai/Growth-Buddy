// node scripts/nudges.test.mjs
import assert from 'node:assert/strict';
import {
  usualSleep,
  lastNightGuess,
  repeatExpense,
  usualReminderTime,
  stepsTarget,
  focusMinutesTarget,
} from './nudges.js';

// usualSleep: median across midnight, 3 nights minimum, today and >14 days ignored.
assert.equal(usualSleep({}, '2026-10-11'), null);
assert.equal(
  usualSleep(
    {
      '2026-10-10': { bedtime: '23:00', wakeTime: '07:00' },
      '2026-10-09': { bedtime: '23:30', wakeTime: '07:00' },
    },
    '2026-10-11'
  ),
  null
);
assert.deepEqual(
  usualSleep(
    {
      '2026-10-11': { bedtime: '03:00', wakeTime: '11:00' }, // today: not history
      '2026-10-10': { bedtime: '23:30', wakeTime: '06:50' },
      '2026-10-09': { bedtime: '00:30', wakeTime: '07:10' },
      '2026-10-08': { bedtime: '00:00', wakeTime: '07:00' },
      '2026-09-01': { bedtime: '20:00', wakeTime: '04:00' }, // too old
    },
    '2026-10-11'
  ),
  { bedtime: '00:00', wakeTime: '07:00' }
);

// lastNightGuess: phone wins, then usual (3 nights), then last night (1-3 days old).
const night3 = {
  '2026-10-10': { bedtime: '23:30', wakeTime: '06:50', quality: 'good' },
  '2026-10-09': { bedtime: '00:30', wakeTime: '07:10' },
  '2026-10-08': { bedtime: '00:00', wakeTime: '07:00' },
};
assert.deepEqual(lastNightGuess(night3, '2026-10-11', { bedtime: '23:10', wakeTime: '06:45', minutes: 455 }), {
  bedtime: '23:10',
  wakeTime: '06:45',
  quality: 'good',
  source: 'phone',
});
assert.deepEqual(lastNightGuess(night3, '2026-10-11'), {
  bedtime: '00:00',
  wakeTime: '07:00',
  quality: 'good',
  source: 'usual',
});
assert.deepEqual(lastNightGuess({ '2026-10-10': { bedtime: '22:45:00', wakeTime: '06:30:00' } }, '2026-10-11'), {
  bedtime: '22:45',
  wakeTime: '06:30',
  quality: 'okay',
  source: 'last',
});
assert.equal(lastNightGuess({ '2026-10-06': { bedtime: '23:00', wakeTime: '07:00' } }, '2026-10-11'), null);
assert.equal(lastNightGuess({}, '2026-10-11'), null);
assert.equal(lastNightGuess(undefined, '2026-10-11', null), null);

// repeatExpense: 4+ days, near the usual time, not already logged today.
const at = (date, h, m = 0) => new Date(date + 'T00:00:00').getTime() + (h * 60 + m) * 60000;
const coffee = ['2026-10-10', '2026-10-09', '2026-10-08', '2026-10-06'].map((d, i) => ({
  date: d,
  amount: i === 0 ? 130 : 120,
  note: i === 0 ? 'Coffee ' : 'coffee',
  category: 'food',
  accountId: i === 0 ? 'acc-1' : 'acc-2',
  createdAt: at(d, 9, 10),
}));
const nine = new Date('2026-10-11T09:30:00');
assert.deepEqual(repeatExpense(coffee, '2026-10-11', nine), {
  note: 'Coffee',
  amount: 120,
  category: 'food',
  accountId: 'acc-1',
});
assert.equal(
  repeatExpense(coffee, '2026-10-11', new Date('2026-10-11T15:00:00')),
  null,
  'wrong time of day'
);
assert.equal(repeatExpense(coffee.slice(1), '2026-10-11', nine), null, 'three days is not a habit');
assert.equal(
  repeatExpense(
    coffee.concat({ date: '2026-10-11', amount: 120, note: 'COFFEE' }),
    '2026-10-11',
    nine
  ),
  null,
  'already logged today'
);
assert.equal(
  repeatExpense(
    coffee.map((e) => ({ ...e, createdAt: undefined })),
    '2026-10-11',
    nine
  ),
  null,
  'no times, so "around now" is unknowable'
);

// usualReminderTime: the most frequent, twice at least.
assert.equal(usualReminderTime([{ time: '09:00:00' }]), null);
assert.equal(
  usualReminderTime([{ time: '09:00:00' }, { time: '18:30' }, { time: '09:00' }, { time: null }]),
  '09:00'
);

// stepsTarget
assert.equal(stepsTarget('Walk 8k steps'), 8000);
assert.equal(stepsTarget('10,000 steps'), 10000);
assert.equal(stepsTarget('Walk 6500'), 6500);
assert.equal(stepsTarget('Walking'), null);
assert.equal(stepsTarget('Walk 30 min'), null);

// focusMinutesTarget
assert.equal(focusMinutesTarget('Read 20 min'), null);
assert.equal(focusMinutesTarget('Deep work 2h'), 120);
assert.equal(focusMinutesTarget('Focus 45 min'), 45);
assert.equal(focusMinutesTarget('Pomodoro'), 25);

console.log('nudges: ok');
