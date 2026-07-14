/* =====================================================================
   Growth Buddy — Growth Circle (search people + mentorship invites)
   ===================================================================== */
import { h, activate, Icon, Avatar, plural, refreshIcons, confirmDialog } from './gb-kit.js';
import { toast } from './toast.js';

function PersonRow(person, onOffer, onRequest, onView) {
  const rel = person.relationship || 'none';
  let trailing;
  if (rel === 'mentoring' || rel === 'mentee') {
    const label = rel === 'mentoring' ? 'You mentor them' : 'They mentor you';
    // The pill opens their status — say so instead of relying on the cursor.
    trailing = h(
      'span',
      {
        class: 'gb-tag-pill is-accepted',
        style: { cursor: 'pointer' },
        ...activate(() => onView(person)),
      },
      label + ' ›'
    );
  } else if (rel === 'pending') {
    trailing = h('span', { class: 'gb-tag-pill is-pending' }, 'Invite pending');
  } else {
    trailing = h(
      'div',
      { class: 'gb-person-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft',
          style: { width: 'auto', padding: '8px 12px', fontSize: '12.5px' },
          onclick: () => onOffer(person),
        },
        Icon('hand-helping', { size: 14, sw: 2.4 }),
        'Mentor them'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { width: 'auto', padding: '8px 12px', fontSize: '12.5px' },
          onclick: () => onRequest(person),
        },
        Icon('user-plus', { size: 14, sw: 2.4 }),
        'Ask to mentor me'
      )
    );
  }
  return h(
    'div',
    { class: 'gb-row gb-person-row' },
    Avatar({ name: person.displayName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, person.displayName),
      h(
        'div',
        { class: 'sub' },
        (person.email ? person.email + ' · ' : '') + 'Level ' + person.level
      )
    ),
    trailing
  );
}

/**
 * Status window for a connected partner. Shows their level, current task
 * progress, and habit streaks. Only the mentee/mentor sees this — the
 * backend enforces it via the {@code /connections/{id}/status} endpoint.
 */
function showPartnerStatus(partnerId, fallbackName, statusApi) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }
  const subEl = h('div', { class: 'gb-modal-sub' }, 'Loading…');
  const taskBlock = h('div', { class: 'gb-status-block' });
  const habitBlock = h('div', { class: 'gb-status-block' });
  const card = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'gb-profile-head' },
      Avatar({ name: fallbackName, bg: 'var(--iris-100)', fg: 'var(--iris-700)', size: 64 }),
      h('div', null, h('div', { class: 'gb-modal-title' }, fallbackName), subEl)
    ),
    taskBlock,
    habitBlock,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Close'
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
    card
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(() => overlay.classList.add('is-open'));

  statusApi(partnerId)
    .then((data) => {
      subEl.textContent =
        'Level ' +
        data.level +
        ' · ' +
        (data.relationship === 'mentoring' ? 'Your mentee' : 'Your mentor');
      const t =
        data.tasksTotal === 0
          ? 'No tasks logged yet.'
          : data.tasksDone + '/' + plural(data.tasksTotal, 'task') + ' done today';
      taskBlock.appendChild(h('h4', { class: 'gb-status-label' }, 'Tasks'));
      taskBlock.appendChild(h('p', { class: 'gb-status-summary' }, t));
      if (data.tasks && data.tasks.length) {
        const list = h('ul', { class: 'gb-status-list' });
        data.tasks.slice(0, 6).forEach((it) => {
          list.appendChild(
            h(
              'li',
              { class: it.done ? 'is-done' : '' },
              h('span', null, it.done ? '✓ ' : '○ '),
              it.title
            )
          );
        });
        taskBlock.appendChild(list);
      }
      habitBlock.appendChild(h('h4', { class: 'gb-status-label' }, 'Habits'));
      habitBlock.appendChild(
        h('pre', { class: 'gb-status-pre' }, data.habitsSummary || 'No habits tracked.')
      );
    })
    .catch((err) => {
      subEl.textContent = err.message || 'Could not load status.';
    });
}

