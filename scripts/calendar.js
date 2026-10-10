/* =====================================================================
   Growth Buddy — Calendar screen (reminders + tags + recurrence)
   ===================================================================== */
import {
  h,
  Card,
  SectionTitle,
  Icon,
  Pill,
  plural,
  refreshIcons,
  openOverlay,
  submitOnEnter,
  confirmDialog,
  formatTime,
} from './gb-kit.js';
import {
  occursOn,
  getWorkWeek,
  WORK_WEEKS,
  DEFAULT_WORK_WEEK,
  DAY_CODES,
  WEEK_ORDER,
  parseRepeatDays,
  nthWeekdayOf,
} from './recurrence.js';
import { chimeOptionValue, chimeOptions, playChime } from './chime.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---- Color tags ---- */
const TAGS = {
  work: { label: 'Work', color: 'var(--sky-500)', soft: 'var(--sky-50)', softFg: 'var(--sky-700)' },
  personal: {
    label: 'Personal',
    color: 'var(--iris-500)',
    soft: 'var(--iris-50)',
    softFg: 'var(--iris-700)',
  },
  health: {
    label: 'Health',
    color: 'var(--leaf-500)',
    soft: 'var(--leaf-50)',
    softFg: 'var(--leaf-700)',
  },
  urgent: {
    label: 'Urgent',
    color: 'var(--coral-500)',
    soft: 'var(--coral-50)',
    softFg: 'var(--coral-700)',
  },
  other: {
    label: 'Other',
    color: 'var(--sun-500)',
    soft: 'var(--sun-50)',
    softFg: 'var(--sun-700)',
  },
};
const TAG_ORDER = ['work', 'personal', 'health', 'urgent', 'other'];

/* ---- Recurrence options ---- */
/* `phrase` is only for the "X repeats ___." sentence in the delete dialog,
   where lowercasing the button label would read "repeats mon-fri". */
const REPEATS = {
  none: { label: 'Once' },
  daily: { label: 'Daily' },
  // A getter, not a string: the label has to say which days this user's working
  // week actually covers, and Settings can change that without a reload.
  weekdays: {
    get label() {
      return (WORK_WEEKS[getWorkWeek()] || WORK_WEEKS[DEFAULT_WORK_WEEK]).label;
    },
    phrase: 'every working day',
  },
  weekly: { label: 'Weekly' },
  monthly: { label: 'Monthly' },
  yearly: { label: 'Yearly' },
};
const REPEAT_ORDER = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/* Build a 'YYYY-MM-DD' key from y / m(0-11) / d. */
function keyOf(y, m, d) {
  return y + '-' + pad(m + 1) + '-' + pad(d);
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y: y, m: m - 1, d: d };
}

function todayKey() {
  const t = new Date();
  return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
}

function isFutureKey(key) {
  return key > todayKey();
}

/* Has this slot already gone by? A past date, or today at a time that has
   passed. No time means "sometime today", which has not. */
function isPastSlot(key, time) {
  const today = todayKey();
  if (key < today) return true;
  if (key > today) return false;
  if (!time) return false;
  const now = new Date();
  const hhmm =
    String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return time < hhmm;
}

/* Pretty label for a date key, e.g. "Mon, June 8". */
function prettyDate(key) {
  const p = parseKey(key);
  const date = new Date(p.y, p.m, p.d);
  return DOW[date.getDay()] + ', ' + MONTHS[p.m] + ' ' + p.d;
}

function remindersOn(reminders, key) {
  return reminders
    .filter((r) => occursOn(r, key))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
}

/* ---- Free / busy ----
   The user's routine (ui_prefs.routine: sleep every night, an optional lunch
   break, and up to ROUTINE_MAX blocks of their own such as a gym slot or the
   commute) turns the day into all 24 hours: those are painted in, and free is
   what is left of the waking day. Without a routine the window is
   08:00-22:00, stretched to fit any block outside it. Module state like the
   working week in recurrence.js, set from app.js at boot and on save. */
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d/;
let routine = null;

function validRoutine(r) {
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

const ROUTINE_MAX = 8;
/* Which days a routine block is on: every day, the user's working week, or the
   days outside it. */
const DAY_OPTS = ['all', 'work', 'off'];
const validDays = (d) => (DAY_OPTS.indexOf(d) !== -1 ? d : 'all');
const dayOptLabel = (d) =>
  d === 'all'
    ? 'Every day'
    : d === 'off'
      ? 'Days off'
      : 'Work days (' + (WORK_WEEKS[getWorkWeek()] || WORK_WEEKS[DEFAULT_WORK_WEEK]).label + ')';

function setRoutine(r) {
  routine = validRoutine(r);
}

/* "Notify before": how far ahead of its time a reminder rings. A reminder's own
   choice wins; none means the user's default, `ui_prefs.reminderLead`, held
   here as module state like the routine so the form can name it. The server
   applies the same rule (`ReminderPrefs.leadFor`), and so does push.js for the
   phone's own alarms. */
const LEAD_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440];
let defaultLead = 0;
// Opens Settings on the Reminders tab; app.js owns Settings, so it hands this in.
let openReminderSettings = null;
function setReminderSettingsOpener(fn) {
  openReminderSettings = fn;
}

function validLead(n) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 1440 ? Math.round(v) : 0;
}

function setDefaultLead(n) {
  defaultLead = validLead(n);
}

function getDefaultLead() {
  return defaultLead;
}

/** "5 min", "1 h", "1 h 30 min", "1 day" — ReminderPrefs.human on the server. */
function minutesLabel(m) {
  if (m >= 1440 && m % 1440 === 0) return m / 1440 + (m === 1440 ? ' day' : ' days');
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (!hh) return mm + ' min';
  return mm ? hh + ' h ' + mm + ' min' : hh + ' h';
}

function leadLabel(m) {
  return m ? minutesLabel(m) + ' before' : 'At the time';
}

/* The Notify <select>: Default (naming what that is today), then each lead. An
   empty value is "follow my default", not "at the time" — the same split the
   Tone select makes, for the same reason. Refilled on focus: the add form is
   cached for the session and the default can change in Settings meanwhile. */
function notifySelect() {
  const sel = h('select', { class: 'gb-input', 'aria-label': 'When to notify' });
  // "Custom…": any number of minutes or hours up to a day — the server's
  // ceiling (ReminderPrefs.MAX_LEAD), so what is typed is what is stored.
  const amount = h('input', {
    type: 'number',
    class: 'gb-input gb-notify-amount',
    min: 1,
    max: 1440,
    step: 1,
    inputmode: 'numeric',
    'aria-label': 'How long before',
  });
  const unit = h(
    'select',
    { class: 'gb-input gb-notify-unit', 'aria-label': 'Minutes or hours' },
    h('option', { value: '1' }, 'min before'),
    h('option', { value: '60' }, 'hours before')
  );
  const hint = h('span', { class: 'gb-notify-hint' }, 'Up to 24 hours');
  const customRow = h('div', { class: 'gb-notify-custom', style: { display: 'none' } }, amount, unit, hint);
  const wrap = h('div', { class: 'gb-notify' }, sel, customRow);
  const fill = () => {
    const v = sel.value;
    sel.replaceChildren(
      h('option', { value: '' }, 'Default \u00b7 ' + (defaultLead ? minutesLabel(defaultLead) + ' early' : 'on time')),
      ...LEAD_OPTIONS.map((m) => h('option', { value: String(m) }, leadLabel(m))),
      h('option', { value: 'custom' }, 'Custom\u2026')
    );
    sel.value = v;
  };
  fill();
  sel.addEventListener('focus', fill);
  const showCustom = (on) => {
    customRow.style.display = on ? '' : 'none';
  };
  sel.addEventListener('change', () => {
    showCustom(sel.value === 'custom');
    if (sel.value === 'custom') {
      if (!amount.value) amount.value = '20';
      setTimeout(() => amount.focus(), 0);
    }
  });
  // Clamp as they type past the ceiling, rather than refuse it on save.
  const clamp = () => {
    const max = 1440 / Number(unit.value);
    if (Number(amount.value) > max) amount.value = String(max);
  };
  amount.addEventListener('input', clamp);
  unit.addEventListener('change', clamp);
  wrap.setLead = (n) => {
    fill();
    if (n === null || n === undefined) {
      sel.value = '';
      showCustom(false);
      return;
    }
    const m = validLead(n);
    if (LEAD_OPTIONS.indexOf(m) !== -1) {
      sel.value = String(m);
      showCustom(false);
      return;
    }
    sel.value = 'custom';
    const hours = m % 60 === 0;
    unit.value = hours ? '60' : '1';
    amount.value = String(hours ? m / 60 : m);
    showCustom(true);
  };
  /** Minutes, or null for "the default". An empty custom box counts as the default too. */
  wrap.getLead = () => {
    if (sel.value === '') return null;
    if (sel.value !== 'custom') return Number(sel.value);
    const v = Math.round(Number(amount.value) * Number(unit.value));
    return Number.isFinite(v) && v > 0 ? Math.min(v, 1440) : null;
  };
  return wrap;
}

const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const toHHMM = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

function isWorkDay(key) {
  const p = parseKey(key);
  const days = (WORK_WEEKS[getWorkWeek()] || WORK_WEEKS[DEFAULT_WORK_WEEK]).days;
  return days.indexOf(new Date(p.y, p.m, p.d).getDay()) !== -1;
}

const onDay = (days, key) => days === 'all' || (days === 'work') === isWorkDay(key);

/* A day as consecutive spans of one kind: 'free' | 'busy' | 'custom' | 'lunch'
   | 'sleep', in that order of precedence where they overlap. Busy is any
   reminder with a start AND an end; overlapping meetings form one busy span carrying every
   title. Painted minute by minute: 1440 cells, which is what makes overlaps,
   sleep across midnight and lunch inside a meeting all the same simple case. */
function freeBusy(reminders, key, rt = routine) {
  const blocks = reminders
    .filter((r) => r.time && r.endTime)
    .map((r) => ({ a: toMin(r.time), b: toMin(r.endTime), title: r.text }));
  let lo = 0;
  let hi = 1440;
  if (!rt) {
    lo = Math.min(480, ...blocks.map((x) => x.a));
    hi = Math.max(1320, ...blocks.map((x) => x.b));
  }
  const kind = new Array(1440).fill('free');
  const paint = (a, b, k) => {
    for (let m = a; m < b; m++) kind[m] = k;
  };
  if (rt) {
    const bed = toMin(rt.bed);
    const wake = toMin(rt.wake);
    if (bed > wake) {
      paint(0, wake, 'sleep');
      paint(bed, 1440, 'sleep');
    } else {
      paint(bed, wake, 'sleep');
    }
    if (rt.lunchFrom && onDay(rt.lunchDays, key)) {
      paint(toMin(rt.lunchFrom), toMin(rt.lunchTo), 'lunch');
    }
    // Each custom block paints its own cell value, 'c<index>', so two of them
    // back to back stay two spans with their own names.
    (rt.items || []).forEach((it, i) => {
      if (onDay(it.days, key)) paint(toMin(it.from), toMin(it.to), 'c' + i);
    });
  }
  blocks.forEach((x) => paint(x.a, x.b, 'busy'));
  const spans = [];
  for (let m = lo; m < hi; m++) {
    const last = spans[spans.length - 1];
    if (last && last.cell === kind[m]) last.b = m + 1;
    else spans.push({ cell: kind[m], a: m, b: m + 1 });
  }
  return spans.map((x) => {
    const custom = x.cell[0] === 'c';
    const k = custom ? 'custom' : x.cell;
    return {
      kind: k,
      free: k === 'free',
      start: toHHMM(x.a),
      end: toHHMM(x.b),
      mins: x.b - x.a,
      titles:
        k === 'busy'
          ? blocks.filter((b) => b.a < x.b && b.b > x.a).map((b) => b.title)
          : custom
            ? [rt.items[+x.cell.slice(1)].name]
            : [],
    };
  });
}

