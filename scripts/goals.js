/* =====================================================================
   Growth Buddy — Goals screen (short / mid / long term goals + actions)
   ===================================================================== */
import { h, Icon, Pill, refreshIcons } from './gb-kit.js';
import { toast } from './toast.js';

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

function todayKey() {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function openGoalModal({ title, sub, body, primary, onPrimary }) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay && overlay.remove(), 180);
  }
  const primaryBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      onclick: async () => {
        try {
          primaryBtn.disabled = true;
          await onPrimary();
          close();
        } catch (err) {
          primaryBtn.disabled = false;
          toast.error(err, 'Oops, that goal slipped away.');
        }
      },
    },
    primary || 'Save'
  );
  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, title),
      sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
    ),
    h('div', { class: 'gb-modal-body' }, body),
    primaryBtn,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Cancel'
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: (e) => {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return { close };
}

function confirmInModal({ title, body, primary, onConfirm }) {
  openGoalModal({
    title,
    body: h('div', { class: 'gb-note-hint' }, body),
    primary,
    onPrimary: onConfirm,
  });
}

/* ---- Goal progress: open edit dialog ---- */
function openEditProgress(goal, progress, onUpdateProgress) {
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
    h('div', { class: 'gb-field-label' }, 'Days followed so far'),
    followedInput
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
      if (!Number.isFinite(followed) || followed < 0) {
        followedInput.focus();
        throw new Error('Days followed cannot be negative.');
      }
      if (followed > dur) {
        followedInput.focus();
        throw new Error('Days followed cannot exceed duration.');
      }
      onUpdateProgress(goal.id, { durationDays: dur, daysFollowed: followed });
    },
  });
  setTimeout(() => durationInput.focus(), 60);
}

/* ---- Goal progress bar component ---- */
function GoalProgressBar({ goal, progress, onUpdateProgress }) {
  if (!progress || !progress.durationDays) return null;
  const dur = progress.durationDays;
  const followed = progress.daysFollowed || 0;
  const left = Math.max(0, dur - followed);
  const pct = Math.min(100, Math.round((followed / dur) * 100));
  const isDone = followed >= dur;

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
      h('span', { class: 'gb-goal-progress-label' }, 'Day tracker'),
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
      !isDone
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: () =>
                onUpdateProgress(goal.id, {
                  durationDays: dur,
                  daysFollowed: Math.min(dur, followed + 1),
                }),
            },
            Icon('plus', { size: 14, sw: 2.6 }),
            '+1 Day'
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn',
          'aria-label': 'Edit day tracker',
          onclick: () => openEditProgress(goal, progress, onUpdateProgress),
        },
        Icon('pencil', { size: 15, sw: 2.4 })
      )
    )
  );
}

/* ---- Goal milestones / sub-tasks ----
   Break a goal into checkpoints with a progress %. Stored alongside the day
   tracker in goalProgress[goalId].milestones (CacheStorage, frontend-first):
     milestones: [{ id, title, done }] */
function milestoneStats(progress) {
  const ms = (progress && progress.milestones) || [];
  const done = ms.filter((x) => x.done).length;
  return { ms, done, total: ms.length, pct: ms.length ? Math.round((done / ms.length) * 100) : 0 };
}

