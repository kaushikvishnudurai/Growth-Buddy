/* Local-day keys ("YYYY-MM-DD" in the device's zone), shared by every module
   that used to carry its own copy. Pure, no imports, so node tests load it.
   Not here, on purpose: goals.js `todayKey` (the ACCOUNT's zone, not the
   device's), the UTC day-number walkers in review.js / insights.js (`dayKey`,
   DST-proof arithmetic), and the two `relativeTime`s (app.js and notes.js round
   and format the date differently). */
export function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

/** Key from y / m (0-11) / d. */
export function dateKey(y, m, d) {
  return y + '-' + pad2(m + 1) + '-' + pad2(d);
}

/** Local key of a Date or an instant. */
export function localKey(d) {
  const t = d instanceof Date ? d : new Date(d);
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

export function todayKey() {
  return localKey(new Date());
}