function duration(m) {
  const hrs = Math.floor(m / 60);
  const rest = m % 60;
  return (hrs ? hrs + 'h' : '') + (hrs && rest ? ' ' : '') + (rest || !hrs ? rest + 'm' : '');
}

const KIND_LABEL = { free: 'Free', busy: 'Busy', custom: 'Routine', lunch: 'Lunch', sleep: 'Sleep' };
const KINDS = ['free', 'busy', 'custom', 'lunch', 'sleep'];

function totalsOf(segs) {
  const t = { free: 0, busy: 0, custom: 0, lunch: 0, sleep: 0 };
  segs.forEach((x) => (t[x.kind] += x.mins));
  return t;
}

function StatTiles(t, fmt = duration) {
  return h(
    'div',
    { class: 'gb-sched-stats' },
    KINDS.filter((k) => k === 'free' || k === 'busy' || t[k]).map((k) =>
      h(
        'div',
        { class: 'gb-sched-stat is-' + k },
        h('span', { class: 'gb-sched-stat-l' }, KIND_LABEL[k]),
        h('span', { class: 'gb-sched-stat-v' }, fmt(t[k], k))
      )
    )
  );
}

/* Whole hours that still add up to the week (168): round each total down, then
   give the hours left over to the largest remainders. Rounding each tile on its
   own showed 169h for a week. */
function wholeHours(t) {
  const total = Math.round(KINDS.reduce((n, k) => n + t[k], 0) / 60);
  const out = {};
  KINDS.forEach((k) => (out[k] = Math.floor(t[k] / 60)));
  let left = total - KINDS.reduce((n, k) => n + out[k], 0);
  KINDS.slice()
    .sort((a, b) => (t[b] % 60) - (t[a] % 60))
    .forEach((k) => {
      if (left > 0 && t[k] % 60) {
        out[k] += 1;
        left -= 1;
      }
    });
  return out;
}

/* The day's shape as one bar. Free is the bar's own fill; every other span is
   drawn over it, positioned across the window the spans cover. */
function DayBar(segs, className) {
  const lo = toMin(segs[0].start);
  const span = segs.reduce((n, x) => n + x.mins, 0);
  return h(
    'div',
    { class: 'gb-sched-bar' + (className ? ' ' + className : ''), 'aria-hidden': 'true' },
    segs
      .filter((x) => !x.free)
      .map((x) =>
        h('span', {
          class: 'gb-sched-' + x.kind,
          style: { left: ((toMin(x.start) - lo) / span) * 100 + '%', width: (x.mins / span) * 100 + '%' },
        })
      )
  );
}

function DayTicks(segs) {
  const lo = toMin(segs[0].start);
  const hi = lo + segs.reduce((n, x) => n + x.mins, 0);
  const marks = hi - lo === 1440 ? ['00:00', '06:00', '12:00', '18:00'] : ['08:00', '12:00', '16:00', '20:00'];
  // Label where the bar ends too (22:00), or it read as running past the axis.
  // Marks too close to that label to fit beside it give way.
  const end = hi < 1440 ? segs[segs.length - 1].end : null;
  const at = (t) => ((toMin(t) - lo) / (hi - lo)) * 100;
  return h(
    'div',
    { class: 'gb-sched-ticks', 'aria-hidden': 'true' },
    marks
      .filter((t) => toMin(t) >= lo && toMin(t) < hi && (!end || at(t) < 80))
      .map((t) => h('span', { style: { left: at(t) + '%' } }, formatTime(t))),
    end ? h('span', { class: 'is-end', style: { right: 0 } }, formatTime(end)) : null
  );
}

function SchedRow(x) {
  if (x.kind === 'sleep' || x.kind === 'lunch') {
    const when =
      x.kind === 'sleep' && x.start === '00:00'
        ? 'until ' + formatTime(x.end)
        : x.kind === 'sleep' && x.end === '24:00'
          ? 'from ' + formatTime(x.start)
          : formatTime(x.start) + ' to ' + formatTime(x.end);
    return h(
      'li',
      { class: 'gb-sched-row is-' + x.kind },
      Icon(x.kind === 'sleep' ? 'moon' : 'utensils', { size: 15, sw: 2.2 }),
      h('span', { class: 'gb-sched-time' }, when),
      h(
        'span',
        { class: 'gb-sched-what' },
        x.kind === 'sleep' ? 'Sleep' : 'Lunch break',
        x.kind === 'lunch' ? h('span', { class: 'gb-sched-len' }, duration(x.mins)) : null
      )
    );
  }
  if (x.kind === 'custom') {
    return h(
      'li',
      { class: 'gb-sched-row is-custom' },
      Icon('repeat', { size: 15, sw: 2.2 }),
      h('span', { class: 'gb-sched-time' }, formatTime(x.start) + ' to ' + formatTime(x.end)),
      h(
        'span',
        { class: 'gb-sched-what' },
        x.titles[0],
        h('span', { class: 'gb-sched-len' }, duration(x.mins))
      )
    );
  }
  return h(
    'li',
    { class: 'gb-sched-row is-' + x.kind },
    h('span', { class: 'gb-sched-time' }, formatTime(x.start) + ' to ' + formatTime(x.end)),
    h(
      'span',
      { class: 'gb-sched-what' },
      x.free ? 'Free' : x.titles.join(', '),
      h('span', { class: 'gb-sched-len' }, duration(x.mins))
    )
  );
}

function ScheduleCard(list, key) {
  const segs = freeBusy(list, key);
  if (!routine && segs.every((x) => x.free)) return null;
  return Card({
    className: 'gb-schedule',
    children: [
      StatTiles(totalsOf(segs)),
      DayBar(segs),
      DayTicks(segs),
      h('ul', { class: 'gb-sched-list' }, segs.map(SchedRow)),
    ],
  });
}

/* Day or week, picked by the toggle in the section head. Session-only view
   state, like the form cache: it survives the panel's repaints, not a reload. */
let scheduleView = 'day';

function ScheduleSection(reminders, list, key, onSelectDate, onSaveRoutine) {
  const rerender = (e) => {
    const sec = e.currentTarget.closest('[data-cal-section="schedule"]');
    sec.replaceWith(ScheduleSection(reminders, list, key, onSelectDate, onSaveRoutine));
    refreshIcons();
  };
  const viewBtn = (v, label) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gb-sched-tab' + (scheduleView === v ? ' is-on' : ''),
        'aria-pressed': String(scheduleView === v),
        onclick: (e) => {
          scheduleView = v;
          rerender(e);
        },
      },
      label
    );
  const day = scheduleView === 'day' ? ScheduleCard(list, key) : null;
  const body =
    scheduleView === 'week'
      ? WeekCard(reminders, key, (k) => {
          scheduleView = 'day';
          if (onSelectDate) onSelectDate(k);
        })
      : day ||
        h(
          'div',
          { class: 'gb-day-empty' },
          'Nothing blocked out yet. Give a reminder an end time, or set your routine to see the whole day.'
        );
  return h(
    'div',
    { class: 'gb-cal-block gb-day-section', 'data-cal-section': 'schedule' },
    h(
      'div',
      { class: 'gb-day-head gb-sched-headrow' },
      h('span', { class: 'gb-day-head-title' }, 'Schedule'),
      h('span', { class: 'gb-sched-tabs' }, viewBtn('day', 'Day'), viewBtn('week', 'Week')),
      onSaveRoutine
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-sched-routine',
              onclick: () => openRoutineDialog(onSaveRoutine),
            },
            Icon('moon', { size: 14, sw: 2.4 }),
            routine ? 'Routine' : 'Set routine'
          )
        : null
    ),
    body
  );
}

/* Monday to Sunday around `key`, one bar per day. A row is a button that opens
   that day; the week's totals sit on top. */
function WeekCard(reminders, key, onPick) {
  const p = parseKey(key);
  const d0 = new Date(p.y, p.m, p.d);
  d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i);
    const k = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
    days.push({ key: k, d, segs: freeBusy(remindersOn(reminders, k), k) });
  }
  const week = totalsOf(days.flatMap((x) => x.segs));
  return Card({
    className: 'gb-schedule gb-week',
    children: [
      // Whole hours at week scale: "104h 45m" does not fit a quarter of a phone.
      StatTiles(week, (m, k) => wholeHours(week)[k] + 'h'),
      h(
        'ul',
        { class: 'gb-week-list' },
        days.map((x) =>
          h(
            'li',
            null,
            h(
              'button',
              {
                type: 'button',
                class: 'gb-week-row' + (x.key === key ? ' is-on' : ''),
                'aria-label':
                  prettyDate(x.key) + ', ' + duration(totalsOf(x.segs).free) + ' free',
                onclick: () => onPick(x.key),
              },
              h('span', { class: 'gb-week-day' }, DOW[x.d.getDay()].slice(0, 3) + ' ' + x.d.getDate()),
              DayBar(x.segs, 'gb-sched-bar--mini'),
              h('span', { class: 'gb-week-free' }, duration(totalsOf(x.segs).free))
            )
          )
        )
      ),
    ],
  });
}

/* A segmented pick of DAY_OPTS. get() reads the choice. */
function DaysPicker(initial, label) {
  let picked = validDays(initial);
  const node = h(
    'div',
    { class: 'gb-segmented gb-segmented--days', role: 'radiogroup', 'aria-label': label },
    DAY_OPTS.map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-seg' + (k === picked ? ' is-on' : ''),
          role: 'radio',
          'aria-checked': String(k === picked),
          dataset: { k },
          onclick: (e) => {
            picked = k;
            for (const b of e.currentTarget.parentElement.children) {
              b.classList.toggle('is-on', b.dataset.k === k);
              b.setAttribute('aria-checked', String(b.dataset.k === k));
            }
          },
        },
        dayOptLabel(k)
      )
    )
  );
  return { node, get: () => picked };
}

/* Set once, shown on every day. Sleep may run past midnight, so bedtime and
   wake-up are two plain inputs with no "end after start" rule. Lunch is a
   TimeRange, and clearing its end turns lunch off. Below them, the user's own
   blocks: a name, a time range and which days, added and removed in place. */
