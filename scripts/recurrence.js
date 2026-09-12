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
   deliberately written to the same shape so a diff is readable, and
   `recurrence.cases.json` is the one list of cases BOTH sides are tested
   against — add a case there and the Java test picks it up too, so the
   two can no longer drift without something going red.
   ===================================================================== */

/* Which days count as working days. Mirrors WorkWeek.java; the keys are what
   the user's ui_prefs blob stores under `workWeek`. */
export const WORK_WEEKS = {
  mon_fri: { label: 'Mon\u2013Fri', days: [1, 2, 3, 4, 5] },
  sun_thu: { label: 'Sun\u2013Thu', days: [0, 1, 2, 3, 4] },
  mon_sat: { label: 'Mon\u2013Sat', days: [1, 2, 3, 4, 5, 6] },
};
export const DEFAULT_WORK_WEEK = 'mon_fri';

/* The signed-in user's working week, set once from their ui_prefs at load.

   Module state rather than a parameter threaded through every caller: there is
   exactly one user per browser, and `occursOn` is reached from eight places
   across the calendar and the Home mini calendar, none of which otherwise care.
   The backend takes it explicitly instead, because one process serves everyone. */
let currentWorkWeek = DEFAULT_WORK_WEEK;

export function setWorkWeek(week) {
  currentWorkWeek = WORK_WEEKS[week] ? week : DEFAULT_WORK_WEEK;
}

export function getWorkWeek() {
  return currentWorkWeek;
}

function parseKey(key) {
  const [y, m, d] = String(key || '')
    .split('-')
    .map(Number);
  return { y: y, m: m - 1, d: d };
}

/* Does reminder `rem` occur on date `key` ('YYYY-MM-DD')? Honors recurrence,
   the from/until bounds, and per-occurrence skips.

   `workWeek` only affects the 'weekdays' repeat and defaults to whatever
   setWorkWeek() was last given — the signed-in user's setting. Pass it
   explicitly to ask about a different one (the tests do). Unknown values fall
   back to Mon-Fri, which is what every reminder created before the setting
   existed meant. */
export function occursOn(rem, key, workWeek = currentWorkWeek) {
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
    // A working week is not the same everywhere — Sun–Thu across much of the
    // Gulf, Mon–Sat in plenty of Indian offices — so this follows the user's
    // setting rather than assuming the one it used to hardcode.
    case 'weekdays':
      return (WORK_WEEKS[workWeek] || WORK_WEEKS[DEFAULT_WORK_WEEK]).days.indexOf(dow) !== -1;
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
