/* Per-hour water stats, shared by push.js (boot: the reminder's usual hours)
   and insights.js (Report: the water-gap finding). Its own module because a
   static import of insights.js from a boot module hoists the whole Insights
   engine into the boot chunk. Pure, no imports. */

const localKey = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

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