function openRoutineDialog(onSave) {
  const r = routine || {
    bed: '23:00',
    wake: '07:00',
    lunchFrom: null,
    lunchTo: null,
    lunchDays: 'all',
    items: [],
  };
  const timeIn = (value, label) =>
    h('input', { type: 'time', class: 'gb-input gb-input--time', value: value || '', 'aria-label': label });
  const bedIn = timeIn(r.bed, 'Bedtime');
  const wakeIn = timeIn(r.wake, 'Wake up');
  const lunchFrom = timeIn(r.lunchFrom, 'Lunch from');
  const lunchTo = timeIn(r.lunchTo, 'Lunch to');
  const lunchRange = TimeRange(lunchFrom, lunchTo, 'Turn off lunch break');
  const lunchDays = DaysPicker(r.lunchDays, 'Lunch on');
  const err = h('p', { class: 'gb-field-error', role: 'alert', style: { display: 'none' } });

  // One editor per custom block. Each keeps its own inputs; the list is the
  // order they were added in.
  const rows = [];
  const list = h('div', { class: 'gb-routine-items' });
  const addBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--soft gb-routine-add', onclick: () => addRow().nameIn.focus() },
    Icon('plus', { size: 16, sw: 2.6 }),
    'Add a routine block'
  );
  const syncAdd = () => (addBtn.style.display = rows.length >= ROUTINE_MAX ? 'none' : '');
  function addRow(item = { name: '', from: '', to: '', days: 'all' }) {
    const nameIn = h('input', {
      type: 'text',
      class: 'gb-input',
      value: item.name,
      maxlength: 40,
      placeholder: 'Gym, commute, school run...',
      'aria-label': 'Block name',
    });
    const fromIn = timeIn(item.from, 'Block from');
    const toIn = timeIn(item.to, 'Block to');
    const range = TimeRange(fromIn, toIn, 'Clear end time');
    const days = DaysPicker(item.days, 'Block on');
    const row = { nameIn, fromIn, toIn, range, days };
    const node = h(
      'div',
      { class: 'gb-routine-item' },
      h(
        'div',
        { class: 'gb-routine-item-head' },
        nameIn,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Remove this block',
            onclick: () => {
              rows.splice(rows.indexOf(row), 1);
              node.remove();
              syncAdd();
            },
          },
          Icon('trash-2', { size: 15 })
        )
      ),
      range.node,
      days.node
    );
    rows.push(row);
    list.appendChild(node);
    syncAdd();
    refreshIcons();
    return row;
  }
  (r.items || []).forEach((it) => addRow(it));
  syncAdd();

  function save() {
    err.style.display = 'none';
    if (!bedIn.value || !wakeIn.value || bedIn.value === wakeIn.value) {
      err.textContent = 'Pick a bedtime and a different wake-up time.';
      err.style.display = '';
      (bedIn.value ? wakeIn : bedIn).focus();
      return;
    }
    if (!lunchRange.check()) return;
    // A block left completely empty is dropped; a half-filled one is refused,
    // since saving would silently lose it.
    const items = [];
    for (const row of rows) {
      const name = row.nameIn.value.trim();
      if (!name && !row.fromIn.value) continue;
      if (!name) {
        row.nameIn.focus();
        return;
      }
      if (!row.fromIn.value || !row.toIn.value) {
        (row.fromIn.value ? row.toIn : row.fromIn).focus();
        return;
      }
      if (!row.range.check()) return;
      items.push({ name, from: row.fromIn.value, to: row.toIn.value, days: row.days.get() });
    }
    const next = validRoutine({
      bed: bedIn.value,
      wake: wakeIn.value,
      lunchFrom: lunchTo.value ? lunchFrom.value : null,
      lunchTo: lunchTo.value || null,
      lunchDays: lunchDays.get(),
      items,
    });
    close();
    onSave(next);
  }

  const { sheet, close } = openOverlay({ label: 'My routine' });
  const parts = [
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'My routine'),
      h('div', { class: 'gb-modal-sub' }, 'Blocks out the same hours every day, with no reminders or alerts.')
    ),
    h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Sleep'),
      h('div', { class: 'gb-rem-inputs gb-rem-range' }, bedIn, h('span', { class: 'gb-rem-to' }, 'to'), wakeIn),
      err,
      h('div', { class: 'gb-field-label' }, 'Lunch break (optional)'),
      lunchRange.node,
      lunchDays.node,
      h('div', { class: 'gb-field-label' }, 'Your own blocks (optional)'),
      list,
      addBtn
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary',
        style: { width: '100%', marginTop: '14px' },
        onclick: save,
      },
      'Save routine'
    ),
  ];
  // Element.append writes a null argument out as the text "null", so the
  // optional button is added only when there is something to turn off.
  if (routine) {
    parts.push(
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-modal-cancel',
          onclick: () => {
            close();
            onSave(null);
          },
        },
        'Turn off routine'
      )
    );
  }
  parts.push(
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Cancel')
  );
  sheet.append(...parts);
  refreshIcons();
}

/* A required text field refusing empty: the same in-page line as TimeRange's,
   because an add that only refocused read as a dead button. Typing clears it. */
function requiredError(input) {
  const node = h('p', { class: 'gb-field-error', role: 'alert', style: { display: 'none' } });
  const set = (msg) => {
    node.textContent = msg || '';
    node.style.display = msg ? '' : 'none';
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  input.addEventListener('input', () => set(''));
  return { node, set };
}

/* Start + end time pair, shared by the add form and the edit dialog. The end is
   disabled until there is a start, and has its own clear button: a native time
   input has no reliable way to empty it (none on iOS or Chrome), and an empty
   end is how a block goes back to being a plain reminder. check() reports a bad
   pair in the page, because a native bubble vanishes the moment focus moves. */
/* Pure: an end time is optional, but when present it must be after the start.
   Both are HH:MM strings, so <= is a time comparison. */
function timeRangeOk(start, end) {
  return !(end && end <= start);
}

/* Pure: the PATCH the edit dialog sends. null means "unchanged" in a PATCH, so a
   removed time says allDay outright and a dropped until says clearUntil; -1 is
   "back to my default" lead. `repeat` is null when the scope is one occurrence. */
function reminderEditPatch(rem, { text, time, endTime, tag, sound, lead, movedDate, repeat, until }) {
  const patch = {
    text,
    time: time || null,
    endTime: endTime || null,
    tag,
    sound: sound || '',
    notifyBefore: lead === null ? -1 : lead,
  };
  if (!time && rem.time) patch.allDay = true;
  if (movedDate) patch.date = movedDate;
  if (repeat) {
    patch.repeat = repeat;
    if (repeat !== 'none') {
      if (until) patch.until = until;
      else if (rem.until) patch.clearUntil = true;
    }
  }
  return patch;
}

function TimeRange(timeInput, endInput, clearLabel = 'Remove end time') {
  const error = h('p', { class: 'gb-field-error', role: 'alert', style: { display: 'none' } });
  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-icon-btn gb-rem-clear',
      'aria-label': clearLabel,
      onclick: () => {
        endInput.value = '';
        sync();
        endInput.focus();
      },
    },
    Icon('x', { size: 14, sw: 2.6 })
  );
  function setError(msg) {
    error.textContent = msg || '';
    error.style.display = msg ? '' : 'none';
    endInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function sync() {
    if (!timeInput.value) endInput.value = '';
    endInput.disabled = !timeInput.value;
    clearBtn.style.visibility = endInput.value ? 'visible' : 'hidden';
    setError('');
  }
  timeInput.addEventListener('input', sync);
  endInput.addEventListener('input', sync);
  sync();
  const node = h(
    'div',
    null,
    h(
      'div',
      { class: 'gb-rem-inputs gb-rem-range' },
      timeInput,
      h('span', { class: 'gb-rem-to' }, 'to'),
      endInput,
      clearBtn
    ),
    error
  );
  return {
    node,
    sync,
    check() {
      if (!timeRangeOk(timeInput.value, endInput.value)) {
        setError('The end time has to be after the start time.');
        endInput.focus();
        return false;
      }
      return true;
    },
  };
}