/* Raw status enums read as jargon — show plain words instead. */
const STATUS_LABELS = { pending: 'Invite pending', accepted: 'Connected', rejected: 'Declined' };
function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function OutgoingRow(req, statusApi, onRevoke) {
  const isAccepted = req.status === 'accepted';
  const isPending = req.status === 'pending';
  const canRevoke = (isAccepted || isPending) && !!onRevoke;
  const label =
    req.direction === 'offer'
      ? isAccepted
        ? 'You mentor ' + req.toName
        : 'You offered to mentor ' + req.toName
      : isAccepted
        ? req.toName + ' mentors you'
        : 'You asked ' + req.toName + ' to mentor you';
  const statusClass = 'gb-tag-pill is-' + req.status;
  const confirmOpts = isAccepted
    ? { title: 'Remove this connection?', confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true }
    : {
        title: 'Cancel this invite?',
        confirmLabel: 'Cancel invite',
        cancelLabel: 'Keep',
        danger: true,
      };
  return h(
    'div',
    {
      class: 'gb-row' + (isAccepted ? ' is-clickable' : ''),
      ...(isAccepted
        ? activate((e) => {
            if (e.target.closest && e.target.closest('.gb-revoke-btn')) return;
            showPartnerStatus(req.toUserId, req.toName, statusApi);
          })
        : {}),
    },
    Avatar({ name: req.toName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, label),
      h('div', { class: 'sub' }, req.note ? '“' + req.note + '”' : '')
    ),
    h('span', { class: statusClass }, statusLabel(req.status)),
    // Accepted rows open the partner's status on tap — show that affordance.
    isAccepted ? Icon('chevron-right', { size: 16, sw: 2.4, color: 'var(--fg3)' }) : null,
    canRevoke
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-revoke-btn',
            'aria-label': isAccepted ? 'Remove connection' : 'Cancel invite',
            title: isAccepted ? 'Remove' : 'Cancel invite',
            onclick: async () => {
              if (await confirmDialog(confirmOpts)) onRevoke(req.id);
            },
          },
          Icon('x', { size: 14, sw: 2.4 })
        )
      : null
  );
}

function IncomingRow(req, statusApi, onRevoke) {
  const isAccepted = req.status === 'accepted';
  const label =
    req.direction === 'offer'
      ? isAccepted
        ? req.fromName + ' mentors you'
        : req.fromName + ' offered to mentor you'
      : isAccepted
        ? 'You mentor ' + req.fromName
        : req.fromName + ' asked you to mentor them';
  const statusClass = 'gb-tag-pill is-' + req.status;
  return h(
    'div',
    {
      class: 'gb-row' + (isAccepted ? ' is-clickable' : ''),
      ...(isAccepted
        ? activate((e) => {
            if (e.target.closest && e.target.closest('.gb-revoke-btn')) return;
            showPartnerStatus(req.fromUserId, req.fromName, statusApi);
          })
        : {}),
    },
    Avatar({ name: req.fromName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, label),
      h('div', { class: 'sub' }, req.note ? '“' + req.note + '”' : '')
    ),
    h('span', { class: statusClass }, statusLabel(req.status)),
    // Accepted rows open the partner's status on tap — show that affordance.
    isAccepted ? Icon('chevron-right', { size: 16, sw: 2.4, color: 'var(--fg3)' }) : null,
    isAccepted && onRevoke
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-revoke-btn',
            'aria-label': 'Remove connection',
            title: 'Remove',
            onclick: async () => {
              const ok = await confirmDialog({
                title: 'Remove this connection?',
                confirmLabel: 'Remove',
                cancelLabel: 'Keep',
                danger: true,
              });
              if (ok) onRevoke(req.id);
            },
          },
          Icon('x', { size: 14, sw: 2.4 })
        )
      : null
  );
}

/**
 * ScreenCircle({
 *   onSearch: (q) => Promise<People[]>,
 *   onSendInvite: (toUserId, direction, note) => Promise,
 *   onLoadOutgoing: () => Promise<Request[]>,
 *   onLoadIncoming: () => Promise<Request[]>,
 * })
 */
/**
 * Modal opened by "Find someone". On open, eagerly fetches the full browse
 * list so the user has something to scroll through immediately. Typing then
 * narrows the list either client-side (fast, on substrings) or via the
 * server search endpoint (which also surfaces users not in the recent list).
 */
