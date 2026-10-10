/* =====================================================================
   Growth Buddy — Goals screen (short / mid / long term goals + actions)
   ===================================================================== */
import { h, Icon, Pill, openModal, shakeRefusal } from './gb-kit.js';
import {
  moveItem,
  renameMilestone,
  setMilestoneDue,
  milestoneDueState,
  liveLinkedIds,
} from './goal-milestones.js';

const HORIZON_LABEL = {
  short_term: 'Short Term',
  mid_term: 'Mid Term',
  long_term: 'Long Term',
};

const HORIZON_META = {
  short_term: { bg: 'var(--leaf-50)', fg: 'var(--leaf-700)', dot: 'var(--leaf-500)' },
  mid_term: { bg: 'var(--sun-50)', fg: 'var(--sun-700)', dot: 'var(--sun-500)' },
  long_term: { bg: 'var(--iris-50)', fg: 'var(--iris-700)', dot: 'var(--iris-500)' },
};

function fmtDate(value) {
  if (!value) return 'No target date';
  try {
    return new Date(value + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch (_) {
    return value;
  }
}

/* Today as YYYY-MM-DD in the account's timezone, which is what the server's
   UserClock checks an action date against. The device's own date disagreed
   with it for anyone whose phone and account zones differ (travel, an account
   left on UTC): the picker allowed a day the server then refused, or blocked
   one it would take. Set by ScreenGoals from the user; device date if unset. */
let userZone = '';
function todayKey() {
  if (userZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: userZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch (_) {
      /* unknown zone id: fall through to the device date */
    }
  }
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/* Whole days from today to a YYYY-MM-DD target (negative = past). */
function daysUntil(dateKey) {
  if (!dateKey) return null;
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const [ty, tm, td] = todayKey().split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/* Active goals first, soonest target first (no target after dated ones), then
   completed ones, most recently completed first. Newest-first within a tie,
   which is the order the server sends. */
function sortGoals(goals) {
  return (goals || [])
    .map((g, i) => ({ g, i }))
    .sort((a, b) => {
      if (a.g.completed !== b.g.completed) return a.g.completed ? 1 : -1;
      if (a.g.completed) {
        return (
          String(b.g.completedAt || '').localeCompare(String(a.g.completedAt || '')) || a.i - b.i
        );
      }
      const at = a.g.targetDate || '9999-12-31';
      const bt = b.g.targetDate || '9999-12-31';
      return at.localeCompare(bt) || a.i - b.i;
    })
    .map((x) => x.g);
}

/* The shared dialog with this screen's own wording for a failed save. Returns
   `{ close }` because that is what the call sites here destructure. */
function openGoalModal(opts) {
  return { close: openModal({ ...opts, errorMessage: 'Oops, that goal slipped away.' }) };
}

function confirmInModal({ title, body, primary, onConfirm }) {
  openGoalModal({
    title,
    body: h('div', { class: 'gb-note-hint' }, body),
    primary,
    destructive: true,
    onPrimary: onConfirm,
  });
}

/* ---- Goal progress: open edit dialog ---- */
function openEditProgress(goal, progress, onUpdateProgress, linkedCount = 0) {
  // With habits linked, the tracker can count itself: a day any of them was
  // done is a day followed (from `autoSince`, the goal's start).
  let auto = !!(progress && progress.autoDays) && linkedCount > 0;
  const durationInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '1',
    max: '1000',
    placeholder: 'e.g. 50',
    value: (progress && progress.durationDays) || '',
  });
  const followedInput = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '0',
    max: '1000',
    value: progress && progress.daysFollowed != null ? String(progress.daysFollowed) : '0',
  });
  const followedField = h(
    'div',
    { style: { display: auto ? 'none' : '' } },
    h('div', { class: 'gb-field-label' }, 'Days followed so far'),
    followedInput
  );
  const autoSwitch =
    linkedCount > 0
      ? h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': String(auto),
            'aria-label': 'Count days from linked habits',
            class: 'gb-switch' + (auto ? ' is-on' : ''),
            onclick: () => {
              auto = !auto;
              autoSwitch.classList.toggle('is-on', auto);
              autoSwitch.setAttribute('aria-checked', String(auto));
              followedField.style.display = auto ? 'none' : '';
            },
          },
          h('span', { class: 'gb-switch-knob' })
        )
      : null;
  const body = h(
    'div',
    { class: 'gb-form' },
    h('div', { class: 'gb-field-label' }, 'Total days for this challenge'),
    durationInput,
    h(
      'div',
      { class: 'gb-note-hint', style: { marginBottom: '4px' } },
      'e.g. 50 for a "50-day sugar cut"'
    ),
    autoSwitch
      ? h(
          'div',
          { style: { display: 'flex', gap: '12px', alignItems: 'center', margin: '8px 0' } },
          h(
            'span',
            { style: { flex: 1 } },
            'Count a day whenever a linked habit was done'
          ),
          autoSwitch
        )
      : null,
    followedField
  );
  openGoalModal({
    title: 'Edit day tracker',
    sub: goal.title,
    body,
    primary: 'Save progress',
    onPrimary: async () => {
      const dur = parseInt(durationInput.value);
      const followed = parseInt(followedInput.value);
      if (!Number.isFinite(dur) || dur < 1) {
        durationInput.focus();
        throw new Error('Duration must be at least 1 day.');
      }
      if (auto) {
        // Counted from the goal's own start, so linking habits to a goal that
        // is weeks old picks up the weeks already done.
        const since =
          (progress && progress.autoSince) ||
          String(goal.createdAt || '').slice(0, 10) ||
          todayKey();
        onUpdateProgress(goal.id, { durationDays: dur, autoDays: true, autoSince: since });
        return;
      }
      if (!Number.isFinite(followed) || followed < 0) {
        followedInput.focus();
        throw new Error('Days followed cannot be negative.');
      }
      if (followed > dur) {
        followedInput.focus();
        throw new Error('Days followed cannot exceed duration.');
      }
      onUpdateProgress(goal.id, { durationDays: dur, daysFollowed: followed, autoDays: false });
    },
  });
  setTimeout(() => durationInput.focus(), 60);
}