function dueKey(task) {
  if (!task || !task.dueAt) return '';
  const dt = new Date(task.dueAt);
  if (Number.isNaN(dt.getTime())) return '';
  return keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function tasksOn(tasks, key) {
  return (tasks || [])
    .filter((t) => dueKey(t) === key)
    .sort((a, b) => {
      const av = a.dueAt || '';
      const bv = b.dueAt || '';
      return av.localeCompare(bv);
    });
}

function keyFromInstant(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function completedTasksOn(tasks, key) {
  return (tasks || [])
    .filter((t) => !!t.done && keyFromInstant(t.doneAt) === key)
    .sort((a, b) => String(a.doneAt || '').localeCompare(String(b.doneAt || '')));
}

function goalActionsOn(sections, key) {
  const rows = [];
  (sections || []).forEach((section) => {
    (section.goals || []).forEach((goal) => {
      (goal.recentActions || []).forEach((action) => {
        const actionKey = action.actionDate || keyFromInstant(action.createdAt);
        if (actionKey === key) {
          rows.push({ goal: goal.title, note: action.note, date: actionKey });
        }
      });
    });
  });
  return rows;
}

function prettyTaskTime(iso) {
  if (!iso) return 'No due time';
  try {
    return formatTime(iso);
  } catch (_) {
    return 'Due';
  }
}

/* ---- Month grid ---- */
function MonthGrid({ year, month, selectedDate, reminders, onSelectDate }) {
  const firstDow = new Date(year, month, 1).getDay();
  const today = todayKey();

  const dowRow = h(
    'div',
    { class: 'gb-cal-dow' },
    DOW.map((d) => h('span', null, d[0]))
  );

  const cells = [];
  const startDay = 1 - firstDow;
  for (let i = 0; i < 42; i++) {
    const dt = new Date(year, month, startDay + i);
    const key = keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const inMonth = dt.getFullYear() === year && dt.getMonth() === month;
    const todays = remindersOn(reminders, key);

    // Up to 3 distinct tag-colored dots.
    const seen = [];
    for (const r of todays) {
      if (seen.indexOf(r.tag) === -1) seen.push(r.tag);
      if (seen.length >= 3) break;
    }
    const dots = seen.length
      ? h(
          'span',
          { class: 'gb-cal-dots' },
          seen.map((tag) =>
            h('span', {
              class: 'gb-cal-dot',
              style: { background: (TAGS[tag] || TAGS.other).color },
            })
          )
        )
      : null;

    const cls =
      'gb-cal-day' +
      (inMonth ? '' : ' is-other-month') +
      (key === today ? ' is-today' : '') +
      (key === selectedDate ? ' is-selected' : '') +
      (todays.length ? ' has-rem' : '');
    cells.push(
      h(
        'button',
        {
          type: 'button',
          class: cls,
          'data-day-key': key,
          'aria-label':
            prettyDate(key) +
            (key === today ? ', today' : '') +
            (todays.length ? ' — ' + plural(todays.length, 'reminder') : ''),
          'aria-pressed': String(key === selectedDate),
          onclick: () => onSelectDate(key),
        },
        h('span', { class: 'num' }, String(dt.getDate())),
        dots
      )
    );
  }

  return Card({
    className: 'gb-cal-card',
    children: [dowRow, h('div', { class: 'gb-cal-grid', onkeydown: moveFocus }, cells)],
  });
}

/* Arrow keys walk the days, the way every date grid does; Enter/Space already
   select (they are buttons). Without this, reaching the 28th was 28 Tabs.
   Focus only — selecting stays an explicit Enter, so arrowing past a day doesn't
   load its food and repaint the panel on each step. */
const GRID_STEP = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
function moveFocus(e) {
  const step = GRID_STEP[e.key];
  const cell = e.target.closest && e.target.closest('.gb-cal-day');
  if (!step || !cell) return;
  const days = Array.from(e.currentTarget.querySelectorAll('.gb-cal-day'));
  const next = days[days.indexOf(cell) + step];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/* ---- Tag picker (color chips) ---- */
function TagPicker(initial) {
  let selected = initial;
  const chips = {};
  function applySelection(tag) {
    selected = tag;
    for (const k in chips) {
      const on = k === tag;
      chips[k].classList.toggle('is-on', on);
      chips[k].setAttribute('aria-checked', String(on));
    }
  }
  const wrap = h('div', { class: 'gb-tagpick', role: 'radiogroup', 'aria-label': 'Tag' });
  TAG_ORDER.forEach((tag) => {
    const t = TAGS[tag];
    const chip = h(
      'button',
      {
        type: 'button',
        class: 'gb-tagchip' + (tag === selected ? ' is-on' : ''),
        role: 'radio',
        'aria-checked': String(tag === selected),
        'aria-label': t.label,
        style: { '--tag-color': t.color, '--tag-soft': t.soft, '--tag-soft-fg': t.softFg },
        onclick: () => applySelection(tag),
      },
      h('span', { class: 'swatch' }),
      t.label
    );
    chips[tag] = chip;
    wrap.appendChild(chip);
  });
  return { node: wrap, get: () => selected, set: applySelection };
}

/* ---- Repeat picker (segmented) ---- */
function RepeatPicker(initial, onChange) {
  let selected = initial;
  const segs = {};
  function applySelection(rep, fireChange) {
    selected = rep;
    for (const k in segs) {
      const on = k === rep;
      segs[k].classList.toggle('is-on', on);
      segs[k].setAttribute('aria-checked', String(on));
    }
    if (fireChange && onChange) onChange(rep);
  }
  const wrap = h('div', {
    class: 'gb-segmented gb-segmented--repeat',
    role: 'radiogroup',
    'aria-label': 'Repeat',
  });
  REPEAT_ORDER.forEach((rep) => {
    const seg = h(
      'button',
      {
        type: 'button',
        class: 'gb-seg' + (rep === selected ? ' is-on' : ''),
        role: 'radio',
        'aria-checked': String(rep === selected),
        onclick: () => applySelection(rep, true),
      },
      REPEATS[rep].label
    );
    segs[rep] = seg;
    wrap.appendChild(seg);
  });
  /* The form DOM is cached for the whole session, so these labels are a
     snapshot — change the working week in Settings and the 'weekdays' segment
     kept saying Mon-Fri while everything rebuilt per render said Mon-Sat.
     Called on every side-panel render, which is cheap and catches every path. */
  function relabel() {
    for (const k in segs) segs[k].textContent = REPEATS[k].label;
  }
  return {
    node: wrap,
    get: () => selected,
    set: (rep) => applySelection(rep, true),
    relabel: relabel,
  };
}

/* ---- The richer rule: every N, which weekdays, nth weekday, end after N ----
   The fields recurrence.js and ReminderService.occursOn both read (see the
   header there). One control set, shown under the Repeat picker in the add
   form and the edit dialog; `sync(repeat, anchorKey)` shows the parts that
   repeat can use, and get() always answers all four, with the "clear" values
   a PATCH needs (interval 1, days '', nth 0, count 0). */
const RULE_UNIT = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};
const DAY_SHORT = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };

function RuleExtras() {
  let repeat = 'none';
  let anchorKey = todayKey();
  // The day-of-month a by-date monthly series keeps (see sync); null = the anchor's.
  let dateKey = null;
  const clampInt = (v, lo, hi) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
  };
  const every = h('input', {
    type: 'number',
    class: 'gb-input gb-rule-num',
    min: 1,
    max: 99,
    step: 1,
    value: '1',
    inputmode: 'numeric',
    'aria-label': 'Repeat every',
  });
  const unitLabel = h('span', { class: 'gb-rule-word' }, 'days');
  const everyRow = h('div', { class: 'gb-rule-row' }, h('span', { class: 'gb-rule-word' }, 'Every'), every, unitLabel);
  const relabelUnit = () => {
    const u = RULE_UNIT[repeat];
    if (u) unitLabel.textContent = clampInt(every.value, 1, 99) === 1 ? u[0] : u[1];
  };
  every.addEventListener('input', relabelUnit);

  const picked = new Set();
  const chips = {};
  const paintDays = () => {
    for (const code of WEEK_ORDER) {
      chips[code].classList.toggle('is-on', picked.has(code));
      chips[code].setAttribute('aria-pressed', String(picked.has(code)));
    }
  };
  const daysRow = h(
    'div',
    { class: 'gb-rule-days', role: 'group', 'aria-label': 'On these days' },
    WEEK_ORDER.map((code) => {
      chips[code] = h(
        'button',
        {
          type: 'button',
          class: 'gb-rule-day',
          'aria-pressed': 'false',
          onclick: () => {
            if (picked.has(code)) picked.delete(code);
            else picked.add(code);
            paintDays();
          },
        },
        DAY_SHORT[code]
      );
      return chips[code];
    })
  );

  const monthSel = h('select', { class: 'gb-input gb-rule-month', 'aria-label': 'Which day of the month' });
  const fillMonth = () => {
    const keep = monthSel.value;
    const { nth, isLast, dow } = nthWeekdayOf(anchorKey);
    const day = parseKey(dateKey || anchorKey).d;
    const opts = [h('option', { value: '0' }, 'On day ' + day)];
    if (nth <= 5) opts.push(h('option', { value: String(nth) }, 'On the ' + ORDINAL[nth] + ' ' + DAY_LONG[dow]));
    if (isLast) opts.push(h('option', { value: '-1' }, 'On the last ' + DAY_LONG[dow]));
    monthSel.replaceChildren(...opts);
    monthSel.value = Array.from(monthSel.options).some((o) => o.value === keep) ? keep : '0';
  };

  const count = h('input', {
    type: 'number',
    class: 'gb-input gb-rule-num',
    min: 1,
    max: 999,
    step: 1,
    inputmode: 'numeric',
    placeholder: '-',
    'aria-label': 'End after this many times (optional)',
  });
  const countRow = h(
    'div',
    { class: 'gb-rule-row' },
    h('span', { class: 'gb-rule-word' }, 'End after'),
    count,
    h('span', { class: 'gb-rule-word' }, 'times (optional)')
  );
  const node = h('div', { class: 'gb-rule', style: { display: 'none' } }, everyRow, daysRow, monthSel, countRow);

  // `dayKey`: a split of a series on the 31st made from February's 28th keeps
  // the 31st (ReminderService.keepDayOfMonth), so "On day" names the series' day.
  function sync(rep, key, dayKey = null) {
    repeat = rep || 'none';
    if (key) anchorKey = key;
    dateKey = dayKey;
    node.style.display = repeat === 'none' ? 'none' : '';
    everyRow.style.display = RULE_UNIT[repeat] ? '' : 'none';
    daysRow.style.display = repeat === 'weekly' ? '' : 'none';
    monthSel.style.display = repeat === 'monthly' ? '' : 'none';
    relabelUnit();
    if (repeat === 'monthly') fillMonth();
    // Weekly with nothing picked means the anchor's own weekday; show it so.
    if (repeat === 'weekly' && !picked.size) {
      picked.add(DAY_CODES[nthWeekdayOf(anchorKey).dow]);
      paintDays();
    }
  }
  function get() {
    return {
      repeatInterval: RULE_UNIT[repeat] ? clampInt(every.value, 1, 99) : 1,
      repeatDays: repeat === 'weekly' ? WEEK_ORDER.filter((c) => picked.has(c)).join(',') : '',
      repeatNth: repeat === 'monthly' ? Number(monthSel.value) || 0 : 0,
      repeatCount: count.value ? clampInt(count.value, 1, 999) : 0,
    };
  }
  function set(rem) {
    every.value = String((rem && rem.repeatInterval) || 1);
    picked.clear();
    for (const i of parseRepeatDays(rem && rem.repeatDays)) picked.add(DAY_CODES[i]);
    paintDays();
    count.value = rem && rem.repeatCount ? String(rem.repeatCount) : '';
    sync((rem && rem.repeat) || 'none', rem && rem.date);
    if (rem && rem.repeatNth) {
      fillMonth();
      monthSel.value = String(rem.repeatNth);
    }
  }
  return { node, sync, get, set, reset: () => set(null) };
}

/** "Every 2 weeks on Mon, Fri", "Monthly on the last Fri · 10 times". */
function describeRepeat(rem) {
  const rep = rem && rem.repeat;
  if (!rep || rep === 'none' || !REPEATS[rep]) return '';
  const n = Number(rem.repeatInterval) || 1;
  const u = RULE_UNIT[rep];
  let out = n > 1 && u ? 'Every ' + n + ' ' + u[1] : REPEATS[rep].label;
  if (rep === 'weekly') {
    const days = parseRepeatDays(rem.repeatDays);
    if (days.length) {
      out += ' on ' + WEEK_ORDER.filter((c) => days.indexOf(DAY_CODES.indexOf(c)) !== -1)
        .map((c) => DAY_SHORT[c])
        .join(', ');
    }
  }
  if (rep === 'monthly' && rem.repeatNth && rem.date) {
    out += ' on the ' + ORDINAL[rem.repeatNth] + ' ' + DAY_LONG[nthWeekdayOf(rem.date).dow].slice(0, 3);
  }
  if (rem.repeatCount) out += ' · ' + rem.repeatCount + ' times';
  return out;
}

/* A second alert: None, or minutes before. No "Default": unlike the first
   alert it has nothing to fall back on (notify_before2 is null = none). */
function secondAlertSelect() {
  const sel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Second alert' },
    h('option', { value: '' }, 'None'),
    ...LEAD_OPTIONS.map((m) => h('option', { value: String(m) }, leadLabel(m)))
  );
  sel.setLead = (n) => {
    const m = n === null || n === undefined ? '' : String(validLead(n));
    if (m && !Array.from(sel.options).some((o) => o.value === m)) {
      sel.append(h('option', { value: m }, leadLabel(Number(m))));
    }
    sel.value = m;
  };
  /** Minutes, or null for none. */
  sel.getLead = () => (sel.value === '' ? null : Number(sel.value));
  return sel;
}

/* Notes under the title: the 1000 the column holds. */
function notesInput(value) {
  return h(
    'textarea',
    {
      class: 'gb-input gb-rem-notes-input',
      rows: 2,
      maxlength: 1000,
      placeholder: 'Details, a link, what to bring (optional)',
      'aria-label': 'Notes (optional)',
    },
    value || ''
  );
}

