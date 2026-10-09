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
} from './recurrence.js';
import { CHIMES, playChime } from './chime.js';

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
      if (endInput.value && endInput.value <= timeInput.value) {
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
    maxlength: 120,
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
  const toneSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Reminder tone' },
    [h('option', { value: '' }, 'Default tone')].concat(
      CHIMES.map((c) =>
        h('option', { value: c.key }, c.key === 'off' ? 'Silent in the app' : c.label)
      )
    )
  );
  toneSel.value = rem.sound || '';
  toneSel.addEventListener('change', () => {
    if (toneSel.value) playChime(toneSel.value);
  });

  const repeats = rem.repeat && rem.repeat !== 'none';
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
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await onEdit(scope, rem.id, occKey, {
            text,
            time: timeInput.value || null,
            endTime: endInput.value || null,
            sound: toneSel.value || '',
          });
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
      h('div', { class: 'gb-field-label' }, 'Time'),
      range.node,
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

function ReminderRow(rem, occKey, onDelete, whatsappEnabled, onEdit) {
  const t = TAGS[rem.tag] || TAGS.other;
  const meta = [];
  if (rem.time) {
    meta.push(
      h(
        'span',
        { class: 'meta-item' },
        Icon('clock', { size: 13, color: 'var(--fg3)' }),
        formatTime(rem.time) + (rem.endTime ? ' to ' + formatTime(rem.endTime) : '')
      )
    );
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
  if (rem.repeat && rem.repeat !== 'none') {
    const reLabel =
      REPEATS[rem.repeat].label + (rem.until ? ' · until ' + prettyDate(rem.until) : '');
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
    { class: 'gb-rem-row', style: { '--tag-color': t.color } },
    h('span', { class: 'gb-rem-accent' }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'gb-rem-text' }, rem.text),
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
  selectedDate: '',
  onAddReminder: null,
};
let cachedForm = null;
let cachedFormRefs = null;

/* Text handed over from another screen ("make a reminder" on a note), held
   until the form exists — the caller switches screens, so the form is usually
   built a tick AFTER the prefill lands. */
let pendingReminderText = '';

function prefillCalendarReminder(text) {
  pendingReminderText = text || '';
  applyPendingReminderText();
}

function applyPendingReminderText() {
  if (!pendingReminderText || !cachedFormRefs) return;
  cachedFormRefs.textInput.value = pendingReminderText;
  pendingReminderText = '';
  setTimeout(() => cachedFormRefs.textInput.focus(), 60);
}

function resetCalendarForm() {
  if (!cachedFormRefs) return;
  const { textInput, timeInput, syncRange, untilInput, tagPicker, repeatPicker, untilField, soundInput } =
    cachedFormRefs;
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
    maxlength: 120,
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
  const soundInput = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Reminder tone' },
    [h('option', { value: '' }, 'Default tone')].concat(
      // 'Silent' means no sound anywhere now: the app plays nothing on this key
      // and push.js queues no device alarm for it, because Android has no
      // soundless channel to queue one against.
      CHIMES.map((c) => h('option', { value: c.key }, c.key === 'off' ? 'Silent — no alert' : c.label))
    )
  );
  // Picking one is the preview, the same rule as the Alerts pane. Nothing plays
  // for 'Default tone': this file doesn't know which tone that is, and guessing
  // the built-in default would preview a sound the reminder won't make.
  soundInput.addEventListener('change', () => {
    if (soundInput.value) playChime(soundInput.value);
  });

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

  const repeatPicker = RepeatPicker('none', (rep) => {
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
        endInput.value || ''
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

  const node = Card({
    className: 'gb-rem-form',
    children: [
      h('div', { class: 'gb-field-label' }, 'New reminder'),
      textInput,
      textErr.node,
      h('div', { class: 'gb-field-label' }, 'Time'),
      range.node,
      h('p', { class: 'gb-field-hint' }, 'Add an end time to block it out as busy on the day.'),
      h('div', { class: 'gb-field-label' }, 'Tag'),
      tagPicker.node,
      h('div', { class: 'gb-field-label' }, 'Repeat'),
      repeatPicker.node,
      untilField,
      h('div', { class: 'gb-field-label' }, 'Tone'),
      soundInput,
      addBtn,
    ],
  });

  return {
    node,
    refs: { textInput, timeInput, endInput, syncRange: range.sync, untilInput, tagPicker, repeatPicker, untilField, soundInput },
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
  if (!cachedForm) {
    const built = buildForm();
    cachedForm = built.node;
    cachedFormRefs = built.refs;
  }
  cachedFormRefs.untilInput.min = selectedDate;
  cachedFormRefs.repeatPicker.relabel();
  applyPendingReminderText();
  const form = cachedForm;

  let listNode;
  if (list.length) {
    listNode = Card({
      children: list.map((r) =>
        ReminderRow(r, selectedDate, onDeleteReminder, whatsappEnabled, onEditReminder)
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
  return h(
    'div',
    { class: 'gb-cal-col gb-cal-side' },
    h(
      'div',
      { 'data-cal-section': 'title' },
      SectionTitle({
        title: prettyDate(selectedDate),
        action: totalCount ? totalCount + (totalCount === 1 ? ' item' : ' items') : null,
      })
    ),
    futurePlanningHint,
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
    ScheduleSection(reminders, list, selectedDate, onSelectDate, onSaveRoutine),
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
    pastDate ? null : h('div', { class: 'gb-cal-block' }, form)
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
  setRoutine,
  ScreenCalendar,
  CalendarToolbar as RenderCalendarToolbar,
  ReminderPanel as RenderCalendarSide,
  MonthGrid as RenderCalendarGrid,
  resetCalendarForm,
  prefillCalendarReminder,
};
