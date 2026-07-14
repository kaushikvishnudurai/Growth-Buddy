/* =====================================================================
   Growth Buddy — Mentor (Buddy) chat screen
   ===================================================================== */
import { h, Icon, confirmDialog } from './gb-kit.js';

/** Lightweight markdown for chat bubbles: **bold** and *italic*; preserve newlines. */
function renderRich(text) {
  const out = document.createDocumentFragment();
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  parts.forEach((p) => {
    if (!p) return;
    if (p.startsWith('**') && p.endsWith('**')) {
      const b = document.createElement('strong');
      b.textContent = p.slice(2, -2);
      out.appendChild(b);
    } else if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      const i = document.createElement('em');
      i.textContent = p.slice(1, -1);
      out.appendChild(i);
    } else {
      out.appendChild(document.createTextNode(p));
    }
  });
  return out;
}

function bubble(role, content) {
  const isUser = role === 'user';
  const bubbleEl = h('div', { class: 'gb-msg-bubble' + (isUser ? ' is-user' : ' is-bot') });
  bubbleEl.appendChild(renderRich(content));
  return h(
    'div',
    { class: 'gb-msg-row' + (isUser ? ' is-user' : ' is-bot') },
    isUser
      ? null
      : h('div', { class: 'gb-msg-avatar' }, Icon('sparkles', { size: 16, color: '#fff' })),
    bubbleEl
  );
}

function typingBubble() {
  return h(
    'div',
    { class: 'gb-msg-row is-bot' },
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

/**
 * Self-contained chat panel. Owns its own thread + messages so the parent
 * doesn't have to round-trip them through global state on every keystroke.
 *
 *   ScreenMentor({ api })
 *     api: { get: () => Promise<{threadId, messages}>,
 *            post: (text) => Promise<{userMessage, assistantMessage}> }
 */
function ScreenMentor({ api }) {
  const listEl = h('div', { class: 'gb-msg-list' });
  const input = h('textarea', {
    class: 'gb-msg-input',
    'aria-label': 'Message Buddy',
    placeholder: "What's on your mind? You can vent — Buddy listens.",
    rows: 2,
    maxlength: 4000,
  });
  let busy = false;
  let cache = [];

  const PROMPTS = [
    'Plan my day',
    'I feel overwhelmed',
    'Help me focus',
    'I keep procrastinating',
    'Pep talk',
  ];

  function syncChipState() {
    clearChip.disabled = busy || !cache.length;
    sendBtn.disabled = busy;
    sendBtn.classList.toggle('is-busy', busy);
  }

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
      msgs.forEach((m) => listEl.appendChild(bubble(m.role, m.content)));
    }
    chipsRow.classList.toggle('is-hidden', !hasMessages);
    syncChipState();
    // Scroll to bottom after DOM paints.
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });
  }

  api
    .get()
    .then((data) => {
      cache = data.messages || [];
      renderMessages(cache);
    })
    .catch((err) => {
      renderMessages([]);
      listEl.appendChild(h('p', { class: 'gb-msg-error' }, err.message || 'Could not load chat.'));
    });

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    syncChipState();
    cache = cache.concat([{ role: 'user', content: text }]);
    renderMessages(cache);
    // Append a typing indicator below the user message.
    const typing = typingBubble();
    listEl.appendChild(typing);
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
    });
    input.value = '';

    try {
      const reply = await api.post(text);
      cache.push(reply.assistantMessage);
      typing.remove();
      renderMessages(cache);
    } catch (err) {
      typing.remove();
      cache.push({ role: 'assistant', content: 'Hmm, something glitched. Try again?' });
      renderMessages(cache);
      console.error(err);
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
      await api.clear();
      cache = [];
      renderMessages(cache);
    } catch (err) {
      listEl.appendChild(h('p', { class: 'gb-msg-error' }, err.message || 'Could not clear chat.'));
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
    { class: 'gb-msg-chips' },
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

  return h(
    'div',
    { class: 'gb-mentor gb-rise' },
    listEl,
    chipsRow,
    h('div', { class: 'gb-msg-bar' }, input, sendBtn)
  );
}

export { ScreenMentor };
