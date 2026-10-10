/* Pure, DOM-free helpers lifted out of app.js so node can test them
   (scripts/app-logic.test.mjs). Nothing here touches `state`, the DOM, storage
   or the network: app.js passes in what each one needs. */

/* Water taps not yet on the server, laid over a summary from it. Only the
   summary's own day counts: a glass queued last night is yesterday's.
   `pending`: Map tempId -> { amountMl, loggedAt, drinkType }. */
export function overlayPendingWater(water, pending, { today, dayOf, effectiveMl }) {
  const w = water || {};
  const day = w.date || today;
  let consumedMl = w.consumedMl || 0;
  const entries = [...(w.entries || [])];
  pending.forEach(({ amountMl, loggedAt, drinkType }, id) => {
    if (dayOf(loggedAt) !== day) return;
    // consumedMl is the server's effective total (a coffee counts 0.8).
    const counts = effectiveMl(amountMl, drinkType);
    consumedMl += counts;
    entries.push({ id, amountMl, loggedAt, drinkType: drinkType || 'water', effectiveMl: counts });
  });
  return { ...w, consumedMl, entries };
}

/* Send queued items one at a time, in queue (oldest-first) order. An offline
   failure stops the run, so nothing later overtakes it; any other failure is a
   refusal and the run moves on. */
export async function replayOldestFirst(items, send, { isOffline, onSent, onRefused }) {
  for (const x of items) {
    try {
      const res = await send(x);
      onSent(x, res);
    } catch (err) {
      if (isOffline(err)) break;
      onRefused(x, err);
    }
  }
}

/* A summary the server sent back after a write belongs to the entry's own day.
   Only today's (or an undated one) may replace the Home card's copy. */
export function summaryIsForToday(summary, today) {
  return !summary || !summary.date || summary.date === today;
}

/* A counter that marks answers stale: take `now()` before a request, `bump()`
   on every write, and an answer whose stamp `isStale` is thrown away. */
export function generation() {
  let n = 0;
  return {
    now: () => n,
    bump: () => ++n,
    isStale: (g) => g !== n,
  };
}

/* What a food/water write drops from the week caches. 'food' keeps the water
   week, 'water' keeps the food week, anything else drops both; the diet check
   always goes (water is part of its read). Today's trends row follows the water
   card on any non-food write. Mutates `s`. */
export function applyWeekInvalidation(s, kind, todayKey) {
  s.dietCheck = null;
  if (kind !== 'water') s.foodWeek = null;
  if (kind !== 'food') s.waterWeek = null;
  const todayRow = s.trends && s.trends.byDate && s.trends.byDate[todayKey];
  if (todayRow && s.water && kind !== 'food') {
    todayRow.waterMl = s.water.consumedMl || 0;
    todayRow.waterGoalMl = s.water.goalMl || 0;
  }
}

/* Per-key "which save is newest". start() stamps a save; only the newest one's
   failure may roll back, an older one is already superseded. */
export function latestSeq() {
  const seq = {};
  return {
    start(key) {
      seq[key] = (seq[key] || 0) + 1;
      return seq[key];
    },
    isLatest: (key, n) => seq[key] === n,
  };
}

/* Put `obj[key]` back to `prev`, or remove it when there was none. */
export function restoreKey(obj, key, prev) {
  if (prev) obj[key] = prev;
  else delete obj[key];
}

/* A Set of keys with a request in flight. claim() is false when the key is
   already busy (a double tap), otherwise marks it; delete() releases it. */
export function inFlightKeys() {
  const set = new Set();
  set.claim = (key) => {
    if (set.has(key)) return false;
    set.add(key);
    return true;
  };
  return set;
}