/* ---- Scoped delete dialog for recurring reminders ---- */
function openDeleteDialog(rem, occKey, onDelete) {
  const opts = [
    { scope: 'this', icon: 'calendar-x', label: 'Only this day', sub: prettyDate(occKey) },
    {
      scope: 'future',
      icon: 'calendar-off',
      label: 'This & all future',
      sub: 'From ' + prettyDate(occKey) + ' onward',
    },
    {
      scope: 'before',
      icon: 'history',
      label: 'Only past days',
      sub: 'Delete everything before ' + prettyDate(occKey),
    },
    { scope: 'all', icon: 'trash-2', label: 'Delete whole series', sub: 'Every occurrence' },
  ];

  const { sheet, close } = openOverlay({ label: 'Delete recurring reminder' });

  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Delete recurring reminder'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        '“' + rem.text + '” repeats ' +
          (REPEATS[rem.repeat].phrase || REPEATS[rem.repeat].label.toLowerCase()) + '.'
      )
    ),
    h(
      'div',
      { class: 'gb-modal-opts' },
      opts.map((o) =>
        h(
          'button',
          {
            type: 'button',
            class: 'gb-modal-opt' + (o.scope === 'all' ? ' is-danger' : ''),
            onclick: () => {
              close();
              onDelete(o.scope, rem.id, occKey);
            },
          },
          h('span', { class: 'gb-modal-opt-ic' }, Icon(o.icon, { size: 18 })),
          h(
            'span',
            { class: 'gb-modal-opt-tx' },
            h('span', { class: 'gb-modal-opt-l' }, o.label),
            h('span', { class: 'gb-modal-opt-s' }, o.sub)
          )
        )
      )
    ),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    )
  );
  refreshIcons();
}

/* ---- Reminder row ---- */
/* Editing a recurring reminder asks the same question deleting one does, for
   the same reason: the row on screen is one occurrence of a series, and the
   user has to say how far the change reaches. Scoped delete has always asked;
   editing had no answer at all because there was nothing to edit with. */
function openEditDialog(rem, occKey, onEdit) {
  const textInput = h('input', {
    type: 'text',
    class: 'gb-input',
    value: rem.text || '',
    // The column's own width (calendar_reminders.text is 255).
    maxlength: 255,
    'aria-label': 'Reminder text',
  });
  const timeInput = h('input', {
    type: 'time',
    class: 'gb-input gb-input--time',
    value: (rem.time || '').slice(0, 5),
    'aria-label': 'Reminder time',
  });
  const endInput = h('input', {
    type: 'time',
    class: 'gb-input gb-input--time',
    value: (rem.endTime || '').slice(0, 5),
    placeholder: 'End',
    'aria-label': 'End time (optional)',
  });
  const range = TimeRange(timeInput, endInput);
  /* A native time input can't reliably be emptied (no clear on iOS or Chrome),
     and a null time in the PATCH means "unchanged" — so taking the time off is
     its own button here and its own field (allDay) on the wire. */
  const noTimeBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-login-link gb-rem-notime',
      onclick: () => {
        timeInput.value = '';
        range.sync();
        syncNoTime();
      },
    },
    'No time, just the day'
  );
  const syncNoTime = () => {
    noTimeBtn.style.display = timeInput.value ? '' : 'none';
  };
  timeInput.addEventListener('input', syncNoTime);
  syncNoTime();
  const toneSel = toneSelect('Silent in the app');
  toneSel.setTone(rem.sound);
  const notifySel = notifySelect();
  notifySel.setLead(rem.notifyBefore);
  toneSel.addEventListener('change', () => {
    if (toneSel.value) playChime(toneSel.value);
  });

  const repeats = rem.repeat && rem.repeat !== 'none';
  const tagPicker = TagPicker(TAGS[rem.tag] ? rem.tag : 'personal');

  // The day: only a single reminder has one to move — a one-off, or the
  // one-off an "only this day" edit leaves. A series is measured from its anchor.
  const dateInput = h('input', {
    type: 'date',
    class: 'gb-input gb-input--until',
    value: occKey,
    min: occKey < todayKey() ? occKey : todayKey(),
    'aria-label': 'Reminder date',
  });
  const dateErr = requiredError(dateInput);
  const dateField = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Day'),
    dateInput,
    dateErr.node
  );

  // Repeat + until describe how a series runs, so not for "only this day".
  const untilInput = h('input', {
    type: 'date',
    class: 'gb-input gb-input--until',
    value: rem.until || '',
    'aria-label': 'Repeat until (optional)',
  });
  const untilErr = requiredError(untilInput);
  const untilClear = h(
    'button',
    {
      type: 'button',
      class: 'gb-login-link',
      onclick: () => {
        untilInput.value = '';
        untilErr.set('');
      },
    },
    'No end date'
  );
  const untilField = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Repeat until (optional)'),
    untilInput,
    untilClear,
    untilErr.node
  );
  const repeatPicker = RepeatPicker(rem.repeat || 'none', () => syncScope());
  const rule = RuleExtras();
  rule.set(rem);
  const repeatField = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Repeat'),
    repeatPicker.node,
    rule.node,
    untilField
  );
  const notes = notesInput(rem.notes);
  const secondSel = secondAlertSelect();
  secondSel.setLead(rem.notifyBefore2);

  const scopes = [
    { scope: 'this', icon: 'calendar-x', label: 'Only this day', sub: prettyDate(occKey) },
    {
      scope: 'future',
      icon: 'calendar-off',
      label: 'This & all future',
      sub: 'From ' + prettyDate(occKey) + ' onward',
    },
    { scope: 'all', icon: 'repeat', label: 'The whole series', sub: 'Every occurrence' },
  ];
  let scope = repeats ? 'this' : 'all';
  const scopeRow = repeats
    ? h(
        'div',
        { class: 'gb-modal-opts' },
        scopes.map((o) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gb-modal-opt' + (o.scope === scope ? ' is-on' : ''),
              dataset: { scope: o.scope },
              onclick: (e) => {
                scope = o.scope;
                const row = e.currentTarget.parentElement;
                for (const b of row.children) b.classList.toggle('is-on', b.dataset.scope === scope);
                syncScope();
              },
            },
            h('span', { class: 'gb-modal-opt-ic' }, Icon(o.icon, { size: 18 })),
            h(
              'span',
              { class: 'gb-modal-opt-tx' },
              h('span', { class: 'gb-modal-opt-l' }, o.label),
              h('span', { class: 'gb-modal-opt-s' }, o.sub)
            )
          )
        )
      )
    : null;

  // The first day "until" is measured from, for the scope in hand.
  const startKey = () => (scope === 'future' ? occKey : rem.date || occKey);
  function syncScope() {
    const single = !repeats || scope === 'this';
    dateField.style.display = single ? '' : 'none';
    repeatField.style.display = scope === 'this' ? 'none' : '';
    untilField.style.display = repeatPicker.get() === 'none' ? 'none' : '';
    untilInput.min = startKey();
    const keepsDay = scope === 'future' && rem.repeat === 'monthly' && !rem.repeatNth;
    rule.sync(repeatPicker.get(), startKey(), keepsDay ? rem.date : null);
  }
  syncScope();

  const textErr = requiredError(textInput);
  const { sheet, close } = openOverlay({ label: 'Edit reminder' });
  // Built on openOverlay, not openModal, so Enter needs wiring here too.
  const saveBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      style: { width: '100%', marginTop: '14px' },
      // Closes only once the save lands: closing first lost every edit when
      // it failed (onEdit has toasted why and rethrown).
      onclick: async (e) => {
        const text = textInput.value.trim();
        if (!text) {
          textErr.set('Write what to be reminded of first.');
          textInput.focus();
          return;
        }
        if (!range.check()) return;
        const single = !repeats || scope === 'this';
        // Only a move is checked: a reminder already on a past day can still
        // have its text fixed without being made to jump forward.
        const movedDay = single && dateInput.value !== occKey;
        if (movedDay && (!dateInput.value || dateInput.value < todayKey())) {
          dateErr.set('Pick today or a day after it.');
          dateInput.focus();
          return;
        }
        const repeat = scope === 'this' ? null : repeatPicker.get();
        // YYYY-MM-DD strings, so < is a date comparison (same as the add form).
        if (repeat && repeat !== 'none' && untilInput.value && untilInput.value < startKey()) {
          untilErr.set('This is before the reminder starts on ' + prettyDate(startKey()) + '.');
          untilInput.focus();
          return;
        }
        const patch = reminderEditPatch(rem, {
          text,
          time: timeInput.value,
          endTime: endInput.value,
          tag: tagPicker.get(),
          sound: toneSel.value,
          lead: notifySel.getLead(),
          movedDate: movedDay ? dateInput.value : null,
          repeat,
          until: untilInput.value,
        });
        // Notes and the second alert: '' clears notes, -1 clears the alert
        // (a PATCH's null means "unchanged"). The rule's details go with the
        // repeat, in the clear-able form RuleExtras.get() gives.
        patch.notes = notes.value.trim();
        patch.notifyBefore2 = secondSel.getLead() === null ? -1 : secondSel.getLead();
        if (repeat) Object.assign(patch, rule.get());
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await onEdit(scope, rem.id, occKey, patch);
          close();
        } catch (_) {
          btn.disabled = false;
        }
      },
    },
    'Save changes'
  );
  submitOnEnter(sheet, saveBtn);
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Edit reminder'),
      h(
        'div',
        { class: 'gb-modal-sub' },
        repeats ? 'Pick how far this change reaches.' : prettyDate(occKey)
      )
    ),
    h(
      'div',
      { class: 'gb-form' },
      h('div', { class: 'gb-field-label' }, 'Reminder'),
      textInput,
      textErr.node,
      h('div', { class: 'gb-field-label' }, 'Notes'),
      notes,
      h('div', { class: 'gb-field-label' }, 'Notify'),
      notifySel,
      h('div', { class: 'gb-field-label' }, 'Second alert'),
      secondSel,
      h('div', { class: 'gb-field-label' }, 'Time'),
      range.node,
      noTimeBtn,
      h('div', { class: 'gb-field-label' }, 'Tag'),
      tagPicker.node,
      dateField,
      repeatField,
      h('div', { class: 'gb-field-label' }, 'Tone'),
      toneSel
    ),
    ...(scopeRow ? [h('div', { class: 'gb-field-label' }, 'Apply to'), scopeRow] : []),
    saveBtn,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    )
  );
  refreshIcons();
  setTimeout(() => textInput.focus(), 60);
}

