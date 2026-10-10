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
    person[which] ||
    (person.relationship === (which === 'mentorLink' ? 'mentoring' : 'mentee') ? 'active' : 'none');

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
    ? {
        title: 'Remove this connection?',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
        danger: true,
      }
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
 * A PENDING invite addressed to me, with Accept / Decline. Before this the
 * Circle screen showed incoming rows only once accepted, so an invite could be
 * answered from the bell and nowhere else — and a cleared bell lost it.
 */
function RequestRow(req, onRespond) {
  const label =
    req.direction === 'offer'
      ? req.fromName + ' offered to mentor you'
      : req.fromName + ' asked you to mentor them';
  const row = h('div', { class: 'gb-row gb-request-row' });
  const respond = async (accept) => {
    const buttons = row.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      await onRespond(req.id, accept);
    } catch (err) {
      buttons.forEach((b) => (b.disabled = false));
      toast.error(err, 'Could not respond to invite.');
    }
  };
  row.append(
    Avatar({ name: req.fromName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { class: 'title' }, label),
      h('div', { class: 'sub' }, req.note ? '“' + req.note + '”' : '')
    ),
    h(
      'div',
      { class: 'gb-request-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost gb-btn--compact',
          onclick: () => respond(false),
        },
        'Decline'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-btn--compact',
          onclick: () => respond(true),
        },
        'Accept'
      )
    )
  );
  return row;
}

/* ---- Inside an accepted link: cheer / nudge, the thread, agreement, this week ---- */

/* The reader's local calendar day as YYYY-MM-DD (what <input type=date> speaks). */
function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function shortDay(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/* Cheer or nudge, with an optional line. The server caps it at three a day per
   sender per link and says so (429) — the form's toast shows that message. */
function askNudge(mApi, linkId, kind, partnerName) {
  const cheer = kind === 'cheer';
  openFormModal({
    title: cheer ? 'Cheer ' + partnerName + ' on' : 'Nudge ' + partnerName,
    sub: cheer
      ? 'A quick “keep going” lands on their bell.'
      : 'A gentle reminder that you’re in this together.',
    submitLabel: cheer ? 'Send cheer' : 'Send nudge',
    fields: [
      {
        key: 'text',
        label: 'Add a line (optional)',
        placeholder: cheer ? 'e.g. Five days straight — brilliant!' : 'e.g. How did today go?',
        maxlength: 140,
      },
    ],
    onSubmit: async (v, close) => {
      await mApi.nudge(linkId, kind, v.text || null);
      toast.success((cheer ? 'Cheer' : 'Nudge') + ' sent to ' + partnerName + '.');
      close();
    },
  });
}

/**
 * The thread for one link. Newest 50 on open ("Load older" for the page before);
 * new lines from the partner arrive live as `gb:mentorship-message` (app.js
 * re-dispatches the server's transient frame), deduped by id so a line can't
 * land twice when the socket and the POST answer race.
 */
function openChat(mApi, linkId, partnerName, currentUserId) {
  const PAGE = 50;
  let items = []; // oldest first
  const seen = new Set();
  const log = h('div', {
    class: 'gb-chat-log',
    role: 'log',
    'aria-live': 'polite',
    'aria-label': 'Messages with ' + partnerName,
    tabindex: '0',
  });
  const older = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--ghost gb-btn--compact',
      hidden: true,
      onclick: () => load(items.length ? items[0].createdAt : null),
    },
    'Load older'
  );
  const input = h('textarea', {
    class: 'gb-input gb-chat-input',
    rows: 2,
    maxlength: '2000',
    placeholder: 'Message ' + partnerName + '…',
    'aria-label': 'Write a message to ' + partnerName,
  });

  function line(m) {
    const mine = m.senderId === currentUserId;
    const when = new Date(m.createdAt).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    if (m.kind === 'cheer' || m.kind === 'nudge') {
      const what =
        m.kind === 'cheer'
          ? mine
            ? 'You sent a cheer'
            : (m.senderName || partnerName) + ' cheered you on'
          : mine
            ? 'You sent a nudge'
            : (m.senderName || partnerName) + ' nudged you';
      return h(
        'div',
        { class: 'gb-chat-event' },
        Icon(m.kind === 'cheer' ? 'sparkles' : 'bell', { size: 13, sw: 2.4 }),
        h('span', null, what + (m.body ? ': “' + m.body + '”' : '')),
        h('time', { datetime: m.createdAt }, when)
      );
    }
    return h(
      'div',
      { class: 'gb-chat-msg' + (mine ? ' is-mine' : '') },
      h('div', { class: 'gb-chat-bubble' }, m.body),
      h(
        'time',
        { class: 'gb-chat-time', datetime: m.createdAt },
        (mine ? 'You' : m.senderName) + ' · ' + when
      )
    );
  }
  function paint(stickToBottom) {
    log.replaceChildren(
      ...(items.length
        ? items.map(line)
        : [
            h(
              'div',
              { class: 'gb-empty-sm' },
              'No messages yet. Say hello to ' + partnerName + '.'
            ),
          ])
    );
    refreshIcons();
    if (stickToBottom) log.scrollTop = log.scrollHeight;
  }
  function add(m) {
    if (!m || !m.id || seen.has(m.id)) return;
    seen.add(m.id);
    items.push(m);
    paint(true);
  }
  function load(before) {
    older.disabled = true;
    mApi
      .listMessages(linkId, before)
      .then((page) => {
        page = page || [];
        const fresh = page.filter((m) => !seen.has(m.id));
        fresh.forEach((m) => seen.add(m.id));
        items = fresh.concat(items);
        older.hidden = page.length < PAGE;
        paint(!before);
      })
      .catch((err) => {
        if (!items.length) {
          log.replaceChildren(
            h('div', { class: 'gb-empty-sm' }, (err && err.message) || 'Could not load messages.')
          );
        } else {
          toast.error(err, 'Could not load older messages.');
        }
      })
      .finally(() => {
        older.disabled = false;
      });
  }

  const sendBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary gb-btn--compact',
      onclick: async () => {
        const body = input.value.trim();
        if (!body || sendBtn.disabled) return;
        sendBtn.disabled = true;
        try {
          add(await mApi.sendMessage(linkId, body));
          input.value = '';
          input.focus();
        } catch (err) {
          toast.error(err, 'Could not send that.');
        } finally {
          sendBtn.disabled = false;
        }
      },
    },
    Icon('send', { size: 14, sw: 2.4 }),
    'Send'
  );
  // Ctrl/⌘+Enter sends; plain Enter is a new line (a phone keyboard's Enter).
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  const onLive = (e) => {
    const m = e.detail;
    if (m && m.linkId === linkId) add(m);
  };
  window.addEventListener('gb:mentorship-message', onLive);
  const { sheet, close } = openOverlay({
    label: 'Messages with ' + partnerName,
    className: 'gb-chat-sheet',
    onClose: () => window.removeEventListener('gb:mentorship-message', onLive),
  });
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, partnerName),
      h('div', { class: 'gb-modal-sub' }, 'Only the two of you can see this.')
    ),
    h('div', { class: 'gb-chat-body' }, older, log),
    h('div', { class: 'gb-circle-composer gb-chat-composer' }, input, sendBtn),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      'Close'
    )
  );
  log.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Loading…'));
  refreshIcons();
  load(null);
  setTimeout(() => input.focus(), 60);
}

