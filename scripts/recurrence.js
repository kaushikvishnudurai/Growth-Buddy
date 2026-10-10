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

/* ---- The richer rule (all optional; absent = what it always meant) ----

   repeatInterval  every N days / weeks / months / years (1 = every; ignored by
                   'weekdays', which is a fixed set of days).
   repeatDays      'MO,WE,FR' — the days of a 'weekly' reminder. Empty = the
                   anchor's weekday. Weeks start on Monday (RRULE's WKST=MO), so
                   "every 2 weeks on Sun" counts the Sunday with the Monday before.
   repeatNth       1..5 or -1 (last): a 'monthly' reminder on the nth <anchor's
                   weekday> of the month instead of on a date. A month with no 5th
                   such day is skipped, as RRULE BYDAY=5TU does.
   repeatCount     end after N occurrences. Counted from the anchor over the
                   rule alone — a skipped day or a "from" trim still uses one up,
                   the way RRULE COUNT treats an EXDATE. */
export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // index = getDay()
/** The order a picker lists them in. */
export const WEEK_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** 'MO,WE,FR' (or an array of codes) → sorted getDay() numbers; unknown codes dropped. */
export function parseRepeatDays(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const c of list) {
    const i = DAY_CODES.indexOf(String(c).trim().toUpperCase());
    if (i !== -1 && out.indexOf(i) === -1) out.push(i);
  }
  return out.sort((x, y) => x - y);
}

function intervalOf(rem) {
  const n = Math.floor(Number(rem.repeatInterval));
  return n >= 2 && n <= 99 ? n : 1;
}

function nthOf(rem) {
  const n = Number(rem.repeatNth);
  return n === -1 || (n >= 1 && n <= 5) ? n : 0;
}

/* Days since 1970-01-01, from UTC so a DST change can't make a day 23 hours. */
const epochDay = (p) => Math.round(Date.UTC(p.y, p.m, p.d) / 86400000);
const dowOfEpoch = (e) => (((e + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
const mondayOf = (e) => e - ((dowOfEpoch(e) + 6) % 7);

/* Does the rule alone (no bounds, skips or count) land on `t`? */
function matchesRule(rem, a, t, workWeek) {
  const ad = epochDay(a);
  const td = epochDay(t);
  if (td < ad) return false;
  const n = intervalOf(rem);
  // An anchor on the 29th-31st clamps to the last day of a shorter month, so a
  // monthly reminder set for the 31st still fires in February, April and friends.
  const lastOfMonth = new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate();
  const dayMatches = t.d === a.d || (a.d > lastOfMonth && t.d === lastOfMonth);
  const dow = dowOfEpoch(td); // 0 Sun … 6 Sat
  const adow = dowOfEpoch(ad);

  switch (rem.repeat) {
    case 'daily':
      return (td - ad) % n === 0;
    // A working week is not the same everywhere — Sun–Thu across much of the
    // Gulf, Mon–Sat in plenty of Indian offices — so this follows the user's
    // setting rather than assuming the one it used to hardcode.
    case 'weekdays':
      return (WORK_WEEKS[workWeek] || WORK_WEEKS[DEFAULT_WORK_WEEK]).days.indexOf(dow) !== -1;
    case 'weekly': {
      const days = parseRepeatDays(rem.repeatDays);
      const onDay = days.length ? days.indexOf(dow) !== -1 : dow === adow;
      return onDay && ((mondayOf(td) - mondayOf(ad)) / 7) % n === 0;
    }
    case 'monthly': {
      if (((t.y - a.y) * 12 + (t.m - a.m)) % n !== 0) return false;
      const nth = nthOf(rem);
      if (!nth) return dayMatches;
      if (dow !== adow) return false;
      return nth === -1 ? t.d + 7 > lastOfMonth : Math.ceil(t.d / 7) === nth;
    }
    case 'yearly':
      return (t.y - a.y) % n === 0 && t.m === a.m && dayMatches;
    default:
      return td === ad;
  }
}

/* The epoch day of the Nth occurrence, or Infinity when the rule never gets
   there inside a century. Memoised: the calendar asks about every cell of the
   month for every reminder on each render. */
const MAX_SCAN_DAYS = 366 * 100;
const lastCache = new Map();
function lastByCount(rem, a, count, workWeek) {
  const sig = [
    rem.date,
    rem.repeat,
    rem.repeatInterval,
    rem.repeatDays,
    rem.repeatNth,
    count,
    workWeek,
  ].join('|');
  if (lastCache.has(sig)) return lastCache.get(sig);
  const start = epochDay(a);
  let seen = 0;
  let last = Infinity;
  for (let e = start; e < start + MAX_SCAN_DAYS; e++) {
    const d = new Date(e * 86400000);
    if (
      matchesRule(
        rem,
        a,
        { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() },
        workWeek
      )
    ) {
      if (++seen >= count) {
        last = e;
        break;
      }
    }
  }
  if (lastCache.size > 500) lastCache.clear();
  lastCache.set(sig, last);
  return last;
}

/* Does reminder `rem` occur on date `key` ('YYYY-MM-DD')? Honors recurrence,
   the from/until bounds, per-occurrence skips and "end after N times".

   `workWeek` only affects the 'weekdays' repeat and defaults to whatever
   setWorkWeek() was last given — the signed-in user's setting. Pass it
   explicitly to ask about a different one (the tests do). Unknown values fall
   back to Mon-Fri, which is what every reminder created before the setting
   existed meant. */
export function occursOn(rem, key, workWeek = currentWorkWeek) {
  if (!rem || !rem.date || !key) return false;
  const a = parseKey(rem.date);
  const t = parseKey(key);
  if (![a.y, a.m, a.d, t.y, t.m, t.d].every(Number.isFinite)) return false;
  const td = epochDay(t);
  if (rem.from && td < epochDay(parseKey(rem.from))) return false;
  if (rem.until && td > epochDay(parseKey(rem.until))) return false;
  if (Array.isArray(rem.skip) && rem.skip.indexOf(key) !== -1) return false;
  if (!matchesRule(rem, a, t, workWeek)) return false;
  const count = Math.floor(Number(rem.repeatCount));
  if (rem.repeat && rem.repeat !== 'none' && count >= 1) {
    return td <= lastByCount(rem, a, count, workWeek);
  }
  return true;
}

/** The nth-weekday reading of a date, for the picker: { nth: 1..5, isLast, dow }.
    A 5th is always the last too; a 4th can be. */
export function nthWeekdayOf(key) {
  const p = parseKey(key);
  const last = new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();
  return { nth: Math.ceil(p.d / 7), isLast: p.d + 7 > last, dow: dowOfEpoch(epochDay(p)) };
}