/** "HH:MM" local, from a snooze's instant — what formatTime takes. */
function snoozeClock(iso) {
  const d = new Date(iso);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** "Snoozed till 09:20", with the day when it isn't today — a 23:55 snooze of
    20 minutes rings tomorrow, and a bare "00:15" read as earlier today. */
function snoozeLabel(iso) {
  const d = new Date(iso);
  const key = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
  return (
    'Snoozed till ' + (key === todayKey() ? '' : prettyDate(key) + ', ') + formatTime(snoozeClock(iso))
  );
}

function ReminderRow(rem, occKey, onDelete, whatsappEnabled, onEdit, onCancelSnooze, onToggleDone) {
  const t = TAGS[rem.tag] || TAGS.other;
  const meta = [];
  // Per occurrence: ticking off today's leaves tomorrow's ringing.
  const done = Array.isArray(rem.doneDates) && rem.doneDates.indexOf(occKey) !== -1;
  if (rem.time) {
    meta.push(
      h(
        'span',
        { class: 'meta-item' },
        Icon('clock', { size: 13, color: 'var(--fg3)' }),
        formatTime(rem.time) + (rem.endTime ? ' to ' + formatTime(rem.endTime) : '')
      )
    );
    // Only the reminder's own choice: the default is in Settings, and badging
    // every row with it would say the same thing down the whole list.
    if (rem.notifyBefore) {
      meta.push(
        h(
          'span',
          { class: 'meta-item' },
          Icon('bell', { size: 13, color: 'var(--fg3)' }),
          leadLabel(rem.notifyBefore)
        )
      );
    }
    if (rem.snoozedUntil && new Date(rem.snoozedUntil).getTime() > Date.now()) {
      const label = snoozeLabel(rem.snoozedUntil);
      // A button when it can be undone: the endpoint existed, and the only way
      // to call off a snooze was Settings → Reminders.
      meta.push(
        onCancelSnooze
          ? h(
              'button',
              {
                type: 'button',
                class: 'meta-item gb-rem-snoozed gb-rem-snoozed--btn',
                'aria-label': label + '. Cancel the snooze',
                title: 'Cancel the snooze',
                onclick: () => onCancelSnooze(rem.id),
              },
              Icon('alarm-clock', { size: 13 }),
              label,
              Icon('x', { size: 12, sw: 2.6 })
            )
          : h('span', { class: 'meta-item gb-rem-snoozed' }, Icon('alarm-clock', { size: 13 }), label)
      );
    }
    // Only where it is still true: the scheduler has already passed a slot in
    // the past, so badging it "WhatsApp" promises a message that will never come.
    if (whatsappEnabled && !isPastSlot(occKey, rem.time)) {
      meta.push(
        h(
          'span',
          { class: 'meta-item gb-wa-badge' },
          Icon('message-circle', { size: 13, color: 'var(--gb-wa-green, #25D366)' }),
          'WhatsApp'
        )
      );
    }
  }
  // A second alert, when it has one (no default to hide, unlike the first).
  if (rem.time && rem.notifyBefore2 !== null && rem.notifyBefore2 !== undefined) {
    meta.push(
      h(
        'span',
        { class: 'meta-item' },
        Icon('bell-plus', { size: 13, color: 'var(--fg3)' }),
        'and ' + leadLabel(rem.notifyBefore2).toLowerCase()
      )
    );
  }
  if (rem.repeat && rem.repeat !== 'none') {
    const reLabel =
      describeRepeat(rem) + (rem.until ? ' · until ' + prettyDate(rem.until) : '');
    meta.push(
      h('span', { class: 'meta-item' }, Icon('repeat', { size: 13, color: 'var(--fg3)' }), reLabel)
    );
  }

  async function handleDelete() {
    if (rem.repeat && rem.repeat !== 'none') {
      openDeleteDialog(rem, occKey, onDelete);
      return;
    }
    // A one-off went on a single tap, next to Edit, with no undo.
    const ok = await confirmDialog({
      title: 'Delete "' + rem.text + '"?',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) onDelete('all', rem.id, occKey);
  }

  const tagPill = h(
    'span',
    { class: 'gb-tag-pill', style: { background: t.soft, color: t.softFg } },
    t.label
  );

  return h(
    'div',
    { class: 'gb-rem-row' + (done ? ' is-done' : ''), style: { '--tag-color': t.color } },
    h('span', { class: 'gb-rem-accent' }),
    onToggleDone
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-rem-check' + (done ? ' is-on' : ''),
            role: 'checkbox',
            'aria-checked': String(done),
            'aria-label': (done ? 'Done: ' : 'Mark done: ') + rem.text,
            title: done ? 'Done. Tap to undo' : 'Mark done: it won’t ring for this day',
            onclick: () => onToggleDone(rem.id, occKey, !done),
          },
          done ? Icon('check', { size: 14, sw: 3 }) : null
        )
      : null,
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'gb-rem-text' }, rem.text),
      rem.notes ? h('div', { class: 'gb-rem-notes' }, rem.notes) : null,
      h('div', { class: 'gb-rem-meta' }, tagPill, meta)
    ),
    onEdit
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-rem-del gb-rem-edit',
            'aria-label': 'Edit reminder: ' + rem.text,
            onclick: () => openEditDialog(rem, occKey, onEdit),
          },
          Icon('pencil', { size: 16 })
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        class: 'gb-rem-del',
        'aria-label': 'Delete reminder: ' + rem.text,
        onclick: handleDelete,
      },
      Icon('trash-2', { size: 16 })
    )
  );
}

/* ---- Persistent form cache ----
     The reminder form lives across re-renders so clicking another day
     doesn't wipe what the user is typing or which tag/repeat they picked.
     We rebind the per-render closure variables (selectedDate, callback)
     through `formBinding` rather than rebuilding the DOM. */
const formBinding = {
  onSelectDate: null,
  selectedDate: '',
  onAddReminder: null,
};
let cachedForm = null;
let cachedFormRefs = null;

/* Text handed over from another screen ("make a reminder" on a note), held
   until the form exists — the caller switches screens, so the form is usually
   built a tick AFTER the prefill lands. */
let pendingReminderText = '';
let pendingReminderOpts = null; // { time?: 'HH:MM', repeat?: REPEAT_ORDER key }

/* `opts` (optional) also presets the time and the repeat — Report's
   "Set a bedtime reminder" hands over a daily one at the suggested hour. */
function prefillCalendarReminder(text, opts) {
  pendingReminderText = text || '';
  pendingReminderOpts = opts || null;
  applyPendingReminderText();
}

function applyPendingReminderText() {
  if (!pendingReminderText || !cachedFormRefs) return;
  cachedFormRefs.textInput.value = pendingReminderText;
  const o = pendingReminderOpts;
  if (o && /^\d{2}:\d{2}$/.test(String(o.time || ''))) {
    cachedFormRefs.timeInput.value = o.time;
    cachedFormRefs.syncRange();
  }
  if (o && o.repeat && REPEATS[o.repeat]) cachedFormRefs.repeatPicker.set(o.repeat);
  pendingReminderText = '';
  pendingReminderOpts = null;
  setTimeout(() => cachedFormRefs.textInput.focus(), 60);
}

/* Adds one of the user's own sounds from a tone picker (app.js owns the
   storage, the upload and the cap). Resolves to the new chime key, or null when
   they cancelled or were at the limit. */
let addCustomTone = null;
function setCustomToneAdder(fn) {
  addCustomTone = fn;
}

/* Speaking a reminder into the form (app.js owns the microphone and the
   parser): { supported(), capture(btn) -> Promise<{said, reminder} | null> }. */
let voiceReminder = null;
function setVoiceReminder(v) {
  voiceReminder = v;
}

/* A reminder's tone <select>: Default, the built-ins, the user's own sounds,
   Silent, then "Add your own sound…". Refilled on focus when the list has changed, because the add form is
   built once and cached, and a sound added in Settings since must show up. */
const ADD_TONE = '__add';
function toneSelect(offLabel) {
  const sel = h('select', { class: 'gb-input', 'aria-label': 'Reminder tone' });
  let sig = null;
  const fill = () => {
    const opts = chimeOptions();
    const next = opts.map((c) => c.key + '=' + c.label).join('|');
    if (next === sig) return;
    sig = next;
    const v = sel.value;
    sel.replaceChildren(
      h('option', { value: '' }, 'Default tone'),
      ...opts.map((c) => h('option', { value: c.key }, c.key === 'off' ? offLabel : c.label)),
      addCustomTone ? h('option', { value: ADD_TONE }, '+ Add your own sound\u2026') : null
    );
    sel.value = chimeOptionValue(v);
  };
  fill();
  sel.addEventListener('focus', fill);
  // Before the caller's own change listener (it previews the pick), which must
  // never see the "add" entry: it isn't a tone.
  let last = sel.value;
  sel.addEventListener('focus', () => {
    last = sel.value;
  });
  sel.addEventListener('change', async (e) => {
    if (sel.value !== ADD_TONE) {
      last = sel.value;
      return;
    }
    e.stopImmediatePropagation();
    sel.value = last;
    const key = addCustomTone ? await addCustomTone() : null;
    sig = null;
    fill();
    if (key) {
      sel.value = chimeOptionValue(key);
      last = sel.value;
    }
  });
  sel.setTone = (key) => {
    fill();
    sel.value = chimeOptionValue(key);
    last = sel.value;
  };
  return sel;
}

function resetCalendarForm() {
  if (!cachedFormRefs) return;
  const { textInput, timeInput, syncRange, untilInput, tagPicker, repeatPicker, untilField, soundInput, notifyInput, rule, notes, secondSel } =
    cachedFormRefs;
  notifyInput.setLead(null);
  rule.reset();
  notes.value = '';
  secondSel.setLead(null);
  textInput.value = '';
  timeInput.value = '';
  syncRange();
  untilInput.value = '';
  soundInput.value = '';
  tagPicker.set('personal');
  repeatPicker.set('none');
  untilField.style.display = 'none';
}