/* The mentor's "This week" card: the mentee's check-ins Monday → today (their
   week, their zone), against last week, and their streaks. Server-gated: the
   mentee side 403s, and progress sharing off comes back as `shared: false`. */
function WeekCard(mApi, linkId, partnerName) {
  const el = h('div', { class: 'gb-week-card' }, h('div', { class: 'gb-empty-sm' }, 'Loading…'));
  mApi
    .week(linkId)
    .then((w) => {
      const head = h(
        'div',
        { class: 'gb-week-head' },
        h('strong', null, 'This week'),
        h('span', null, 'since ' + shortDay(w.weekStart))
      );
      if (!w.shared) {
        el.replaceChildren(
          head,
          h('div', { class: 'gb-empty-sm' }, partnerName + ' keeps their progress private.')
        );
        return;
      }
      const diff = w.checkins - w.lastWeekCheckins;
      const trend =
        diff === 0
          ? 'same as last week'
          : diff > 0
            ? diff + ' more than last week'
            : -diff + ' fewer than last week';
      const streaks = (w.streaks || [])
        .slice()
        .sort((a, b) => b.streak - a.streak)
        .slice(0, 5);
      el.replaceChildren(
        head,
        h(
          'div',
          { class: 'gb-week-stat' },
          h('span', { class: 'gb-week-num' }, String(w.checkins)),
          h('span', null, (w.checkins === 1 ? 'check-in' : 'check-ins') + ' · ' + trend)
        ),
        streaks.length
          ? h(
              'ul',
              { class: 'gb-week-streaks' },
              ...streaks.map((s) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'gb-week-habit' }, s.name),
                  h(
                    'span',
                    { class: 'gb-week-streak' },
                    plural(s.streak, 'day') + (s.doneToday ? ' · done today' : '')
                  )
                )
              )
            )
          : h('div', { class: 'gb-empty-sm' }, 'No habits tracked yet.')
      );
    })
    .catch((err) =>
      el.replaceChildren(
        h('div', { class: 'gb-empty-sm' }, (err && err.message) || 'Could not load this week.')
      )
    );
  return el;
}

