/* =====================================================================
   Growth Buddy — the day line: a day drawn midnight to midnight, a mark per
   reminder. Calendar's month cells and day head use it, and so does Home's
   timeline head; its own module so Home doesn't pull in the lazy calendar.js.
   ===================================================================== */
import { h, formatTime } from './gb-kit.js';
import { todayKey } from './dates.js';

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
export function DayLine(list, className, extra) {
  const marks = [];
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
export function DayRuler(list, key, isToday = key === todayKey()) {
  let now = null;
  if (isToday) {
    const d = new Date();
    now = h('span', {
      class: 'gb-line-now',
      style: { left: ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100 + '%' },
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
    DayLine(list, 'gb-ruler-line', now),
    h(
      'div',
      { class: 'gb-ruler-hours', 'aria-hidden': 'true' },
      rulerHours().map((t) => h('span', null, t))
    )
  );
}

