/* Node check for the pure food & water helpers.

   `node scripts/nutrition.test.mjs`

   The slot hours and the hydration factors are mirrored in Java (MealSlot,
   DrinkType); FoodSlotFavouriteBarcodeTest / WaterDrinkTypeTest pin the same
   numbers there, so a change to one side fails the other's check. */

import assert from 'node:assert/strict';
import {
  mealSlotForHour,
  slotOf,
  groupBySlot,
  effectiveMl,
  HYDRATION,
  suggestWaterGoalMl,
  labelFor,
  dayMicros,
} from './nutrition.js';

// Slots: the same hours as MealSlot.forHour.
assert.deepEqual([2, 4, 7, 10, 11, 15, 16, 17, 18, 22, 23].map(mealSlotForHour), [
  'snack',
  'breakfast',
  'breakfast',
  'breakfast',
  'lunch',
  'lunch',
  'snack',
  'snack',
  'dinner',
  'dinner',
  'snack',
]);

// A stored slot wins; a row from before slots takes its local hour.
const at = (h) => new Date(2026, 9, 10, h, 30).toISOString();
assert.equal(slotOf({ mealSlot: 'dinner', loggedAt: at(8) }), 'dinner');
assert.equal(slotOf({ mealSlot: null, loggedAt: at(8) }), 'breakfast');
assert.equal(
  slotOf({ mealSlot: 'brunch', loggedAt: at(13) }),
  'lunch',
  'an unknown slot is ignored'
);

// Grouping: meal order, empties kept, kcal per slot.
const groups = groupBySlot([
  { id: 1, kcalEstimated: 300, loggedAt: at(20) },
  { id: 2, kcalEstimated: 200, mealSlot: 'breakfast', loggedAt: at(9) },
  { id: 3, kcalEstimated: 100, loggedAt: at(20) },
]);
assert.deepEqual(
  groups.map((g) => g.slot),
  ['breakfast', 'lunch', 'dinner', 'snack']
);
assert.deepEqual(
  groups.map((g) => g.kcal),
  [200, 0, 400, 0]
);
assert.deepEqual(
  groups[2].entries.map((e) => e.id),
  [1, 3],
  'order within a slot is kept'
);
assert.equal(
  groupBySlot(null).every((g) => g.entries.length === 0),
  true
);

// Hydration: the agreed factors, and water when the type is unknown.
assert.deepEqual(HYDRATION, { water: 1, tea: 0.9, coffee: 0.8, juice: 0.9, milk: 0.9, other: 1 });
assert.equal(effectiveMl(250, 'coffee'), 200);
assert.equal(effectiveMl(250, 'tea'), 225);
assert.equal(effectiveMl(250, undefined), 250);
assert.equal(effectiveMl(250, 'soda'), 250);

// Water goal: 33 ml/kg to the nearest 250, held to 1000..7000.
assert.equal(suggestWaterGoalMl(70), 2250); // 2310 -> 2250
assert.equal(suggestWaterGoalMl(80), 2750); // 2640 -> 2750
assert.equal(suggestWaterGoalMl('60'), 2000); // 1980 -> 2000
assert.equal(suggestWaterGoalMl(26), 1000); // 858 -> 750, held to 1000
assert.equal(suggestWaterGoalMl(null), null);
assert.equal(suggestWaterGoalMl(''), null);
assert.equal(suggestWaterGoalMl(0), null);

// A barcode label scaled to the portion; what the label lacks stays null.
const biscuit = { kcalPer100g: 443, proteinPer100g: 7.5, sugarPer100g: 22, sodiumMgPer100g: 360 };
assert.deepEqual(labelFor(biscuit, 50), {
  kcal: 222,
  proteinG: 4,
  carbsG: null,
  fatG: null,
  fiberG: null,
  sugarG: 11,
  sodiumMg: 180,
});
assert.equal(labelFor({}, 100).kcal, null);

// Micronutrients: only what the server knows, never a 0 for unknown.
assert.deepEqual(dayMicros({ fiberG: 12, sugarG: null }), [
  { key: 'fiber', label: 'Fibre', value: 12, unit: 'g' },
]);
assert.deepEqual(dayMicros({ fiberG: 0 }).length, 1, 'a real 0 is shown');
assert.deepEqual(dayMicros(null), []);

console.log('nutrition: ok');
