/* i18n: one place for user-facing words and for how dates, times and numbers read.

   t(key, vars)        catalog lookup with {name} interpolation; `vars.count` picks a
                       plural form through Intl.PluralRules. Missing in the active
                       locale → English → the key itself (never undefined, never throws).
   setLocale(tag)      'hi-IN', 'ta', … — anything Intl accepts; junk falls back to the
                       device. Also sets <html lang>.
   localeFromUser(u)   the profile's locale if one exists (uiPrefs.locale, then
                       user.locale / user.language), else navigator.language, else 'en'.
                       NOTE: uiPrefs.qaLang is the quick-add VOICE language, not the UI
                       one — deliberately not read here.
   fmtDate / fmtTime / fmtNumber / fmtPercent / fmtRelativeDays — Intl in the active locale.

   Date-only keys ('YYYY-MM-DD', and 'YYYY-MM') are parsed as LOCAL dates at noon.
   `new Date('2026-03-08')` is UTC midnight, which west of Greenwich is the evening
   before — the label read a day early. Noon also keeps clear of a DST jump.

   Keys that are DATA (`toLocaleDateString('en-CA')` → 'YYYY-MM-DD') are not display
   strings and do not belong here; leave them as they are.

   DOM-free apart from the guarded <html lang> write, so node tests can import it.
   ponytail: only `en` ships, and only a handful of strings go through t() so far.
   Upgrade path: move strings into `en` screen by screen, then add a catalog per
   language (see CODEMAP "Adding a language"). */

const en = {
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.tomorrow': 'Tomorrow',
  'common.days': { one: '{count} day', other: '{count} days' },
  'common.items': { one: '{count} item', other: '{count} items' },
  'common.ofGoal': '{value} of {goal}',
};

const CATALOGS = { en };

let locale = null;

function canonical(tag) {
  if (!tag || typeof tag !== 'string') return null;
  try {
    return Intl.getCanonicalLocales(tag.replace('_', '-'))[0] || null;
  } catch (_) {
    return null;
  }
}

function deviceLocale() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return canonical(nav && (nav.languages && nav.languages[0])) || canonical(nav && nav.language) || 'en';
}

/** The profile's locale when it has one, else the device's. */
function localeFromUser(user) {
  const p = user && user.uiPrefs;
  return (
    canonical(p && p.locale) ||
    canonical(user && user.locale) ||
    canonical(user && user.language) ||
    deviceLocale()
  );
}

function setLocale(tag) {
  locale = canonical(tag) || deviceLocale();
  cache.clear();
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale;
  }
  return locale;
}

function getLocale() {
  return locale || (locale = deviceLocale());
}

/* Intl constructors are slow enough to matter in a 60-row list; reuse them. */
const cache = new Map();
function memo(kind, opts, make) {
  const k = kind + '|' + getLocale() + '|' + JSON.stringify(opts || {});
  let f = cache.get(k);
  if (!f) {
    try {
      f = make(getLocale(), opts);
    } catch (_) {
      f = make('en', opts);
    }
    cache.set(k, f);
  }
  return f;
}

function catalogFor(tag) {
  if (CATALOGS[tag]) return CATALOGS[tag];
  const base = tag.split('-')[0];
  return CATALOGS[base] || null;
}

function plural(n, opts) {
  return memo('plural', opts, (l, o) => new Intl.PluralRules(l, o)).select(n);
}

/** Look up `key`; {name} placeholders come from `vars`. Unknown key → the key. */
function t(key, vars) {
  const own = catalogFor(getLocale());
  let entry = own && own[key] != null ? own[key] : en[key];
  if (entry == null) return key;
  if (typeof entry === 'object') {
    const n = vars && typeof vars.count === 'number' ? vars.count : NaN;
    const form = Number.isFinite(n) ? plural(n) : 'other';
    entry = entry[form] != null ? entry[form] : entry.other;
    if (entry == null) return key;
  }
  if (!vars) return entry;
  return String(entry).replace(/\{(\w+)\}/g, (m, name) => {
    if (!(name in vars)) return m;
    const v = vars[name];
    return typeof v === 'number' ? fmtNumber(v) : String(v);
  });
}

const KEY_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const KEY_MONTH = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM-DD' / 'YYYY-MM' → local noon; Date passes through; else new Date(x). */
function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    let m = KEY_DAY.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
    m = KEY_MONTH.exec(v);
    if (m) return new Date(+m[1], +m[2] - 1, 1, 12);
  }
  return new Date(v);
}

const DATE_STYLES = {
  short: { day: 'numeric', month: 'short' }, // 12 Mar
  dayMonth: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' }, // 12 Mar 2026
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short' }, // Thu
  weekdayLong: { weekday: 'long' }, // Thursday
  weekdayDate: { weekday: 'short', day: 'numeric', month: 'short' }, // Thu, 12 Mar
  month: { month: 'long' }, // March
  monthYear: { month: 'long', year: 'numeric' }, // March 2026
};

/** `style` is a name from DATE_STYLES or an Intl options object. Bad input → ''. */
function fmtDate(value, style = 'medium') {
  if (value == null || value === '') return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const opts = typeof style === 'object' ? style : DATE_STYLES[style] || DATE_STYLES.medium;
  return memo('date', opts, (l, o) => new Intl.DateTimeFormat(l, o)).format(d);
}

/** Locale clock text. Prefer gb-kit `formatTime` for anything the user reads —
    it honours the account's 12/24h pref; pass `{ hour12 }` here to do the same. */
function fmtTime(value, { hour12 } = {}) {
  if (value == null || value === '') return '';
  let d;
  const hm = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value));
  if (hm) {
    d = new Date();
    d.setHours(+hm[1], +hm[2], 0, 0);
  } else d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { hour: 'numeric', minute: '2-digit' };
  if (hour12 === true) opts.hour12 = true;
  if (hour12 === false) {
    opts.hour = '2-digit';
    opts.hourCycle = 'h23'; // hour12:false alone gave en-US "24:00" at midnight
  }
  return memo('time', opts, (l, o) => new Intl.DateTimeFormat(l, o)).format(d);
}

function fmtNumber(n, opts) {
  const v = n == null || n === '' ? NaN : Number(n);
  if (!Number.isFinite(v)) return '';
  return memo('num', opts, (l, o) => new Intl.NumberFormat(l, o)).format(v);
}

/** `ratio` is 0..1 (0.42 → "42%"). */
function fmtPercent(ratio, digits = 0) {
  const v = ratio == null || ratio === '' ? NaN : Number(ratio);
  if (!Number.isFinite(v)) return '';
  const opts = { style: 'percent', maximumFractionDigits: digits };
  return memo('num', opts, (l, o) => new Intl.NumberFormat(l, o)).format(v);
}

/** Whole local days from `from` (default now) to `value`; keys count as local dates. */
function daysBetween(value, from = new Date()) {
  const a = toDate(from);
  const b = toDate(value);
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000
  );
}

/** -1 → "yesterday", 3 → "in 3 days". A number is a day offset; a date/key is
    measured from `from` (default today). */
function fmtRelativeDays(value, from) {
  const n = typeof value === 'number' ? value : daysBetween(value, from);
  if (!Number.isFinite(n)) return '';
  return memo('rel', { numeric: 'auto' }, (l, o) => new Intl.RelativeTimeFormat(l, o)).format(
    n,
    'day'
  );
}

export {
  t,
  setLocale,
  getLocale,
  localeFromUser,
  plural,
  toDate,
  fmtDate,
  fmtTime,
  fmtNumber,
  fmtPercent,
  fmtRelativeDays,
  daysBetween,
  DATE_STYLES,
  CATALOGS,
};
