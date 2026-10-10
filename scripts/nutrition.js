/* =====================================================================
   Growth Buddy — pure food & water helpers
   No DOM, no state, no fetch: what the Food screen's cards and the Log food
   sheet decide, kept here so `node scripts/nutrition.test.mjs` can check it.
   Two of these mirror the server and must agree with it:
     mealSlotForHour  <->  FoodDtos MealSlot.forHour
     HYDRATION        <->  WaterDtos DrinkType
   ===================================================================== */

export const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
];

/* 04-10 breakfast, 11-15 lunch, 18-22 dinner, anything else a snack. */
export function mealSlotForHour(hour) {
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'snack';
}

/* The slot of a moment, in this device's local time. */
export function mealSlotAt(when) {
  const d = when instanceof Date ? when : new Date(when);
  return mealSlotForHour(Number.isNaN(d.getTime()) ? 12 : d.getHours());
}

/* An entry's own slot, or (a row from before slots) the one its hour falls in. */
export function slotOf(entry) {
  const s = entry && entry.mealSlot;
  return MEAL_SLOTS.some((m) => m.key === s) ? s : mealSlotAt(entry && entry.loggedAt);
}

/* The day's entries by slot, in meal order, each with its kcal. Empty slots
   are kept (the card offers "Copy yesterday's" in them); entries keep their
   order within a slot. */
export function groupBySlot(entries) {
  const groups = MEAL_SLOTS.map((m) => ({ slot: m.key, label: m.label, entries: [], kcal: 0 }));
  const byKey = Object.fromEntries(groups.map((g) => [g.slot, g]));
  for (const e of entries || []) {
    const g = byKey[slotOf(e)];
    g.entries.push(e);
    g.kcal += Number(e.kcalEstimated) || 0;
  }
  return groups;
}

/* How much of each drink counts towards the day's water. */
export const HYDRATION = { water: 1, tea: 0.9, coffee: 0.8, juice: 0.9, milk: 0.9, other: 1 };
export const DRINKS = [
  { key: 'water', label: 'Water' },
  { key: 'tea', label: 'Tea' },
  { key: 'coffee', label: 'Coffee' },
  { key: 'juice', label: 'Juice' },
  { key: 'milk', label: 'Milk' },
  { key: 'other', label: 'Other' },
];

export function effectiveMl(amountMl, drinkType) {
  const f = HYDRATION[drinkType] ?? 1;
  return Math.round((Number(amountMl) || 0) * f);
}

/* 33 ml per kg, to the nearest 250, held to the goal field's 1000..7000.
   null without a usable weight: no suggestion beats a made-up one. */
export function suggestWaterGoalMl(weightKg) {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w < 25 || w > 300) return null;
  const ml = Math.round((w * 33) / 250) * 250;
  return Math.max(1000, Math.min(7000, ml));
}

/* A barcode product's per-100 g label scaled to a portion, in the units and
   bounds the entry's columns take. A figure the label lacks stays absent. */
export function labelFor(product, grams) {
  const g = Number(grams) || 0;
  const p = product || {};
  const scale = (v, max) =>
    v == null ? null : Math.max(0, Math.min(max, Math.round((v * g) / 100)));
  return {
    kcal:
      p.kcalPer100g == null
        ? null
        : Math.max(1, Math.min(5000, Math.round((p.kcalPer100g * g) / 100))),
    proteinG: scale(p.proteinPer100g, 900),
    carbsG: scale(p.carbsPer100g, 900),
    fatG: scale(p.fatPer100g, 900),
    fiberG: scale(p.fiberPer100g, 900),
    sugarG: scale(p.sugarPer100g, 900),
    sodiumMg: scale(p.sodiumMgPer100g, 50000),
  };
}

/* The day summary's fibre / sugar / sodium, only those the server knows. */
export function dayMicros(summary) {
  const s = summary || {};
  return [
    { key: 'fiber', label: 'Fibre', value: s.fiberG, unit: 'g' },
    { key: 'sugar', label: 'Sugar', value: s.sugarG, unit: 'g' },
    { key: 'sodium', label: 'Sodium', value: s.sodiumMg, unit: 'mg' },
  ].filter((m) => m.value != null);
}