function buildForm() {
  const textInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'Add a reminder…',
    'aria-label': 'Reminder text',
    // The column's own width (calendar_reminders.text is 255).
    maxlength: 255,
  });
  const timeInput = h('input', {
    type: 'time',
    class: 'gb-input gb-input--time',
    'aria-label': 'Reminder time (optional)',
  });
  const endInput = h('input', {
    type: 'time',
    class: 'gb-input gb-input--time',
    'aria-label': 'End time (optional, makes it a busy block)',
  });
  const range = TimeRange(timeInput, endInput);
  const textErr = requiredError(textInput);

  const tagPicker = TagPicker('personal');

  /* This reminder's own tone. An empty value is not "silent" — it means "use my
     default from Settings", so a reminder nobody thought about keeps following
     that setting when it changes. A <select> rather than the segmented control
     the Alerts pane uses: six options don't fit the side panel's width, and the
     native one already scrolls, keyboards and reads out. */
  // 'Silent' means no sound anywhere now: the app plays nothing on this key
  // and push.js queues no device alarm for it, because Android has no
  // soundless channel to queue one against.
  const soundInput = toneSelect('Silent — no alert');
  // Picking one is the preview, the same rule as the Alerts pane. Nothing plays
  // for 'Default tone': this file doesn't know which tone that is, and guessing
  // the built-in default would preview a sound the reminder won't make.
  soundInput.addEventListener('change', () => {
    if (soundInput.value) playChime(soundInput.value);
  });
  const notifyInput = notifySelect();

  const untilInput = h('input', {
    type: 'date',
    class: 'gb-input gb-input--until',
    'aria-label': 'Repeat until (optional)',
  });
  const untilError = h('p', {
    class: 'gb-field-error',
    role: 'alert',
    style: { display: 'none' },
  });
  const setUntilError = (msg) => {
    untilError.textContent = msg || '';
    untilError.style.display = msg ? '' : 'none';
    untilInput.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  // Typing a new date is the user answering the complaint; drop it then rather
  // than leaving a stale red line under a value that's now fine.
  untilInput.addEventListener('input', () => setUntilError(''));
  const untilField = h(
    'div',
    { class: 'gb-until-field', style: { display: 'none' } },
    h('div', { class: 'gb-field-label' }, 'Repeat until (optional)'),
    untilInput,
    untilError
  );

  const rule = RuleExtras();
  const notes = notesInput('');
  const secondSel = secondAlertSelect();
  const repeatPicker = RepeatPicker('none', (rep) => {
    rule.sync(rep, formBinding.selectedDate);
    untilField.style.display = rep === 'none' ? 'none' : '';
    if (rep === 'none') {
      untilInput.value = '';
      setUntilError('');
    }
  });

  async function submit() {
    const text = textInput.value.trim();
    if (!text) {
      textErr.set('Write what to be reminded of first.');
      textInput.focus();
      return;
    }
    const repeat = repeatPicker.get();
    // untilInput.min is set to the selected date on every render, but `min` on a
    // date input is only a *declared* constraint: nothing checks it unless the
    // input sits in a <form> that submits, and this one doesn't. So an end date
    // before the start — a mistyped year, usually — reached the API and was
    // stored as a recurring reminder that can never occur.
    // This was reportValidity(), which does enforce `min` and returns false, so
    // the reminder was correctly refused — silently. The native bubble it draws
    // needs the input focused and dismisses itself the moment anything else
    // takes focus, so from the outside the button just did nothing, which reads
    // as a dead button rather than a rejected date. Say it in the page instead.
    // Both are YYYY-MM-DD, so < is a date comparison (same trick as money.js).
    setUntilError('');
    if (!range.check()) return;
    if (repeat !== 'none' && untilInput.value && untilInput.value < formBinding.selectedDate) {
      setUntilError('This is before the reminder starts on ' + prettyDate(formBinding.selectedDate) + '.');
      untilInput.focus();
      return;
    }
    const until = repeat !== 'none' ? untilInput.value || '' : '';
    const cb = formBinding.onAddReminder;
    if (typeof cb !== 'function') {
      return;
    }
    addBtn.disabled = true;
    try {
      await cb(
        formBinding.selectedDate,
        text,
        timeInput.value || '',
        tagPicker.get(),
        repeat,
        until,
        soundInput.value || '',
        endInput.value || '',
        notifyInput.getLead(),
        Object.assign(
          {
            notes: notes.value.trim() || null,
            notifyBefore2: secondSel.getLead(),
          },
          repeat !== 'none' ? rule.get() : null
        )
      );
    } finally {
      addBtn.disabled = false;
    }
  }

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  const addBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary gb-rem-add', onclick: submit },
    Icon('plus', { size: 18, sw: 2.6, color: 'var(--fg-on-brand)' }),
    'Add reminder'
  );

  /* Say it all at once — "every Monday at 7 to 7:30 call mom, ten minutes
     before" — and every field it named is filled in, the day included (the
     calendar moves to it). Nothing is added until they tap Add: what they see
     is what they're agreeing to. Without the assistant, the words alone go in. */
  const voiceNote = h('p', { class: 'gb-field-hint gb-voice-note', role: 'status', style: { display: 'none' } });
  const fillFromSpeech = (said, rem) => {
    textErr.set('');
    if (!rem) {
      textInput.value = said;
      voiceNote.textContent = 'Heard: “' + said + '”. Set the time and day, then tap Add.';
      voiceNote.style.display = '';
      textInput.focus();
      return;
    }
    const hm = (v) => (v ? String(v).slice(0, 5) : '');
    // The day first: the repeat rule reads it as it is set ("weekly" takes its
    // weekday from the selected day), and filling it while the calendar was
    // still on today stored a Monday gym as a Saturday one. The panel's repaint
    // sets the same value again a moment later.
    const prevDay = formBinding.selectedDate;
    if (rem.date) formBinding.selectedDate = rem.date;
    textInput.value = rem.text || said;
    timeInput.value = hm(rem.time);
    endInput.value = hm(rem.endTime);
    range.sync();
    tagPicker.set(rem.tag || 'personal');
    repeatPicker.set(rem.repeat || 'none');
    // From scratch: a weekday chip left on from an earlier reminder would
    // otherwise stay picked, and "every Monday" would also ring on that day.
    rule.set({ repeat: rem.repeat || 'none', date: formBinding.selectedDate, repeatInterval: 1 });
    untilInput.value = rem.repeat && rem.repeat !== 'none' ? rem.until || '' : '';
    notifyInput.setLead(rem.notifyBefore === undefined ? null : rem.notifyBefore);
    const filled = ['the text'];
    if (rem.date && rem.date !== prevDay) filled.push('the day');
    if (rem.time) filled.push('the time');
    if (rem.repeat && rem.repeat !== 'none') filled.push('the repeat');
    if (rem.notifyBefore) filled.push('the alert');
    voiceNote.textContent =
      'Filled in ' + filled.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' from what you said. Check it, then tap Add.';
    voiceNote.style.display = '';
    // Moving the day repaints the panel, and a repaint waits while a field in
    // it has focus, so the caret only goes back when the day stays put.
    if (rem.date && rem.date !== prevDay && formBinding.onSelectDate) {
      formBinding.onSelectDate(rem.date);
    } else {
      textInput.focus();
    }
  };
  const micBtn =
    voiceReminder && voiceReminder.supported()
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--compact gb-mic gb-rem-mic',
            'aria-label': 'Say the reminder',
            'aria-pressed': 'false',
            title: 'Say it: “every Monday at 7pm call mom, 10 minutes before”',
            onclick: async () => {
              voiceNote.style.display = 'none';
              const out = await voiceReminder.capture(micBtn);
              if (out && out.said) fillFromSpeech(out.said, out.reminder);
            },
          },
          Icon('mic', { size: 18 })
        )
      : null;
  textInput.addEventListener('input', () => {
    voiceNote.style.display = 'none';
  });

  const node = Card({
    className: 'gb-rem-form',
    children: [
      h('div', { class: 'gb-field-label' }, 'New reminder'),
      micBtn ? h('div', { class: 'gb-rem-text-row' }, textInput, micBtn) : textInput,
      textErr.node,
      voiceNote,
      h('div', { class: 'gb-field-label' }, 'Notes'),
      notes,
      h('div', { class: 'gb-field-label' }, 'Notify'),
      notifyInput,
      h('div', { class: 'gb-field-label' }, 'Second alert'),
      secondSel,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-login-link gb-rem-defaults-link',
          onclick: () => openReminderSettings && openReminderSettings(),
        },
        'Default and snooze length, and all your reminders, in Settings'
      ),
      h('div', { class: 'gb-field-label' }, 'Time'),
      range.node,
      h('p', { class: 'gb-field-hint' }, 'Add an end time to block it out as busy on the day.'),
      h('div', { class: 'gb-field-label' }, 'Tag'),
      tagPicker.node,
      h('div', { class: 'gb-field-label' }, 'Repeat'),
      repeatPicker.node,
      rule.node,
      untilField,
      h('div', { class: 'gb-field-label' }, 'Tone'),
      soundInput,
      addBtn,
    ],
  });

  return {
    node,
    refs: {
      textInput,
      timeInput,
      endInput,
      syncRange: range.sync,
      untilInput,
      tagPicker,
      repeatPicker,
      untilField,
      soundInput,
      notifyInput,
      rule,
      notes,
      secondSel,
    },
  };
}

