// node scripts/starter-packs.test.mjs — what a starter pack would create.
import assert from 'node:assert/strict';
import { PACKS, planStarter } from './starter-packs.js';

const today = '2026-10-11';
const base = { habits: [], reminders: [], goals: [], features: null, money: null, today };

// Every habit icon is one HabitService.HABIT_ICONS accepts.
const HABIT_ICONS = new Set(['repeat', 'dumbbell', 'sparkles', 'notebook-pen', 'users-round', 'trophy',
  'book-open', 'briefcase', 'footprints', 'bike', 'brain', 'droplets', 'leaf', 'ban']);
PACKS.flatMap((p) => p.items).filter((i) => i.kind === 'habit').forEach((i) =>
  assert.ok(HABIT_ICONS.has(i.icon), 'habit icon not allowed by the server: ' + i.icon));

// A pack creates its habits, reminder and a goal 30 days out.
const sleep = planStarter(['sleep'], base);
assert.deepEqual(sleep.map((r) => r.kind), ['habit', 'reminder', 'goal']);
assert.equal(sleep[2].targetDate, '2026-11-10');

// What exists is skipped, case-insensitively.
const has = planStarter(['sleep'], { ...base, habits: [{ name: 'screens OFF before bed' }] });
assert.ok(!has.some((r) => r.kind === 'habit'));

// The same habit from two packs is created once.
const both = planStarter(['water', 'water'], { ...base, features: { water: false } });
assert.equal(both.filter((r) => r.kind === 'habit').length, 1);

// With Water on, Stay hydrated sets the water goal and adds no "Drink water"
// habit beside the tracker; with Water off the habit stands in for it.
assert.deepEqual(planStarter(['water'], base).map((r) => r.kind), ['water']);
assert.deepEqual(planStarter(['water'], { ...base, features: { water: false } }).map((r) => r.kind), ['habit']);

// A switched-off feature is not offered: no habits, and Eat better's lunch reminder needs Food.
const off = planStarter(['eat'], { ...base, features: { habits: false, food: false } });
assert.deepEqual(off.map((r) => r.kind), ['goal']);

// No spending means no invented budget, but the preview says why (a note row), and the goal
// is one a new account can meet: there is no last month to beat.
const fresh = planStarter(['money'], base);
assert.ok(!fresh.some((r) => r.kind === 'budget'));
assert.deepEqual(fresh.find((r) => r.kind === 'note'), { kind: 'note', pack: 'money', about: 'budget' });
assert.equal(fresh.find((r) => r.kind === 'goal').title, 'Track spending for a month');
// Real spending gives the top two, 10% under, and the comparison goal.
const money = {
  budgets: { transport: 500 },
  expenses: [
    { date: '2026-10-01', category: 'food', amount: 4000 },
    { date: '2026-10-02', category: 'shopping', amount: 2000 },
    { date: '2026-10-03', category: 'transport', amount: 9000 }, // already budgeted
    { date: '2026-08-01', category: 'entertainment', amount: 99999 }, // outside 30 days
  ],
};
const budgets = planStarter(['money'], { ...base, money }).filter((r) => r.kind === 'budget');
assert.deepEqual(budgets.map((b) => [b.category, b.amount]), [['food', 3600], ['shopping', 1800]]);
const withHistory = planStarter(['money'], { ...base, money });
assert.equal(withHistory.find((r) => r.kind === 'goal').title, 'Spend less than last month');
assert.ok(!withHistory.some((r) => r.kind === 'note'));

// The default pack: one-tap habits (no measured metric, so the first tick is one tap), each with
// a reminder time, and no hard-coded clock in a name (the time is formatted per device).
const balanced = planStarter(['balanced'], base);
assert.equal(PACKS[0].id, 'balanced');
assert.ok(balanced.filter((r) => r.kind === 'habit').length >= 2);
balanced.filter((r) => r.kind === 'habit').forEach((r) => {
  assert.ok(!r.metric || r.metric === 'none', r.name);
  assert.match(r.reminderTime, /^\d\d:\d\d$/);
});
PACKS.flatMap((p) => p.items).forEach((i) =>
  assert.ok(!/\d\s*(am|pm)\b|\d:\d\d/i.test(i.name || i.text || i.title || ''), 'clock in a name: ' + (i.name || i.text || i.title)));

// Water: from weight when known, skipped when the goal is already that high.
const w = planStarter(['water'], { ...base, weightKg: 70, suggestWater: (kg) => (kg ? 2250 : null) });
assert.equal(w.find((r) => r.kind === 'water').goalMl, 2250);
assert.ok(!planStarter(['water'], { ...base, waterGoalMl: 3000 }).some((r) => r.kind === 'water'));

console.log('starter-packs: ok');
