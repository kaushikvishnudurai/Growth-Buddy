/* =====================================================================
   Growth Buddy — Mentor (Buddy) chat screen
   ===================================================================== */
import { h, Icon, confirmDialog, openModal, fieldRefusal } from './gb-kit.js';

/* ---- One-tap actions under a reply ----
   The server takes Buddy's ```actions block out of the reply and hands it back
   as message.actions (MentorActions.java). These are the chips; a tap opens a
   prefilled confirm sheet, and only Save creates anything. */
const ACTION_LABEL = { task: 'Add as task', habit: 'Make it a habit', reminder: 'Remind me' };
const ACTION_ICON = { task: 'list-checks', habit: 'repeat', reminder: 'alarm-clock' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** message.actions → chip descriptors, at most 3, unknown types / blank titles / repeats dropped. Pure. */
export function actionChips(actions) {
  if (!Array.isArray(actions)) return [];
  const out = [];
  const seen = new Set();
  for (const a of actions) {
    if (!a || !Object.prototype.hasOwnProperty.call(ACTION_LABEL, a.type)) continue;
    const title = String(a.title == null ? '' : a.title).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const key = a.type + '\n' + title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: a.type,
      label: ACTION_LABEL[a.type],
      icon: ACTION_ICON[a.type],
      title,
      time: HHMM.test(a.time || '') ? a.time : null,
      aria: ACTION_LABEL[a.type] + ': ' + title,
    });
    if (out.length === 3) break;
  }
  return out;
}

/** What a reply shows while it streams: the actions fence (and a half-arrived
    "`" or "``") is not text. Pure. The server strips the same block on save. */
