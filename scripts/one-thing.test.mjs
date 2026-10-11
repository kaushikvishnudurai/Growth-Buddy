// node scripts/one-thing.test.mjs
import assert from 'node:assert/strict';
import { pickOneThing } from './one-thing.js';
import { localDayKey } from './home-order.js';

const at = (hh) => {
  const d = new Date();
  d.setHours(hh, 0, 0, 0);
  return d;
};
const today = localDayKey(new Date());
const back = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDayKey(d);
};
const nights = {
  [back(1)]: { bedtime: '23:00', wakeTime: '07:00' },
  [back(2)]: { bedtime: '23:00', wakeTime: '07:00' },
  [back(3)]: { bedtime: '23:00', wakeTime: '07:00' },
};

// Everything owed, evening: each kind wins in order as the one above it is cleared.
const all = {
  habits: [
    { id: 'h1', name: 'Read', streak: 3, doneToday: false, dueToday: true, cadence: 'daily' },
    { id: 'h2', name: 'Walk', streak: 9, doneToday: false, dueToday: true, cadence: 'daily' },
    { id: 'h3', name: 'Gym', streak: 20, doneToday: false, dueToday: true, cadence: 'weekly' },
  ],
  tasks: [
    { id: 't1', title: 'Later', dueAt: null },
    {
      id: 't2',
      title: 'Pay rent',
      overdue: true,
      dueAt: new Date(Date.now() - 864e5).toISOString(),
    },
  ],
  money: {
    expenses: [{ id: 'e1', date: today, amount: 90, category: 'food' }],
    budgets: { food: 100 },
  },
  wellness: { sleepByDate: nights, moodByDate: {} },
  water: { consumedMl: 0, goalMl: 2000 },
  waterUsualHours: [9, 13, 17],
  now: at(19),
};
const order = [];
let s = { ...all };
for (;;) {
  const r = pickOneThing(s);
  if (!r) break;
  order.push(r.kind);
  if (r.kind === 'streak') {
    assert.equal(r.arg, 'h2'); // highest daily streak; the weekly one is not "N-day"
    assert.match(r.title, /9-day Walk/);
    s = { ...s, habits: [] };
  } else if (r.kind === 'overdue') {
    assert.equal(r.arg, 't2');
    s = { ...s, tasks: [] };
  } else if (r.kind === 'budget') {
    assert.match(r.title, /90% of budget/);
    s = { ...s, money: null };
  } else if (r.kind === 'sleep') {
    assert.deepEqual(r.arg, { bedtime: '23:00', wakeTime: '07:00', quality: 'okay', source: 'usual' });
    s = {
      ...s,
      wellness: {
        ...s.wellness,
        sleepByDate: { ...nights, [today]: { bedtime: '23:00', wakeTime: '07:00' } },
      },
    };
  } else if (r.kind === 'water') {
    assert.equal(r.arg, 250);
    s = { ...s, water: { consumedMl: 2000, goalMl: 2000 } };
  } else if (r.kind === 'mood') {
    s = { ...s, wellness: { ...s.wellness, moodByDate: { [today]: { mood: 'good' } } } };
  }
}
assert.deepEqual(order, ['streak', 'overdue', 'sleep', 'water', 'mood', 'budget']);

// A freeze-protected day is not at risk.
assert.equal(
  pickOneThing({ ...all, habits: [{ ...all.habits[1], protectedToday: true }] }).kind,
  'overdue'
);
// A quit habit's clean streak doesn't break unticked (and its tap logs a slip).
assert.equal(
  pickOneThing({ ...all, habits: [{ ...all.habits[1], kind: 'quit' }] }).kind,
  'overdue'
);
// Last night is asked only once the usual wake time (07:00) has passed.
assert.equal(pickOneThing({ wellness: { sleepByDate: nights }, now: at(6) }), null);
assert.equal(pickOneThing({ wellness: { sleepByDate: nights }, now: at(8) }).kind, 'sleep');
// The phone's night needs no wake-time wait (it has already ended) and says where it came from.
{
  const phone = pickOneThing({
    wellness: { sleepByDate: nights },
    phoneNight: { bedtime: '23:40', wakeTime: '07:10', date: today },
    now: at(6),
  });
  assert.equal(phone.kind, 'sleep');
  assert.equal(phone.arg.source, 'phone');
  assert.equal(phone.label, 'Save it');
}
// A task that fell due after load (mapTask's overdue flag still false) counts.
assert.equal(
  pickOneThing({
    ...all,
    habits: [],
    tasks: [
      {
        id: 't3',
        title: 'Call',
        overdue: false,
        dueAt: new Date(at(19).getTime() - 6e4).toISOString(),
      },
    ],
  }).arg,
  't3'
);

// Streak only counts in the evening; morning skips to the overdue task.
assert.equal(pickOneThing({ ...all, now: at(9) }).kind, 'overdue');
// A kind with no handler, or a feature off, is skipped.
assert.equal(pickOneThing({ ...all, can: (k) => k !== 'streak' && k !== 'overdue' }).kind, 'sleep');
assert.equal(
  pickOneThing({
    ...all,
    tasks: [],
    habits: [],
    wellness: { moodByDate: { [today]: {} } },
    water: null,
    features: { money: false },
  }),
  null
);
// Water pace: 9:00 is barely past start, no nag; mood waits for noon.
assert.equal(
  pickOneThing({ water: { consumedMl: 0, goalMl: 2000 }, wellness: {}, now: at(9) }),
  null
);
assert.equal(pickOneThing({ wellness: {}, now: at(13) }).kind, 'mood');
// No water habit (no usual hours) and nothing logged today: water is never nudged.
const waterOnly = (k) => k === 'water';
assert.equal(pickOneThing({ water: { consumedMl: 0, goalMl: 2000 }, can: waterOnly, now: at(20) }), null);
assert.equal(
  pickOneThing({ water: { consumedMl: 0, goalMl: 2000 }, waterUsualHours: [], can: waterOnly, now: at(20) }),
  null
);
// Logged some today, no pattern yet: behind is behind.
assert.equal(
  pickOneThing({ water: { consumedMl: 250, goalMl: 2000 }, can: waterOnly, now: at(20) }).kind,
  'water'
);
// Nothing at all: null.
assert.equal(pickOneThing({ now: at(10) }), null);

console.log('one-thing ok');
