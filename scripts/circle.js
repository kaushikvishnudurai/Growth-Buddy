/* =====================================================================
   Growth Buddy — Growth Circle (search people + mentorship invites)
   ===================================================================== */
import {
  h,
  activate,
  Icon,
  Avatar,
  Check,
  plural,
  refreshIcons,
  confirmDialog,
  openOverlay,
  focusSoon,
  visibleText,
} from './gb-kit.js';
import { toast } from './toast.js';
import {
  CHALLENGE_TEMPLATES,
  standingLine,
  inviteLink,
  inviteFromHash,
  MAX_SEATS,
  seatLayout,
  presence,
  seatOrder,
  initials,
  challengeDay,
  AGREEMENT_MAX,
  parseAgreement,
  formatAgreement,
} from './circle-core.js';

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
        const body = visibleText(input.value);
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
  focusSoon(input);
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

/* One link's agreement as a checklist. Either partner ticks, adds or removes an
   item; each change saves the whole list, last writer wins, as the text did. The
   tick paints at once and rolls back if the save fails. */
function AgreementList(req, mApi, heading, onEnd) {
  let items = parseAgreement(req.agreement);
  const el = h('div', { class: 'gb-agree' });
  const input = h('input', {
    type: 'text',
    class: 'gb-input gb-agree-input',
    maxlength: 120,
    enterkeyhint: 'done',
    'aria-label': heading + ': add an item',
  });
  async function save(next) {
    const text = formatAgreement(next);
    if (text.length > AGREEMENT_MAX) {
      toast.error(null, 'The list is full. Remove a finished item first.');
      return false;
    }
    const before = items;
    items = next;
    paint();
    try {
      const res = await mApi.setAgreement(req.id, text || null);
      req.agreement = res && res.agreement;
      return true;
    } catch (err) {
      items = before;
      paint();
      toast.error(err, 'Could not save the agreement.');
      return false;
    }
  }
  const add = async () => {
    const t = input.value.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (await save(items.concat({ done: false, text: t }))) input.value = '';
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  function paint() {
    const done = items.filter((it) => it.done).length;
    // The example only while the list is empty: after that it's just noise.
    input.placeholder = items.length ? 'Add a goal' : 'e.g. 30 min of DSA, 5 days a week';
    // replaceChildren, unlike h(), writes a null child as the text "null".
    const parts = [
      h(
        'div',
        { class: 'gb-agree-head' },
        Icon('target', { size: 13, sw: 2.4 }),
        h('span', { class: 'gb-agree-title' }, heading),
        items.length
          ? h(
              'span',
              { class: 'gb-agree-count' + (done === items.length ? ' is-all' : '') },
              done + '/' + items.length
            )
          : null,
        onEnd ? h('button', { type: 'button', class: 'gb-agree-end', onclick: onEnd }, 'End') : null
      ),
      items.length
        ? h(
            'ul',
            { class: 'gb-agree-list' },
            items.map((it, i) =>
              h(
                'li',
                { class: 'gb-agree-item' + (it.done ? ' is-done' : '') },
                Check({
                  done: it.done,
                  label: it.text,
                  onToggle: () =>
                    save(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x))),
                }),
                h('span', { class: 'gb-agree-text' }, it.text),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-agree-del',
                    'aria-label': 'Remove ' + it.text,
                    onclick: () => save(items.filter((_, j) => j !== i)),
                  },
                  Icon('x', { size: 14, sw: 2.4 })
                )
              )
            )
          )
        : null,
      h(
        'div',
        { class: 'gb-agree-add' },
        input,
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--soft gb-btn--compact',
            'aria-label': 'Add item',
            onclick: add,
          },
          Icon('plus', { size: 14, sw: 2.6 })
        )
      ),
    ];
    el.replaceChildren(...parts.filter(Boolean));
    refreshIcons();
  }
  paint();
  return el;
}

/* Under each accepted connection: the agreement checklist, Cheer / Nudge /
   Message, and, when I mentor them, the weekly card. `links` holds one link, or
   two when we mentor each other: then each direction keeps its own checklist
   (what I help with is not what they help with), but the person gets one row
   and one set of tools instead of everything twice. */