/* ---- Goal progress bar component ---- */
function GoalProgressBar({ goal, progress, onUpdateProgress, linkedCount = 0 }) {
  if (!progress || !progress.durationDays) return null;
  // Counting from linked habits: app.js already set daysFollowed from them,
  // and there is no day to log by hand.
  const auto = !!progress.autoDays && linkedCount > 0;
  const dur = progress.durationDays;
  const followed = progress.daysFollowed || 0;
  const left = Math.max(0, dur - followed);
  const pct = Math.min(100, Math.round((followed / dur) * 100));
  const isDone = followed >= dur;
  const today = todayKey();
  const loggedToday = progress.lastLoggedOn === today && followed > 0;

  const leftEl = isDone
    ? h('span', { class: 'gb-goal-progress-done-chip' }, 'Complete!')
    : h(
        'span',
        null,
        h('span', { class: 'gb-goal-progress-stat-val' }, String(left)),
        ' days left'
      );

  return h(
    'div',
    { class: 'gb-goal-progress' },
    h(
      'div',
      { class: 'gb-goal-progress-header' },
      h(
        'span',
        { class: 'gb-goal-progress-label' },
        auto ? 'Day tracker · from linked habits' : 'Day tracker'
      ),
      h('span', { class: 'gb-goal-progress-pct' }, pct + '%')
    ),
    h(
      'div',
      { class: 'gb-goal-progress-track' },
      h('div', {
        class: 'gb-goal-progress-fill' + (isDone ? ' is-done' : ''),
        style: { width: Math.max(pct, 2) + '%' },
      })
    ),
    h(
      'div',
      { class: 'gb-goal-progress-stats' },
      h(
        'span',
        null,
        h('span', { class: 'gb-goal-progress-stat-val' }, String(followed)),
        ' / ' + dur + ' days followed'
      ),
      leftEl
    ),
    h(
      'div',
      { class: 'gb-goal-progress-actions' },
      // One day a day. "Log a day" took any number of taps, so a double tap (or
      // a second visit) counted the same day twice. `lastLoggedOn` lives in the
      // progress blob with the count; today's log can be taken back.
      auto
        ? null
        : loggedToday
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-goal-day-btn is-logged',
              'aria-label': 'Logged today. Undo',
              onclick: () =>
                onUpdateProgress(goal.id, {
                  durationDays: dur,
                  daysFollowed: Math.max(0, followed - 1),
                  lastLoggedOn: progress.prevLoggedOn || null,
                  prevLoggedOn: null,
                }),
            },
            Icon('undo-2', { size: 15, sw: 2.4 }),
            'Logged today · Undo'
          )
        : !isDone
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-goal-day-btn',
                onclick: () =>
                  onUpdateProgress(goal.id, {
                    durationDays: dur,
                    daysFollowed: Math.min(dur, followed + 1),
                    lastLoggedOn: today,
                    prevLoggedOn: progress.lastLoggedOn || null,
                  }),
              },
              Icon('calendar-check', { size: 15, sw: 2.4 }),
              'Log a day'
            )
          : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn',
          'aria-label': 'Edit day tracker',
          onclick: () => openEditProgress(goal, progress, onUpdateProgress, linkedCount),
        },
        Icon('pencil', { size: 15, sw: 2.4 })
      )
    )
  );
}

/* ---- Goal milestones / sub-tasks ----
   Break a goal into checkpoints with a progress %. Stored alongside the day
   tracker in goalProgress[goalId].milestones (the goal's progress blob):
     milestones: [{ id, title, done, due? }]
   A row's pencil opens it in place: rename, an optional due date, move up /
   down and delete. Which row is open is module state: a move saves and
   re-renders the screen, and the row has to come back still open. */
