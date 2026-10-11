// Its own module so achievements.js (boot chunk) can use it without pulling the
// rest of review.js (Report-only, lazy) into the boot chunk with it.
import { localKey } from './dates.js';

/**
 * Every date key the user did something on: sleep, mood, a habit check-in, an expense,
 * water, food or a finished task. `trends.byDate` alone holds only the days the app was
 * opened (its snapshot), so ten nights of logs read as "active 1 day". Each input optional.
 * `habitHistory` is `{id: {days: [{date, done}]}}`, `finished` `[{doneAt}]`.
 */
export function activeDates({ trends, wellness, money, habitHistory, finished } = {}) {
  const out = new Set();
  const by = (trends && trends.byDate) || {};
  for (const k in by) {
    const e = by[k] || {};
    if (e.score > 0 || e.waterMl > 0 || e.kcal > 0) out.add(k);
  }
  const w = wellness || {};
  Object.keys(w.sleepByDate || {}).forEach((k) => out.add(k));
  Object.keys(w.moodByDate || {}).forEach((k) => out.add(k));
  (w.photoHistory || []).forEach((p) => p && p.date && out.add(p.date));
  ((money && money.expenses) || []).forEach((e) => e && e.date && out.add(e.date));
  for (const id in habitHistory || {})
    ((habitHistory[id] && habitHistory[id].days) || []).forEach((d) => d.done && out.add(String(d.date)));
  (finished || []).forEach((t) => t && t.doneAt && out.add(localKey(Date.parse(t.doneAt))));
  return out;
}