function GoalMilestones({ goal, progress, onUpdateProgress }) {
  const { ms, done, total, pct } = milestoneStats(progress);
  const setMs = (next) => onUpdateProgress(goal.id, { milestones: next });
  const toggle = (id) =>
    setMs(ms.map((x) => (x.id === id ? Object.assign({}, x, { done: !x.done }) : x)));
  const remove = (id) => setMs(ms.filter((x) => x.id !== id));

  const addInput = h('input', {
    type: 'text',
    class: 'gb-input gb-goal-ms-input',
    maxlength: '160',
    placeholder: 'Add a checkpoint…',
  });
  const add = () => {
    const title = addInput.value.trim();
    if (!title) return;
    setMs(ms.concat({ id: 'm' + Date.now().toString(36), title, done: false }));
  };
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  const rows = ms.map((x) =>
    h(
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
      h('span', { class: 'gb-goal-ms-title' }, x.title),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-icon-btn gb-goal-ms-del',
          'aria-label': 'Delete checkpoint',
          onclick: () => remove(x.id),
        },
        Icon('trash-2', { size: 13, sw: 2.4 })
      )
    )
  );

  return h(
    'div',
    { class: 'gb-goal-ms' },
    h(
      'div',
      { class: 'gb-goal-ms-header' },
      h('span', { class: 'gb-goal-ms-label' }, 'Milestones'),
      total ? h('span', { class: 'gb-goal-ms-pct' }, done + '/' + total + ' · ' + pct + '%') : null
    ),
    total
      ? h(
          'div',
          { class: 'gb-goal-ms-track' },
          h('div', { class: 'gb-goal-ms-fill', style: { width: Math.max(pct, 2) + '%' } })
        )
      : null,
    rows.length ? h('div', { class: 'gb-goal-ms-list' }, rows) : null,
    h(
      'div',
      { class: 'gb-goal-ms-add' },
      addInput,
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: add },
        Icon('plus', { size: 14, sw: 2.6 }),
        'Add'
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

function GoalRow(
  goal,
  onToggle,
  onDelete,
  onAddAction,
  onEditAction,
  onDeleteAction,
  progress,
  onUpdateProgress
) {
  const meta = HORIZON_META[goal.horizon] || HORIZON_META.short_term;
  const recentActions = goal.recentActions || [];

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
      statusChip
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
        ? h('span', null, 'Target ' + fmtDate(goal.targetDate))
        : h('span', null, 'Flexible target'),
      goal.latestActionAt
        ? h('span', null, 'Last ' + fmtDate(String(goal.latestActionAt).slice(0, 10)))
        : null
    ),
    GoalProgressBar({ goal, progress: progress || null, onUpdateProgress }),
    GoalMilestones({ goal, progress: progress || null, onUpdateProgress }),
    recentActions.length
      ? h(
          'div',
          { class: 'gb-goal-action-list' },
          recentActions.map((action) => ActionRow(goal, action, onEditAction, onDeleteAction))
        )
      : null,
    h(
      'div',
      { class: 'gb-goal-card-footer' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => onAddAction(goal),
        },
        Icon('plus', { size: 14, sw: 2.4 }),
        'Log action'
      ),
      !(progress && progress.durationDays)
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--secondary gb-btn--compact',
              onclick: () => openEditProgress(goal, progress || null, onUpdateProgress),
            },
            Icon('timer', { size: 14, sw: 2.4 }),
            'Track days'
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--secondary gb-btn--compact',
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
          onclick: () => onDelete(goal.id),
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
}) {
  const createBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--soft',
      style: { width: 'auto', padding: '8px 14px' },
      onclick: () => openCreateGoal(),
    },
    Icon('plus', { size: 16, sw: 2.6 }),
    'New goal'
  );

  function openCreateGoal() {
    const titleInput = h('input', {
      type: 'text',
      class: 'gb-input',
      maxlength: '255',
      placeholder: 'What do you want to achieve?',
    });
    const descInput = h('textarea', {
      class: 'gb-input gb-input--about',
      maxlength: '1000',
      placeholder: 'Add a simple description or why this matters.',
    });
    const horizonInput = h(
      'select',
      { class: 'gb-input' },
      h('option', { value: 'short_term' }, 'Short term'),
      h('option', { value: 'mid_term' }, 'Mid term'),
      h('option', { value: 'long_term' }, 'Long term')
    );
    const targetInput = h('input', { type: 'date', class: 'gb-input' });
    const durationInput = h('input', {
      type: 'number',
      class: 'gb-input',
      min: '1',
      max: '1000',
      placeholder: 'e.g. 50 (optional)',
    });
    const body = h(
      'div',
      { class: 'gb-form gb-form--about-diet' },
      h('div', { class: 'gb-field-label' }, 'Title'),
      titleInput,
      h('div', { class: 'gb-field-label' }, 'Description'),
      descInput,
      h('div', { class: 'gb-field-label' }, 'Horizon'),
      horizonInput,
      h('div', { class: 'gb-field-label' }, 'Target date (optional)'),
      targetInput,
      h('div', { class: 'gb-field-label' }, 'Challenge duration in days (optional)'),
      h(
        'div',
        { class: 'gb-note-hint', style: { marginBottom: '4px' } },
        'For challenges like "50-day sugar cut" — adds a day-by-day progress tracker'
      ),
      durationInput
    );
    openGoalModal({
      title: 'New goal',
      sub: 'Choose short, mid, or long term and keep the wording simple.',
      body,
      primary: 'Save goal',
      onPrimary: async () => {
        const title = titleInput.value.trim();
        if (!title) {
          titleInput.focus();
          throw new Error('Title is required');
        }
        const goal = await onCreateGoal({
          title,
          description: descInput.value.trim() || null,
          horizon: horizonInput.value,
          targetDate: targetInput.value || null,
        });
        const dur = parseInt(durationInput.value);
        if (Number.isFinite(dur) && dur >= 1 && goal && goal.id) {
          onUpdateGoalProgress(goal.id, { durationDays: dur, daysFollowed: 0 });
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

  const horizonCards = sections.map((section) => {
    const goals = section.goals || [];
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
            goals.map((goal) =>
              GoalRow(
                goal,
                onToggleGoal,
                onDeleteGoal,
                openAddAction,
                openActionModal,
                onDeleteAction,
                goalProgress[String(goal.id)] || null,
                onUpdateGoalProgress
              )
            )
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
