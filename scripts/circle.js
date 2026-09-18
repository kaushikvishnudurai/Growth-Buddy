/* =====================================================================
   Growth Buddy — Growth Circle (search people + mentorship invites)
   ===================================================================== */
import {
  h,
  activate,
  Icon,
  Avatar,
  plural,
  refreshIcons,
  confirmDialog,
  openOverlay,
} from './gb-kit.js';
import { toast } from './toast.js';

/* Placeholder rows, so a section has its real height before the data lands.
   Every section on this screen used to start empty: the page rendered as three
   headings over nothing and then jumped as each card arrived. */
function sectionSkeleton(rows) {
  const line = (w) => h('div', { class: 'gb-skel-line', style: { width: w } });
  const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
  for (let i = 0; i < rows; i++) {
    card.appendChild(
      h(
        'div',
        { class: 'gb-row' },
        h('div', { class: 'gb-skel-avatar' }),
        h('div', { class: 'gb-skel-lines' }, line('55%'), line('35%'))
      )
    );
  }
  return card;
}

/**
 * One person in "Find someone".
 *
 * The two mentorship directions are INDEPENDENT — you can mentor someone and
 * be mentored by them at the same time — so each direction gets its own
 * control instead of the pair collapsing into a single status pill. Both slots
 * always render, which also keeps every row the same height while the list
 * loads (see the note on `.gb-person-actions` in app.css).
 */
