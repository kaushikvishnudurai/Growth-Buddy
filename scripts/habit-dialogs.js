/* =====================================================================
   Growth Buddy — habit dialogs (add / edit form, history panel, freeze calendar)
   A lazy chunk, loaded on the first tap that opens one (app.js
   habitDialogs()). Moved out of app.js intact, the same way as settings.js:
   what it uses from app.js arrives as a context object and is bound to the
   same names. Never import this statically from a boot module.
   ===================================================================== */
import {
  h,
  refreshIcons,
  Icon,
  DOMAIN,
  openOverlay,
  fieldRefusal,
  formatTime,
  rovingGroup,
} from './gb-kit.js';
import {
  habitStats,
  heatmapWeeks,
  canEditDay,
  pctLabel,
  daysFrom,
  isSlipRow,
  recentNotes,
  suggestReminderTime,
} from './habit-stats.js';
import { chimeOptionValue, chimeOptions, playChime } from './chime.js';

// Bound from app.js before every open (bind()), before any code below runs.
let state, announce, pushToast, toastError, toastSuccess, todayKey, reconcileStreakFreeze,
  isQuitHabit, freezeTokensLeft, api, habitNoteInput, refreshScoreLater, createHabit, updateHabit,
  forgetGoalHabitHistory, deleteHabit, reSyncDeviceAlarms, openModal, segmented, METRIC_LABEL,
  accountTodayKey, render;
export function bind(ctx) {
  ({
    state, announce, pushToast, toastError, toastSuccess, todayKey, reconcileStreakFreeze,
    isQuitHabit, freezeTokensLeft, api, habitNoteInput, refreshScoreLater, createHabit, updateHabit,
    forgetGoalHabitHistory, deleteHabit, reSyncDeviceAlarms, openModal, segmented, METRIC_LABEL,
    accountTodayKey, render,
  } = ctx);
}

/* ---- The freeze calendar ----
   Picking the day a freeze covers. protect/unprotect have always accepted any
   past date; the UI only ever sent today (the rest-day toggle) or yesterday
   (the at-risk prompt), so a miss from earlier in the week was unreachable.

   Days with no check-in row are simply absent from the history, so "missed" is
   the absence of a record, not a record saying so — the grid fills the month
   and marks whatever the server didn't mention. */