/* Under each accepted connection: the pair's agreement (either side edits it),
   Cheer / Nudge / Message, and — mentor side only — the weekly card. */
function LinkExtras(req, partnerName, isMentor, mApi, currentUserId) {
  const agreementBtn = h('button', {
    type: 'button',
    class: 'gb-conn-agreement',
    onclick: () =>
      openFormModal({
        title: 'Your agreement',
        sub: 'What you and ' + partnerName + ' are working on. You both see it.',
        submitLabel: 'Save',
        fields: [
          {
            key: 'text',
            label: 'Agreement',
            placeholder: 'e.g. 30 min of DSA, 5 days a week',
            value: req.agreement || '',
            maxlength: 500,
          },
        ],
        onSubmit: async (v, close) => {
          const res = await mApi.setAgreement(req.id, v.text);
          req.agreement = res && res.agreement;
          paintAgreement();
          close();
        },
      }),
  });
  function paintAgreement() {
    agreementBtn.classList.toggle('is-empty', !req.agreement);
    agreementBtn.setAttribute(
      'aria-label',
      req.agreement
        ? 'Agreement: ' + req.agreement + '. Edit'
        : 'Set your agreement with ' + partnerName
    );
    agreementBtn.replaceChildren(
      Icon('target', { size: 13, sw: 2.4 }),
      h('span', null, req.agreement || 'Set what you’re working on together'),
      Icon('pencil', { size: 12, sw: 2.4 })
    );
    refreshIcons();
  }
  paintAgreement();

  const tool = (icon, label, onclick, extra) =>
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-btn--compact', onclick, ...(extra || {}) },
      Icon(icon, { size: 14, sw: 2.4 }),
      label
    );
  const weekSlot = h('div', { class: 'gb-week-slot' });
  let weekBtn = null;
  if (isMentor) {
    weekBtn = tool(
      'calendar-check',
      'This week',
      () => {
        const open = weekBtn.getAttribute('aria-expanded') !== 'true';
        weekBtn.setAttribute('aria-expanded', String(open));
        // Refetched on every open: it's a live number, and one request per tap.
        weekSlot.replaceChildren(...(open ? [WeekCard(mApi, req.id, partnerName)] : []));
      },
      { 'aria-expanded': 'false' }
    );
  }
  return h(
    'div',
    { class: 'gb-conn-extra' },
    agreementBtn,
    h(
      'div',
      { class: 'gb-conn-tools' },
      tool('sparkles', 'Cheer', () => askNudge(mApi, req.id, 'cheer', partnerName), {
        'aria-label': 'Cheer ' + partnerName + ' on',
      }),
      tool('bell', 'Nudge', () => askNudge(mApi, req.id, 'nudge', partnerName), {
        'aria-label': 'Nudge ' + partnerName,
      }),
      tool('message-circle', 'Message', () => openChat(mApi, req.id, partnerName, currentUserId), {
        'aria-label': 'Message ' + partnerName,
      }),
      weekBtn
    ),
    weekSlot
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
    placeholder: 'Search by name…',
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
    timer = null,
    seq = 0; // bumped on every keystroke; a server answer for an older one is dropped
  queryInput.addEventListener('input', () => {
    const q = queryInput.value.trim().toLowerCase();
    const mine = ++seq;
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
        if (mine !== seq) return;
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
      h('div', { class: 'gb-modal-sub' }, 'Scroll the list or search by name.')
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
  const { sheet, close } = openOverlay({ label: title });
  const inputs = {};
  const fieldNodes = [];
  fields.forEach((f) => {
    if (f.type === 'checkbox') {
      // A yes/no field: label and box on one line, value read as a boolean.
      const box = h('input', { type: 'checkbox', checked: !!f.value });
      inputs[f.key] = box;
      fieldNodes.push(
        h(
          'label',
          { class: 'gb-form-check' },
          box,
          h('span', null, f.label, f.hint ? h('small', null, f.hint) : null)
        )
      );
      return;
    }
    if (f.type === 'select') {
      // A fixed choice (the challenge's metric): options [{ value, label }].
      const sel = h(
        'select',
        { class: 'gb-input', 'aria-label': f.label },
        ...f.options.map((o) => h('option', { value: o.value }, o.label))
      );
      if (f.value != null) sel.value = String(f.value);
      inputs[f.key] = sel;
      fieldNodes.push(h('div', { class: 'gb-field-label' }, f.label), sel);
      return;
    }
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
        for (const k in inputs) {
          values[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : inputs[k].value.trim();
        }
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
      submitBtn,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel')
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
 * leaderboard (members ranked by the challenge's metric — habit check-ins, focus
 * minutes or water-goal days — over the window; a future start shows "Upcoming").
 */
function ChallengesPanel({ api, currentUserId }) {
  const el = h('div', { class: 'gb-challenges' }, sectionSkeleton(1));

  // Gold, silver, bronze for the top three; the rest keep their number. These
  // shades clear 3:1 on both light and dark cards (the 500s fade out on white).
  const MEDAL_COLOR = { 1: 'var(--sun-700)', 2: 'var(--warm-500)', 3: 'var(--coral-600)' };
  // What a challenge counts (ChallengeMetrics.Metric server-side). A challenge
  // from before the column has no metric and counted check-ins.
  const METRICS = {
    habit_checkins: {
      label: 'Habit check-ins',
      unit: (v) => plural(v, 'check-in'),
      empty: 'No check-ins logged yet.',
    },
    focus_minutes: {
      label: 'Focus minutes',
      unit: (v) => v + ' min',
      empty: 'No focus time logged yet.',
    },
    water_days: {
      label: 'Days on the water goal',
      unit: (v) => plural(v, 'day'),
      empty: 'Nobody has hit their water goal yet.',
    },
  };
  const metricOf = (c) => METRICS[c && c.metric] || METRICS.habit_checkins;
  function leaderboardRows(entries, c) {
    const metric = metricOf(c);
    if (c && c.startDate > localISO()) {
      return [h('div', { class: 'gb-empty-sm' }, 'Starts ' + shortDay(c.startDate) + '.')];
    }
    if (!entries || !entries.length) {
      return [h('div', { class: 'gb-empty-sm' }, metric.empty)];
    }
    return entries
      .slice(0, 10)
      .map((m) =>
        h(
          'div',
          { class: 'gb-lb-row' + (m.userId === currentUserId ? ' is-me' : '') },
          m.rank <= 3
            ? h(
                'span',
                { class: 'gb-lb-rank', 'aria-label': 'Rank ' + m.rank, title: 'Rank ' + m.rank },
                Icon('medal', { size: 18, sw: 2.2, color: MEDAL_COLOR[m.rank] })
              )
            : h('span', { class: 'gb-lb-rank' }, '#' + m.rank),
          h('span', { class: 'gb-lb-name' }, m.userId === currentUserId ? 'You' : m.name),
          h('span', { class: 'gb-lb-val' }, metric.unit(m.value))
        )
      );
  }

  function challengeBlock(c) {
    // Dates are local days (YYYY-MM-DD), so a string compare orders them.
    const upcoming = !c.active && c.startDate > localISO();
    return h(
      'div',
      { class: 'gb-challenge' },
      h(
        'div',
        { class: 'gb-challenge-head' },
        h('div', { class: 'gb-challenge-title' }, c.title),
        h(
          'span',
          { class: 'gb-challenge-badge', 'data-active': String(!!c.active || upcoming) },
          c.active ? 'Active' : upcoming ? 'Upcoming' : 'Ended'
        )
      ),
      h(
        'div',
        { class: 'gb-challenge-dates' },
        metricOf(c).label + ' · ' + c.startDate + ' → ' + c.endDate
      ),
      h('div', { class: 'gb-lb' }, ...leaderboardRows(c.leaderboard, c)),
      // Members with progress sharing off (Settings → Privacy) are left off the
      // board server-side; say so, or the roster just looks short.
      c.hiddenCount > 0
        ? h(
            'div',
            { class: 'gb-empty-sm' },
            plural(c.hiddenCount, 'member') + ' keep their progress private.'
          )
        : null
    );
  }

  // Actions update only the card they touch: refresh() rebuilt every card,
  // so each one dropped back to "Loading…" and the page jumped.
  function startChallenge(circleId, reload) {
    openFormModal({
      title: 'Start a challenge',
      sub: 'Pick what counts. Most over the window wins.',
      submitLabel: 'Start',
      fields: [
        {
          key: 'title',
          label: 'Title',
          placeholder: 'e.g. 7-day habit sprint',
          value: 'Weekly habit sprint',
        },
        {
          key: 'metric',
          label: 'What counts',
          type: 'select',
          value: 'habit_checkins',
          options: Object.keys(METRICS).map((k) => ({ value: k, label: METRICS[k].label })),
        },
        { key: 'start', label: 'Starts', type: 'date', value: localISO(), min: localISO() },
        { key: 'days', label: 'Length in days (1–90)', type: 'number', value: 7, min: 1, max: 90 },
      ],
      onSubmit: async (v, close) => {
        if (!v.title) throw new Error('Give the challenge a title first.');
        const today = localISO();
        const start = v.start || today;
        // The server refuses it too (against the creator's own day); say so first.
        if (start < today) throw new Error('A challenge can’t start in the past.');
        await api.createChallenge(circleId, {
          title: v.title,
          days: Math.max(1, Math.min(90, Number(v.days) || 7)),
          metric: v.metric || 'habit_checkins',
          startDate: start,
        });
        toast.success(
          start > today ? 'Challenge scheduled for ' + shortDay(start) + '.' : 'Challenge started!'
        );
        close();
        reload();
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
        {
          key: 'private',
          type: 'checkbox',
          label: 'Private circle',
          hint: 'Hidden from Browse. People join with a code you share.',
        },
      ],
      onSubmit: async (v, close) => {
        if (!v.name) throw new Error('Give the circle a name first.');
        const made = await api.createCircle({
          name: v.name,
          goal: v.goal || null,
          visibility: v.private ? 'private' : 'public',
        });
        toast.success(
          made && made.joinCode ? 'Circle created. Code: ' + made.joinCode : 'Circle created.'
        );
        close();
        addCard(made);
      },
    });
  }

  function joinWithCode() {
    openFormModal({
      title: 'Join with a code',
      sub: 'Private circles are joined with the code a member shares.',
      submitLabel: 'Join',
      fields: [{ key: 'code', label: 'Circle code', placeholder: 'e.g. K7M2QX9P', maxlength: 12 }],
      onSubmit: async (v, close) => {
        if (!v.code) throw new Error('Enter the code first.');
        const joined = await api.joinByCode(v.code);
        toast.success('Joined ' + joined.name + '.');
        close();
        if (!el.querySelector('[data-circle-id="' + joined.id + '"]')) addCard(joined);
      },
    });
  }

  /* Who's in the circle; for the owner, Make owner / Remove on each row. */
  function openMembers(c, onChanged) {
    const list = h('div', { class: 'gb-form' }, h('div', { class: 'gb-empty-sm' }, 'Loading…'));
    function paintMembers(rows) {
      list.replaceChildren();
      rows.forEach((m) => {
        const isMe = m.userId === currentUserId;
        const tools =
          c.owner && !isMe
            ? h(
                'div',
                { class: 'gb-request-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--soft gb-btn--compact',
                    onclick: async () => {
                      const ok = await confirmDialog({
                        title: 'Make ' + m.name + ' the owner?',
                        message: 'You stay in the circle as a member.',
                        confirmLabel: 'Make owner',
                        cancelLabel: 'Cancel',
                      });
                      if (!ok) return;
                      try {
                        const updated = await api.transfer(c.id, m.userId);
                        Object.assign(c, updated);
                        toast.success(m.name + ' now owns ' + c.name + '.');
                        onChanged();
                        load();
                      } catch (err) {
                        toast.error(err, 'Could not hand the circle on.');
                      }
                    },
                  },
                  'Make owner'
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-iconbtn gb-iconbtn--danger',
                    'aria-label': 'Remove ' + m.name,
                    title: 'Remove',
                    onclick: async () => {
                      const ok = await confirmDialog({
                        title: 'Remove ' + m.name + '?',
                        confirmLabel: 'Remove',
                        cancelLabel: 'Keep',
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        const r = await api.removeMember(c.id, m.userId);
                        c.memberCount = Math.max(1, (c.memberCount || 1) - 1);
                        // A private circle's code rotates so the removed member can't rejoin.
                        if (r && r.joinCode) c.joinCode = r.joinCode;
                        onChanged();
                        load();
                      } catch (err) {
                        toast.error(err, 'Could not remove them.');
                      }
                    },
                  },
                  Icon('x', { size: 14, sw: 2.4 })
                )
              )
            : null;
        list.appendChild(
          h(
            'div',
            { class: 'gb-browse-row' },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { class: 'gb-circle-name' }, isMe ? 'You' : m.name),
              h('div', { class: 'gb-circle-sub' }, m.role === 'owner' ? 'Owner' : 'Member')
            ),
            tools
          )
        );
      });
      refreshIcons();
    }
    function load() {
      api
        .listMembers(c.id)
        .then(paintMembers)
        .catch(() =>
          list.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Could not load members.'))
        );
    }
    load();
    openSheet(c.name + ' · members', list);
  }

  /* The ⋯ sheet: code (private), members, and Leave or Delete. */
  function openCircleMenu(c, cardEl, onChanged) {
    const { sheet, close } = openOverlay({ label: c.name });
    const action = (label, icon, cls, run) =>
      h(
        'button',
        { type: 'button', class: 'gb-btn ' + cls, onclick: run },
        Icon(icon, { size: 15, sw: 2.4 }),
        label
      );
    const leaveOrDelete = c.owner
      ? action('Delete circle', 'trash-2', 'gb-btn--danger', async () => {
          const ok = await confirmDialog({
            title: 'Delete ' + c.name + '?',
            message: 'Its challenges and posts go too. This cannot be undone.',
            confirmLabel: 'Delete',
            cancelLabel: 'Keep',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.deleteCircle(c.id);
            close();
            removeCard(cardEl);
            toast.success('Circle deleted.');
          } catch (err) {
            toast.error(err, 'Could not delete the circle.');
          }
        })
      : action('Leave circle', 'log-out', 'gb-btn--ghost', async () => {
          const ok = await confirmDialog({
            title: 'Leave ' + c.name + '?',
            confirmLabel: 'Leave',
            cancelLabel: 'Stay',
            danger: true,
          });
          if (!ok) return;
          try {
            await api.leave(c.id);
            close();
            removeCard(cardEl);
            toast.success('You left ' + c.name + '.');
          } catch (err) {
            toast.error(err, 'Could not leave the circle.');
          }
        });
    sheet.append(
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, c.name),
        h(
          'div',
          { class: 'gb-modal-sub' },
          (c.visibility === 'private' ? 'Private · ' : '') +
            plural(c.memberCount, 'member') +
            (c.owner ? ' · you own it' : '')
        )
      ),
      h(
        'div',
        { class: 'gb-modal-body' },
        h(
          'div',
          { class: 'gb-form' },
          c.joinCode
            ? h(
                'div',
                { class: 'gb-circle-code' },
                h('span', null, 'Invite code'),
                h('strong', null, c.joinCode)
              )
            : null,
          action('Members', 'users', 'gb-btn--soft', () => {
            close();
            openMembers(c, onChanged);
          }),
          leaveOrDelete
        )
      ),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
        'Close'
      )
    );
    refreshIcons();
  }

  function removeCard(cardEl) {
    cardEl.remove();
    if (!el.querySelector('.gb-circle-card')) refresh();
  }

  /**
   * The circle's post feed: newest 50, "Load older" for the page before, and a
   * composer. Posts existed server-side with no screen at all.
   */
  function PostsFeed(c) {
    const list = h(
      'div',
      { class: 'gb-circle-posts-list' },
      h('div', { class: 'gb-empty-sm' }, 'Loading…')
    );
    const PAGE = 50;
    let posts = [];
    const more = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact',
        hidden: true,
        onclick: () => load(posts.length ? posts[posts.length - 1].createdAt : null),
      },
      'Load older'
    );
    const input = h('textarea', {
      class: 'gb-input gb-circle-post-input',
      maxlength: '2000',
      rows: 2,
      placeholder: 'Share an update with the circle…',
      'aria-label': 'Write a post',
    });
    const send = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary gb-btn--compact',
        onclick: async () => {
          const body = input.value.trim();
          if (!body || send.disabled) return;
          send.disabled = true;
          try {
            const p = await api.createPost(c.id, body);
            input.value = '';
            posts = [p, ...posts];
            paintPosts();
          } catch (err) {
            toast.error(err, 'Could not post that.');
          } finally {
            send.disabled = false;
          }
        },
      },
      Icon('send', { size: 14, sw: 2.4 }),
      'Post'
    );
    function paintPosts() {
      list.replaceChildren();
      if (!posts.length) {
        list.appendChild(h('div', { class: 'gb-empty-sm' }, 'No posts yet. Say hello!'));
        return;
      }
      posts.forEach((p) => list.appendChild(PostRow(p)));
      refreshIcons();
    }
    /* One post: kudos toggle (one per member, server-enforced) and, for its
       author or the circle's owner, delete. */
    function PostRow(p) {
      const kudosBtn = h('button', { type: 'button' });
      function paintKudos() {
        const n = p.kudos || 0;
        kudosBtn.className = 'gb-kudos' + (p.reacted ? ' is-on' : '');
        kudosBtn.setAttribute('aria-pressed', String(!!p.reacted));
        kudosBtn.setAttribute(
          'aria-label',
          (p.reacted ? 'Take back your kudos' : 'Give kudos') +
            ' (' +
            plural(n, 'kudos', 'kudos') +
            ')'
        );
        kudosBtn.replaceChildren(Icon('heart', { size: 14, sw: 2.4 }), h('span', null, String(n)));
        refreshIcons();
      }
      kudosBtn.onclick = async () => {
        if (kudosBtn.disabled) return;
        kudosBtn.disabled = true;
        try {
          const r = await api.toggleKudos(c.id, p.id);
          p.kudos = r.kudos;
          p.reacted = r.reacted;
          paintKudos();
        } catch (err) {
          toast.error(err, 'Could not give kudos.');
        } finally {
          kudosBtn.disabled = false;
        }
      };
      paintKudos();
      const canDelete = p.userId === currentUserId || c.owner;
      const delBtn = canDelete
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn gb-circle-post-del',
              'aria-label': 'Delete post',
              title: 'Delete',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: 'Delete this post?',
                  message: p.userId === currentUserId ? null : 'It goes for every member.',
                  confirmLabel: 'Delete',
                  cancelLabel: 'Keep',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api.deletePost(c.id, p.id);
                  posts = posts.filter((x) => x.id !== p.id);
                  paintPosts();
                } catch (err) {
                  toast.error(err, 'Could not delete that post.');
                }
              },
            },
            Icon('trash-2', { size: 14, sw: 2.4 })
          )
        : null;
      return h(
        'div',
        { class: 'gb-circle-post' },
        h(
          'div',
          { class: 'gb-circle-post-meta' },
          h('strong', null, p.userId === currentUserId ? 'You' : p.authorName || 'Member'),
          h(
            'span',
            null,
            new Date(p.createdAt).toLocaleString([], {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          )
        ),
        h('div', { class: 'gb-circle-post-body' }, p.body),
        h('div', { class: 'gb-circle-post-foot' }, kudosBtn, delBtn)
      );
    }
    function load(before) {
      api
        .listPosts(c.id, before)
        .then((page) => {
          page = page || [];
          posts = before ? posts.concat(page) : page;
          more.hidden = page.length < PAGE;
          paintPosts();
        })
        .catch(() =>
          list.replaceChildren(
            h('div', { class: 'gb-empty-sm' }, 'Could not load posts.'),
            h(
              'button',
              {
                type: 'button',
                class: 'gb-btn gb-btn--secondary gb-btn--compact',
                onclick: () => load(before),
              },
              'Try again'
            )
          )
        );
    }
    load(null);
    return h(
      'div',
      { class: 'gb-circle-posts' },
      h('div', { class: 'gb-circle-composer' }, input, send),
      list,
      more
    );
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

    const subEl = h('div', { class: 'gb-circle-sub' });
    const paintSub = () => {
      subEl.textContent =
        (c.visibility === 'private' ? 'Private · ' : '') +
        plural(c.memberCount, 'member') +
        (c.owner ? ' · Owner' : '');
    };
    paintSub();

    // Posts open on demand: a feed per card would fetch for every circle at once.
    let feed = null;
    const postsSlot = h('div', { class: 'gb-circle-posts-slot' });
    const postsBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact',
        'aria-expanded': 'false',
        onclick: () => {
          const open = postsBtn.getAttribute('aria-expanded') !== 'true';
          postsBtn.setAttribute('aria-expanded', String(open));
          if (open && !feed) feed = PostsFeed(c);
          postsSlot.replaceChildren(...(open ? [feed] : []));
          refreshIcons();
        },
      },
      Icon('message-circle', { size: 14, sw: 2.4 }),
      'Posts'
    );

    const card = h(
      'div',
      { class: 'gb-card gb-circle-card', dataset: { circleId: c.id } },
      h(
        'div',
        { class: 'gb-circle-card-head' },
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'gb-circle-name' }, c.name), subEl),
        h(
          'div',
          { class: 'gb-circle-card-tools' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              onclick: () => startChallenge(c.id, loadChallenges),
            },
            Icon('flag', { size: 14, sw: 2.4 }),
            'Start challenge'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Circle options',
              title: 'Options',
              onclick: () => openCircleMenu(c, card, paintSub),
            },
            Icon('ellipsis', { size: 16, sw: 2.4 })
          )
        )
      ),
      body,
      h('div', { class: 'gb-circle-card-foot' }, postsBtn),
      postsSlot
    );
    return card;
  }

  function addCard(c) {
    if (!c) return refresh();
    // The first circle replaces the "join or create" empty card.
    if (!el.querySelector('.gb-circle-card')) el.replaceChildren();
    el.appendChild(circleCard(c));
    refreshIcons();
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
        // Private circles are never listed — the code is the way in, so it
        // lives here, and the sheet opens even when there is nothing to browse.
        const list = h(
          'div',
          { class: 'gb-form' },
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft', onclick: joinWithCode },
            Icon('shield-check', { size: 15, sw: 2.4 }),
            'Join a private circle with a code'
          ),
          joinable.length
            ? null
            : h('div', { class: 'gb-empty-sm' }, 'You are already in every public circle.')
        );
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
                    // A second tap while the first is in flight joined twice
                    // and toasted "Could not join" over the success.
                    const btn = e.currentTarget;
                    if (btn.disabled) return;
                    btn.disabled = true;
                    try {
                      const joined = await api.join(c.id);
                      btn.closest('.gb-browse-row').remove();
                      toast.success('Joined ' + c.name + '.');
                      addCard(joined);
                    } catch (err) {
                      btn.disabled = false;
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

  // The screen puts the actions on the Challenges heading's line.
  return { node: el, actions };
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
  onRespond,
  challengesApi,
  mentorshipApi,
  currentUserId,
}) {
  const outgoingEl = h('div', { class: 'gb-circle-section' }, sectionSkeleton(1));
  // Pending invites TO me. Empty (no heading at all) until there is one.
  const requestsEl = h('div', { class: 'gb-circle-section' });

  function respondAndRefresh(reqId, accept) {
    return onRespond(reqId, accept).then(() => {
      toast.success(accept ? 'Connected.' : 'Invite declined.');
      return refreshAll();
    });
  }

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
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            onclick: async (e) => {
              // One invite per tap: a double tap sent two.
              const btn = e.currentTarget;
              if (btn.disabled) return;
              btn.disabled = true;
              try {
                await onSendInvite(person.id, direction, noteInput.value.trim() || null);
                toast.success('Invite sent to ' + person.displayName + '.');
                refreshAll();
                close();
              } catch (err) {
                btn.disabled = false;
                toast.error(err, 'Could not send invite.');
              }
            },
          },
          'Send invite'
        ),
        h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel')
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
    const row = (item) => {
      const r =
        item.side === 'incoming'
          ? IncomingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
          : OutgoingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null);
      if (!mentorshipApi) return r;
      return h(
        'div',
        { class: 'gb-conn-item' },
        r,
        LinkExtras(item.req, item.partnerName, iMentor(item), mentorshipApi, currentUserId)
      );
    };

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

    const pendingForMe = onRespond ? cachedIncoming.filter((r) => r.status === 'pending') : [];
    requestsEl.replaceChildren();
    if (pendingForMe.length) {
      const card = h('div', { class: 'gb-card', style: { padding: '4px 0' } });
      pendingForMe.forEach((r) => card.appendChild(RequestRow(r, respondAndRefresh)));
      requestsEl.append(
        h(
          'h4',
          { class: 'gb-circle-section-title' },
          'Requests for you',
          h('span', { class: 'gb-circle-count' }, String(pendingForMe.length))
        ),
        card
      );
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
    const incoming = onLoadIncoming
      ? onLoadIncoming().catch(() => cachedIncoming)
      : Promise.resolve([]);
    return Promise.all([outgoing, incoming]).then(([out, inc]) => {
      cachedOutgoing = out || [];
      cachedIncoming = inc || [];
      paint();
    });
  }

  refreshAll();

  /* Live: app.js re-broadcasts every mentorship push (an invite sent to me,
     accepted, declined, ended) as `gb:circle-changed`. Without this the screen
     kept showing "Invite pending" after the other person accepted, until you
     left and came back. The listener retires itself once this screen is gone. */
  let screenEl = null;
  let wasMounted = false;
  function onCircleChanged() {
    if (!screenEl || !screenEl.isConnected) {
      // Built but not in the page yet (lazy mount): keep listening. Mounted
      // once and gone now: this screen was replaced — stop.
      if (wasMounted) window.removeEventListener('gb:circle-changed', onCircleChanged);
      return;
    }
    wasMounted = true;
    refreshAll();
  }
  window.addEventListener('gb:circle-changed', onCircleChanged);

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

  const challenges = challengesApi ? ChallengesPanel({ api: challengesApi, currentUserId }) : null;
  const challengesPanel = challenges && challenges.node;

  screenEl = h(
    'div',
    { class: 'gb-rise', style: { padding: '0 0 24px' } },
    h(
      'div',
      {
        style: {
          padding: '6px var(--gutter) 10px',
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
          // Not "Growth Circle": the screen header already says that.
          'Mentorship'
        ),
        h(
          'p',
          { style: { color: 'var(--fg3)', fontSize: '0.8125rem', margin: 0 } },
          'Your mentors, your mentees, and your sent invites.'
        )
      ),
      addBtn
    ),
    h('div', { class: 'gb-circle-requests', style: { padding: '0 var(--gutter)' } }, requestsEl),
    h(
      'div',
      { style: { padding: '18px var(--gutter) 6px' } },
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
    h('div', { style: { padding: '0 var(--gutter)' } }, incomingEl),
    h(
      'div',
      { style: { padding: '18px var(--gutter) 6px' } },
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
    h('div', { style: { padding: '0 var(--gutter)' } }, outgoingEl),
    challengesPanel
      ? h(
          'div',
          { style: { padding: '22px var(--gutter) 6px' }, class: 'gb-challenges-head-wrap' },
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
            ),
            challenges.actions
          )
        )
      : null,
    challengesPanel ? h('div', { style: { padding: '0 var(--gutter)' } }, challengesPanel) : null
  );
  requestAnimationFrame(() => {
    if (screenEl.isConnected) wasMounted = true;
  });
  return screenEl;
}

export { ScreenCircle };