/* ---- Reminder list + add form for the selected day ---- */
function ReminderPanel({
  selectedDate,
  reminders,
  tasks,
  goals,
  wellness,
  foodSummary,
  dayFoodLoading,
  dayFoodError,
  whatsappEnabled,
  onRetryFood,
  onAddReminder,
  onDeleteReminder,
  onEditReminder,
  onCancelSnooze,
  onToggleDone,
  onSelectDate,
  onSaveRoutine,
}) {
  const list = remindersOn(reminders, selectedDate);
  const dayTasks = tasksOn(tasks, selectedDate);
  const dayCompletedTasks = completedTasksOn(tasks, selectedDate);
  const dayGoalActions = goalActionsOn(goals, selectedDate);
  const daySleep = wellness && wellness.sleepByDate ? wellness.sleepByDate[selectedDate] : null;
  const dayMood = wellness && wellness.moodByDate ? wellness.moodByDate[selectedDate] : null;
  const dayFood = foodSummary && Array.isArray(foodSummary.entries) ? foodSummary.entries : [];
  const wellnessCount = (daySleep ? 1 : 0) + (dayMood ? 1 : 0);
  const winCount =
    dayCompletedTasks.length + dayGoalActions.length + dayFood.length + wellnessCount;
  const futureDate = isFutureKey(selectedDate);
  // A day that has already gone is read-only. The form used to sit under every
  // day, so a reminder could be filed against last Tuesday and then never fire.
  const pastDate = selectedDate < todayKey();

  // Rebind the form to the latest date + callback (DOM stays the same).
  formBinding.selectedDate = selectedDate;
  formBinding.onAddReminder = onAddReminder;
  formBinding.onSelectDate = onSelectDate;
  if (!cachedForm) {
    const built = buildForm();
    cachedForm = built.node;
    cachedFormRefs = built.refs;
  }
  cachedFormRefs.untilInput.min = selectedDate;
  // The rule's labels ("the 2nd Tuesday") are about the day the form is on.
  cachedFormRefs.rule.sync(cachedFormRefs.repeatPicker.get(), selectedDate);
  cachedFormRefs.repeatPicker.relabel();
  applyPendingReminderText();
  const form = cachedForm;

  let listNode;
  if (list.length) {
    listNode = Card({
      children: list.map((r) =>
        ReminderRow(r, selectedDate, onDeleteReminder, whatsappEnabled, onEditReminder, onCancelSnooze, onToggleDone)
      ),
    });
  } else {
    listNode = futureDate
      ? null
      : h(
          'div',
          { class: 'gb-rem-empty' },
          Icon('calendar-check', { size: 28, color: 'var(--fg3)' }),
          h('p', null, pastDate ? 'No reminders on this day.' : 'No reminders yet. Add one below.')
        );
  }

  let tasksNode;
  if (dayTasks.length) {
    tasksNode = Card({
      children: dayTasks.map((t) =>
        h(
          'div',
          { class: 'gb-day-row' },
          h(
            'div',
            { class: 'gb-day-row-main' },
            h('div', { class: 'gb-day-row-title' }, t.title),
            h(
              'div',
              { class: 'gb-day-row-sub' },
              prettyTaskTime(t.dueAt) + (t.done ? ' · done' : '')
            )
          ),
          t.done ? h('span', { class: 'gb-day-pill is-done' }, 'Done') : null
        )
      ),
    });
  } else {
    tasksNode = futureDate
      ? null
      : h('div', { class: 'gb-day-empty' }, 'No due tasks for this day.');
  }

  let foodNode;
  if (dayFoodLoading && !dayFood.length) {
    foodNode = h('div', { class: 'gb-day-empty' }, 'Loading food entries...');
  } else if (dayFoodError && !dayFood.length) {
    foodNode = h(
      'div',
      { class: 'gb-day-empty gb-day-empty--error' },
      h('div', { class: 'gb-day-empty-msg' }, dayFoodError),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-day-retry',
          onclick: () => onRetryFood(selectedDate),
        },
        'Retry'
      )
    );
  } else if (dayFood.length) {
    foodNode = Card({
      children: dayFood.map((f) =>
        h(
          'div',
          { class: 'gb-day-row' },
          h(
            'div',
            { class: 'gb-day-row-main' },
            h('div', { class: 'gb-day-row-title' }, f.foodName),
            h(
              'div',
              { class: 'gb-day-row-sub' },
              f.quantityGrams + 'g · ' + f.kcalEstimated + ' kcal'
            )
          ),
          h('span', { class: 'gb-day-pill' }, f.mealType || 'meal')
        )
      ),
    });
  } else {
    foodNode = h('div', { class: 'gb-day-empty' }, 'No food logged for this day.');
  }

  const winItems = [];
  dayCompletedTasks
    .slice(0, 3)
    .forEach((t) =>
      winItems.push({ icon: 'check-circle-2', title: t.title, sub: 'Task completed' })
    );
  dayGoalActions
    .slice(0, 3)
    .forEach((a) => winItems.push({ icon: 'target', title: a.note, sub: 'Progress on ' + a.goal }));
  if (daySleep)
    winItems.push({
      icon: 'moon',
      title: (daySleep.bedtime || '--') + ' to ' + (daySleep.wakeTime || '--'),
      sub: 'Sleep logged',
    });
  if (dayMood)
    winItems.push({
      icon: 'smile-plus',
      title: dayMood.mood + ' mood, ' + dayMood.energy + ' energy',
      sub: 'Mood check-in',
    });
  dayFood.slice(0, 2).forEach((f) =>
    winItems.push({
      icon: 'utensils',
      title: f.foodName,
      sub: (f.kcalEstimated || 0) + ' kcal logged',
    })
  );
  const winsNode = winCount
    ? Card({
        className: 'gb-wins-card',
        children: [
          h(
            'div',
            { class: 'gb-wins-score' },
            h('span', { class: 'gb-wins-number' }, String(winCount)),
            h(
              'span',
              { class: 'gb-wins-copy' },
              winCount === 1 ? 'win saved for this day' : 'wins saved for this day'
            )
          ),
          h(
            'div',
            { class: 'gb-wins-list' },
            winItems
              .slice(0, 6)
              .map((item) =>
                h(
                  'div',
                  { class: 'gb-wins-row' },
                  h('span', { class: 'gb-wins-icon' }, Icon(item.icon, { size: 15, sw: 2.4 })),
                  h(
                    'span',
                    { class: 'gb-wins-text' },
                    h('span', { class: 'gb-wins-title' }, item.title),
                    h('span', { class: 'gb-wins-sub' }, item.sub)
                  )
                )
              )
          ),
        ],
      })
    : h(
        'div',
        { class: 'gb-wins-empty' },
        Icon('sparkles', { size: 24, color: 'var(--fg3)' }),
        h('p', null, 'No wins saved here yet. Finish a task, log food, or add a goal action.')
      );

  const totalCount = list.length + dayTasks.length + (!futureDate ? dayFood.length : 0);
  const futurePlanningHint =
    futureDate && !dayTasks.length && !list.length
      ? h(
          'div',
          { class: 'gb-future-note' },
          Icon('calendar-plus', { size: 18, color: 'var(--brand)' }),
          h('span', null, 'This day is open. Add a task or reminder when you are ready.')
        )
      : null;
  /* Two blocks inside one node: the day's reminders (with the add form and the
     schedule) and its record (wins, tasks, food). One node because app.js
     repaints this panel in place by swapping .gb-cal-side; display: contents
     on it lets the page grid place the two blocks apart — reminders top right,
     the record under the month on desktop, and reminders straight after the
     month on a phone, ahead of the record. */
  return h(
    'div',
    { class: 'gb-cal-side' },
    h(
      'div',
      { class: 'gb-cal-col gb-cal-reminders' },
      h(
        'div',
        { 'data-cal-section': 'title' },
        SectionTitle({
          title: prettyDate(selectedDate),
          action: totalCount ? totalCount + (totalCount === 1 ? ' item' : ' items') : null,
        })
      ),
    futurePlanningHint,
      h(
        'div',
        { class: 'gb-cal-block gb-day-section', 'data-cal-section': 'reminders' },
        h(
          'div',
          { class: 'gb-day-head' },
          h('span', { class: 'gb-day-head-title' }, 'Reminders'),
          h('span', { class: 'gb-day-head-count' }, String(list.length))
        ),
        listNode
      ),
    pastDate ? null : h('div', { class: 'gb-cal-block' }, form),
      ScheduleSection(reminders, list, selectedDate, onSelectDate, onSaveRoutine)
    ),
    h(
      'div',
      { class: 'gb-cal-col gb-cal-daylog' },
      !futureDate
        ? h(
            'div',
            { class: 'gb-cal-block gb-day-section', 'data-cal-section': 'wins' },
            h(
              'div',
              { class: 'gb-day-head' },
              // Not "Past wins": this shows for today too, and today isn't past.
              h('span', { class: 'gb-day-head-title' }, 'Wins'),
              h('span', { class: 'gb-day-head-count' }, String(winCount))
            ),
            winsNode
          )
        : null,
      h(
        'div',
        { class: 'gb-cal-block gb-day-section', 'data-cal-section': 'tasks' },
        h(
          'div',
          { class: 'gb-day-head' },
          h('span', { class: 'gb-day-head-title' }, 'Tasks'),
          h('span', { class: 'gb-day-head-count' }, String(dayTasks.length))
        ),
        tasksNode
      ),
      !futureDate
        ? h(
            'div',
            { class: 'gb-cal-block gb-day-section', 'data-cal-section': 'food' },
            h(
              'div',
              { class: 'gb-day-head' },
              h('span', { class: 'gb-day-head-title' }, 'Food'),
              h('span', { class: 'gb-day-head-count' }, String(dayFood.length))
            ),
            foodNode,
            foodSummary && typeof foodSummary.totalCalories === 'number'
              ? h('div', { class: 'gb-day-total' }, 'Total: ' + foodSummary.totalCalories + ' kcal')
              : null
          )
        : null,
    )
  );
}

function ScreenCalendar({
  year,
  month,
  selectedDate,
  reminders,
  tasks,
  goals,
  wellness,
  foodSummary,
  dayFoodLoading,
  dayFoodError,
  whatsappEnabled,
  onPrevMonth,
  onNextMonth,
  onToday,
  onSelectDate,
  onRetryFood,
  onAddReminder,
  onDeleteReminder,
  onEditReminder,
  onCancelSnooze,
  onToggleDone,
  onSaveRoutine,
}) {
  const toolbar = CalendarToolbar({
    year,
    month,
    reminders,
    tasks,
    onPrevMonth,
    onNextMonth,
    onToday,
  });

  return h(
    'div',
    { class: 'gb-rise gb-cal' },
    h(
      'div',
      { class: 'gb-cal-col gb-cal-main' },
      toolbar,
      h(
        'div',
        { class: 'gb-cal-block' },
        MonthGrid({ year, month, selectedDate, reminders, onSelectDate })
      ),
      h(
        'div',
        // Says what it is: as a bare row of coloured labels it read as the tag
        // filter, and people tapped it.
        { class: 'gb-cal-block gb-cal-legend', role: 'note', 'aria-label': 'Dot colours' },
        h('span', { class: 'gb-legend-title', 'aria-hidden': 'true' }, 'Dot colours'),
        TAG_ORDER.map((tag) =>
          h(
            'span',
            { class: 'gb-legend-item' },
            h('span', { class: 'gb-legend-dot', style: { background: TAGS[tag].color } }),
            TAGS[tag].label
          )
        )
      )
    ),
    ReminderPanel({
      selectedDate,
      reminders,
      tasks,
      goals,
      wellness,
      foodSummary,
      dayFoodLoading,
      dayFoodError,
      whatsappEnabled,
      onRetryFood,
      onAddReminder,
      onDeleteReminder,
      onEditReminder,
      onCancelSnooze,
      onToggleDone,
      onSelectDate,
      onSaveRoutine,
    })
  );
}

function CalendarToolbar({ year, month, reminders, tasks, onPrevMonth, onNextMonth, onToday }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let monthCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    monthCount += remindersOn(reminders, keyOf(year, month, d)).length;
  }
  const monthTasks = (tasks || []).filter((t) => {
    const dt = new Date(t.dueAt || '');
    return !Number.isNaN(dt.getTime()) && dt.getFullYear() === year && dt.getMonth() === month;
  }).length;
  monthCount += monthTasks;

  return h(
    'div',
    { class: 'gb-cal-block gb-cal-toolbar' },
    h(
      'div',
      { class: 'gb-cal-monthbar' },
      h(
        'div',
        { class: 'gb-cal-monthnav' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-iconbtn',
            'aria-label': 'Previous month',
            onclick: onPrevMonth,
          },
          Icon('chevron-left', { size: 20 })
        ),
        h(
          'div',
          { class: 'gb-cal-monthlabel' },
          h('span', { class: 'm' }, MONTHS[month]),
          h('span', { class: 'y' }, String(year))
        ),
        h(
          'button',
          { type: 'button', class: 'gb-iconbtn', 'aria-label': 'Next month', onclick: onNextMonth },
          Icon('chevron-right', { size: 20 })
        )
      ),
      // Beside the month it jumps: on a phone it used to take a row of its own.
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--secondary gb-cal-today', onclick: onToday },
        'Today'
      )
    ),
    monthCount
      ? h(
          'div',
          { class: 'gb-cal-toolbar-actions' },
          Pill({
            icon: 'bell',
            label: plural(monthCount, 'item') + ' this month',
            bg: 'var(--brand-soft)',
            fg: 'var(--brand-soft-fg)',
          })
        )
      : null
  );
}

export {
  isPastSlot,
  freeBusy,
  wholeHours,
  timeRangeOk,
  reminderEditPatch,
  setRoutine,
  setDefaultLead,
  getDefaultLead,
  setReminderSettingsOpener,
  setCustomToneAdder,
  setVoiceReminder,
  notifySelect as NotifySelect,
  LEAD_OPTIONS,
  leadLabel,
  minutesLabel,
  REPEATS,
  REPEAT_ORDER,
  TAGS,
  ScreenCalendar,
  CalendarToolbar as RenderCalendarToolbar,
  ReminderPanel as RenderCalendarSide,
  MonthGrid as RenderCalendarGrid,
  resetCalendarForm,
  prefillCalendarReminder,
  snoozeLabel,
  describeRepeat,
};