function milestoneStats(progress) {
  const ms = (progress && progress.milestones) || [];
  const done = ms.filter((x) => x.done).length;
  return { ms, done, total: ms.length, pct: ms.length ? Math.round((done / ms.length) * 100) : 0 };
}

let editingMs = ''; // 'goalId:milestoneId' of the row open for editing

function focusMs(sel) {
  requestAnimationFrame(() => {
    const el = document.querySelector(sel);
    if (el) el.focus();
  });
}

const DUE_LABEL = { overdue: 'Overdue', today: 'Due today', soon: 'Due', later: 'Due' };

function GoalMilestones({ goal, progress, onUpdateProgress }) {
  const { ms, done, total, pct } = milestoneStats(progress);
  // "Count finished tasks toward progress" on: the bar is milestones and
  // finished linked tasks together (goal-tasks.js combinedGoalProgress).
  const work = progress && progress.work && progress.work.withTasks ? progress.work : null;
  const setMs = (next) => onUpdateProgress(goal.id, { milestones: next });
  const toggle = (id) =>
    setMs(ms.map((x) => (x.id === id ? Object.assign({}, x, { done: !x.done }) : x)));
  const remove = (id) => {
    editingMs = '';
    setMs(ms.filter((x) => x.id !== id));
  };
  const keyOf = (x) => String(goal.id) + ':' + x.id;
  const today = todayKey();

  const addInput = h('input', {
    type: 'text',
    class: 'gb-goal-ms-input',
    maxlength: '160',
    placeholder: 'Add a milestone…',
    'aria-label': 'New milestone',
    'data-ms-goal': String(goal.id),
  });
  const add = () => {
    const title = addInput.value.trim();
    if (!title) {
      // An enabled + that did nothing read as broken: point at the empty field.
      addInput.focus();
      shakeRefusal(addInput.parentElement);
      return;
    }
    setMs(ms.concat({ id: 'm' + Date.now().toString(36), title, done: false }));
    // The save re-renders the screen, which replaces this input; put the caret
    // in the new one so the next checkpoint can be typed straight after Enter.
    focusMs('[data-ms-goal="' + String(goal.id) + '"]');
  };
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  function editRow(x, index) {
    const titleInput = h('input', {
      type: 'text',
      class: 'gb-goal-ms-input',
      maxlength: '160',
      value: x.title,
      'aria-label': 'Milestone name',
      'data-ms-edit': keyOf(x),
    });
    const dueInput = h('input', {
      type: 'date',
      class: 'gb-input gb-goal-ms-due-input',
      value: x.due || '',
      'aria-label': 'Due date (optional)',
    });
    let node = null;
    const save = () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        shakeRefusal(titleInput);
        return;
      }
      editingMs = '';
      setMs(setMilestoneDue(renameMilestone(ms, x.id, title), x.id, dueInput.value));
      focusMs('[data-ms-open="' + keyOf(x) + '"]');
    };
    // Nothing was saved, so nothing re-renders: swap the plain row back in.
    const cancel = () => {
      editingMs = '';
      const plain = viewRow(x);
      node.replaceWith(plain);
      focusMs('[data-ms-open="' + keyOf(x) + '"]');
    };
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        // Close the row, not the screen or dialog behind it.
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    });
    // A move saves the order only and re-renders with this row still open; a
    // name typed and not yet saved goes with it, so save it along.
    const move = (delta, dir) => {
      const title = titleInput.value.trim();
      const renamed = title ? renameMilestone(ms, x.id, title) : ms;
      setMs(moveItem(setMilestoneDue(renamed, x.id, dueInput.value), x.id, delta));
      focusMs('[data-ms-move="' + keyOf(x) + ':' + dir + '"]');
    };
    const iconBtn = (label, icon, onclick, extra = {}) =>
      h(
        'button',
        { type: 'button', class: 'gb-icon-btn', 'aria-label': label, onclick, ...extra },
        Icon(icon, { size: 14, sw: 2.4 })
      );
    node = h(
      'div',
      { class: 'gb-goal-ms-row is-editing' },
      h(
        'div',
        { class: 'gb-goal-ms-edit' },
        titleInput,
        h(
          'label',
          { class: 'gb-goal-ms-due-field' },
          h('span', { class: 'gb-field-label' }, 'Due'),
          dueInput
        )
      ),
      h(
        'div',
        { class: 'gb-goal-ms-tools' },
        iconBtn('Move up: ' + x.title, 'chevron-up', () => move(-1, 'up'), {
          disabled: index === 0,
          'data-ms-move': keyOf(x) + ':up',
        }),
        iconBtn('Move down: ' + x.title, 'chevron-down', () => move(1, 'down'), {
          disabled: index === ms.length - 1,
          'data-ms-move': keyOf(x) + ':down',
        }),
        iconBtn('Delete milestone: ' + x.title, 'trash-2', () => remove(x.id)),
        iconBtn('Cancel editing', 'x', cancel),
        iconBtn('Save milestone', 'check', save)
      )
    );
    return node;
  }

  function viewRow(x) {
    const index = ms.findIndex((m) => m.id === x.id);
    const dueState = milestoneDueState(x, today);
    let node = null;
    node = h(
      'div',
      { class: 'gb-goal-ms-row' + (x.done ? ' is-done' : '') },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-goal-ms-check' + (x.done ? ' is-done' : ''),
          role: 'checkbox',
          'aria-checked': x.done ? 'true' : 'false',
          'aria-label': (x.done ? 'Mark incomplete: ' : 'Mark complete: ') + x.title,
          onclick: () => toggle(x.id),
        },
        x.done ? Icon('check', { size: 13, sw: 3, color: '#fff' }) : null
      ),
      h(
        'span',
        { class: 'gb-goal-ms-title' },
        x.title,
        x.due
          ? h(
              'span',
              { class: 'gb-goal-ms-due' + (dueState === 'overdue' ? ' is-overdue' : '') },
              (DUE_LABEL[dueState] || 'Due') +
                (dueState === 'today' ? '' : ' ' + fmtDate(x.due).replace(/,? \d{4}$/, ''))
            )
          : null
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn gb-goal-ms-del',
          'aria-label': 'Edit milestone: ' + x.title,
          'data-ms-open': keyOf(x),
          // Opening a row changes nothing stored: swap it in place, no save.
          onclick: () => {
            editingMs = keyOf(x);
            node.replaceWith(editRow(x, index));
            focusMs('[data-ms-edit="' + keyOf(x) + '"]');
          },
        },
        Icon('pencil', { size: 13, sw: 2.4 })
      )
    );
    return node;
  }

  const rows = ms.map((x, index) => (editingMs === keyOf(x) ? editRow(x, index) : viewRow(x)));

  return h(
    'div',
    { class: 'gb-goal-ms' },
    h(
      'div',
      { class: 'gb-goal-ms-header' },
      h('span', { class: 'gb-goal-ms-label' }, work ? 'Milestones + tasks' : 'Milestones'),
      work
        ? h('span', { class: 'gb-goal-ms-pct' }, work.done + '/' + work.total + ' · ' + work.pct + '%')
        : total
          ? h('span', { class: 'gb-goal-ms-pct' }, done + '/' + total + ' · ' + pct + '%')
          : null
    ),
    work || total
      ? h(
          'div',
          { class: 'gb-goal-ms-track' },
          h('div', {
            class: 'gb-goal-ms-fill',
            style: { width: Math.max(work ? work.pct : pct, 2) + '%' },
          })
        )
      : null,
    rows.length ? h('div', { class: 'gb-goal-ms-list' }, rows) : null,
    // The + sits inside the field: a separate "+ Add" pill beside it squeezed
    // the input to a few characters on a card this narrow.
    h(
      'div',
      { class: 'gb-affix gb-goal-ms-add' },
      addInput,
      h(
        'button',
        { type: 'button', class: 'gb-goal-ms-addbtn', 'aria-label': 'Add milestone', onclick: add },
        Icon('plus', { size: 16, sw: 2.6 })
      )
    )
  );
}