async function openFreezeCalendar() {
  const habits = (state.habits || []).filter((x) => x.active !== false);
  if (!habits.length) {
    toastError(new Error('Add a habit first.'), 'Nothing to freeze yet.');
    return;
  }

  let habit = habits[0];
  let cursor = new Date();
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let byDate = {};
  // The day the habit started. Days before it are blank, not missed.
  let since = '';

  const grid = h('div', { class: 'gb-freeze-cal' });
  const { sheet, close } = openOverlay({ label: 'Freeze a day', className: 'gb-freeze-modal' });

  /* Far enough back to cover the month on screen, not a fixed window. A flat
     ?days=120 only reached about four months, so paging further back returned
     nothing and painted a whole month as untouched — indistinguishable from a
     month genuinely missed. +31 so the first of the month is inside the range
     rather than exactly on its edge. */
  function daysBack() {
    const span = Math.ceil((Date.now() - cursor.getTime()) / 86400000);
    return Math.max(31, span + 31);
  }

  async function load() {
    grid.replaceChildren(h('div', { class: 'gb-freeze-loading' }, 'Loading…'));
    try {
      const res = await api(
        '/api/habits/' + encodeURIComponent(habit.id) + '/history?days=' + daysBack()
      );
      byDate = {};
      since = (res && res.since) || '';
      ((res && res.days) || []).forEach((r) => {
        byDate[r.date] = r;
      });
    } catch (err) {
      toastError(err, 'Could not load that habit.');
      byDate = {};
    }
    paint();
  }

  // One request at a time: a double tap on a missed day sent two /protect
  // calls before the first answered, and the grid hadn't repainted to say so.
  let toggling = false;
  async function toggleDay(key, row) {
    if (toggling) return;
    const covered = row && row.protectedDay;
    if (row && row.done) {
      toastError(new Error('That day is already done.'), 'Nothing to freeze.');
      return;
    }
    if (!covered && freezeTokensLeft() <= 0) {
      toastError(new Error('No freezes left this week.'), 'Out of freezes.');
      return;
    }
    toggling = true;
    try {
      const updated = await api(
        '/api/habits/' + encodeURIComponent(habit.id) + (covered ? '/unprotect' : '/protect'),
        { method: 'POST', body: JSON.stringify({ date: key }) }
      );
      state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
      habit = updated;
      reconcileStreakFreeze(updated);
      toastSuccess(covered ? 'Freeze returned to your wallet.' : 'Day covered by a freeze.');
      render();
      await load();
    } catch (err) {
      toastError(err, covered ? 'Could not undo that.' : 'Could not freeze that day.');
    } finally {
      toggling = false;
    }
  }

  function paint() {
    const today = todayKey();
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(h('div', { class: 'gb-mini-cal-day is-empty' }));
    for (let d = 1; d <= total; d++) {
      const key =
        year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const row = byDate[key];
      const future = key > today;
      const before = !!since && key < since;
      // Missed is "behind us and not done", not "has no row": unprotecting a day
      // leaves the row behind with done=false, and keying off its absence made a
      // refunded day render as though nothing had ever been missed.
      const done = !!(row && row.done);
      const frozen = !!(row && row.protectedDay);
      const cls =
        'gb-mini-cal-day gb-freeze-day' +
        (key === today ? ' is-today' : '') +
        (future || before ? ' is-future' : '') +
        (done ? ' is-done' : '') +
        (frozen ? ' is-frozen' : '') +
        (!future && !before && !done && !frozen ? ' is-missed' : '');
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: cls,
            disabled: future || before || !!(row && row.done),
            title: future
              ? 'Not yet'
              : before
                ? 'Before this habit existed'
              : row && row.done
                ? 'Done'
                : row && row.protectedDay
                  ? 'Frozen — tap to get the freeze back'
                  : 'Tap to cover this day with a freeze',
            onclick: () => toggleDay(key, row),
          },
          h('span', { class: 'num' }, String(d)),
          row && row.done
            ? Icon('check', { size: 11, sw: 3 })
            : row && row.protectedDay
              ? Icon('snowflake', { size: 11, sw: 2.6 })
              : null
        )
      );
    }

    const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const atCurrentMonth =
      year === new Date().getFullYear() && month === new Date().getMonth();
    grid.replaceChildren(
      h(
        'div',
        { class: 'gb-mini-cal-header' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-mini-cal-nav-btn',
            'aria-label': 'Previous month',
            onclick: () => {
              cursor = new Date(year, month - 1, 1);
              load();
            },
          },
          Icon('chevron-left', { size: 16, sw: 2.6 })
        ),
        h('div', { class: 'gb-mini-cal-month' }, monthLabel),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-mini-cal-nav-btn',
            'aria-label': 'Next month',
            // Nothing to protect ahead of today, so the walk stops here.
            disabled: atCurrentMonth,
            onclick: () => {
              cursor = new Date(year, month + 1, 1);
              load();
            },
          },
          Icon('chevron-right', { size: 16, sw: 2.6 })
        )
      ),
      h(
        'div',
        { class: 'gb-mini-cal-dow' },
        ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) =>
          h('div', { class: 'gb-mini-cal-dow-cell' }, d)
        )
      ),
      h('div', { class: 'gb-mini-cal-grid' }, ...cells),
      h(
        'div',
        { class: 'gb-mini-cal-legend' },
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot is-done' }),
          'Done'
        ),
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot is-frozen' }),
          'Frozen'
        ),
        h(
          'span',
          { class: 'gb-mini-cal-legend-item' },
          h('span', { class: 'dot is-missed' }),
          'Missed'
        )
      )
    );
    refreshIcons();
  }

  const picker = h(
    'div',
    { class: 'gb-freeze-habits' },
    habits.map((x) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-chip' + (x.id === habit.id ? ' is-on' : ''),
          'aria-pressed': x.id === habit.id ? 'true' : 'false',
          onclick: (e) => {
            habit = x;
            Array.from(picker.children).forEach((el) => {
              el.classList.remove('is-on');
              el.setAttribute('aria-pressed', 'false');
            });
            e.currentTarget.classList.add('is-on');
            e.currentTarget.setAttribute('aria-pressed', 'true');
            load();
          },
        },
        x.name
      )
    )
  );

  // Filtered, not passed straight through: Element.append() turns a null child
  // into the literal text "null", which is exactly what it printed above the
  // calendar for anyone with a single habit.
  sheet.append(
    ...[
      h(
        'div',
        { class: 'gb-modal-title' },
        Icon('snowflake', { size: 16, sw: 2.4 }),
        ' Freeze a day'
      ),
      h(
        'p',
        { class: 'gb-modal-sub' },
        'A freeze covers one missed day so the streak holds. Tap a day to spend one, tap it again to get it back.'
      ),
      habits.length > 1 ? picker : null,
      grid,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Done'),
    ].filter(Boolean)
  );
  refreshIcons();
  load();
}