function openSearchModal({ onBrowse, onSearch, onOffer, onRequest, onView }) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 180);
  }
  const queryInput = h('input', {
    type: 'search',
    class: 'gb-input',
    placeholder: 'Search by name or email…',
    autofocus: true,
    maxlength: 80,
  });
  const resultsEl = h('div', { class: 'gb-card gb-search-results' });

  function paintLoading() {
    resultsEl.replaceChildren(h('div', { class: 'gb-empty' }, h('p', null, 'Loading people…')));
  }
  function paintEmpty(msg, onRetry) {
    resultsEl.replaceChildren(
      h(
        'div',
        { class: 'gb-empty' },
        Icon('users-round', { size: 22, color: 'var(--fg3)' }),
        h('p', null, msg),
        onRetry
          ? h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--secondary gb-btn--compact',
                onclick: onRetry,
              },
              'Try again'
            )
          : null
      )
    );
  }
  function paintList(list) {
    if (!list.length) {
      paintEmpty('No matches.');
      return;
    }
    resultsEl.replaceChildren();
    list.forEach((p) =>
      resultsEl.appendChild(
        PersonRow(
          p,
          (person) => {
            onOffer(person);
            close();
          },
          (person) => {
            onRequest(person);
            close();
          },
          (person) => {
            onView(person);
            close();
          }
        )
      )
    );
  }

  let allPeople = [];
  function loadPeople() {
    paintLoading();
    (onBrowse ? onBrowse() : Promise.resolve([]))
      .then((list) => {
        allPeople = list || [];
        paintList(allPeople);
      })
      .catch(() => paintEmpty('Could not load people.', loadPeople));
  }
  loadPeople();

  let lastQ = '',
    timer = null;
  queryInput.addEventListener('input', () => {
    const q = queryInput.value.trim().toLowerCase();
    clearTimeout(timer);
    // Empty query → restore the full browse list.
    if (q.length === 0) {
      paintList(allPeople);
      lastQ = '';
      return;
    }
    // 1-character query → filter locally (avoids a server round-trip on every keystroke).
    const localFiltered = allPeople.filter(
      (p) =>
        (p.displayName || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)
    );
    paintList(localFiltered);
    if (q.length < 2) return;
    // 2+ chars → also ask the server (catches users not in the recent browse window).
    timer = setTimeout(async () => {
      if (q === lastQ) return;
      lastQ = q;
      try {
        const ppl = await onSearch(q);
        // Merge server results with local filter, dedupe by id, keep stable order.
        const seen = new Set();
        const merged = [];
        [...localFiltered, ...ppl].forEach((p) => {
          if (seen.has(p.id)) return;
          seen.add(p.id);
          merged.push(p);
        });
        paintList(merged);
      } catch (_) {
        /* keep local-filtered view */
      }
    }, 220);
  });

  const sheet = h(
    'div',
    {
      class: 'gb-modal gb-search-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Find people',
    },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Find someone'),
      h('div', { class: 'gb-modal-sub' }, 'Scroll the list or search by name / email.')
    ),
    queryInput,
    resultsEl,
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Close'
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
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    queryInput.focus();
  });
}

/* Minimal styled modal with a list of text/number fields; resolves the entered
   values via onSubmit. Reuses the app's modal CSS (see openNoteModal above). */
function openFormModal({ title, sub, fields, submitLabel, onSubmit }) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay && overlay.remove(), 180);
  }
  const inputs = {};
  const fieldNodes = [];
  fields.forEach((f) => {
    const input = h('input', {
      type: f.type || 'text',
      class: 'gb-input',
      placeholder: f.placeholder || '',
      value: f.value != null ? String(f.value) : '',
      maxlength: f.maxlength || 120,
      min: f.min,
      max: f.max,
    });
    inputs[f.key] = input;
    fieldNodes.push(h('div', { class: 'gb-field-label' }, f.label), input);
  });

  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, title),
      sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
    ),
    h('div', { class: 'gb-modal-body' }, h('div', { class: 'gb-form' }, ...fieldNodes)),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel'),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          onclick: async () => {
            const values = {};
            for (const k in inputs) values[k] = inputs[k].value.trim();
            try {
              await onSubmit(values, close);
            } catch (err) {
              toast.error(err, 'Something went wrong.');
            }
          },
        },
        submitLabel || 'Save'
      )
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
  setTimeout(() => {
    const first = fieldNodes.find((n) => n.tagName === 'INPUT');
    first && first.focus();
  }, 60);
}

/**
 * Circle challenges + leaderboard. Self-managing DOM node: loads the user's
 * circles, lets them create one or start a challenge, and shows each challenge's
 * leaderboard (members ranked by habit check-ins completed in the window).
 */