function ActionRow(goal, action, onEditAction, onDeleteAction) {
  return h(
    'div',
    { class: 'gb-goal-action-row' },
    h(
      'div',
      { class: 'gb-goal-action-text' },
      h('div', { class: 'gb-goal-action-note' }, action.note),
      h(
        'div',
        { class: 'gb-goal-action-date' },
        fmtDate(action.actionDate || String(action.createdAt || '').slice(0, 10))
      )
    ),
    h(
      'div',
      { class: 'gb-goal-action-tools' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn',
          'aria-label': 'Edit action',
          onclick: () => onEditAction(goal, action),
        },
        Icon('pencil', { size: 15, sw: 2.4 })
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn',
          'aria-label': 'Delete action',
          onclick: () =>
            confirmInModal({
              title: 'Delete action',
              body: 'Remove this action from the goal history?',
              primary: 'Delete',
              onConfirm: () => onDeleteAction(goal.id, action.id),
            }),
        },
        Icon('trash-2', { size: 15, sw: 2.4 })
      )
    )
  );
}

/* A goal's linked tasks (tasks.goal_id): "Tasks: done/total", its open ones
   (ticked like Home's rows — the tick is the task's own, toggleTask), "Add a
   task" (New task with this goal picked) and, once it has any, the "Count
   finished tasks toward progress" switch (`countTasks` in the progress blob,
   read by goal-tasks.js combinedGoalProgress). */