function PersonRow(person, onOffer, onRequest, onView) {
  // Defensive: the browse/search endpoints already exclude the caller, but a
  // stale cached payload must never offer you an invite to yourself.
  if ((person.relationship || 'none') === 'self') return null;

  const link = (which) =>
    person[which] || (person.relationship === (which === 'mentorLink' ? 'mentoring' : 'mentee') ? 'active' : 'none');

  /* `viewable` is the mentor side only. Progress flows one way — see
     showPartnerStatus — so the "they mentor you" pill is a label, not a door. */
  function slot(state, activeLabel, pendingLabel, actionLabel, icon, btnClass, onAct, viewable) {
    if (state === 'active') {
      if (!viewable) return h('span', { class: 'gb-tag-pill is-accepted' }, activeLabel);
      return h(
        'span',
        {
          class: 'gb-tag-pill is-accepted',
          style: { cursor: 'pointer' },
          ...activate(() => onView(person)),
        },
        activeLabel + ' \u203a'
      );
    }
    if (state === 'pending') {
      return h('span', { class: 'gb-tag-pill is-pending' }, pendingLabel);
    }
    return h(
      'button',
      {
        type: 'button',
        class: 'gb-btn ' + btnClass,
        style: { width: 'auto', padding: '8px 12px', fontSize: '0.78125rem' },
        onclick: () => onAct(person),
      },
      Icon(icon, { size: 14, sw: 2.4 }),
      actionLabel
    );
  }

  return h(
    'div',
    { class: 'gb-row gb-person-row' },
    Avatar({ name: person.displayName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
    h(
      'div',
      { class: 'gb-person-id' },
      h('div', { class: 'title' }, person.displayName),
      h(
        'div',
        { class: 'sub' },
        (person.email ? person.email + ' \u00b7 ' : '') + 'Level ' + person.level
      )
    ),
    h(
      'div',
      { class: 'gb-person-actions' },
      slot(
        link('mentorLink'),
        'You mentor them',
        'Offer sent',
        'Mentor them',
        'hand-helping',
        'gb-btn--soft',
        onOffer,
        true
      ),
      slot(
        link('menteeLink'),
        'They mentor you',
        'Request sent',
        'Get mentored',
        'user-plus',
        'gb-btn--secondary',
        onRequest,
        false
      )
    )
  );
}

/**
 * Status window for a MENTEE. Shows their level, current task progress, and
 * habit streaks — for their mentor only, the way a manager sees a report's
 * work and not the other way round. Callers must gate on being the mentor;
 * the endpoint enforces it (403 for the mentee side), this is just the UI
 * not offering a tap that would fail.
 */
function showPartnerStatus(partnerId, fallbackName, statusApi, onChecked) {
  const { sheet: card, close } = openOverlay({ label: fallbackName });
  const subEl = h('div', { class: 'gb-modal-sub' }, 'Loading…');
  const taskBlock = h('div', { class: 'gb-status-block' });
  const habitBlock = h('div', { class: 'gb-status-block' });
  card.append(
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
  refreshIcons();

  statusApi(partnerId)
    .then((data) => {
      if (onChecked) onChecked();
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

/**
 * "Did I check on this mentee today?"
 *
 * <p>The server stamps `checkedAt` when the mentee's progress sheet loads, so
 * the tick means the mentor actually opened it — not that they tapped a button.
 * It's an instant, compared against the reader's LOCAL day here: the backend
 * has no idea what timezone the mentor is in, and "today" is their word.
 * Nothing to expire, so there is no nightly job to get wrong.
 */
function checkedToday(iso) {
  if (!iso) return false;
  const then = new Date(iso);
  const now = new Date();
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

/* Paints in place so opening the sheet can flip the pill without a repaint. */
function paintCheckPill(el, req) {
  const done = checkedToday(req.checkedAt);
  el.className = 'gb-check-pill' + (done ? ' is-done' : '');
  el.title = done ? 'You checked on them today' : 'You have not checked on them today';
  el.replaceChildren(
    Icon('check', { size: 13, sw: 3 }),
    h('span', null, done ? 'Checked today' : 'Not checked')
  );
}

function CheckPill(req) {
  const el = h('span', null);
  paintCheckPill(el, req);
  return el;
}

/* Raw status enums read as jargon — show plain words instead. */
const STATUS_LABELS = { pending: 'Invite pending', accepted: 'Connected', rejected: 'Declined' };
function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function OutgoingRow(req, statusApi, onRevoke) {
  const isAccepted = req.status === 'accepted';
  const isPending = req.status === 'pending';
  // I sent it, so an 'offer' makes me the mentor — and only a mentor may open
  // the other side's progress. A 'request' I sent made them MY mentor: that row
  // stays a plain row (the endpoint 403s that direction anyway).
  const canViewStatus = isAccepted && req.direction === 'offer';
  const canRevoke = (isAccepted || isPending) && !!onRevoke;
  const label =
    req.direction === 'offer'
      ? isAccepted
        ? 'You mentor ' + req.toName
        : 'You offered to mentor ' + req.toName
      : isAccepted
        ? req.toName + ' mentors you'
        : 'You asked ' + req.toName + ' to mentor you';
  // A mentee row lives in a card headed "You mentor" and every row in it is
  // accepted — so "Connected" says nothing. The tick does: it's the one thing
  // a mentor wants at a glance, which of their people they've looked in on today.
  const checkPill = canViewStatus ? CheckPill(req) : null;
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
      class: 'gb-row' + (canViewStatus ? ' is-clickable' : ''),
      ...(canViewStatus
        ? activate((e) => {
            if (e.target.closest && e.target.closest('.gb-revoke-btn')) return;
            showPartnerStatus(req.toUserId, req.toName, statusApi, () => {
              req.checkedAt = new Date().toISOString();
              paintCheckPill(checkPill, req);
              refreshIcons();
            });
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
    checkPill || h('span', { class: statusClass }, statusLabel(req.status)),
    // The chevron promises a tap target, so it belongs only on rows that have one.
    canViewStatus ? Icon('chevron-right', { size: 16, sw: 2.4, color: 'var(--fg3)' }) : null,
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
  // They sent it: a 'request' asked me to mentor them, so I'm the mentor. An
  // 'offer' made them mine — no progress window back up the chain.
  const canViewStatus = isAccepted && req.direction !== 'offer';
  const label =
    req.direction === 'offer'
      ? isAccepted
        ? req.fromName + ' mentors you'
        : req.fromName + ' offered to mentor you'
      : isAccepted
        ? 'You mentor ' + req.fromName
        : req.fromName + ' asked you to mentor them';
  const checkPill = canViewStatus ? CheckPill(req) : null;
  const statusClass = 'gb-tag-pill is-' + req.status;
  return h(
    'div',
    {
      class: 'gb-row' + (canViewStatus ? ' is-clickable' : ''),
      ...(canViewStatus
        ? activate((e) => {
            if (e.target.closest && e.target.closest('.gb-revoke-btn')) return;
            showPartnerStatus(req.fromUserId, req.fromName, statusApi, () => {
              req.checkedAt = new Date().toISOString();
              paintCheckPill(checkPill, req);
              refreshIcons();
            });
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
    checkPill || h('span', { class: statusClass }, statusLabel(req.status)),
    // The chevron promises a tap target, so it belongs only on rows that have one.
    canViewStatus ? Icon('chevron-right', { size: 16, sw: 2.4, color: 'var(--fg3)' }) : null,
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
function openSearchModal({ onBrowse, onSearch, onOffer, onRequest, onView, currentUserId }) {
  const { sheet, close } = openOverlay({ label: 'Find people', className: 'gb-search-modal' });
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
    // You are never a person you can invite. The endpoints already exclude the
    // caller, so this only catches a stale cached payload — but it is the one
    // place every list (browse, local filter, merged server search) passes
    // through, so one guard here covers all three.
    const people = (list || []).filter((p) => p && p.id !== currentUserId);
    if (!people.length) {
      paintEmpty('No matches.');
      return;
    }
    resultsEl.replaceChildren();
    people.forEach((p) => {
      const row = PersonRow(
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
      );
      if (row) resultsEl.appendChild(row);
    });
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

  sheet.append(
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
  refreshIcons();
  requestAnimationFrame(() => queryInput.focus());
}

/* Minimal styled modal with a list of text/number fields; resolves the entered
   values via onSubmit. Reuses the app's modal CSS (see openNoteModal above). */
function openFormModal({ title, sub, fields, submitLabel, onSubmit }) {
  const { sheet, close } = openOverlay({ label: title });  const inputs = {};
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

  // Disabled while submitting — a second tap here used to send a duplicate invite
  // (matches openModal in app.js).
  const submitBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      onclick: async () => {
        const values = {};
        for (const k in inputs) values[k] = inputs[k].value.trim();
        try {
          submitBtn.disabled = true;
          await onSubmit(values, close);
        } catch (err) {
          toast.error(err, 'Something went wrong.');
        } finally {
          submitBtn.disabled = false;
        }
      },
    },
    submitLabel || 'Save'
  );
  sheet.append(
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
      submitBtn
    )
  );
  refreshIcons();
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
  const el = h('div', { class: 'gb-challenges' }, sectionSkeleton(1));

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
  const { sheet, close } = openOverlay({ label: title });
  sheet.append(
    h('div', { class: 'gb-modal-head' }, h('div', { class: 'gb-modal-title' }, title)),
    h('div', { class: 'gb-modal-body' }, bodyNode),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      h('button', { type: 'button', class: 'gb-btn gb-btn--primary', onclick: close }, 'Close')
    )
  );
  refreshIcons();
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
  const outgoingEl = h('div', { class: 'gb-circle-section' }, sectionSkeleton(1));

  const incomingEl = h('div', { class: 'gb-circle-section' }, sectionSkeleton(2));

  function openNoteModal(person, direction) {
    const verb = direction === 'offer' ? 'mentor them' : 'ask them to mentor you';
    const noteInput = h('textarea', {
      class: 'gb-input gb-input--about',
      maxlength: '500',
      placeholder: 'Add a short note (optional)',
    });

    const { sheet, close } = openOverlay({ label: 'Add a short note' });
    sheet.append(
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
                refreshAll();
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
    refreshIcons();
    setTimeout(() => noteInput.focus(), 60);
  }

  function promptAndSend(person, direction) {
    openNoteModal(person, direction);
  }

  function revokeAndRefresh(reqId) {
    onRevoke(reqId)
      .then(() => {
        refreshAll();
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

    /* Which side of each link am I on? Same rule the rows use for the progress
       window: an offer I sent, or a request sent to me, makes me the mentor.
       One flat list read as a jumble of "You mentor X" / "Y mentors you" — the
       two are different jobs, so they get different boxes. */
    const iMentor = (item) =>
      item.side === 'outgoing' ? item.req.direction === 'offer' : item.req.direction !== 'offer';
    const row = (item) =>
      item.side === 'incoming'
        ? IncomingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
        : OutgoingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null);

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
      [
        { title: 'You mentor', items: accepted.filter(iMentor) },
        { title: 'Who mentors you', items: accepted.filter((it) => !iMentor(it)) },
      ]
        .filter((g) => g.items.length)
        .forEach((g) => {
          const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
          g.items.forEach((item) => card.appendChild(row(item)));
          incomingEl.appendChild(
            h(
              'div',
              { class: 'gb-conn-group' },
              h('h5', { class: 'gb-conn-group-head' }, g.title, h('span', null, g.items.length)),
              card
            )
          );
        });
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

  /**
   * ONE paint per load. Outgoing and incoming used to resolve independently and
   * each called paint(), so the screen rendered twice with half the data — the
   * Connections card flipped from "No connections yet" to the real list as the
   * second response landed, and the page visibly jumped. Waiting for both means
   * the first paint is the final one.
   */
  function refreshAll() {
    const outgoing = onLoadOutgoing().catch(() => cachedOutgoing);
    const incoming = onLoadIncoming ? onLoadIncoming().catch(() => cachedIncoming) : Promise.resolve([]);
    return Promise.all([outgoing, incoming]).then(([out, inc]) => {
      cachedOutgoing = out || [];
      cachedIncoming = inc || [];
      paint();
    });
  }

  refreshAll();

  function launchSearch() {
    openSearchModal({
      onBrowse,
      onSearch,
      currentUserId,
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
      style: {
        width: 'auto',
        flex: 'none',
        whiteSpace: 'nowrap',
        padding: '8px 14px',
        fontSize: '0.8125rem',
      },
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
              fontSize: '1.125rem',
              margin: '0 0 4px',
            },
          },
          'Growth Circle'
        ),
        h(
          'p',
          { style: { color: 'var(--fg3)', fontSize: '0.8125rem', margin: 0 } },
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
            fontSize: '0.9375rem',
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
            fontSize: '0.9375rem',
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
                  fontSize: '0.9375rem',
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