function ChallengesPanel({ api, currentUserId }) {
  const el = h('div', { class: 'gb-challenges' });

  function leaderboardRows(entries) {
    if (!entries || !entries.length) {
      return [h('div', { class: 'gb-empty-sm' }, 'No check-ins logged yet.')];
    }
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    return entries
      .slice(0, 10)
      .map((m) =>
        h(
          'div',
          { class: 'gb-lb-row' + (m.userId === currentUserId ? ' is-me' : '') },
          h('span', { class: 'gb-lb-rank' }, medals[m.rank] || '#' + m.rank),
          h('span', { class: 'gb-lb-name' }, m.userId === currentUserId ? 'You' : m.name),
          h('span', { class: 'gb-lb-val' }, plural(m.value, 'check-in'))
        )
      );
  }

  function challengeBlock(c) {
    return h(
      'div',
      { class: 'gb-challenge' },
      h(
        'div',
        { class: 'gb-challenge-head' },
        h('div', { class: 'gb-challenge-title' }, c.title),
        h(
          'span',
          { class: 'gb-challenge-badge', 'data-active': String(!!c.active) },
          c.active ? 'Active' : 'Ended'
        )
      ),
      h('div', { class: 'gb-challenge-dates' }, c.startDate + ' → ' + c.endDate),
      h('div', { class: 'gb-lb' }, ...leaderboardRows(c.leaderboard))
    );
  }

  function startChallenge(circleId) {
    openFormModal({
      title: 'Start a challenge',
      sub: 'Most habit check-ins over the window wins.',
      submitLabel: 'Start',
      fields: [
        {
          key: 'title',
          label: 'Title',
          placeholder: 'e.g. 7-day habit sprint',
          value: 'Weekly habit sprint',
        },
        { key: 'days', label: 'Length in days (1–90)', type: 'number', value: 7, min: 1, max: 90 },
      ],
      onSubmit: async (v, close) => {
        if (!v.title) return;
        await api.createChallenge(circleId, {
          title: v.title,
          days: Math.max(1, Math.min(90, Number(v.days) || 7)),
        });
        toast.success('Challenge started!');
        close();
        refresh();
      },
    });
  }

  function newCircle() {
    openFormModal({
      title: 'New circle',
      sub: 'A small group to run challenges together.',
      submitLabel: 'Create',
      fields: [
        { key: 'name', label: 'Name', placeholder: 'e.g. Morning Runners' },
        { key: 'goal', label: 'Shared goal (optional)', placeholder: 'e.g. Move every day' },
      ],
      onSubmit: async (v, close) => {
        if (!v.name) return;
        await api.createCircle({ name: v.name, goal: v.goal || null });
        toast.success('Circle created.');
        close();
        refresh();
      },
    });
  }

  function circleCard(c) {
    const body = h(
      'div',
      { class: 'gb-challenge-body' },
      h('div', { class: 'gb-empty-sm' }, 'Loading…')
    );
    function loadChallenges() {
      api
        .listChallenges(c.id)
        .then((list) => {
          body.replaceChildren();
          if (!list || !list.length) {
            body.appendChild(h('div', { class: 'gb-empty-sm' }, 'No challenges yet — start one!'));
          } else {
            list.forEach((c2) => body.appendChild(challengeBlock(c2)));
          }
          refreshIcons();
        })
        .catch(() =>
          body.replaceChildren(
            h('div', { class: 'gb-empty-sm' }, 'Could not load challenges.'),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--secondary gb-btn--compact',
                onclick: loadChallenges,
              },
              'Try again'
            )
          )
        );
    }
    loadChallenges();

    return h(
      'div',
      { class: 'gb-card gb-circle-card' },
      h(
        'div',
        { class: 'gb-circle-card-head' },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { class: 'gb-circle-name' }, c.name),
          h('div', { class: 'gb-circle-sub' }, plural(c.memberCount, 'member'))
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft gb-btn--compact',
            onclick: () => startChallenge(c.id),
          },
          Icon('flag', { size: 14, sw: 2.4 }),
          'Start challenge'
        )
      ),
      body
    );
  }

  function refresh() {
    api
      .listMine()
      .then((mine) => {
        el.replaceChildren();
        if (!mine || !mine.length) {
          el.appendChild(
            h(
              'div',
              { class: 'gb-card' },
              h(
                'div',
                { class: 'gb-empty' },
                Icon('trophy', { size: 26, color: 'var(--fg3)' }),
                h('p', null, 'Join or create a circle to run habit challenges with friends.')
              )
            )
          );
        } else {
          mine.forEach((c) => el.appendChild(circleCard(c)));
        }
        refreshIcons();
      })
      .catch((err) => {
        el.replaceChildren(
          h(
            'div',
            { class: 'gb-card' },
            h(
              'div',
              { class: 'gb-empty' },
              h('p', null, 'Could not load your circles.'),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--secondary gb-btn--compact',
                  onclick: refresh,
                },
                'Try again'
              )
            )
          )
        );
        void err;
      });
  }

  refresh();

  const actions = h(
    'div',
    { class: 'gb-challenges-actions' },
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: openBrowse },
      Icon('search', { size: 14, sw: 2.4 }),
      'Browse'
    ),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact', onclick: newCircle },
      Icon('plus', { size: 14, sw: 2.6 }),
      'New circle'
    )
  );

  function openBrowse() {
    api
      .listAll()
      .then((all) => {
        const joinable = (all || []).filter((c) => !c.joined);
        if (!joinable.length) {
          toast.success('You are already in every circle.');
          return;
        }
        const list = h('div', { class: 'gb-form' });
        joinable.forEach((c) => {
          list.appendChild(
            h(
              'div',
              { class: 'gb-browse-row' },
              h(
                'div',
                { style: { minWidth: 0 } },
                h('div', { class: 'gb-circle-name' }, c.name),
                h('div', { class: 'gb-circle-sub' }, plural(c.memberCount, 'member'))
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-btn--compact',
                  onclick: async (e) => {
                    try {
                      await api.join(c.id);
                      e.target.closest('.gb-browse-row').remove();
                      toast.success('Joined ' + c.name + '.');
                      refresh();
                    } catch (err) {
                      toast.error(err, 'Could not join.');
                    }
                  },
                },
                'Join'
              )
            )
          );
        });
        openSheet('Browse circles', list);
      })
      .catch((err) => toast.error(err, 'Could not load circles.'));
  }

  return { node: h('div', null, actions, el) };
}

