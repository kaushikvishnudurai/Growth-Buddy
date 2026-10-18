/* =====================================================================
   Growth Buddy — the day line: a day drawn midnight to midnight, a mark per
   reminder. Calendar's month cells and day head use it, and so does Home's
   timeline head; its own module so Home doesn't pull in the lazy calendar.js.
   ===================================================================== */
import { h, formatTime } from './gb-kit.js';
import { todayKey } from './dates.js';
import { WORK_WEEKS, DEFAULT_WORK_WEEK, getWorkWeek } from './recurrence.js';

export const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/* ---- Color tags ---- */
export const TAGS = {
  work: { label: 'Work', color: 'var(--sky-500)', soft: 'var(--info-soft)', softFg: 'var(--info-soft-fg)' },
  personal: {
    label: 'Personal',
    color: 'var(--iris-500)',
    soft: 'var(--ai-soft)',
    softFg: 'var(--ai-soft-fg)',
  },
  health: {
    label: 'Health',
    color: 'var(--leaf-500)',
    soft: 'var(--success-soft)',
    softFg: 'var(--success-soft-fg)',
  },
  urgent: {
    label: 'Urgent',
    color: 'var(--coral-500)',
    soft: 'var(--brand-soft)',
    softFg: 'var(--brand-soft-fg)',
  },
  other: {
    label: 'Other',
    color: 'var(--sun-500)',
    soft: 'var(--warning-soft)',
    softFg: 'var(--warning-soft-fg)',
  },
};
/* ---- The day line ----
   The screen's one drawing: a day is a line from midnight to midnight, and a
   reminder is a mark where it falls (a block spans its start to its end). The
   month draws one per cell, the selected day draws it large with the hours.
   Reminders with no time sit at the head of the line as a dot: "any time". */
export function DayLine(list, className, extra, bands) {
  const marks = (bands || []).map((x) =>
    h('span', { class: 'gb-line-band is-' + x.kind, style: { left: (x.a / 1440) * 100 + '%', width: ((x.b - x.a) / 1440) * 100 + '%' } })
  );
  let anytime = 0;
  list.forEach((r) => {
    if (!r.time) return void anytime++;
    const a = toMin(r.time);
    const b = r.endTime ? toMin(r.endTime) : null;
    marks.push(
      h('span', {
        class: 'gb-line-mark' + (b != null && b > a ? ' is-block' : ''),
        style: {
          left: (a / 1440) * 100 + '%',
          width: b != null && b > a ? ((b - a) / 1440) * 100 + '%' : null,
          '--tag-color': (TAGS[r.tag] || TAGS.other).color,
        },
      })
    );
  });
  return h(
    'span',
    { class: 'gb-line ' + className, 'aria-hidden': 'true' },
    anytime ? h('span', { class: 'gb-line-any' }) : null,
    h('span', { class: 'gb-line-track' }, marks, extra || null)
  );
}

/* Hour labels for the large line, short enough to sit under it on a phone:
   "00 06 12 18 24", or "12a 6a 12p 6p 12a" for a 12-hour clock. */
export function rulerHours() {
  const h24 = /^13/.test(formatTime('13:00'));
  return h24 ? ['00', '06', '12', '18', '24'] : ['12a', '6a', '12p', '6p', '12a'];
}

// `isToday`: Home passes its own (the account's day); Calendar the device's.
// `nowMin`: where the now ring sits; Home passes the account clock's minute so
// it agrees with its own now line, Calendar leaves it to the device clock.
export function DayRuler(list, key, isToday = key === todayKey(), bands = null, nowMin = null) {
  let now = null;
  if (isToday) {
    let min = nowMin;
    if (min == null) {
      const d = new Date();
      min = d.getHours() * 60 + d.getMinutes();
    }
    now = h('span', {
      class: 'gb-line-now',
      style: { left: (min / 1440) * 100 + '%' },
    });
  }
  // Each mark's start time above it; one that would crowd the last shown
  // (under 2.5 hours on) gives way, the list below still names them all.
  const labels = [];
  let last = -Infinity;
  list.forEach((r) => {
    if (!r.time || toMin(r.time) - last < 150) return;
    last = toMin(r.time);
    const at = (last / 1440) * 100;
    labels.push(
      h(
        'span',
        { class: at > 88 ? 'is-end' : at < 8 ? 'is-start' : null, style: { left: at + '%' } },
        formatTime(r.time)
      )
    );
  });
  return h(
    'div',
    { class: 'gb-ruler' },
    labels.length ? h('div', { class: 'gb-ruler-labels', 'aria-hidden': 'true' }, labels) : null,
    DayLine(list, 'gb-ruler-line', now, bands),
    h(
      'div',
      { class: 'gb-ruler-hours', 'aria-hidden': 'true' },
      rulerHours().map((t) => h('span', null, t))
    )
  );
}