function GoalTasks({ goal, progress, tasks, onUpdateProgress, taskOps }) {
  const ops = taskOps || {};
  if (!ops.onAddTask && !tasks.total) return null;
  const counting = !!(progress && progress.countTasks);
  const addBtn = ops.onAddTask
    ? h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: () => ops.onAddTask(goal),
        },
        Icon('plus', { size: 14, sw: 2.4 }),
        'Add a task'
      )
    : null;
  if (!tasks.total) return h('div', { class: 'gb-goal-tasks' }, addBtn);
  const countSwitch = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': String(counting),
      'aria-label': 'Count finished tasks toward progress',
      class: 'gb-switch' + (counting ? ' is-on' : ''),
      onclick: () => onUpdateProgress(goal.id, { countTasks: !counting }),
    },
    h('span', { class: 'gb-switch-knob' })
  );
  return h(
    'div',
    { class: 'gb-goal-ms gb-goal-tasks' },
    h(
      'div',
      { class: 'gb-goal-ms-header' },
      h('span', { class: 'gb-goal-ms-label' }, 'Tasks: ' + tasks.done + '/' + tasks.total)
    ),
    tasks.open.length
      ? h(
          'div',
          { class: 'gb-goal-ms-list' },
          tasks.open.map((t) =>
            h(
              'div',
              { class: 'gb-goal-ms-row' },
              ops.onToggleTask
                ? h('button', {
                    type: 'button',
                    class: 'gb-goal-ms-check',
                    role: 'checkbox',
                    'aria-checked': 'false',
                    'aria-label': 'Mark complete: ' + t.title,
                    onclick: () => ops.onToggleTask(t.id),
                  })
                : null,
              h('span', { class: 'gb-goal-ms-title' }, t.title)
            )
          )
        )
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: '12px', alignItems: 'center', margin: '6px 0' } },
      h('span', { style: { flex: 1 } }, 'Count finished tasks toward progress'),
      countSwitch
    ),
    addBtn
  );
}

function GoalRow(
  goal,
  onToggle,
  onDelete,
  onAddAction,
  onEditAction,
  onDeleteAction,
  progress,
  onUpdateProgress,
  onEditGoal,
  onSeeAllActions,
  linked,
  taskOps,
  onFocus
) {
  const meta = HORIZON_META[goal.horizon] || HORIZON_META.short_term;
  // linked = { count, month, autoDays } from app.js (goalHabitSummary), or null.
  const linkedCount = linked ? linked.count : 0;
  const recentActions = goal.recentActions || [];
  const left = goal.completed ? null : daysUntil(goal.targetDate);
  const overdue = left != null && left < 0;
  // Everything it tracks is finished, but the goal still says Active: offer the
  // one tap that closes it rather than leaving a 100% goal among the open ones.
  const hasDays = !!(progress && progress.durationDays);
  const ms = milestoneStats(progress);
  // Linked tasks ({done, total, open} from app.js effectiveGoalProgress): a goal
  // whose last open task was just ticked is offered "Mark done" here too.
  const tasks = (progress && progress.linkedTasks) || { done: 0, total: 0, open: [] };
  const allDone =
    !goal.completed &&
    (hasDays || ms.total > 0 || tasks.total > 0) &&
    (!hasDays || (progress.daysFollowed || 0) >= progress.durationDays) &&
    ms.done === ms.total &&
    tasks.done === tasks.total;

  const statusChip = h(
    'span',
    {
      class: 'gb-goal-status-chip' + (goal.completed ? ' is-complete' : ''),
    },
    goal.completed ? 'Complete' : 'Active'
  );

  return h(
    'div',
    {
      class: 'gb-goal-card' + (goal.completed ? ' is-complete' : ''),
      style: { borderLeftColor: meta.dot },
    },
    h(
      'div',
      { class: 'gb-goal-card-header' },
      h('div', { class: 'gb-goal-title' }, goal.title),
      statusChip,
      // Opens the Focus timer with this goal picked as what the session is on.
      onFocus && !goal.completed
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-icon-btn',
              'aria-label': 'Start focus on ' + goal.title,
              title: 'Start focus',
              onclick: () => onFocus(goal),
            },
            Icon('timer', { size: 15, sw: 2.4 })
          )
        : null,
      onEditGoal
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-icon-btn',
              'aria-label': 'Edit goal: ' + goal.title,
              onclick: () => onEditGoal(goal),
            },
            Icon('pencil', { size: 15, sw: 2.4 })
          )
        : null
    ),
    goal.description ? h('div', { class: 'gb-goal-desc' }, goal.description) : null,
    h(
      'div',
      { class: 'gb-goal-meta' },
      Pill({
        label: HORIZON_LABEL[goal.horizon] || goal.horizon,
        bg: meta.bg,
        fg: meta.fg,
        dot: meta.dot,
      }),
      h('span', null, goal.actionCount + ' ' + (goal.actionCount === 1 ? 'action' : 'actions')),
      goal.targetDate
        ? h(
            'span',
            overdue
              ? { class: 'gb-goal-overdue', style: { color: 'var(--coral-700)', fontWeight: 600 } }
              : null,
            overdue
              ? 'Overdue · target ' + fmtDate(goal.targetDate)
              : 'Target ' +
                  fmtDate(goal.targetDate) +
                  (left != null && left <= 30 && !goal.completed
                    ? left === 0
                      ? ' · today'
                      : ' · ' + left + (left === 1 ? ' day' : ' days') + ' left'
                    : '')
          )
        : h('span', null, 'Flexible target'),
      goal.latestActionAt
        ? h('span', null, 'Last ' + fmtDate(String(goal.latestActionAt).slice(0, 10)))
        : null
    ),
    linked
      ? h(
          'div',
          { class: 'gb-goal-linked' },
          Icon('link', { size: 13, sw: 2.4 }),
          'Linked habits: ' +
            linked.month +
            (linked.month === 1 ? ' check-in' : ' check-ins') +
            ' this month'
        )
      : null,
    GoalProgressBar({ goal, progress: progress || null, onUpdateProgress, linkedCount }),
    GoalMilestones({ goal, progress: progress || null, onUpdateProgress }),
    GoalTasks({ goal, progress: progress || null, tasks, onUpdateProgress, taskOps }),
    recentActions.length
      ? h(
          'div',
          { class: 'gb-goal-action-list' },
          recentActions.map((action) => ActionRow(goal, action, onEditAction, onDeleteAction)),
          // Only three ride along with the list; the rest come on request.
          onSeeAllActions && goal.actionCount > recentActions.length
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--ghost gb-btn--compact',
                  onclick: () => onSeeAllActions(goal),
                },
                'See all ' + goal.actionCount + ' actions'
              )
            : null
        )
      : null,
    allDone
      ? h(
          'div',
          { class: 'gb-goal-progress-done-chip', style: { marginTop: '8px' } },
          'Everything here is done. Mark the goal done?'
        )
      : null,
    h(
      'div',
      { class: 'gb-goal-card-footer' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-btn--compact',
          onclick: () => onAddAction(goal),
        },
        Icon('notebook-pen', { size: 14, sw: 2.4 }),
        'Log action'
      ),
      !(progress && progress.durationDays)
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--secondary gb-btn--compact',
              onclick: () =>
                openEditProgress(goal, progress || null, onUpdateProgress, linkedCount),
            },
            Icon('timer', { size: 14, sw: 2.4 }),
            'Track days'
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class:
            'gb-btn ' +
            (goal.completed ? 'gb-btn--secondary' : allDone ? 'gb-btn--primary' : 'gb-btn--soft') +
            ' gb-btn--compact',
          onclick: () => onToggle(goal.id),
        },
        Icon(goal.completed ? 'undo-2' : 'check', { size: 14, sw: 2.4 }),
        goal.completed ? 'Reopen' : 'Mark done'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact gb-goal-delete-btn',
          onclick: () => onDelete(goal.id, goal),
          'aria-label': 'Delete goal',
        },
        Icon('trash-2', { size: 14, sw: 2.4 })
      )
    )
  );
}