function colorPicker(initial) {
  // Friendly palette mapped to token-aware hexes (so dark mode still reads OK).
  const swatches = [
    { v: '#F97316', name: 'orange' },
    { v: '#22C55E', name: 'green' },
    { v: '#0EA5E9', name: 'sky' },
    { v: '#6C5CE7', name: 'iris' },
    { v: '#E11D48', name: 'coral' },
    { v: '#EAB308', name: 'sun' },
  ];
  let selected = initial || '';
  const wrap = rovingGroup(
    h('div', { class: 'gb-color-pick', role: 'radiogroup', 'aria-label': 'Color' })
  );
  const dots = {};
  swatches.forEach((s) => {
    const dot = h('button', {
      type: 'button',
      class: 'gb-color-dot' + (s.v === selected ? ' is-on' : ''),
      style: { background: s.v },
      role: 'radio',
      'aria-label': s.name,
      'aria-checked': String(s.v === selected),
      onclick: () => {
        selected = selected === s.v ? '' : s.v;
        for (const k in dots) {
          dots[k].classList.toggle('is-on', k === selected);
          dots[k].setAttribute('aria-checked', String(k === selected));
        }
      },
    });
    dots[s.v] = dot;
    wrap.appendChild(dot);
  });
  return { node: wrap, get: () => selected };
}

/* Fitness habits measure something. Picking one fills the name, the icon and
   what it records, so the common cases are one tap instead of three fields.
   'minutes' is the honest unit for a workout nobody measures in distance. */
const FITNESS_PRESETS = [
  { key: 'running', label: 'Running', name: 'Running', icon: 'footprints', metric: 'km' },
  { key: 'cycling', label: 'Cycling', name: 'Cycling', icon: 'bike', metric: 'km' },
  { key: 'walking', label: 'Walking', name: 'Walking', icon: 'footprints', metric: 'steps' },
  { key: 'workout', label: 'Workout', name: 'Workout', icon: 'dumbbell', metric: 'minutes' },
];

/* Starter templates on New habit: one tap fills the name, category, icon and
   (for a quit one) the kind, then the form is the user's to change. Icons must
   be in HabitService.HABIT_ICONS (HabitIconsTest reads this list). */
const HABIT_TEMPLATES = [
  { key: 'water', name: 'Drink water', domain: 'habit', icon: 'droplets' },
  { key: 'read', name: 'Read 20 min', domain: 'study', icon: 'book-open' },
  { key: 'walk', name: 'Walk 8k steps', domain: 'fitness', icon: 'footprints', metric: 'steps' },
  { key: 'nosugar', name: 'No sugar', domain: 'habit', icon: 'ban', kind: 'quit' },
  { key: 'meditate', name: 'Meditate', domain: 'habit', icon: 'leaf' },
];

const HEAT_LABEL = {
  done: 'done',
  frozen: 'covered by a freeze',
  missed: 'missed',
  open: 'not done',
  today: 'not done yet',
  before: 'before this habit started',
  future: 'not yet',
  // A quit ("break a habit") habit's days.
  clean: 'clean',
  slipped: 'slipped',
};

