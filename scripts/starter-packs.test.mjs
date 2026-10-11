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
const has = planStarter(['sleep'], { ...base, habits: [{ name: 'screens off by 10:30 PM' }] });
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

// No spending means no invented budget; real spending gives the top two, 10% under.
assert.ok(!planStarter(['money'], base).some((r) => r.kind === 'budget'));
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

// Water: from weight when known, skipped when the goal is already that high.
const w = planStarter(['water'], { ...base, weightKg: 70, suggestWater: (kg) => (kg ? 2250 : null) });
assert.equal(w.find((r) => r.kind === 'water').goalMl, 2250);
assert.ok(!planStarter(['water'], { ...base, waterGoalMl: 3000 }).some((r) => r.kind === 'water'));

console.log('starter-packs: ok');
