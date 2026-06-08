/* =====================================================================
   Growth Buddy — Goals screen (short / mid / long term goals + actions)
   ===================================================================== */
(function () {
  'use strict';

  const { h, Icon, Pill } = window.GB;

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
        month: 'short', day: 'numeric', year: 'numeric',
      });
    } catch (_) {
      return value;
    }
  }

  function todayKey() {
    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function openGoalModal({ title, sub, body, primary, onPrimary }) {
    let overlay;
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay && overlay.remove(), 180);
    }
    const primaryBtn = h('button', {
      type: 'button', class: 'gb-btn gb-btn--primary',
      onclick: async () => {
        try {
          primaryBtn.disabled = true;
          await onPrimary();
          close();
        } catch (err) {
          primaryBtn.disabled = false;
          if (window.GB.toastError) {
            window.GB.toastError(err, 'Oops, that goal slipped away.');
          }
        }
      },
    }, primary || 'Save');
    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, title),
        sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
      ),
      h('div', { class: 'gb-modal-body' }, body),
      primaryBtn,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Cancel')
    );
    overlay = h('div', { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } }, sheet);
    document.body.appendChild(overlay);
    window.GB.refreshIcons && window.GB.refreshIcons();
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    return { close };
  }

  function confirmInModal({ title, body, primary, onConfirm }) {
    openGoalModal({ title, body: h('div', { class: 'gb-note-hint' }, body), primary, onPrimary: onConfirm });
  }

  function ActionRow(goal, action, onEditAction, onDeleteAction) {
    return h(
      'div',
      { class: 'gb-goal-action-row' },
      h(
        'div',
        { class: 'gb-goal-action-text' },
        h('div', { class: 'gb-goal-action-note' }, action.note),
        h('div', { class: 'gb-goal-action-date' }, fmtDate(action.actionDate || String(action.createdAt || '').slice(0, 10)))
      ),
      h(
        'div',
        { class: 'gb-goal-action-tools' },
        h('button', { type: 'button', class: 'gb-icon-btn', 'aria-label': 'Edit action', onclick: () => onEditAction(goal, action) }, Icon('pencil', { size: 15, sw: 2.4 })),
        h('button', {
          type: 'button', class: 'gb-icon-btn', 'aria-label': 'Delete action',
          onclick: () => confirmInModal({
            title: 'Delete action',
            body: 'Remove this action from the goal history?',
            primary: 'Delete',
            onConfirm: () => onDeleteAction(goal.id, action.id),
          }),
        }, Icon('trash-2', { size: 15, sw: 2.4 }))
      )
    );
  }

  function GoalRow(goal, onToggle, onDelete, onAddAction, onEditAction, onDeleteAction) {
    const meta = HORIZON_META[goal.horizon] || HORIZON_META.short_term;
    const recentActions = goal.recentActions || [];
    return h(
      'div',
      { class: 'gb-goal-row' + (goal.completed ? ' is-complete' : '') },
      h(
        'div',
        { class: 'gb-goal-main' },
        h('div', { class: 'gb-goal-title' }, goal.title),
        goal.description ? h('div', { class: 'gb-goal-desc' }, goal.description) : null,
        h(
          'div',
          { class: 'gb-goal-meta' },
          Pill({ label: HORIZON_LABEL[goal.horizon] || goal.horizon, bg: meta.bg, fg: meta.fg, dot: meta.dot }),
          h('span', null, goal.actionCount + ' actions'),
          h('span', null, goal.latestActionAt ? ('Last action ' + fmtDate(String(goal.latestActionAt).slice(0, 10))) : 'No actions yet'),
          h('span', null, goal.targetDate ? ('Target ' + fmtDate(goal.targetDate)) : 'Flexible target')
        )
      ),
      h(
        'div',
        { class: 'gb-goal-actions' },
        h('button', { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: () => onAddAction(goal) }, Icon('plus', { size: 16, sw: 2.4 }), 'Action'),
        h('button', { type: 'button', class: 'gb-btn gb-btn--secondary gb-btn--compact', onclick: () => onToggle(goal.id) }, Icon(goal.completed ? 'undo-2' : 'check', { size: 16, sw: 2.4 }), goal.completed ? 'Reopen' : 'Done'),
        h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact', onclick: () => onDelete(goal.id) }, Icon('trash-2', { size: 16, sw: 2.4 }), 'Delete')
      ),
      recentActions.length
        ? h('div', { class: 'gb-goal-action-list' }, recentActions.map(action => ActionRow(goal, action, onEditAction, onDeleteAction)))
        : null
    );
  }

  function ScreenGoals({
    sections = [], gratitude = [], onCreateGoal, onToggleGoal, onDeleteGoal,
    onAddAction, onUpdateAction, onDeleteAction, onCreateGratitude,
    onUpdateGratitude, onDeleteGratitude,
  }) {
    const createBtn = h('button', {
      type: 'button', class: 'gb-btn gb-btn--soft', style: { width: 'auto', padding: '8px 14px' },
      onclick: () => openCreateGoal(),
    }, Icon('plus', { size: 16, sw: 2.6 }), 'New goal');

    function openCreateGoal() {
      const titleInput = h('input', { type: 'text', class: 'gb-input', maxlength: '255', placeholder: 'What do you want to achieve?' });
      const descInput = h('textarea', { class: 'gb-input gb-input--about', maxlength: '1000', placeholder: 'Add a simple description or why this matters.' });
      const horizonInput = h('select', { class: 'gb-input' },
        h('option', { value: 'short_term' }, 'Short term'),
        h('option', { value: 'mid_term' }, 'Mid term'),
        h('option', { value: 'long_term' }, 'Long term')
      );
      const targetInput = h('input', { type: 'date', class: 'gb-input' });
      const body = h('div', { class: 'gb-form gb-form--about-diet' },
        h('div', { class: 'gb-field-label' }, 'Title'), titleInput,
        h('div', { class: 'gb-field-label' }, 'Description'), descInput,
        h('div', { class: 'gb-field-label' }, 'Horizon'), horizonInput,
        h('div', { class: 'gb-field-label' }, 'Target date (optional)'), targetInput,
      );
      openGoalModal({
        title: 'Add goal',
        sub: 'Choose short, mid, or long term and keep the wording simple.',
        body,
        primary: 'Save goal',
        onPrimary: async () => {
          const title = titleInput.value.trim();
          if (!title) {
            titleInput.focus();
            throw new Error('Title is required');
          }
          await onCreateGoal({
            title,
            description: descInput.value.trim() || null,
            horizon: horizonInput.value,
            targetDate: targetInput.value || null,
          });
        },
      });
      setTimeout(() => titleInput.focus(), 60);
    }

    function openActionModal(goal, action) {
      const noteInput = h('textarea', { class: 'gb-input gb-input--about', maxlength: '1000', placeholder: 'What did you do today toward this goal?' }, action ? action.note : '');
      const dateInput = h('input', { type: 'date', class: 'gb-input', value: action ? (action.actionDate || '') : todayKey() });
      const body = h('div', { class: 'gb-form gb-form--about-diet' },
        h('div', { class: 'gb-field-label' }, 'Action note'), noteInput,
        h('div', { class: 'gb-field-label' }, 'Action date'), dateInput,
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

    function openAddAction(goal) { openActionModal(goal, null); }

    function openGratitudeModal(entry) {
      const noteInput = h('textarea', { class: 'gb-input gb-input--about', maxlength: '1000', placeholder: 'What are you grateful for today?' }, entry ? entry.note : '');
      const dateInput = h('input', { type: 'date', class: 'gb-input', value: entry ? entry.entryDate : todayKey() });
      const body = h('div', { class: 'gb-form gb-form--about-diet' },
        h('div', { class: 'gb-field-label' }, 'Gratitude note'), noteInput,
        h('div', { class: 'gb-field-label' }, 'Date'), dateInput,
      );
      openGoalModal({
        title: entry ? 'Edit gratitude' : 'Add gratitude',
        sub: 'Small notes count. Keep it honest and simple.',
        body,
        primary: entry ? 'Update note' : 'Save note',
        onPrimary: async () => {
          const note = noteInput.value.trim();
          if (!note) {
            noteInput.focus();
            throw new Error('Gratitude note is required');
          }
          const payload = { note, entryDate: dateInput.value || null };
          if (entry) await onUpdateGratitude(entry.id, payload);
          else await onCreateGratitude(payload);
        },
      });
      setTimeout(() => noteInput.focus(), 60);
    }

    function GratitudePanel() {
      const entries = gratitude || [];
      return h(
        'div',
        { class: 'gb-gratitude-panel' },
        h(
          'div',
          { class: 'gb-gratitude-head' },
          h('div', null,
            h('div', { class: 'gb-goal-section-title' }, 'Gratitude'),
            h('div', { class: 'gb-note-hint' }, 'A quick place for what felt good today.')
          ),
          h('button', { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: () => openGratitudeModal(null) }, Icon('heart', { size: 16, sw: 2.4 }), 'Add')
        ),
        entries.length
          ? h('div', { class: 'gb-gratitude-list' }, entries.slice(0, 6).map(entry => h(
              'div',
              { class: 'gb-gratitude-row' },
              h('div', { class: 'gb-gratitude-main' },
                h('div', { class: 'gb-gratitude-note' }, entry.note),
                h('div', { class: 'gb-goal-action-date' }, fmtDate(entry.entryDate))
              ),
              h('div', { class: 'gb-goal-action-tools' },
                h('button', { type: 'button', class: 'gb-icon-btn', 'aria-label': 'Edit gratitude', onclick: () => openGratitudeModal(entry) }, Icon('pencil', { size: 15, sw: 2.4 })),
                h('button', {
                  type: 'button', class: 'gb-icon-btn', 'aria-label': 'Delete gratitude',
                  onclick: () => confirmInModal({
                    title: 'Delete gratitude',
                    body: 'Remove this gratitude note?',
                    primary: 'Delete',
                    onConfirm: () => onDeleteGratitude(entry.id),
                  }),
                }, Icon('trash-2', { size: 15, sw: 2.4 }))
              )
            )))
          : h('div', { class: 'gb-goal-empty' }, 'No gratitude notes yet.')
      );
    }

    const horizonCards = sections.map(section => {
      const goals = section.goals || [];
      return h(
        'div',
        { class: 'gb-goal-section' },
        h(
          'div',
          { class: 'gb-goal-section-head' },
          h('div', { class: 'gb-goal-section-title' }, HORIZON_LABEL[section.horizon] || section.horizon),
          h('div', { class: 'gb-goal-section-count' }, goals.length)
        ),
        goals.length
          ? h('div', { class: 'gb-card', style: { padding: '4px 0' } }, goals.map(goal => GoalRow(goal, onToggleGoal, onDeleteGoal, openAddAction, openActionModal, onDeleteAction)))
          : h('div', { class: 'gb-goal-empty' }, 'No goals in this section yet.')
      );
    });

    return h(
      'div',
      { class: 'gb-goals gb-rise' },
      h(
        'div',
        { class: 'gb-dash-block' },
        h('div', { class: 'gb-sectiontitle' }, h('h3', null, 'Goal activities'), createBtn),
        h('div', { class: 'gb-goal-intro' }, 'Track short, mid, and long term goals, then log the actions you actually completed.')
      ),
      h('div', { class: 'gb-goal-section' }, GratitudePanel()),
      h('div', { class: 'gb-dash-block' }, horizonCards)
    );
  }

  window.GB.ScreenGoals = ScreenGoals;
})();