/* ---- A habit's history (Edit habit's top block) ----
   12 ISO weeks of done / missed / frozen days from GET /api/habits/{id}/history,
   plus the numbers habit-stats.js derives from the same rows: completion over
   30 days and since it started, and the best streak in the cadence's unit.
   Today and the 7 days before it are buttons: a tap opens that day's popover
   (dayPopover) — tick / un-tick (a quit habit: log / undo a slip) and the
   day's note — saved through the ordinary check-in endpoint with its `date`
   (the server refuses a future day; a day before the habit existed is not
   offered). Under the legend, the last few days that carry a note. */
function habitHistoryPanel(habit) {
  const panel = h(
    'section',
    { class: 'gb-hh', 'aria-label': 'History' },
    h('div', { class: 'gb-hh-loading' }, 'Loading history…')
  );
  // Two years: "all time" for nearly everyone; past that the server's `since`
  // is the window's start and the label says so.
  const SPAN_DAYS = 730;
  let rows = [];
  let since = '';
  let clipped = false;
  let busy = false;

  async function load() {
    try {
      const res = await api(
        '/api/habits/' + encodeURIComponent(habit.id) + '/history?days=' + SPAN_DAYS
      );
      rows = (res && res.days) || [];
      since = (res && res.since) || '';
      clipped = !!since && daysFrom(since, accountTodayKey()) >= SPAN_DAYS;
      paint();
    } catch (_) {
      panel.replaceChildren(
        h('div', { class: 'gb-hh-loading' }, 'Could not load this habit’s history.')
      );
    }
  }

  // The day whose popover is open (tick or slip + its note), or null.
  let openDay = null;

  function isDone(row) {
    // A quit habit's day is "done" (clean) unless its row is a slip.
    return isQuitHabit(habit) ? !isSlipRow(row) : !!(row && row.done);
  }

  /* Save one day: its done state (on a quit habit, done = false is the slip)
     and, when given, its note. Optimistic: painted first, rolled back on a
     failure. A note alone on a missed day of a build habit is a not-done row
     with a note — no tick, no XP. */
  async function saveDay(key, nextDone, note) {
    if (busy) return;
    const prev = rows;
    const row = rows.find((r) => r.date === key);
    const changed = nextDone !== isDone(row);
    busy = true;
    rows = rows
      .filter((r) => r.date !== key)
      .concat({
        date: key,
        done: nextDone,
        protectedDay: nextDone || isQuitHabit(habit) ? false : !!(row && row.protectedDay),
        note: note != null ? note || null : row ? row.note : null,
      });
    paint();
    try {
      const body = { date: key, done: nextDone };
      if (note != null) body.note = note;
      const updated = await api('/api/habits/' + encodeURIComponent(habit.id) + '/checkin', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (updated && updated.id) {
        state.habits = state.habits.map((x) => (x.id === updated.id ? updated : x));
        reconcileStreakFreeze(updated);
        habit = updated;
      }
      forgetGoalHabitHistory(habit.id);
      let what;
      if (isQuitHabit(habit)) what = nextDone ? 'Slip taken back on ' : 'Slip logged on ';
      else what = nextDone ? 'Ticked ' : 'Un-ticked ';
      announce(changed ? what + fmtDayKey(key) + '.' : 'Note saved for ' + fmtDayKey(key) + '.');
      // Today's tick moves the ring; an earlier day only the streak.
      if (changed && key === accountTodayKey()) refreshScoreLater();
      render();
      reSyncDeviceAlarms();
    } catch (err) {
      rows = prev;
      toastError(err, 'Could not update that day.');
    } finally {
      busy = false;
      paint();
      // The repaint replaced the button that had focus; put it back on that day.
      const again = panel.querySelector('[data-hh-day="' + key + '"]');
      if (again) again.focus();
    }
  }

  function fmtDayKey(key) {
    return new Date(key + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  /* The open day's popover: its state, the tick (or slip) button and its note. */
  function dayPopover(key, dayState) {
    const quit = isQuitHabit(habit);
    const row = rows.find((r) => r.date === key);
    const done = isDone(row);
    const note = habitNoteInput(row && row.note);
    let toggleLabel;
    let toggleIcon;
    if (quit) {
      toggleLabel = done ? 'Log a slip' : 'Undo the slip';
      toggleIcon = done ? 'ban' : 'undo-2';
    } else {
      toggleLabel = done ? 'Un-tick' : 'Mark done';
      toggleIcon = done ? 'undo-2' : 'check';
    }
    return h(
      'div',
      { class: 'gb-hh-pop', role: 'group', 'aria-label': fmtDayKey(key) },
      h(
        'div',
        { class: 'gb-hh-pop-head' },
        h('span', null, fmtDayKey(key) + ' · ' + HEAT_LABEL[dayState]),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-icon-btn',
            'aria-label': 'Close this day',
            onclick: () => {
              openDay = null;
              paint();
              const cell = panel.querySelector('[data-hh-day="' + key + '"]');
              if (cell) cell.focus();
            },
          },
          Icon('x', { size: 16, sw: 2.4 })
        )
      ),
      note,
      h(
        'div',
        { class: 'gb-hh-pop-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn ' + (quit && done ? 'gb-btn--soft' : 'gb-btn--primary'),
            disabled: busy,
            onclick: () => saveDay(key, !done, note.value.trim()),
          },
          Icon(toggleIcon, { size: 15, sw: 2.4 }),
          toggleLabel
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft',
            disabled: busy,
            onclick: () => saveDay(key, done, note.value.trim()),
          },
          'Save note'
        )
      )
    );
  }

  function paint() {
    const today = accountTodayKey();
    const cadence = habit.cadence || 'daily';
    const kind = isQuitHabit(habit) ? 'quit' : 'build';
    const quit = kind === 'quit';
    const stats = habitStats({
      days: rows,
      since,
      today,
      cadence,
      targetPerWeek: habit.targetPerWeek,
      kind,
    });
    // The server's longest only grows, and remembers runs older than this window.
    const best = Math.max(stats.best, Number(habit.longestStreak) || 0);
    const weeks = heatmapWeeks({ days: rows, since, today, cadence, kind });
    let openState = null;
    const grid = h(
      'div',
      { class: 'gb-hh-grid', role: 'group', 'aria-label': 'Last 12 weeks' },
      weeks.map((w) =>
        h(
          'div',
          { class: 'gb-hh-week' },
          w.cells.map((c) => {
            const editable = canEditDay(c.date, { today, since });
            const label = fmtDayKey(c.date) + ': ' + HEAT_LABEL[c.state];
            const cls = 'gb-hh-day is-' + c.state + (c.date === today ? ' is-now' : '');
            if (editable && c.date === openDay) openState = c.state;
            return editable
              ? h('button', {
                  type: 'button',
                  class: cls + ' is-editable',
                  disabled: busy,
                  'aria-expanded': String(c.date === openDay),
                  'data-hh-day': c.date,
                  'aria-label':
                    label + '. Tap to ' + (quit ? 'log a slip' : 'tick') + ' or add a note',
                  title: label,
                  onclick: () => {
                    openDay = openDay === c.date ? null : c.date;
                    paint();
                    const again = panel.querySelector('[data-hh-day="' + c.date + '"]');
                    if (again) again.focus();
                  },
                })
              : h('span', { class: cls, role: 'img', 'aria-label': label, title: label });
          })
        )
      )
    );
    const unit = stats.unit === 'week' ? 'week' : 'day';
    const stat = (value, label) =>
      h(
        'div',
        { class: 'gb-hh-stat' },
        h('span', { class: 'gb-hh-stat-val' }, value),
        h('span', { class: 'gb-hh-stat-label' }, label)
      );
    const legend = quit
      ? ['clean', 'slipped']
      : ['done', cadence === 'daily' ? 'missed' : 'open', 'frozen'];
    const notes = recentNotes({ days: rows, since, today, cadence, kind });
    let allLabel = clipped ? 'Last 2 years' : 'All time';
    if (quit) allLabel = 'Clean, ' + allLabel.toLowerCase();
    panel.replaceChildren(
      h(
        'div',
        { class: 'gb-hh-stats' },
        stat(pctLabel(stats.rate30), quit ? 'Clean, 30 days' : 'Last 30 days'),
        stat(pctLabel(stats.rateAll), allLabel),
        stat(String(best), quit ? 'Best clean run (days)' : 'Best streak (' + unit + 's)')
      ),
      grid,
      openState ? dayPopover(openDay, openState) : null,
      h(
        'div',
        { class: 'gb-hh-legend', 'aria-hidden': 'true' },
        legend.map((s) =>
          h(
            'span',
            { class: 'gb-hh-legend-item' },
            h('span', { class: 'gb-hh-day is-' + s }),
            s === 'open' ? 'Not done' : s === 'frozen' ? 'Freeze' : s[0].toUpperCase() + s.slice(1)
          )
        )
      ),
      h(
        'div',
        { class: 'gb-field-hint' },
        quit
          ? 'Tap any of the last 7 days to log or undo a slip, or add a note.'
          : 'Forgot to tick? Tap any of the last 7 days to tick it, un-tick it or add a note.'
      ),
      notes.length
        ? h(
            'ul',
            { class: 'gb-hh-notes', 'aria-label': 'Recent notes' },
            notes.map((n) =>
              h(
                'li',
                { class: 'gb-hh-note' },
                h('span', { class: 'gb-hh-day is-' + n.state, 'aria-hidden': 'true' }),
                h('span', { class: 'gb-hh-note-date' }, fmtDayKey(n.date)),
                h('span', null, n.note)
              )
            )
          )
        : null
    );
  }

  load();
  return panel;
}