/* ---- The routine (ui_prefs.routine) ----
   Sleep every night, an optional lunch, up to ROUTINE_MAX blocks of the user's
   own. Calendar's Schedule paints it (freeBusy); Home's ruler draws it as bands. */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d/;
export function validRoutine(r) {
  const ok = (t) => typeof t === 'string' && HHMM_RE.test(t);
  if (!r || typeof r !== 'object' || !ok(r.bed) || !ok(r.wake)) return null;
  const bed = r.bed.slice(0, 5);
  const wake = r.wake.slice(0, 5);
  if (bed === wake) return null;
  const lunch = ok(r.lunchFrom) && ok(r.lunchTo) && r.lunchTo.slice(0, 5) > r.lunchFrom.slice(0, 5);
  // ponytail: a custom block can't cross midnight (sleep is the one that does);
  // split it in two if someone needs a night shift.
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter(
      (i) =>
        i &&
        typeof i.name === 'string' &&
        i.name.trim() &&
        ok(i.from) &&
        ok(i.to) &&
        i.to.slice(0, 5) > i.from.slice(0, 5)
    )
    .slice(0, ROUTINE_MAX)
    .map((i) => ({
      name: i.name.trim().slice(0, 40),
      from: i.from.slice(0, 5),
      to: i.to.slice(0, 5),
      days: validDays(i.days),
    }));
  return {
    bed,
    wake,
    lunchFrom: lunch ? r.lunchFrom.slice(0, 5) : null,
    lunchTo: lunch ? r.lunchTo.slice(0, 5) : null,
    lunchDays: validDays(r.lunchDays),
    items,
  };
}

export const ROUTINE_MAX = 8;
/* Which days a routine block is on: every day, the user's working week, or the
   days outside it. */
export const DAY_OPTS = ['all', 'work', 'off'];
export const validDays = (d) => (DAY_OPTS.indexOf(d) !== -1 ? d : 'all');
export function isWorkDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const days = (WORK_WEEKS[getWorkWeek()] || WORK_WEEKS[DEFAULT_WORK_WEEK]).days;
  return days.indexOf(new Date(y, m - 1, d).getDay()) !== -1;
}

export const onDay = (days, key) => days === 'all' || (days === 'work') === isWorkDay(key);

export const KIND_LABEL = { free: 'Free', busy: 'Busy', custom: 'Routine', lunch: 'Lunch', sleep: 'Sleep' };

/* The routine's blocks on `key` as [{kind, name, a, b}] in minutes; sleep across
   midnight comes back as two (the night's tail and its start). */
export function routineBlocks(rt, key) {
  if (!rt) return [];
  const out = [];
  const bed = toMin(rt.bed);
  const wake = toMin(rt.wake);
  if (bed > wake) {
    out.push({ kind: 'sleep', name: 'Sleep', a: 0, b: wake, from: rt.bed, to: rt.wake });
    out.push({ kind: 'sleep', name: 'Sleep', a: bed, b: 1440, from: rt.bed, to: rt.wake, tail: true });
  } else out.push({ kind: 'sleep', name: 'Sleep', a: bed, b: wake, from: rt.bed, to: rt.wake });
  if (rt.lunchFrom && onDay(rt.lunchDays, key))
    out.push({ kind: 'lunch', name: 'Lunch', a: toMin(rt.lunchFrom), b: toMin(rt.lunchTo), from: rt.lunchFrom, to: rt.lunchTo });
  (rt.items || []).forEach((it) => {
    if (onDay(it.days, key)) out.push({ kind: 'custom', name: it.name, a: toMin(it.from), b: toMin(it.to), from: it.from, to: it.to });
  });
  return out;
}
