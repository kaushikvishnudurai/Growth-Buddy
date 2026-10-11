// Its own module so push.js (boot chunk) can use it without pulling insights.js
// (Report-only, lazy) into the boot chunk with it.
import { localKey } from './dates.js';

/** Per local hour, the share of logged days with a glass in it. */
export function drinkRateByHour(times) {
  const days = new Set();
  const hours = Array.from({ length: 24 }, () => new Set());
  for (const t of times || []) {
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) continue;
    const k = localKey(d);
    days.add(k);
    hours[d.getHours()].add(k);
  }
  return { days: days.size, rate: hours.map((s) => (days.size ? s.size / days.size : 0)) };
}