function openHabitForm(habit) {
  const nameInput = h('input', {
    type: 'text',
    class: 'gb-input',
    placeholder: 'e.g. Meditate',
    maxlength: 120,
    value: habit ? habit.name : '',
  });
  // Assigned once the fields it toggles exist; segmented() takes its handler at
  // construction, and the preset row is built below.
  let syncDomain = () => {};
  const domain = segmented(
    [
      { value: 'habit', label: 'General' },
      { value: 'fitness', label: 'Fitness' },
      { value: 'study', label: 'Study' },
      { value: 'journal', label: 'Journal' },
    ],
    (habit && habit.domain) || 'habit',
    (d) => syncDomain(d)
  );
  // "N× a week" is the custom cadence: the server always had it (targetPerWeek,
  // weekly-bucket streaks), but the form offered only Daily and Weekly.
  const targetInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '1',
    max: '7',
    step: '1',
    inputmode: 'numeric',
    'aria-label': 'Times per week',
    value: String(habit && habit.cadence === 'custom' ? habit.targetPerWeek || 3 : 3),
  });
  const targetField = h(
    'div',
    { style: { display: habit && habit.cadence === 'custom' ? '' : 'none' } },
    h('div', { class: 'gb-field-label' }, 'Times per week'),
    targetInput
  );
  const cadence = segmented(
    [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'custom', label: 'N× a week' },
    ],
    (habit && habit.cadence) || 'daily',
    (c) => {
      targetField.style.display = c === 'custom' ? '' : 'none';
    }
  );
  // Pause keeps the habit and its history but takes it out of today's score,
  // Home's count and its reminders (Habit.active; the scheduler skips inactive).
  let paused = !!habit && habit.active === false;
  const pauseSwitch = habit
    ? h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': String(paused),
          'aria-label': 'Pause this habit',
          class: 'gb-switch' + (paused ? ' is-on' : ''),
          onclick: () => {
            paused = !paused;
            pauseSwitch.classList.toggle('is-on', paused);
            pauseSwitch.setAttribute('aria-checked', String(paused));
          },
        },
        h('span', { class: 'gb-switch-knob' })
      )
    : null;
  const color = colorPicker((habit && habit.color) || '');
  const reminderInput = h('input', {
    type: 'time',
    class: 'gb-input',
    value: habit && habit.reminderTime ? String(habit.reminderTime).slice(0, 5) : '',
  });
  const toneSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'Habit reminder tone' },
    [h('option', { value: '' }, 'Default tone')].concat(
      chimeOptions().map((c) =>
        h('option', { value: c.key }, c.key === 'off' ? 'Silent — no alert' : c.label)
      )
    )
  );
  if (habit) toneSel.value = chimeOptionValue(habit.sound);
  toneSel.addEventListener('change', () => {
    if (toneSel.value) playChime(toneSel.value);
  });

  let presetIcon = null;
  // A preset names the habit only if you haven't: it used to overwrite what you typed.
  let presetName = '';
  const metricSel = h(
    'select',
    { class: 'gb-input', 'aria-label': 'What this habit records' },
    Object.keys(METRIC_LABEL).map((k) => h('option', { value: k }, METRIC_LABEL[k]))
  );
  const metricField = h(
    'div',
    { style: { display: 'none' } },
    h('div', { class: 'gb-field-label' }, 'Records'),
    metricSel
  );
  const presetRow = h(
    'div',
    { class: 'gb-preset-row', style: { display: 'none' } },
    FITNESS_PRESETS.map((pre) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-preset',
          onclick: () => {
            const typed = nameInput.value.trim();
            if (!typed || typed === presetName) nameInput.value = presetName = pre.name;
            metricSel.value = pre.metric;
            presetIcon = pre.icon;
            for (const b of presetRow.children) b.classList.remove('is-on');
            presetRow.querySelector('[data-preset="' + pre.key + '"]').classList.add('is-on');
          },
          dataset: { preset: pre.key },
        },
        Icon(pre.icon, { size: 16, sw: 2.4 }),
        pre.label
      )
    )
  );
  // The presets and the unit only make sense for fitness; everything else is a
  // plain tick, which is what every habit was before this.
  syncDomain = (d) => {
    const fitness = d === 'fitness';
    presetRow.style.display = fitness ? '' : 'none';
    metricField.style.display = fitness ? '' : 'none';
    if (!fitness) {
      metricSel.value = 'none';
      presetIcon = null;
    }
  };
  if (habit) {
    syncDomain(domain.get());
    if (habit.domain === 'fitness') metricSel.value = habit.metric || 'none';
  }

  // Build (tick it) or break (quit: clean unless a slip is logged). Chosen at
  // creation only — the server refuses to turn ticks into slips — so editing
  // shows a line instead. A quit habit is daily and measures nothing.
  let kind = isQuitHabit(habit) ? 'quit' : 'build';
  const cadenceBlock = h(
    'div',
    null,
    h('div', { class: 'gb-field-label' }, 'Cadence'),
    cadence.node,
    targetField
  );
  const syncKind = (k) => {
    kind = k;
    const quit = k === 'quit';
    cadenceBlock.style.display = quit ? 'none' : '';
    nameInput.placeholder = quit ? 'e.g. No sugar' : 'e.g. Meditate';
    if (quit) {
      presetRow.style.display = 'none';
      metricField.style.display = 'none';
      metricSel.value = 'none';
    } else {
      syncDomain(domain.get());
    }
  };
  const kindSeg = habit
    ? null
    : segmented(
        [
          { value: 'build', label: 'Build a habit' },
          { value: 'quit', label: 'Break a habit' },
        ],
        kind,
        (k) => syncKind(k)
      );
  const DOMAIN_ORDER = ['habit', 'fitness', 'study', 'journal'];
  const templateRow = habit
    ? null
    : h(
        'div',
        { class: 'gb-preset-row', role: 'group', 'aria-label': 'Start from a template' },
        HABIT_TEMPLATES.map((t) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gb-preset',
              onclick: () => {
                nameInput.value = presetName = t.name;
                nameInput.setAttribute('aria-invalid', 'false');
                // Category first, then the kind: a quit kind hides what fitness showed.
                const di = DOMAIN_ORDER.indexOf(t.domain || 'habit');
                if (di >= 0) domain.node.children[di].click();
                kindSeg.node.children[t.kind === 'quit' ? 1 : 0].click();
                if (t.metric) metricSel.value = t.metric;
                // After the category click: syncDomain clears a non-fitness icon.
                presetIcon = t.icon;
              },
            },
            Icon(t.icon, { size: 16, sw: 2.4 }),
            t.name
          )
        )
      );
  // A category tap while breaking a habit must not bring the fitness presets back.
  const syncDomainOnly = syncDomain;
  syncDomain = (d) => {
    syncDomainOnly(d);
    if (kind === 'quit') syncKind('quit');
  };
  if (habit) syncKind(kind);

  const body = h(
    'div',
    { class: 'gb-form' },
    // Editing doubles as the habit's detail view: its history comes first.
    habit ? habitHistoryPanel(habit) : null,
    kindSeg ? kindSeg.node : null,
    templateRow ? h('div', { class: 'gb-field-label' }, 'Start from a template') : null,
    templateRow,
    isQuitHabit(habit)
      ? h(
          'div',
          { class: 'gb-field-hint' },
          'Breaking a habit: every day counts as clean unless you log a slip.'
        )
      : null,
    h('div', { class: 'gb-field-label' }, 'Name'),
    nameInput,
    h('div', { class: 'gb-field-label' }, 'Category'),
    domain.node,
    presetRow,
    metricField,
    h('div', { class: 'gb-field-label' }, 'Color (optional)'),
    color.node,
    cadenceBlock,
    h('div', { class: 'gb-field-label' }, 'Daily reminder (optional)'),
    reminderInput,
    h('div', { class: 'gb-field-label' }, 'Tone'),
    toneSel,
    pauseSwitch
      ? h(
          'div',
          { style: { display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' } },
          h('span', { style: { flex: 1 } }, 'Pause — keep it, but don’t count it or remind me'),
          pauseSwitch
        )
      : null
  );

  nameInput.addEventListener('input', () => nameInput.setAttribute('aria-invalid', 'false'));
  openModal({
    title: habit ? 'Edit habit' : 'New habit',
    body,
    primary: habit ? 'Save changes' : 'Add habit',
    danger: habit
      ? {
          label: 'Delete habit',
          onClick: () => deleteHabit(habit.id), // undoable: no confirm
        }
      : null,
    onPrimary: async () => {
      const name = nameInput.value.trim();
      if (!name) throw fieldRefusal(nameInput, 'Give the habit a name.');
      const d = domain.get();
      // Editing keeps the habit's own icon unless a preset or a new category says otherwise.
      const quit = kind === 'quit';
      const icon =
        presetIcon ||
        (habit && habit.domain === d && habit.icon) ||
        (quit ? 'ban' : DOMAIN[d] && DOMAIN[d].icon) ||
        'repeat';
      // A quit habit is daily whatever the hidden cadence control says.
      const cad = quit ? 'daily' : cadence.get();
      let targetPerWeek;
      if (cad === 'custom') {
        targetPerWeek = Number(targetInput.value);
        if (!Number.isInteger(targetPerWeek) || targetPerWeek < 1 || targetPerWeek > 7) {
          throw fieldRefusal(targetInput, 'Pick 1 to 7 times a week.');
        }
      }
      const fields = {
        name,
        domain: d,
        icon,
        cadence: cad,
        metric: d === 'fitness' && !quit ? metricSel.value : 'none',
        ...(targetPerWeek ? { targetPerWeek } : {}),
      };
      if (habit) {
        // On PUT a null field means "unchanged", so blanks are sent as '' and a
        // removed reminder as its own flag.
        await updateHabit(habit.id, {
          ...fields,
          color: color.get() || '',
          reminderTime: reminderInput.value || null,
          clearReminder: !reminderInput.value,
          sound: toneSel.value || '',
          active: !paused,
        });
        // Pausing or a new cadence changes what today's score counts.
        if (paused !== (habit.active === false) || cad !== (habit.cadence || 'daily')) {
          refreshScoreLater();
        }
        return;
      }
      const created = await createHabit({
        ...fields,
        kind,
        color: color.get() || null,
        reminderTime: reminderInput.value || null,
        sound: toneSel.value || null,
      });
      // No reminder picked: offer the time the user's other habits ring at, one
      // tap. A quit habit has nothing to be reminded to do.
      if (!reminderInput.value && !quit && created && created.id) {
        const at = suggestReminderTime(state.habits);
        pushToast('Remind you at ' + formatTime(at) + '?', 'info', 6000, {
          label: 'Remind me',
          run: () =>
            updateHabit(created.id, { reminderTime: at })
              .then(() => {
                render();
                toastSuccess('Reminder set for ' + formatTime(at) + '.');
              })
              .catch((err) => toastError(err, 'Could not set the reminder.')),
        });
      }
    },
  });
  // A new habit starts at its name. Editing opens on the history: focusing the
  // name scrolled it away and raised a phone keyboard over it.
  if (!habit) setTimeout(() => nameInput.focus(), 60);
}

export { openHabitForm, openFreezeCalendar };