function LinkExtras(links, partnerName, mApi, currentUserId, onRevoke) {
  const mutual = links.length > 1;
  const lists = links.map(({ req, iMentor }) =>
    AgreementList(
      req,
      mApi,
      !mutual
        ? 'Your agreement'
        : iMentor
          ? 'You help ' + partnerName + ' with'
          : partnerName + ' helps you with',
      mutual && onRevoke
        ? async () => {
            const ok = await confirmDialog({
              title: iMentor
                ? 'Stop mentoring ' + partnerName + '?'
                : 'Stop being mentored by ' + partnerName + '?',
              message: 'The other direction stays as it is.',
              confirmLabel: 'End',
              cancelLabel: 'Keep',
              danger: true,
            });
            if (ok) onRevoke(req.id);
          }
        : null
    )
  );
  // Both partners must open the SAME thread, so a mutual pair talks on the link
  // with the smaller id, which both sides compute alike.
  // ponytail: messages already sent on the other link stay on it, unshown here.
  const req = links.map((l) => l.req).sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  const mentorLink = links.find((l) => l.iMentor);
  const isMentor = !!mentorLink;

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
        weekSlot.replaceChildren(...(open ? [WeekCard(mApi, mentorLink.req.id, partnerName)] : []));
      },
      { 'aria-expanded': 'false' }
    );
  }
  return h(
    'div',
    { class: 'gb-conn-extra' },
    ...lists,
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
function openFormModal({ title, sub, fields, submitLabel, onSubmit, presets }) {
  const { sheet, close } = openOverlay({ label: title });
  const inputs = {};
  const fieldNodes = [];
  // One-tap presets ({label, values}) fill every field they name; the submit
  // button still sends, so what goes out is on screen first.
  if (presets && presets.length) {
    fieldNodes.push(
      h(
        'div',
        { class: 'gb-circle-presets', role: 'group', 'aria-label': 'Quick picks' },
        presets.map((p) =>
          h(
            'button',
            {
              type: 'button',
              class: 'gb-chip',
              onclick: () => {
                Object.keys(p.values).forEach((k) => {
                  if (inputs[k]) inputs[k].value = String(p.values[k]);
                });
              },
            },
            p.label
          )
        )
      )
    );
  }
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
          values[k] = inputs[k].type === 'checkbox' ? inputs[k].checked : visibleText(inputs[k].value);
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
/* ---- The seat ring ----
   The circle drawn as its members: a seat each around a ring, the circle's name
   in the middle. A seat glows when that member has checked in today (their own
   today), sits as ash when they haven't, and is blank for someone who keeps
   progress private. The track fills by the share who are in. Tapping someone
   else's seat cheers them (once a day per pair, server-side). The seats light in
   turn once, on first paint; prefers-reduced-motion skips it (app.css). */
const RING_R = 40; // percent of the ring's box; the SVG track uses the same
function SeatRing({ circle, members, currentUserId, onCheer, cheered }) {
  const ordered = seatOrder(members, currentUserId);
  const overflow = ordered.length > MAX_SEATS ? ordered.length - (MAX_SEATS - 1) : 0;
  const seated = overflow ? ordered.slice(0, MAX_SEATS - 1) : ordered;
  const spots = seatLayout(seated.length + (overflow ? 1 : 0), RING_R);
  const p = presence(members, currentUserId);
  // Lit seats over all seats (a private seat is a sector too), so the arc ends on a seat boundary.
  const share = ordered.length ? p.lit / ordered.length : 0;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'gb-seat-track');
  svg.setAttribute('aria-hidden', 'true');
  // Start half a seat before twelve o'clock, so the fill spans whole seats.
  // Rotated inside the SVG: rotating the element itself made its box a tilted
  // square wider than the screen.
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', 'rotate(' + (-90 - 180 / Math.max(1, spots.length)) + ' 50 50)');
  svg.appendChild(g);
  const C = 2 * Math.PI * RING_R;
  [
    ['gb-seat-track-bg', 0],
    ['gb-seat-track-fill', C * (1 - share)],
  ].forEach(([cls, off]) => {
    const ci = document.createElementNS(NS, 'circle');
    ci.setAttribute('cx', '50');
    ci.setAttribute('cy', '50');
    ci.setAttribute('r', String(RING_R));
    ci.setAttribute('class', cls);
    ci.style.setProperty('--len', String(C));
    ci.style.setProperty('--off', String(off));
    g.appendChild(ci);
  });

  const seat = (m, i) => {
    const me = m.userId === currentUserId;
    const state = m.doneToday == null ? 'private' : m.doneToday > 0 ? 'lit' : 'ash';
    const said =
      state === 'private' ? 'keeps progress private' : state === 'lit' ? 'checked in today' : 'not checked in yet';
    const name = me ? 'You' : m.name;
    const attrs = {
      class: 'gb-seat is-' + state + (me ? ' is-me' : '') + (cheered.has(m.userId) ? ' is-cheered' : ''),
      style: { left: spots[i].x + '%', top: spots[i].y + '%', '--i': String(i) },
      title: name + ', ' + said,
    };
    const label = h('span', { class: 'gb-seat-initials', 'aria-hidden': 'true' }, initials(m.name));
    if (me || !onCheer) {
      return h('span', { ...attrs, role: 'img', 'aria-label': name + ', ' + said }, label);
    }
    return h(
      'button',
      {
        ...attrs,
        type: 'button',
        'aria-label': cheered.has(m.userId) ? 'Cheered ' + m.name + ' today' : 'Cheer ' + m.name + ' on, ' + said,
        onclick: (e) => onCheer(m, e.currentTarget),
      },
      label
    );
  };

  const ringEl = h(
    'div',
    {
      class: 'gb-seat-ring',
      role: 'group',
      'aria-label': circle.name + ': ' + (p.known ? p.lit + ' of ' + p.known + ' checked in today' : 'members'),
    },
    svg,
    h(
      'div',
      { class: 'gb-seat-core' },
      h('h3', { class: 'gb-seat-name' }, circle.name),
      h(
        'div',
        { class: 'gb-seat-count' },
        p.known ? p.lit + ' of ' + p.known + ' in today' : plural(members.length, 'member')
      )
    ),
    ...seated.map(seat),
    overflow
      ? h(
          'span',
          {
            class: 'gb-seat is-more',
            style: { left: spots[seated.length].x + '%', top: spots[seated.length].y + '%', '--i': String(seated.length) },
            role: 'img',
            'aria-label': overflow + ' more members',
          },
          '+' + overflow
        )
      : null
  );
  // Light the seats once, after first paint, so the sequence is seen.
  requestAnimationFrame(() => requestAnimationFrame(() => ringEl.classList.add('is-on')));
  return ringEl;
}

function ChallengesPanel({ api, currentUserId, wins, addHabit }) {
  const el = h('div', { class: 'gb-challenges' }, sectionSkeleton(1));

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

  /* One tap: a bell card for that member. The server allows one per pair per
     day, and the button says so by going quiet once sent. */
  function cheerButton(circleId, member) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-iconbtn gb-circle-cheer',
        'aria-label': 'Cheer ' + member.name + ' on',
        title: 'Cheer on',
        onclick: async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          try {
            await api.cheer(circleId, member.userId);
            btn.classList.add('is-sent');
            btn.setAttribute('aria-label', 'Cheered ' + member.name);
            toast.success('Cheered ' + member.name + ' on.');
          } catch (err) {
            btn.disabled = false;
            toast.error(err, 'Could not send that cheer.');
          }
        },
      },
      Icon('sparkles', { size: 14, sw: 2.4 })
    );
    // Today's one cheer already sent (the server's cheeredByMe, as the seats read
    // it): show it sent, so the row doesn't offer a cheer that would be refused.
    if (member.cheeredByMe) {
      btn.disabled = true;
      btn.classList.add('is-sent');
      btn.setAttribute('aria-label', 'Cheered ' + member.name + ' today');
    }
    return btn;
  }

  function leaderboardRows(entries, c) {
    const metric = metricOf(c);
    if (c && c.startDate > localISO()) {
      return [h('div', { class: 'gb-empty-sm' }, 'Starts ' + shortDay(c.startDate) + '.')];
    }
    if (!entries || !entries.length) {
      return [h('div', { class: 'gb-empty-sm' }, metric.empty)];
    }
    // The rank is the board's own number: a tie shares it. Cheering lives on
    // the seats above, so a row is read, not tapped.
    return entries.slice(0, 10).map((m) =>
      h(
        'div',
        { class: 'gb-lb-row' + (m.userId === currentUserId ? ' is-me' : '') + (m.rank === 1 ? ' is-lead' : '') },
        h('span', { class: 'gb-lb-rank', 'aria-label': 'Rank ' + m.rank }, String(m.rank)),
        h('span', { class: 'gb-lb-name' }, m.userId === currentUserId ? 'You' : m.name),
        h('span', { class: 'gb-lb-val' }, metric.unit(m.value))
      )
    );
  }

  /* "Habit check-ins · Day 1 of 7 · ends Sat 17 Oct" — where the window is, in words. */
  function challengeMeta(c, upcoming) {
    const day = challengeDay(c.startDate, c.endDate, localISO());
    const when = upcoming
      ? 'starts ' + shortDay(c.startDate)
      : day
        ? 'Day ' + day.day + ' of ' + day.total + ' · ends ' + shortDay(c.endDate)
        : 'ended ' + shortDay(c.endDate);
    return metricOf(c).label + ' · ' + when;
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
      h('div', { class: 'gb-challenge-dates' }, challengeMeta(c, upcoming)),
      (() => {
        const line = upcoming
          ? null
          : standingLine(c.leaderboard, currentUserId, metricOf(c).unit, !c.active);
        return line ? h('div', { class: 'gb-challenge-standing' }, line) : null;
      })(),
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
      presets: CHALLENGE_TEMPLATES.map((t) => ({
        label: t.label,
        values: { title: t.title, metric: t.metric, days: t.days },
      })),
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
        // A new circle's first step, so its card doesn't open on "No challenge running".
        {
          key: 'sprint',
          type: 'checkbox',
          value: true,
          label: 'Start a ' + CHALLENGE_TEMPLATES[0].label + ' today',
        },
      ],
      onSubmit: async (v, close) => {
        if (!v.name) throw new Error('Give the circle a name first.');
        const made = await api.createCircle({
          name: v.name,
          goal: v.goal || null,
          visibility: v.private ? 'private' : 'public',
        });
        close();
        if (v.sprint) {
          const t = CHALLENGE_TEMPLATES[0];
          // The circle exists either way; a refused sprint is one toast, not a failed create.
          await api
            .createChallenge(made.id, { title: t.title, days: t.days, metric: t.metric, startDate: localISO() })
            .catch((err) => toast.error(err, 'Circle created, but the challenge did not start.'));
        }
        addCard(made);
        // The other first step is people. The share sheet needs a tap of its own
        // (a browser opens it only from a gesture), so the toast carries it.
        toast.action(
          made.joinCode ? 'Circle created. Code: ' + made.joinCode : 'Circle created.',
          'Invite',
          () => shareInvite(made)
        );
      },
    });
  }

  function joinWithCode() {
    openFormModal({
      title: 'Join with a code',
      sub: 'Private circles are joined with the code a member shares.',
      submitLabel: 'Join',
      fields: [
        { key: 'code', label: 'Circle code', placeholder: 'e.g. K7M2QX9P', maxlength: 12 },
        ...goalField(null),
      ],
      onSubmit: async (v, close) => {
        if (!v.code) throw new Error('Enter the code first.');
        const joined = await api.joinByCode(v.code);
        toast.success('Joined ' + joined.name + '.');
        close();
        if (!el.querySelector('[data-circle-id="' + joined.id + '"]')) addCard(joined);
        if (v.addGoal) adoptGoal(joined);
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
        const cheer = !isMe && api.cheer ? cheerButton(c.id, m) : null;
        const tools =
          c.owner && !isMe
            ? h(
                'div',
                { class: 'gb-request-actions' },
                cheer,
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
            tools || cheer
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
          action('Share invite link', 'share-2', 'gb-btn--soft', () => shareInvite(c)),
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

  /* The link joins in one tap (inviteFromHash on the far side). The OS share
     sheet where there is one, else the clipboard. */
  async function shareInvite(c) {
    const url = inviteLink(window.location.href, c);
    const text = 'Join my circle ' + c.name + ' on Growth Buddy';
    try {
      if (navigator.share) {
        await navigator.share({ title: c.name, text, url });
        return;
      }
      await navigator.clipboard.writeText(text + ': ' + url);
      toast.success('Invite link copied.');
    } catch (err) {
      if (err && err.name === 'AbortError') return; // closed the share sheet
      toast.error(
        err,
        'Could not share the link. The code is ' + (c.joinCode || 'not needed: it is public') + '.'
      );
    }
  }

  /* Opened from an invite link: ask first, then join, show the card, and drop
     the link's query so a reload doesn't try again. The ask is the guard: a
     link dropped in a chat must not pull anyone into a circle (and show it
     their day) on its own. Already a member is a quiet no-op. */
  async function joinFromLink() {
    const invite = inviteFromHash(window.location.hash);
    if (!invite) return;
    history.replaceState(null, '', window.location.pathname + window.location.search + '#/circle');
    // A public circle is in Browse's list, so the sheet can name it; a private
    // one is only known by its code until it is joined.
    let c = null;
    if (invite.id) {
      try {
        c = (await api.listAll()).find((x) => x.id === invite.id) || null;
      } catch (_) {
        /* the sheet still asks, without the name */
      }
      if (c && c.joined) {
        if (!el.querySelector('[data-circle-id="' + c.id + '"]')) addCard(c);
        return;
      }
    }
    const name = c ? c.name : 'this private circle';
    openFormModal({
      title: 'Join ' + name + '?',
      sub:
        (c ? plural(c.memberCount, 'member') + '. ' : '') +
        'Members will see whether you checked in today, and you will get the circle’s posts and cheers. ' +
        'You can keep your progress private in Settings > Account > Privacy.',
      submitLabel: 'Join',
      fields: goalField(c),
      onSubmit: async (v, close) => {
        let joined;
        try {
          joined = invite.code ? await api.joinByCode(invite.code) : await api.join(invite.id);
        } catch (err) {
          close();
          toast.error(err, 'That invite link did not work. Ask for a fresh one.');
          return;
        }
        close();
        if (!el.querySelector('[data-circle-id="' + joined.id + '"]')) addCard(joined);
        toast.success('You joined ' + joined.name + '.');
        if (v.addGoal) adoptGoal(joined);
      },
    });
  }

  /* The circle's shared goal as one of the joiner's habits, so their seat has
     something to light. Offered pre-ticked on every join; a goal too long to be
     a habit name, or no addHabit wired, offers nothing. */
  function goalField(c) {
    if (typeof addHabit !== 'function' || (c && !habitName(c.goal))) return [];
    return [
      {
        key: 'addGoal',
        type: 'checkbox',
        value: true,
        label: c ? 'Add “' + habitName(c.goal) + '” to my habits' : 'Add the circle’s goal to my habits',
      },
    ];
  }
  function habitName(goal) {
    const g = (goal || '').trim();
    return g && g.length <= 120 ? g : '';
  }
  function adoptGoal(joined) {
    const name = habitName(joined.goal);
    if (!name) return;
    // addHabit resolves false when the user already has a habit of that name.
    addHabit(name).then(
      (made) => made !== false && toast.success('Added “' + name + '” to your habits.'),
      (err) => toast.error(err, 'Could not add the habit.')
    );
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
    // Wins worth sharing, from the user's own habits and goals: a tap fills the
    // box, Post sends it. Nothing is posted without that second tap.
    const winLinesNow = typeof wins === 'function' ? wins() : [];
    const winChips = winLinesNow.length
      ? h(
          'div',
          { class: 'gb-circle-presets', role: 'group', 'aria-label': 'Share a win' },
          h('span', { class: 'gb-circle-presets-label' }, 'Share a win'),
          winLinesNow.map((line) =>
            h(
              'button',
              {
                type: 'button',
                class: 'gb-chip',
                onclick: () => {
                  input.value = line;
                  input.focus();
                },
              },
              line
            )
          )
        )
      : null;
    const send = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--primary gb-btn--compact',
        onclick: async () => {
          const body = visibleText(input.value);
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
      const thread = h('div', { class: 'gb-circle-replies', hidden: true });
      const replyBtn = h(
        'button',
        { type: 'button', class: 'gb-kudos', 'aria-expanded': 'false' },
        Icon('message-circle', { size: 14, sw: 2.4 }),
        h('span', null, String(p.comments || 0))
      );
      replyBtn.setAttribute('aria-label', 'Replies (' + (p.comments || 0) + ')');
      replyBtn.onclick = () => {
        const open = replyBtn.getAttribute('aria-expanded') !== 'true';
        replyBtn.setAttribute('aria-expanded', String(open));
        thread.hidden = !open;
        if (open && !thread.firstChild)
          RepliesThread(p, thread, (n) => {
            p.comments = n;
            replyBtn.lastChild.textContent = String(n);
            replyBtn.setAttribute('aria-label', 'Replies (' + n + ')');
          });
      };
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
        h('div', { class: 'gb-circle-post-foot' }, kudosBtn, replyBtn, delBtn),
        thread
      );
    }
    /* A post's replies, oldest first, with a one-line composer. Fetched when
       first opened; `onCount` keeps the post's reply count in step. */
    function RepliesThread(p, box, onCount) {
      let rows = [];
      const listEl = h(
        'div',
        { class: 'gb-circle-replies-list' },
        h('div', { class: 'gb-empty-sm' }, 'Loading…')
      );
      const field = h('input', {
        type: 'text',
        class: 'gb-input',
        maxlength: '500',
        placeholder: 'Reply…',
        'aria-label': 'Write a reply',
      });
      const sendBtn = h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact' },
        'Reply'
      );
      async function sendReply() {
        const body = visibleText(field.value);
        if (!body || sendBtn.disabled) return;
        sendBtn.disabled = true;
        try {
          rows = rows.concat(await api.createComment(c.id, p.id, body));
          field.value = '';
          paint();
        } catch (err) {
          toast.error(err, 'Could not send that reply.');
        } finally {
          sendBtn.disabled = false;
        }
      }
      sendBtn.onclick = sendReply;
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendReply();
        }
      });
      /* Gone at once, sent once Undo has had its chance: the row leaves on
         the tap, so a second tap has nothing to hit. */
      function removeReply(r) {
        const at = rows.indexOf(r);
        rows = rows.filter((x) => x !== r);
        paint();
        const putBack = () => {
          rows = rows.slice();
          rows.splice(Math.min(at, rows.length), 0, r);
          paint();
        };
        // ponytail: the undo window is the action toast's 6 s; a page closed
        // inside it keeps the reply (the safe side).
        const timer = setTimeout(() => {
          api.deleteComment(c.id, p.id, r.id).catch((err) => {
            putBack();
            toast.error(err, 'Could not delete that reply.');
          });
        }, 6000);
        toast.action('Reply deleted.', 'Undo', () => {
          clearTimeout(timer);
          putBack();
        });
      }
      function paint() {
        onCount(rows.length);
        listEl.replaceChildren();
        if (!rows.length) {
          listEl.appendChild(h('div', { class: 'gb-empty-sm' }, 'No replies yet.'));
          return;
        }
        rows.forEach((r) => {
          const mine = r.userId === currentUserId;
          listEl.appendChild(
            h(
              'div',
              { class: 'gb-circle-reply' },
              h('strong', null, mine ? 'You' : r.authorName || 'Member'),
              h('span', null, r.body),
              mine || c.owner
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'gb-iconbtn gb-circle-post-del',
                      'aria-label': 'Delete reply',
                      title: 'Delete',
                      onclick: () => removeReply(r),
                    },
                    Icon('trash-2', { size: 13, sw: 2.4 })
                  )
                : null
            )
          );
        });
        refreshIcons();
      }
      api
        .listComments(c.id, p.id)
        .then((list) => {
          // A reply sent while this was in flight isn't in `list`: keep it.
          list = list || [];
          rows = list.concat(rows.filter((r) => !list.some((x) => x.id === r.id)));
          paint();
        })
        .catch(() =>
          listEl.replaceChildren(h('div', { class: 'gb-empty-sm' }, 'Could not load replies.'))
        );
      box.append(listEl, h('div', { class: 'gb-circle-composer' }, field, sendBtn));
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
      winChips,
      h('div', { class: 'gb-circle-composer' }, input, send),
      list,
      more
    );
  }

  /* One circle: the seat ring (who is in today), one line to act on it, the
     challenges, then the circle's posts. `openPosts` opens the feed at once
     (the first circle on the screen); the rest open on demand, one fetch each. */
  function circleCard(c, { openPosts = false } = {}) {
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
          // The one running now leads; the rest follow, newest first as served.
          const ordered = (list || []).slice().sort((a, b) => Number(!!b.active) - Number(!!a.active));
          if (!ordered.length) {
            body.appendChild(
              h(
                'div',
                { class: 'gb-challenge-empty' },
                h('p', null, 'No challenge running. Pick one and everyone’s check-ins count from today.'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'gb-btn gb-btn--soft gb-btn--compact',
                    onclick: () => startChallenge(c.id, loadChallenges),
                  },
                  Icon('flag', { size: 14, sw: 2.4 }),
                  'Start a challenge'
                )
              )
            );
          } else {
            ordered.forEach((c2) => body.appendChild(challengeBlock(c2)));
          }
          refreshIcons();
        })
        .catch(() =>
          body.replaceChildren(
            h('div', { class: 'gb-empty-sm' }, 'Couldn’t load challenges.'),
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

    // Who is in today: the ring, and the one action it suggests.
    const cheered = new Set(); // members cheered from this card today
    let members = [];
    const ringSlot = h(
      'div',
      { class: 'gb-seat-ring-slot' },
      h('div', { class: 'gb-seat-ring is-loading', 'aria-hidden': 'true' })
    );
    const nudgeSlot = h('div', { class: 'gb-circle-nudge' });

    async function cheerOne(m) {
      await api.cheer(c.id, m.userId);
      cheered.add(m.userId);
    }
    async function onSeat(m, btn) {
      if (cheered.has(m.userId) || btn.disabled) return;
      btn.disabled = true;
      try {
        await cheerOne(m);
        toast.success('Cheered ' + m.name + ' on.');
        paintRing();
      } catch (err) {
        btn.disabled = false;
        toast.error(err, 'Couldn’t send that cheer.');
      }
    }
    function paintNudge() {
      const p = presence(members, currentUserId);
      const quiet = p.quiet.filter((m) => !cheered.has(m.userId));
      nudgeSlot.replaceChildren();
      if (!p.known) return;
      if (!quiet.length) {
        nudgeSlot.appendChild(
          h(
            'p',
            { class: 'gb-circle-nudge-line' },
            p.lit === p.known
              ? 'Everyone’s in today.'
              : p.quiet.length
                ? 'You’ve cheered everyone still to check in.'
                : p.meIn
                  ? 'You’re in. Nobody else has checked in yet.'
                  : 'You’re the one still to check in today.'
          )
        );
        return;
      }
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary gb-btn--compact gb-circle-nudge-btn',
          onclick: async () => {
            if (btn.disabled) return;
            btn.disabled = true;
            let sent = 0;
            for (const m of quiet) {
              try {
                await cheerOne(m);
                sent++;
              } catch (_) {
                /* already cheered today, or the daily cap: the rest still go */
              }
            }
            if (sent) toast.success('Cheered ' + plural(sent, 'person', 'people') + ' on.');
            else toast.error(null, 'Couldn’t send those cheers. You may have cheered them already today.');
            paintRing();
          },
        },
        Icon('sparkles', { size: 14, sw: 2.4 }),
        quiet.length === 1 ? 'Cheer ' + quiet[0].name.split(' ')[0] + ' on' : 'Cheer the ' + quiet.length + ' still to check in'
      );
      nudgeSlot.appendChild(btn);
    }
    function paintRing() {
      ringSlot.replaceChildren(
        SeatRing({ circle: c, members, currentUserId, onCheer: api.cheer ? onSeat : null, cheered })
      );
      if (api.cheer) paintNudge();
      refreshIcons();
    }
    function loadMembers() {
      api
        .listMembers(c.id)
        .then((list) => {
          members = list || [];
          // Today's one cheer per person, as the server counts it: a reload
          // must not offer a cheer it would refuse.
          members.forEach((m) => m.cheeredByMe && cheered.add(m.userId));
          paintRing();
        })
        .catch(() => {
          ringSlot.replaceChildren(h('h3', { class: 'gb-circle-name gb-circle-name--plain' }, c.name));
        });
    }
    loadMembers();

    const subEl = h('div', { class: 'gb-circle-sub' });
    const paintSub = () => {
      subEl.textContent =
        (c.visibility === 'private' ? 'Private · ' : '') +
        plural(c.memberCount, 'member');
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
        onclick: () => togglePosts(),
      },
      Icon('message-circle', { size: 14, sw: 2.4 }),
      h('span', null, 'Show posts')
    );
    function togglePosts(force) {
      const open = force !== undefined ? force : postsBtn.getAttribute('aria-expanded') !== 'true';
      postsBtn.setAttribute('aria-expanded', String(open));
      postsBtn.lastChild.textContent = open ? 'Hide posts' : 'Show posts';
      if (open && !feed) feed = PostsFeed(c);
      postsSlot.replaceChildren(...(open ? [feed] : []));
      refreshIcons();
    }

    const card = h(
      'div',
      { class: 'gb-card gb-circle-card', dataset: { circleId: c.id } },
      h(
        'div',
        { class: 'gb-circle-card-head' },
        subEl,
        h(
          'div',
          { class: 'gb-circle-card-tools' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-btn--compact',
              onclick: () => startChallenge(c.id, loadChallenges),
            },
            Icon('flag', { size: 14, sw: 2.4 }),
            'New challenge'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Options for ' + c.name,
              title: 'Options',
              onclick: () => openCircleMenu(c, card, paintSub),
            },
            Icon('ellipsis', { size: 16, sw: 2.4 })
          )
        )
      ),
      ringSlot,
      nudgeSlot,
      body,
      h('div', { class: 'gb-circle-card-foot' }, postsBtn),
      postsSlot
    );
    if (openPosts) togglePosts(true);
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
    return api
      .listMine()
      .then((mine) => {
        el.replaceChildren();
        if (!mine || !mine.length) {
          // An empty ring: what a circle will look like once people are in it.
          const spots = seatLayout(5, RING_R);
          el.appendChild(
            h(
              'div',
              { class: 'gb-card gb-circle-empty' },
              h(
                'div',
                { class: 'gb-seat-ring is-on gb-seat-ring--empty', 'aria-hidden': 'true' },
                h(
                  'div',
                  { class: 'gb-seat-core' },
                  h('div', { class: 'gb-seat-name' }, 'Your circle')
                ),
                ...spots.map((pt, i) =>
                  h('span', {
                    class: 'gb-seat ' + (i === 0 ? 'is-lit' : 'is-ash'),
                    style: { left: pt.x + '%', top: pt.y + '%', '--i': String(i) },
                  })
                )
              ),
              h('h3', { class: 'gb-circle-empty-title' }, 'Start a circle'),
              h(
                'p',
                { class: 'gb-circle-empty-copy' },
                'A few friends, one habit. Each seat lights up when that person checks in, and one tap cheers on whoever hasn’t.'
              ),
              h(
                'div',
                { class: 'gb-circle-empty-actions' },
                h(
                  'button',
                  { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact', onclick: newCircle },
                  Icon('plus', { size: 14, sw: 2.6 }),
                  'New circle'
                ),
                h(
                  'button',
                  { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: openBrowse },
                  'Find one to join'
                )
              )
            )
          );
        } else {
          mine.forEach((c, i) => el.appendChild(circleCard(c, { openPosts: i === 0 })));
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

  // After the first load, so a joined circle isn't painted over by the list.
  refresh().then(joinFromLink);

  const actions = h(
    'div',
    { class: 'gb-challenges-actions' },
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: openBrowse, 'aria-label': 'Browse circles' },
      Icon('search', { size: 14, sw: 2.4 }),
      h('span', { class: 'gb-circle-browse-label' }, 'Browse')
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
  wins,
  addHabit,
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
    focusSoon(noteInput);
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
    const baseRow = (item) =>
      item.side === 'incoming'
        ? IncomingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null)
        : OutgoingRow(item.req, onLoadStatus, onRevoke ? revokeAndRefresh : null);
    // One entry per person. Mentoring each other is two links, and listing that
    // person in both boxes with two toolbars read as the same row twice.
    const people = new Map();
    accepted.forEach((item) => {
      const p = people.get(item.partnerId) || { ...item, links: [] };
      p.links.push({ ...item, iMentor: iMentor(item) });
      people.set(item.partnerId, p);
    });
    const entries = [...people.values()].map((p) => ({ ...p, mutual: p.links.length > 1 }));
    const row = (p) => {
      const r = p.mutual ? MutualRow(p) : baseRow(p.links[0]);
      if (!mentorshipApi) return r;
      return h(
        'div',
        { class: 'gb-conn-item' },
        r,
        LinkExtras(
          p.links,
          p.partnerName,
          mentorshipApi,
          currentUserId,
          onRevoke ? revokeAndRefresh : null
        )
      );
    };
    // The person's row for a mutual pair: their progress opens from the link
    // where I'm the mentor, and each direction ends from its own checklist.
    function MutualRow(p) {
      const mine = p.links.find((l) => l.iMentor).req;
      const pill = CheckPill(mine);
      return h(
        'div',
        {
          class: 'gb-row is-clickable',
          ...activate(() =>
            showPartnerStatus(p.partnerId, p.partnerName, onLoadStatus, () => {
              mine.checkedAt = new Date().toISOString();
              paintCheckPill(pill, mine);
              refreshIcons();
            })
          ),
        },
        Avatar({ name: p.partnerName, bg: 'var(--iris-100)', fg: 'var(--iris-700)' }),
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'title' }, p.partnerName),
          h('div', { class: 'sub' }, 'You mentor each other')
        ),
        pill,
        Icon('chevron-right', { size: 16, sw: 2.4, color: 'var(--fg3)' })
      );
    }

    incomingEl.replaceChildren();
    if (!accepted.length) {
      // One quiet line, not a card: an empty box was the first thing on the screen.
      incomingEl.appendChild(
        h(
          'p',
          { class: 'gb-mentor-empty' },
          'No mentors or mentees yet. Find someone to learn from, or offer to guide.'
        )
      );
    } else {
      const single = entries.filter((p) => !p.mutual);
      [
        { title: 'Mentor each other', items: entries.filter((p) => p.mutual) },
        { title: 'You mentor', items: single.filter((p) => p.links[0].iMentor) },
        { title: 'Who mentors you', items: single.filter((p) => !p.links[0].iMentor) },
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
    // Sent invites only when there are some: "none pending" says nothing.
    if (invites.length) {
      outgoingEl.appendChild(h('h5', { class: 'gb-conn-group-head' }, 'Invites you sent', h('span', null, invites.length)));
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
    { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: launchSearch },
    Icon('search', { size: 14, sw: 2.4 }),
    'Find someone'
  );

  const challenges = challengesApi
    ? ChallengesPanel({ api: challengesApi, currentUserId, wins, addHabit })
    : null;
  const challengesPanel = challenges && challenges.node;

  /* Order is importance: invites waiting on you, then your circles (who is in
     today), then mentorship. It opened on Mentorship's two empty cards, with
     the circle itself below the fold under a "Challenges" heading. */
  const section = (title, action, ...kids) =>
    h(
      'section',
      { class: 'gb-circle-block' },
      h('div', { class: 'gb-circle-block-head' }, h('h2', { class: 'gb-circle-block-title' }, title), action || null),
      ...kids
    );
  screenEl = h(
    'div',
    { class: 'gb-rise gb-circle-screen' },
    requestsEl,
    challengesPanel ? section('Your circles', challenges.actions, challengesPanel) : null,
    section('Mentorship', addBtn, incomingEl, outgoingEl)
  );
  requestAnimationFrame(() => {
    if (screenEl.isConnected) wasMounted = true;
  });
  return screenEl;
}

export { ScreenCircle };