function ScreenGoals({
  sections = [],
  onCreateGoal,
  onToggleGoal,
  onDeleteGoal,
  onAddAction,
  onUpdateAction,
  onDeleteAction,
  goalProgress = {},
  onUpdateGoalProgress,
  onUpdateGoal,
  onLoadActions,
  onFocusGoal,
  timezone,
  habits = [],
  linkedHabits = {},
  onAddTask,
  onToggleTask,
}) {
  userZone = timezone || '';
  const createBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--soft',
      style: { width: 'auto', padding: '8px 14px' },
      onclick: () => openGoalForm(null),
    },
    Icon('plus', { size: 16, sw: 2.6 }),
    'New goal'
  );

  // Horizon first and as three buttons, not a select: it's the one choice
  // every goal needs, and the hint under it says what each one means.
  const HORIZON_HINT = {
    short_term: 'Weeks to a few months',
    mid_term: 'About 3 to 12 months',
    long_term: 'A year or more',
  };

  /* New goal, or edit one (`goal` given): same fields, prefilled. The day
     tracker is edited from its own pencil, so editing hides that field. */
  function openGoalForm(goal) {
    const editing = !!goal;
    const titleInput = h('input', {
      type: 'text',
      class: 'gb-input gb-goal-title-input',
      maxlength: '255',
      placeholder: 'What do you want to achieve?',
      'aria-label': 'Goal',
      value: editing ? goal.title || '' : '',
    });
    let horizon = editing && HORIZON_HINT[goal.horizon] ? goal.horizon : 'short_term';
    const hint = h('div', { class: 'gb-field-hint gb-goal-horizon-hint' }, HORIZON_HINT[horizon]);
    const segs = Object.keys(HORIZON_HINT).map((k) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-seg' + (k === horizon ? ' is-on' : ''),
          role: 'radio',
          'aria-checked': String(k === horizon),
          onclick: () => {
            horizon = k;
            segs.forEach((b) => {
              const on = b.dataset.k === k;
              b.classList.toggle('is-on', on);
              b.setAttribute('aria-checked', String(on));
            });
            hint.textContent = HORIZON_HINT[k];
          },
          'data-k': k,
        },
        HORIZON_LABEL[k].replace(/ term$/i, '')
      )
    );
    const descInput = h('textarea', {
      class: 'gb-input gb-goal-desc-input',
      maxlength: '1000',
      rows: '2',
      placeholder: 'Why does it matter? (optional)',
      'aria-label': 'Why it matters',
    });
    if (editing && goal.description) descInput.value = goal.description;
    // Editing keeps a target that has already passed (min would refuse it).
    const targetInput = h('input', {
      type: 'date',
      class: 'gb-input',
      min:
        editing && goal.targetDate && goal.targetDate < todayKey() ? goal.targetDate : todayKey(),
      value: editing ? goal.targetDate || '' : '',
    });
    const durationInput = h('input', {
      type: 'number',
      inputmode: 'numeric',
      min: '1',
      max: '1000',
      step: '1',
      placeholder: 'Off',
      'aria-label': 'Track daily for how many days',
    });
    const field = (label, control) =>
      h(
        'label',
        { class: 'gb-form-field' },
        h('span', { class: 'gb-field-label' }, label),
        control
      );
    // Habits this goal is built from. Stored in the goal's progress blob
    // (`linkedHabitIds`), so no schema change; the card counts their
    // check-ins, and the day tracker can count from them.
    const progressNow = (editing && goalProgress[String(goal.id)]) || {};
    const linkedBefore = liveLinkedIds(progressNow.linkedHabitIds, habits);
    const linkedPicked = new Set(linkedBefore);
    const habitPicker = habits.length
      ? h(
          'div',
          { class: 'gb-form-field' },
          h('span', { class: 'gb-field-label', id: 'gb-goal-habits-label' }, 'Linked habits'),
          h(
            'div',
            {
              class: 'gb-goal-habit-picks',
              role: 'group',
              'aria-labelledby': 'gb-goal-habits-label',
            },
            habits.map((hb) => {
              const on = linkedPicked.has(hb.id);
              const btn = h(
                'button',
                {
                  type: 'button',
                  class: 'gb-preset' + (on ? ' is-on' : ''),
                  'aria-pressed': String(on),
                  onclick: () => {
                    const now = !linkedPicked.has(hb.id);
                    if (now) linkedPicked.add(hb.id);
                    else linkedPicked.delete(hb.id);
                    btn.classList.toggle('is-on', now);
                    btn.setAttribute('aria-pressed', String(now));
                  },
                },
                hb.name
              );
              return btn;
            })
          ),
          h(
            'div',
            { class: 'gb-field-hint' },
            'Their check-ins show on this goal, and the day tracker can count from them.'
          )
        )
      : null;
    // In the user's habit order, which is the order the picker shows.
    const pickedIds = () => habits.map((hb) => hb.id).filter((id) => linkedPicked.has(id));
    const body = h(
      'div',
      { class: 'gb-form gb-goal-form' },
      titleInput,
      h(
        'div',
        { class: 'gb-form-field' },
        h('span', { class: 'gb-field-label' }, 'Horizon'),
        h('div', { class: 'gb-segmented', role: 'radiogroup', 'aria-label': 'Horizon' }, segs),
        hint
      ),
      descInput,
      editing
        ? field('Target date', targetInput)
        : h(
            'div',
            { class: 'gb-form-pair' },
            field('Target date', targetInput),
            field(
              'Track daily',
              h(
                'div',
                { class: 'gb-affix' },
                durationInput,
                h('span', { class: 'gb-affix-unit' }, 'days')
              )
            )
          ),
      editing
        ? null
        : h(
            'div',
            { class: 'gb-field-hint gb-goal-form-hint' },
            'Track daily adds a day-by-day tracker, for challenges like a 50-day sugar cut.'
          ),
      habitPicker
    );
    openGoalModal({
      title: editing ? 'Edit goal' : 'New goal',
      body,
      primary: editing ? 'Save changes' : 'Save goal',
      onPrimary: async () => {
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.focus();
          throw new Error('Give the goal a name first.');
        }
        if (editing) {
          // PUT: null = unchanged, so a removed date says so with its own flag.
          await onUpdateGoal(goal.id, {
            title,
            description: descInput.value.trim(),
            horizon,
            targetDate: targetInput.value || null,
            clearTargetDate: !targetInput.value,
          });
          const ids = pickedIds();
          if (ids.join() !== linkedBefore.join()) {
            // Unlinking every habit also turns off a tracker counting from them.
            onUpdateGoalProgress(
              goal.id,
              ids.length ? { linkedHabitIds: ids } : { linkedHabitIds: [], autoDays: false }
            );
          }
          return;
        }
        const dur = durationInput.value ? Number(durationInput.value) : null;
        if (dur != null && (!Number.isInteger(dur) || dur < 1 || dur > 1000)) {
          durationInput.focus();
          throw new Error('Track daily takes a whole number of days, 1 to 1000.');
        }
        const goal = await onCreateGoal({
          title,
          description: descInput.value.trim() || null,
          horizon,
          targetDate: targetInput.value || null,
        });
        const ids = pickedIds();
        if (goal && goal.id && (dur != null || ids.length)) {
          onUpdateGoalProgress(goal.id, {
            ...(dur != null ? { durationDays: dur, daysFollowed: 0 } : {}),
            ...(ids.length ? { linkedHabitIds: ids } : {}),
          });
        }
      },
    });
    setTimeout(() => titleInput.focus(), 60);
  }

  function openActionModal(goal, action) {
    const noteInput = h(
      'textarea',
      {
        class: 'gb-input gb-input--about',
        maxlength: '1000',
        placeholder: 'What did you do today toward this goal?',
      },
      action ? action.note : ''
    );
    const dateInput = h('input', {
      type: 'date',
      class: 'gb-input',
      value: action ? action.actionDate || '' : todayKey(),
      max: todayKey(), // an action is something already done
    });
    const body = h(
      'div',
      { class: 'gb-form gb-form--about-diet' },
      h('div', { class: 'gb-field-label' }, 'Action note'),
      noteInput,
      h('div', { class: 'gb-field-label' }, 'Action date'),
      dateInput
    );
    openGoalModal({
      title: action ? 'Edit action' : 'Add action',
      sub: goal.title,
      body,
      primary: action ? 'Update action' : 'Save action',
      onPrimary: async () => {
        const note = noteInput.value.trim();
        if (!note) {
          noteInput.focus();
          throw new Error('Action note is required');
        }
        // A typed date skips the picker's max; YYYY-MM-DD compares as text.
        if (dateInput.value && dateInput.value > todayKey()) {
          dateInput.focus();
          throw new Error("An action can't be dated in the future.");
        }
        const payload = { note, actionDate: dateInput.value || null };
        if (action) await onUpdateAction(goal.id, action.id, payload);
        else await onAddAction(goal.id, payload);
      },
    });
    setTimeout(() => noteInput.focus(), 60);
  }

  function openAddAction(goal) {
    openActionModal(goal, null);
  }

  /* Every action, newest first (GET /api/goals/{id}/actions). The card carries
     only the latest three. Edit / delete close this list first and work as on
     the card. */
  function openAllActions(goal) {
    const list = h(
      'div',
      { class: 'gb-goal-action-list' },
      h('div', { class: 'gb-note-hint' }, 'Loading…')
    );
    const { close } = openGoalModal({ title: 'All actions', sub: goal.title, body: list });
    onLoadActions(goal.id)
      .then((all) => {
        list.replaceChildren(
          ...(all && all.length
            ? all.map((a) =>
                ActionRow(
                  goal,
                  a,
                  (g, act) => {
                    close();
                    openActionModal(g, act);
                  },
                  (gid, aid) => {
                    close();
                    return onDeleteAction(gid, aid);
                  }
                )
              )
            : [h('div', { class: 'gb-note-hint' }, 'No actions yet.')])
        );
      })
      .catch(() => {
        list.replaceChildren(
          h('div', { class: 'gb-note-hint' }, 'Could not load the actions. Try again.')
        );
      });
  }

  const row = (goal) =>
    GoalRow(
      goal,
      onToggleGoal,
      onDeleteGoal,
      openAddAction,
      openActionModal,
      onDeleteAction,
      goalProgress[String(goal.id)] || null,
      onUpdateGoalProgress,
      onUpdateGoal ? openGoalForm : null,
      onLoadActions ? openAllActions : null,
      linkedHabits[String(goal.id)] || null,
      { onAddTask, onToggleTask },
      onFocusGoal || null
    );

  const horizonCards = sections.map((section) => {
    const goals = sortGoals(section.goals);
    const open = goals.filter((g) => !g.completed);
    const finished = goals.filter((g) => g.completed);
    return h(
      'div',
      { class: 'gb-goal-section' },
      h(
        'div',
        { class: 'gb-goal-section-head' },
        h(
          'div',
          { class: 'gb-goal-section-title' },
          HORIZON_LABEL[section.horizon] || section.horizon
        ),
        h('div', { class: 'gb-goal-section-count' }, goals.length)
      ),
      goals.length
        ? h(
            'div',
            { class: 'gb-goal-cards' },
            open.map(row),
            // Finished goals fold away under the open ones instead of sitting
            // between them.
            finished.length
              ? h(
                  'details',
                  { class: 'gb-goal-done-group' },
                  h(
                    'summary',
                    { class: 'gb-goal-section-title' },
                    'Completed (' + finished.length + ')'
                  ),
                  finished.map(row)
                )
              : null
          )
        : h(
            'div',
            { class: 'gb-goal-empty' },
            Icon('target', { size: 20, color: 'var(--fg3)' }),
            h('span', null, 'No goals here yet — start with one small, achievable step.')
          )
    );
  });

  return h(
    'div',
    { class: 'gb-goals gb-rise' },
    h(
      'div',
      { class: 'gb-dash-block' },
      h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Goal activities'), createBtn),
      h(
        'div',
        { class: 'gb-goal-intro' },
        'Set short, mid or long-term goals, then log small daily actions toward them.'
      )
    ),
    h('div', { class: 'gb-dash-block' }, horizonCards)
  );
}

export { ScreenGoals };
