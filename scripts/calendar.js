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

/* 24h 'HH:MM' → '9:00 PM'. */
function formatTime(t) {
  const [hStr, mStr] = t.split(':');
  let hh = parseInt(hStr, 10);
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12;
  if (hh === 0) hh = 12;
  return hh + ':' + mStr + ' ' + ampm;
}

function remindersOn(reminders, key) {
  return reminders
    .filter((r) => occursOn(r, key))
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
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
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
            prettyDate(key) + (todays.length ? ' — ' + plural(todays.length, 'reminder') : ''),
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
    children: [dowRow, h('div', { class: 'gb-cal-grid' }, cells)],
  });
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
function ReminderRow(rem, occKey, onDelete, whatsappEnabled) {
  const t = TAGS[rem.tag] || TAGS.other;
  const meta = [];
  if (rem.time) {
    meta.push(
      h(
        'span',
        { class: 'meta-item' },
        Icon('clock', { size: 13, color: 'var(--fg3)' }),
        formatTime(rem.time)
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

  function handleDelete() {
    if (rem.repeat && rem.repeat !== 'none') {
      openDeleteDialog(rem, occKey, onDelete);
    } else {
      onDelete('all', rem.id, occKey);
    }
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
    h(
      'button',
      {
        type: 'button',
        class: 'gb-rem-del',
        'aria-label': 'Delete reminder',
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
  const { textInput, timeInput, untilInput, tagPicker, repeatPicker, untilField, soundInput } =
    cachedFormRefs;
  textInput.value = '';
  timeInput.value = '';
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
      // 'Silent' is only silent in the app: Android takes a notification's sound
      // from its channel, and a reminder with no sound file falls back to the
      // phone's own. Say so here rather than let the label promise quiet.
      CHIMES.map((c) => h('option', { value: c.key }, c.key === 'off' ? 'Silent in the app' : c.label))
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
        soundInput.value || ''
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
      h('div', { class: 'gb-rem-inputs' }, textInput, timeInput),
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
    refs: { textInput, timeInput, untilInput, tagPicker, repeatPicker, untilField, soundInput },
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
      children: list.map((r) => ReminderRow(r, selectedDate, onDeleteReminder, whatsappEnabled)),
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
            h('span', { class: 'gb-day-head-title' }, 'Past wins'),
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
        { class: 'gb-cal-block gb-cal-legend' },
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
    h(
      'div',
      { class: 'gb-cal-toolbar-actions' },
      monthCount
        ? Pill({
            icon: 'bell',
            label: plural(monthCount, 'item') + ' this month',
            bg: 'var(--brand-soft)',
            fg: 'var(--brand-soft-fg)',
          })
        : null,
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--secondary gb-cal-today', onclick: onToday },
        'Today'
      )
    )
  );
}

export {
  isPastSlot,
  ScreenCalendar,
  CalendarToolbar as RenderCalendarToolbar,
  ReminderPanel as RenderCalendarSide,
  MonthGrid as RenderCalendarGrid,
  resetCalendarForm,
  prefillCalendarReminder,
};