/* Lightweight read-only sheet for a prebuilt body node (used by Browse). */
function openSheet(title, bodyNode) {
  let overlay;
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(() => overlay && overlay.remove(), 180);
  }
  const sheet = h(
    'div',
    { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-modal-title' }, title)),
    h('div', { class: 'gb-modal-body' }, bodyNode),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      h('button', { type: 'button', class: 'gb-btn gb-btn--primary', onclick: close }, 'Close')
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
}

function ScreenCircle({
  onSearch,
  onSendInvite,
  onLoadOutgoing,
  onLoadIncoming,
  onLoadStatus,
  onBrowse,
  onRevoke,
  challengesApi,
  currentUserId,
}) {
  const outgoingEl = h('div');

  const incomingEl = h('div');

  function openNoteModal(person, direction) {
    const verb = direction === 'offer' ? 'mentor them' : 'ask them to mentor you';
    let overlay;
    const noteInput = h('textarea', {
      class: 'gb-input gb-input--about',
      maxlength: '500',
      placeholder: 'Add a short note (optional)',
    });

    function close() {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay && overlay.remove(), 180);
    }

    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add a short note' },
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, 'Add a short note'),
        h('div', { class: 'gb-modal-sub' }, verb + ' (' + person.displayName + ')')
      ),
      h(
        'div',
        { class: 'gb-modal-body' },
        h(
          'div',
          { class: 'gb-form' },
          h('div', { class: 'gb-field-label' }, 'Note (optional)'),
          noteInput,
          h('div', { class: 'gb-note-hint' }, 'Keep it short and friendly.')
        )
      ),
      h(
        'div',
        { class: 'gb-water-prompt-actions' },
        h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel'),
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            onclick: async () => {
              try {
                await onSendInvite(person.id, direction, noteInput.value.trim() || null);
                toast.success('Invite sent to ' + person.displayName + '.');
                refreshOutgoing();
                close();
              } catch (err) {
                toast.error(err, 'Could not send invite.');
              }
            },
          },
          'Send invite'
        )
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
    setTimeout(() => noteInput.focus(), 60);
  }

  function promptAndSend(person, direction) {
    openNoteModal(person, direction);
  }

  function revokeAndRefresh(reqId) {
    onRevoke(reqId)
      .then(() => {
        refreshOutgoing();
        refreshIncoming();
      })
      .catch((err) => toast.error(err, 'Could not revoke.'));
  }

  let cachedOutgoing = [];
  let cachedIncoming = [];

  function paint() {
    // Connections: every ACCEPTED relationship from either side, merged.
    const accepted = [];
    cachedOutgoing
      .filter((r) => r.status === 'accepted')
      .forEach((r) =>
        accepted.push({ side: 'outgoing', req: r, partnerName: r.toName, partnerId: r.toUserId })
      );
    cachedIncoming
      .filter((r) => r.status === 'accepted')
      .forEach((r) =>
        accepted.push({
          side: 'incoming',
          req: r,
          partnerName: r.fromName,
          partnerId: r.fromUserId,
        })
      );

    incomingEl.replaceChildren();
    if (!accepted.length) {
      incomingEl.appendChild(
        h(
          'div',
          { class: 'gb-card' },
          h(
            'div',
            { class: 'gb-empty' },
            Icon('users', { size: 26, color: 'var(--fg3)' }),
            h('p', null, 'No connections yet. Send an invite to get started.')
          )
        )
      );
    } else {
      const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
      accepted.forEach((item) =>
        card.appendChild(
          item.side === 'incoming'
            ? IncomingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
            : OutgoingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
        )
      );
      incomingEl.appendChild(card);
    }

    // Your invites: only OUTGOING + still meaningful to show. Cancelled
    // invites are hidden — once revoked, the user doesn't want to keep
    // seeing them. Rejected stays visible briefly so you know the result.
    const invites = cachedOutgoing.filter(
      (r) => r.status !== 'accepted' && r.status !== 'cancelled'
    );
    outgoingEl.replaceChildren();
    if (!invites.length) {
      outgoingEl.appendChild(
        h(
          'div',
          { class: 'gb-card' },
          h(
            'div',
            { class: 'gb-empty' },
            Icon('mail', { size: 26, color: 'var(--fg3)' }),
            h('p', null, 'No pending invites right now.')
          )
        )
      );
    } else {
      const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
      invites.forEach((r) =>
        card.appendChild(OutgoingRow(r, onLoadStatus, onRevoke ? revokeAndRefresh : null))
      );
      outgoingEl.appendChild(card);
    }
    refreshIcons();
  }

  function refreshOutgoing() {
    onLoadOutgoing()
      .then((list) => {
        cachedOutgoing = list || [];
        paint();
      })
      .catch(() => {
        /* silent */
      });
  }
  function refreshIncoming() {
    if (!onLoadIncoming) return;
    onLoadIncoming()
      .then((list) => {
        cachedIncoming = list || [];
        paint();
      })
      .catch(() => {
        /* silent */
      });
  }

  refreshAll();

  function refreshAll() {
    refreshOutgoing();
    refreshIncoming();
  }

  function launchSearch() {
    openSearchModal({
      onBrowse,
      onSearch,
      onOffer: (person) => promptAndSend(person, 'offer'),
      onRequest: (person) => promptAndSend(person, 'request'),
      onView: (person) => showPartnerStatus(person.id, person.displayName, onLoadStatus),
    });
  }

  const addBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      style: { width: 'auto', padding: '8px 14px', fontSize: '13px' },
      onclick: launchSearch,
    },
    Icon('plus', { size: 14, sw: 2.6 }),
    'Find someone'
  );

  const challengesPanel = challengesApi
    ? ChallengesPanel({ api: challengesApi, currentUserId }).node
    : null;

  return h(
    'div',
    { class: 'gb-rise', style: { padding: '0 0 24px' } },
    h(
      'div',
      {
        style: {
          padding: '6px 20px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '10px',
        },
      },
      h(
        'div',
        null,
        h(
          'h3',
          {
            style: {
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: '18px',
              margin: '0 0 4px',
            },
          },
          'Growth Circle'
        ),
        h(
          'p',
          { style: { color: 'var(--fg3)', fontSize: '13px', margin: 0 } },
          'Your mentors, your mentees, and your sent invites.'
        )
      ),
      addBtn
    ),
    h(
      'div',
      { style: { padding: '18px 20px 6px' } },
      h(
        'h4',
        {
          style: {
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '15px',
            margin: '0 0 10px',
          },
        },
        'Connections'
      )
    ),
    h('div', { style: { padding: '0 20px' } }, incomingEl),
    h(
      'div',
      { style: { padding: '18px 20px 6px' } },
      h(
        'h4',
        {
          style: {
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '15px',
            margin: '0 0 10px',
          },
        },
        'Your invites'
      )
    ),
    h('div', { style: { padding: '0 20px' } }, outgoingEl),
    challengesPanel
      ? h(
          'div',
          { style: { padding: '22px 20px 6px' }, class: 'gb-challenges-head-wrap' },
          h(
            'div',
            {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
              },
            },
            h(
              'h4',
              {
                style: {
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: '15px',
                  margin: 0,
                },
              },
              'Challenges'
            )
          )
        )
      : null,
    challengesPanel ? h('div', { style: { padding: '0 20px' } }, challengesPanel) : null
  );
}

export { ScreenCircle };
