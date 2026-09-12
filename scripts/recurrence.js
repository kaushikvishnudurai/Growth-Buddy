/* =====================================================================
   Growth Buddy — reminder recurrence

   ONE answer to "does this reminder land on this day?", because there
   used to be three: the Calendar screen, the Home mini calendar, and
   ReminderService on the backend. They had already drifted — the mini
   calendar tested `day === anchorDay` for a monthly reminder with no
   end-of-month clamp, so a reminder anchored to the 31st simply vanished
   from Home's dots in February while the Calendar screen showed it on
   the 28th. Adding a repeat option to two of the three would have made
   that worse.

   The backend copy (ReminderService.occursOn) stays — it drives WhatsApp
   delivery and can't import this. **Keep the two in step.** They're
   deliberately written to the same shape so a diff is readable.
   ===================================================================== */

function parseKey(key) {
  const [y, m, d] = String(key || '')
    .split('-')
    .map(Number);
  return { y: y, m: m - 1, d: d };
}

/* Does reminder `rem` occur on date `key` ('YYYY-MM-DD')? Honors recurrence,
   the from/until bounds, and per-occurrence skips. */
export function occursOn(rem, key) {
  if (!rem || !rem.date || !key) return false;
  const a = parseKey(rem.date);
  const t = parseKey(key);
  const anchor = new Date(a.y, a.m, a.d);
  const day = new Date(t.y, t.m, t.d);
  if (Number.isNaN(anchor.getTime()) || Number.isNaN(day.getTime())) return false;
  if (day < anchor) return false;
  if (rem.from) {
    const f = parseKey(rem.from);
    if (day < new Date(f.y, f.m, f.d)) return false;
  }
  if (rem.until) {
    const u = parseKey(rem.until);
    if (day > new Date(u.y, u.m, u.d)) return false;
  }
  if (Array.isArray(rem.skip) && rem.skip.indexOf(key) !== -1) return false;

  // An anchor on the 29th-31st clamps to the last day of a shorter month, so a
  // monthly reminder set for the 31st still fires in February, April and friends.
  const lastOfMonth = new Date(t.y, t.m + 1, 0).getDate();
  const dayMatches = t.d === a.d || (a.d > lastOfMonth && t.d === lastOfMonth);
  const dow = day.getDay(); // 0 Sun … 6 Sat

  switch (rem.repeat) {
    case 'daily':
      return true;
    // ponytail: Mon–Fri, hardcoded. A work week is not the same everywhere —
    // Sun–Thu across much of the Gulf, Mon–Sat in plenty of Indian offices —
    // and the honest fix is a per-user setting, or letting the user tick the
    // days. Neither is worth it until someone asks: this covers the case the
    // option exists for, and the label says Mon–Fri rather than "Weekdays" so
    // it can't quietly mean the wrong thing.
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'weekly':
      return dow === anchor.getDay();
    case 'monthly':
      return dayMatches;
    case 'yearly':
      return t.m === a.m && dayMatches;
    default:
      return day.getTime() === anchor.getTime();
  }
}