export function streamVisible(text) {
  const s = String(text == null ? '' : text);
  const at = s.indexOf('```');
  if (at >= 0) return s.slice(0, at).replace(/\s+$/, '');
  return s.replace(/`{1,2}$/, '');
}

/** A thread still on its starting name; the server renames it from the first message. */
const STARTING_TITLES = ['New conversation', 'Talk to Buddy'];

/* **bold** and *italic*, but only when the asterisks hug the words: "2 * 3 * 4"
   and "a * b" stay plain (they used to come out as "2 <em> 3 </em> 4"). An
   italic never spans a line. */
const RICH = /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;

/** Split chat text into [{type: 'b' | 'i' | 't', text}] runs. Pure, so it is testable. */
export function richParts(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let last = 0;
  for (const m of s.matchAll(RICH)) {
    if (m.index > last) out.push({ type: 't', text: s.slice(last, m.index) });
    out.push(m[1] != null ? { type: 'b', text: m[1] } : { type: 'i', text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 't', text: s.slice(last) });
  return out;
}

/** Lightweight markdown for chat bubbles (see richParts); newlines kept by CSS. */
function renderRich(text) {
  const out = document.createDocumentFragment();
  richParts(text).forEach((p) => {
    if (p.type === 't') {
      out.appendChild(document.createTextNode(p.text));
      return;
    }
    const el = document.createElement(p.type === 'b' ? 'strong' : 'em');
    el.textContent = p.text;
    out.appendChild(el);
  });
  return out;
}

/* Words that read like a crisis. Checked on the user's own message before it is
   sent, on the device; the card it shows is never sent or saved. A false
   positive costs one card of phone numbers, a miss costs more, so it leans wide.
   The prompt also tells Buddy to point to a crisis line; this does not depend
   on the model, the network, or the AI being configured. */
const CRISIS =
  /\b(suicid\w*|kill(ing)? myself|end(ing)? (it all|my life)|take my (own )?life|want(ed)? to die|wish i (was|were) dead|better off dead|no reason to live|self[- ]?harm\w*|hurt(ing)? myself|cut(ting)? myself)\b/i;

export function crisisMatch(text) {
  return CRISIS.test(String(text || ''));
}

function crisisCard() {
  return h(
    'div',
    { class: 'gb-msg-crisis', role: 'note' },
    h('strong', null, 'You deserve support right now.'),
    'If you are thinking about harming yourself, please reach out to someone who can help today. ' +
      'India: Tele-MANAS ',
    h('a', { href: 'tel:14416' }, '14416'),
    ' (24x7). US: ',
    h('a', { href: 'tel:988' }, '988'),
    '. Elsewhere: ',
    h(
      'a',
      { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer' },
      'findahelpline.com'
    ),
    '. In danger right now? Call your local emergency number. Buddy is here to talk too, but it is not a crisis service.'
  );
}

/** The chips row under a reply, or null when it offered none. */
function actionsRow(actions, onAction) {
  const chips = onAction ? actionChips(actions) : [];
  if (!chips.length) return null;
  return h(
    'div',
    { class: 'gb-msg-actions', role: 'group', 'aria-label': 'Suggested actions' },
    chips.map((c) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-msg-chip gb-msg-action',
          'aria-label': c.aria,
          title: c.title,
          onclick: () => onAction(c),
        },
        Icon(c.icon, { size: 14 }),
        c.label
      )
    )
  );
}

function bubble(role, content, actions, onAction) {
  const isUser = role === 'user';
  const bubbleEl = h('div', { class: 'gb-msg-bubble' + (isUser ? ' is-user' : ' is-bot') });
  bubbleEl.appendChild(renderRich(content));
  return h(
    'div',
    { class: 'gb-msg-row' + (isUser ? ' is-user' : ' is-bot') },
    isUser
      ? null
      : h('div', { class: 'gb-msg-avatar' }, Icon('sparkles', { size: 16, color: '#fff' })),
    isUser ? bubbleEl : h('div', { class: 'gb-msg-col' }, bubbleEl, actionsRow(actions, onAction))
  );
}

function typingBubble() {
  return h(
    'div',
    { class: 'gb-msg-row is-bot', 'aria-label': 'Buddy is typing' },
    h('div', { class: 'gb-msg-avatar' }, Icon('sparkles', { size: 16, color: '#fff' })),
    h(
      'div',
      { class: 'gb-msg-bubble is-bot gb-msg-typing' },
      h('span', { class: 'd' }),
      h('span', { class: 'd' }),
      h('span', { class: 'd' })
    )
  );
}

const OFFLINE = 'You are offline. Messages to Buddy need a connection.';

/**
 * Split buffered Server-Sent Events text into whole events. Pure, so it is
 * testable: returns {events: [{event, data}], rest}, where rest is the partial
 * event still waiting for its blank line. data is JSON-parsed; an event whose
 * data isn't JSON is dropped (one bad chunk is a few missing words, not a
 * failed reply). Comment lines (":") are keep-alives.
 */
export function parseSse(buf) {
  const events = [];
  let rest = String(buf || '').replace(/\r\n?/g, '\n');
  let at;
  while ((at = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, at);
    rest = rest.slice(at + 2);
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line[0] === ':') continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value[0] === ' ') value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join('\n')) });
    } catch (_) {
      // malformed: skipped
    }
  }
  return { events, rest };
}

/**
 * Self-contained chat panel. Owns its own thread + messages so the parent
 * doesn't have to round-trip them through global state on every keystroke.
 *
 *   ScreenMentor({ api, threadId, starter })
 *     api: { get: (threadId?) => Promise<{threadId, messages}>  (no id: the newest thread),
 *            post: (text, threadId) => Promise<{userMessage, assistantMessage}>,
 *            stream?: (text, signal, threadId) => Promise<Response>  (an open text/event-stream;
 *              throws {fallback: true} when post should be used instead),
 *            clear: (threadId) => Promise,
 *            threads?: { list, create, rename(id, title), remove(id) },
 *            onThread?: (id) => void   (the shell remembers the open thread, in memory),
 *            act?: { task(title), habit({title, time}), reminder({title, date, time}) },
 *            today?: () => 'YYYY-MM-DD',
 *            reflection?: { label: () => string, open: () => void } }
 *     threadId: the thread to open (else the newest); starter: text to prefill the input with.
 */
function ScreenMentor({ api, threadId: initialThread, starter }) {
  // role=log: a screen reader announces each new bubble as it is appended,
  // without re-reading the whole conversation.
  const listEl = h('div', {
    class: 'gb-msg-list',
    role: 'log',
    'aria-live': 'polite',
    'aria-label': 'Conversation with Buddy',
  });
  const input = h('textarea', {
    class: 'gb-msg-input',
    'aria-label': 'Message Buddy',
    placeholder: "What's on your mind? You can vent — Buddy listens.",
    rows: 2,
    maxlength: 4000,
  });
  let busy = false;
  let loaded = false;
  // Set while a reply streams; the send button is Stop until it settles.
  let stopCtl = null;
  // Only what the server has: a failed send's bubble is never cached.
  let cache = [];
  let threadId = initialThread || null;
  let threadTitle = '';
  const onAction = api.act ? (c) => openActionSheet(c) : null;

  const PROMPTS = [
    'Plan my day',
    'I feel overwhelmed',
    'Help me focus',
    'I keep procrastinating',
    'Pep talk',
  ];

  function syncChipState() {
    clearChip.disabled = busy || !cache.length;
    sendBtn.disabled = busy || !loaded;
    sendBtn.classList.toggle('is-busy', busy && !stopCtl);
    sendBtn.hidden = !!stopCtl;
    stopBtn.hidden = !stopCtl;
    // A thread switch mid-reply would paint the reply into the wrong chat.
    // Still offered when a load failed: another chat is a way out of a broken one.
    threadsBtn.disabled = busy;
    newBtn.disabled = busy;
  }

  const toBottom = () =>
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });

  /** Whole-list paint: first load and clear only. A send appends. */
  function renderMessages(msgs) {
    const hasMessages = Array.isArray(msgs) && msgs.length > 0;
    listEl.replaceChildren();
    if (!hasMessages) {
      listEl.appendChild(
        h(
          'div',
          { class: 'gb-mentor-empty' },
          Icon('sparkles', { size: 30, color: 'var(--iris-500)' }),
          h('h3', null, 'Talk to Buddy'),
          h('p', null, 'A warm, non-judgmental space. Vent, plan, or ask for a gentle nudge.'),
          h(
            'div',
            { class: 'gb-mentor-suggestions' },
            PROMPTS.slice(0, 3).map((p) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--soft gb-mentor-suggestion',
                  onclick: () => {
                    input.value = p;
                    send();
                  },
                },
                p
              )
            )
          )
        )
      );
    } else {
      msgs.forEach((m) => listEl.appendChild(bubble(m.role, m.content, m.actions, onAction)));
    }
    chipsRow.classList.toggle('is-hidden', !hasMessages);
    syncChipState();
    toBottom();
  }

  /** Append one node, swapping the empty state out first if it is showing. */
  function append(node) {
    const empty = listEl.querySelector('.gb-mentor-empty');
    if (empty) empty.remove();
    chipsRow.classList.remove('is-hidden');
    listEl.appendChild(node);
    toBottom();
  }

  /* A load failure shows the failure and a way out, not the "Talk to Buddy"
     welcome: chips under an error invited a send into a chat that never loaded. */
  function load() {
    listEl.replaceChildren(h('div', { class: 'gb-mentor-empty', 'aria-busy': 'true' }, 'Loading…'));
    loaded = false;
    syncChipState();
    const asked = threadId;
    api
      .get(asked)
      .then((data) => {
        // A switch while this was loading: the newer load paints, not this one.
        if (asked !== threadId) return;
        loaded = true;
        cache = (data && data.messages) || [];
        if (data && data.threadId && data.threadId !== threadId) {
          threadId = data.threadId;
          if (api.onThread) api.onThread(threadId);
        }
        if (data && data.title) setTitle(data.title);
        else refreshTitle();
        renderMessages(cache);
        if (starter && !input.value) {
          input.value = starter;
          starter = '';
        }
      })
      .catch((err) => {
        if (asked !== threadId) return;
        chipsRow.classList.add('is-hidden');
        listEl.replaceChildren(
          h(
            'div',
            { class: 'gb-mentor-loadfail', role: 'alert' },
            h(
              'p',
              { class: 'gb-msg-error' },
              !navigator.onLine ? OFFLINE : (err && err.message) || 'Could not load chat.'
            ),
            h('button', { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: load }, 'Retry')
          )
        );
        syncChipState();
      });
  }

  /* ---- Threads ---- */
  function setTitle(t) {
    threadTitle = t || '';
    titleEl.textContent = threadTitle || 'Talk to Buddy';
  }

  /** The open thread's name from the list (after a first message renamed it). */
  function refreshTitle() {
    if (!api.threads || !threadId) return Promise.resolve();
    const id = threadId;
    return api.threads
      .list()
      .then((list) => {
        const t = (list || []).find((x) => x.id === id);
        if (t && id === threadId) setTitle(t.title);
      })
      .catch(() => {});
  }

  function switchTo(id, title) {
    if (busy) return;
    threadId = id || null;
    if (api.onThread) api.onThread(threadId);
    setTitle(title || '');
    input.value = '';
    load();
  }

  async function newChat() {
    if (busy || !api.threads) return;
    const t = await api.threads.create();
    switchTo(t.id, t.title);
  }

  function threadRow(t, close, onGone) {
    const pick = h(
      'button',
      {
        type: 'button',
        class: 'gb-thread-pick',
        'aria-current': t.id === threadId ? 'true' : null,
        onclick: () => {
          close();
          if (t.id !== threadId) switchTo(t.id, t.title);
        },
      },
      Icon('message-circle', { size: 16 }),
      h('span', { class: 'gb-thread-name' }, t.title || 'Untitled chat'),
      t.createdAt
        ? h('span', { class: 'gb-thread-date' }, new Date(t.createdAt).toLocaleDateString())
        : null
    );
    const row = h('div', { class: 'gb-thread-row' + (t.id === threadId ? ' is-current' : ''), role: 'listitem' });
    const rename = h(
      'button',
      { type: 'button', class: 'gb-icon-btn', 'aria-label': 'Rename ' + (t.title || 'chat'), onclick: startRename },
      Icon('pencil', { size: 16 })
    );
    let armed = false;
    const del = h(
      'button',
      {
        type: 'button',
        class: 'gb-icon-btn gb-thread-del',
        'aria-label': 'Delete ' + (t.title || 'chat'),
        onclick: async () => {
          // Two taps, not a confirm stacked on this sheet.
          if (!armed) {
            armed = true;
            del.classList.add('is-armed');
            del.setAttribute('aria-label', 'Tap again to delete ' + (t.title || 'chat'));
            del.replaceChildren(h('span', null, 'Delete?'));
            return;
          }
          del.disabled = true;
          try {
            await api.threads.remove(t.id);
            row.remove();
            onGone(t);
          } catch (err) {
            del.disabled = false;
            row.appendChild(h('p', { class: 'gb-msg-error', role: 'alert' }, (err && err.message) || 'Could not delete.'));
          }
        },
      },
      Icon('trash-2', { size: 16 })
    );
    function startRename() {
      const field = h('input', {
        class: 'gb-input gb-thread-rename',
        value: t.title || '',
        maxlength: 200,
        'aria-label': 'Chat name',
      });
      // Enter, Escape and blur can all arrive for one edit; only the first counts.
      let settled = false;
      const save = async () => {
        if (settled) return;
        settled = true;
        const title = field.value.replace(/\s+/g, ' ').trim();
        if (!title || title === t.title) return paint();
        field.disabled = true;
        try {
          const saved = await api.threads.rename(t.id, title);
          t.title = (saved && saved.title) || title;
          if (t.id === threadId) setTitle(t.title);
        } catch (err) {
          settled = false;
          field.disabled = false;
          field.focus();
          row.appendChild(h('p', { class: 'gb-msg-error', role: 'alert' }, (err && err.message) || 'Could not rename.'));
          return;
        }
        paint();
      };
      field.addEventListener('keydown', (e) => {
        // Kept from the sheet: Enter would press New chat, Escape close Settings.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          save();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          settled = true;
          paint();
        }
      });
      field.addEventListener('blur', save);
      row.replaceChildren(field);
      field.focus();
      field.select();
    }
    function paint() {
      pick.querySelector('.gb-thread-name').textContent = t.title || 'Untitled chat';
      rename.setAttribute('aria-label', 'Rename ' + (t.title || 'chat'));
      row.replaceChildren(pick, rename, del);
    }
    paint();
    return row;
  }

  function openThreads() {
    if (busy || !api.threads) return;
    const list = h('div', { class: 'gb-thread-list', role: 'list', 'aria-busy': 'true' }, 'Loading…');
    const reflect = api.reflection
      ? h(
          'button',
          {
            type: 'button',
            class: 'gb-thread-reflect',
            onclick: () => {
              close();
              api.reflection.open();
            },
          },
          Icon('moon', { size: 16 }),
          h('span', null, 'Evening reflection: ' + api.reflection.label()),
          h('span', { class: 'gb-thread-reflect-act' }, 'Change')
        )
      : null;
    const close = openModal({
      title: 'Your chats with Buddy',
      body: h('div', null, list, reflect),
      primary: 'New chat',
      onPrimary: newChat,
      dismiss: 'Close',
      errorMessage: 'Could not start a new chat.',
      modalClass: 'gb-thread-modal',
    });
    const onGone = (t) => {
      if (!list.querySelector('.gb-thread-row')) list.replaceChildren(h('p', { class: 'gb-field-hint' }, 'No chats yet.'));
      // The open chat went: show the newest left (the server makes one if none is).
      if (t.id === threadId) switchTo(null, '');
    };
    api.threads
      .list()
      .then((rows) => {
        list.removeAttribute('aria-busy');
        list.replaceChildren(...(rows || []).map((t) => threadRow(t, close, onGone)));
        if (!rows || !rows.length) list.replaceChildren(h('p', { class: 'gb-field-hint' }, 'No chats yet.'));
      })
      .catch((err) => {
        list.removeAttribute('aria-busy');
        list.replaceChildren(h('p', { class: 'gb-msg-error', role: 'alert' }, (err && err.message) || 'Could not load your chats.'));
      });
  }

  /* ---- One-tap actions: the confirm sheet ---- */
  function openActionSheet(c) {
    const titleInput = h('input', {
      class: 'gb-input',
      value: c.title,
      maxlength: 120,
      'aria-label': c.type === 'habit' ? 'Habit name' : c.type === 'task' ? 'Task title' : 'Remind me to',
    });
    const timeInput =
      c.type === 'task' ? null : h('input', { class: 'gb-input', type: 'time', value: c.time || '', 'aria-label': 'Time' });
    const today = api.today ? api.today() : new Date().toISOString().slice(0, 10);
    const dateInput =
      c.type === 'reminder' ? h('input', { class: 'gb-input', type: 'date', value: today, min: today, 'aria-label': 'Date' }) : null;
    const field = (label, el) => (el ? h('label', { class: 'gb-field' }, h('span', { class: 'gb-field-label' }, label), el) : null);
    openModal({
      title: c.label,
      sub: 'From Buddy’s suggestion. Change anything before you save.',
      body: h(
        'div',
        { class: 'gb-msg-action-form' },
        field(c.type === 'habit' ? 'Habit' : c.type === 'task' ? 'Task' : 'Remind me to', titleInput),
        field('Date', dateInput),
        field(c.type === 'habit' ? 'Daily reminder (optional)' : 'Time (optional)', timeInput)
      ),
      primary: c.type === 'task' ? 'Add task' : c.type === 'habit' ? 'Add habit' : 'Add reminder',
      errorMessage: 'Could not save that.',
      onPrimary: async () => {
        const title = titleInput.value.replace(/\s+/g, ' ').trim();
        if (!title) throw fieldRefusal(titleInput, 'Give it a name.');
        const time = timeInput && timeInput.value ? timeInput.value : null;
        if (c.type === 'task') await api.act.task(title);
        else if (c.type === 'habit') await api.act.habit({ title, time });
        else {
          const date = dateInput.value || today;
          if (date < today) throw fieldRefusal(dateInput, 'That day has already passed.');
          await api.act.reminder({ title, date, time, timeInput });
        }
      },
    });
  }

  /** Error line + Retry under a message that didn't go through. */
  function failRow(message, onRetry) {
    return h(
      'div',
      { class: 'gb-msg-fail', role: 'alert' },
      h('span', { class: 'gb-msg-error' }, message),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--soft gb-btn--compact', onclick: onRetry },
        'Retry'
      )
    );
  }

  /* The streaming half of a send. Resolves to {userMessage, assistantMessage}
     once the server says done; the bubble fills in as plain text while the words
     arrive, and gets its bold/italic only then (half a "**" would flash). Throws
     with .fallback when nothing came back that could be read as a stream, so the
     caller can send the plain way instead; with .partial when some words came
     and then the reply stopped (Stop, or the line dropped). */
  async function streamReply(text, typing, sendThread) {
    const ctl = new AbortController();
    stopCtl = ctl;
    syncChipState();
    let row = null;
    let bubbleEl = null;
    let got = '';
    const ensureRow = () => {
      if (row) return;
      typing.remove();
      row = bubble('assistant', '');
      bubbleEl = row.querySelector('.gb-msg-bubble');
      append(row);
    };
    try {
      const res = await api.stream(text, ctl.signal, sendThread);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSse(buf + decoder.decode(value, { stream: true }));
        buf = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.event === 'delta' && ev.data && typeof ev.data.text === 'string') {
            ensureRow();
            got += ev.data.text;
            bubbleEl.textContent = streamVisible(got);
            toBottom();
          } else if (ev.event === 'done' && ev.data && ev.data.message) {
            ensureRow();
            bubbleEl.replaceChildren(renderRich(ev.data.message.content));
            const acts = actionsRow(ev.data.message.actions, onAction);
            if (acts) bubbleEl.after(acts);
            return { userMessage: ev.data.userMessage, assistantMessage: ev.data.message };
          } else if (ev.event === 'error') {
            if (row) row.remove();
            const fail = new Error((ev.data && ev.data.message) || 'Could not reach Buddy.');
            fail.status = ev.data && ev.data.status;
            throw fail;
          }
        }
      }
      // Closed with no done: what arrived is what the server kept.
      throw Object.assign(new Error('The reply was cut off.'), { partial: got, row });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw Object.assign(new Error('Stopped.'), { stopped: true, partial: got, row });
      }
      throw err;
    } finally {
      stopCtl = null;
    }
  }

  async function send() {
    const text = input.value.trim();
    if (!text || busy || !loaded) return;
    // The thread this send belongs to, fixed now: the reply streams into it.
    const sendThread = threadId;
    busy = true;
    syncChipState();
    const userRow = bubble('user', text);
    append(userRow);
    const crisis = crisisMatch(text) ? crisisCard() : null;
    if (crisis) append(crisis);
    const typing = typingBubble();
    append(typing);
    input.value = '';

    try {
      if (!navigator.onLine) throw new Error(OFFLINE);
      let reply = null;
      if (api.stream) {
        try {
          reply = await streamReply(text, typing, sendThread);
        } catch (err) {
          // Only "couldn't stream at all" goes the old way; a 429 or a Stop doesn't.
          if (!err || !err.fallback) throw err;
        }
      }
      if (!reply) {
        reply = await api.post(text, sendThread);
        typing.remove();
        append(bubble('assistant', reply.assistantMessage.content, reply.assistantMessage.actions, onAction));
      }
      cache.push(reply.userMessage || { role: 'user', content: text });
      cache.push(reply.assistantMessage);
      if (STARTING_TITLES.includes(threadTitle) || !threadTitle) refreshTitle();
    } catch (err) {
      typing.remove();
      if (err && err.partial) {
        // Some words arrived: the server saved those, so they stay and are cached
        // as Buddy's. No Retry — it would ask the same question twice.
        const kept = err.row && err.row.querySelector('.gb-msg-bubble');
        if (kept) kept.replaceChildren(renderRich(streamVisible(err.partial)));
        cache.push({ role: 'user', content: text });
        cache.push({ role: 'assistant', content: streamVisible(err.partial) });
        if (!err.stopped) append(h('p', { class: 'gb-msg-error', role: 'alert' }, err.message));
      } else {
        userRow.classList.add('is-failed');
        // The server's own words (a 429 says to take a break, a 400 says what was
        // wrong); this used to be one "something glitched" for every failure, and
        // it was cached as if Buddy had said it. A Stop before any word lands here
        // too: the server took the message back out, so it is offered again.
        const msg = (err && err.message) || 'Could not reach Buddy.';
        const row = failRow(msg, () => {
          userRow.remove();
          row.remove();
          if (crisis) crisis.remove();
          input.value = text;
          send();
        });
        append(row);
        if (!err || !err.stopped) console.error(err);
      }
    } finally {
      busy = false;
      syncChipState();
      input.focus();
    }
  }

  async function clearAll() {
    if (busy || !cache.length) return;
    const ok = await confirmDialog({
      title: 'Clear this chat?',
      message: 'All mentor messages will be removed.',
      confirmLabel: 'Clear chat',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    busy = true;
    syncChipState();
    try {
      await api.clear(threadId);
      cache = [];
      renderMessages(cache);
    } catch (err) {
      append(h('p', { class: 'gb-msg-error', role: 'alert' }, err.message || 'Could not clear chat.'));
    } finally {
      busy = false;
      syncChipState();
      input.focus();
    }
  }

  input.addEventListener('keydown', (e) => {
    // Enter sends, Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  const sendBtn = h(
    'button',
    { type: 'button', class: 'gb-msg-send', 'aria-label': 'Send', onclick: send },
    Icon('send', { size: 18, color: '#fff', sw: 2.4 })
  );

  const stopBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-msg-send gb-msg-stop',
      'aria-label': "Stop Buddy's reply",
      hidden: true,
      onclick: () => stopCtl && stopCtl.abort(),
    },
    Icon('x', { size: 18, color: '#fff', sw: 2.4 })
  );

  const clearChip = h(
    'button',
    {
      type: 'button',
      class: 'gb-msg-chip gb-msg-chip--clear',
      onclick: clearAll,
      'aria-label': 'Clear mentor chat',
    },
    'Clear chat'
  );

  const chipsRow = h(
    'div',
    { class: 'gb-msg-chips is-hidden' },
    clearChip,
    PROMPTS.map((p) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-msg-chip',
          'aria-label': p,
          onclick: () => {
            input.value = p;
            input.focus();
            send();
          },
        },
        p
      )
    )
  );

  // The thread bar: which chat this is, the list of them, and a new one.
  const titleEl = h('span', { class: 'gb-mentor-thread-name' }, 'Talk to Buddy');
  const threadsBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-mentor-thread',
      'aria-label': 'Your chats with Buddy',
      'aria-haspopup': 'dialog',
      onclick: openThreads,
    },
    Icon('history', { size: 16 }),
    titleEl
  );
  const newBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-icon-btn gb-mentor-new',
      'aria-label': 'New chat',
      onclick: () =>
        newChat().catch((err) =>
          append(h('p', { class: 'gb-msg-error', role: 'alert' }, (err && err.message) || 'Could not start a new chat.'))
        ),
    },
    Icon('plus', { size: 18 })
  );
  const threadBar = api.threads ? h('div', { class: 'gb-mentor-bar' }, threadsBtn, newBtn) : null;

  load();

  return h(
    'div',
    { class: 'gb-mentor gb-rise' },
    threadBar,
    listEl,
    chipsRow,
    h('div', { class: 'gb-msg-bar' }, input, sendBtn, stopBtn)
  );
}

export { ScreenMentor };
