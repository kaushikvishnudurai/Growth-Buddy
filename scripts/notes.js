/* =====================================================================
   Growth Buddy — Notes (quick jottings, rich text)
   ===================================================================== */
import { h, Icon, refreshIcons, confirmDialog, openOverlay, openModal } from './gb-kit.js';
import { toast } from './toast.js';

/* Swatches a note can wear. `null` (no colour) is the default and stays the
   plain card.

   These are the SEMANTIC soft tokens, not the raw `--sun-50` ramp they used to
   be. The ramps are theme-independent by design, so `--sun-50` is #FFF7E0 in
   dark mode too — and a note card sets only its background and inherits
   `--fg1`/`--fg2` for the text, which flip to near-white there. A yellow note
   came out cream-on-cream at about 1.03:1: the colour saved correctly and the
   note simply went blank. (The pills and chips elsewhere pair a `-50` tint with
   a pinned `-700` foreground, which is why they read fine in both themes; a
   whole card done that way would be a glaring white slab.) The soft tokens
   carry a light tint in light mode and a low-alpha wash in dark, so the
   inherited text stays readable either way. */
const COLORS = [
  { key: 'sun', label: 'Yellow', bg: 'var(--warning-soft)', line: 'var(--warning)' },
  { key: 'leaf', label: 'Green', bg: 'var(--success-soft)', line: 'var(--success)' },
  { key: 'sky', label: 'Blue', bg: 'var(--info-soft)', line: 'var(--info)' },
  { key: 'iris', label: 'Purple', bg: 'var(--ai-soft)', line: 'var(--ai)' },
  { key: 'coral', label: 'Coral', bg: 'var(--brand-soft)', line: 'var(--brand)' },
];
const colorOf = (key) => COLORS.find((c) => c.key === key) || null;

/* ---------------------------------------------------------------------
   Sanitising
   ------------------------------------------------------------------ */

/**
 * Tags a note body may contain, with the attributes each may keep. Everything
 * else is UNWRAPPED (element dropped, its text kept) rather than deleted, so a
 * paste from a web page loses its markup instead of its words.
 */
const ALLOWED = {
  P: [],
  BR: [],
  DIV: [],
  SPAN: [],
  B: [],
  STRONG: [],
  I: [],
  EM: [],
  U: [],
  S: [],
  STRIKE: [],
  UL: [],
  OL: [],
  LI: [],
  H2: [],
  H3: [],
  BLOCKQUOTE: [],
  CODE: [],
  PRE: [],
  A: ['href'],
};
/* Elements with no text worth keeping: unwrapping a <script> would paste its
   source into the note, so these go entirely. */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT']);

/**
 * A note body safe to hand to innerHTML.
 *
 * <p>Rich text means storing HTML, and HTML from a contenteditable is whatever
 * the user pasted — a page copied from the web brings its scripts, its handlers
 * and its javascript: links along. This runs on the way IN (before saving) and
 * on the way OUT (before painting), because a note saved by an older build has
 * never been through the first one.
 *
 * <p>Allow-list over a DOM the browser already parsed, not a regex: the parse is
 * the part that's hard to get right, and DOMParser does it in an inert document
 * where nothing executes.
 */
/* The only hrefs a note may carry. javascript: and data: are the two that turn
   a link into an exploit. sanitize() is the boundary that enforces it, and the
   link dialog tests the same rule so a bad URL is refused while it can still be
   corrected, rather than silently losing its href on save. */
const SAFE_HREF = /^(https?:|mailto:|#|\/)/i;

function sanitize(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const walk = (node) => {
    // Copy first: unwrapping mutates the child list mid-iteration otherwise.
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 3) return; // text: always fine
      if (child.nodeType !== 1) {
        child.remove(); // comments, CDATA, processing instructions
        return;
      }
      const tag = child.tagName;
      if (DROP.has(tag)) {
        child.remove();
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(ALLOWED, tag)) {
        walk(child);
        child.replaceWith(...Array.from(child.childNodes));
        return;
      }
      Array.from(child.attributes).forEach((attr) => {
        const keep = ALLOWED[tag].includes(attr.name.toLowerCase());
        if (!keep) child.removeAttribute(attr.name);
      });
      if (tag === 'A') {
        const href = (child.getAttribute('href') || '').trim();
        if (!SAFE_HREF.test(href)) {
          child.removeAttribute('href');
        } else {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
      }
      walk(child);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Plain text of a note body — for the list preview and the "make a task" title. */
function textOf(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return 'Just now';
  if (sec < 3600) return Math.round(sec / 60) + ' min ago';
  if (sec < 86400) return Math.round(sec / 3600) + ' h ago';
  if (sec < 604800) return Math.round(sec / 86400) + ' d ago';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------------------------------------------------------------------
   The editor
   ------------------------------------------------------------------ */

const TOOLS = [
  { cmd: 'bold', icon: 'bold', label: 'Bold', key: 'b' },
  { cmd: 'italic', icon: 'italic', label: 'Italic', key: 'i' },
  { cmd: 'underline', icon: 'underline', label: 'Underline', key: 'u' },
  { cmd: 'formatBlock', value: 'h2', icon: 'heading-2', label: 'Heading', state: 'h2' },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bullet list' },
  { cmd: 'insertOrderedList', icon: 'list-ordered', label: 'Numbered list' },
  { cmd: 'createLink', icon: 'link', label: 'Link', prompt: 'Link to…' },
];

/**
 * A contenteditable with a toolbar.
 *
 * <p>ponytail: `document.execCommand`. It is deprecated and every browser still
 * implements it, because the replacement is "write your own document model on
 * top of beforeinput" — a text editor project, not a feature. The cost of the
 * shortcut is bounded: commands are fixed, output goes through sanitize(), and
 * if a browser ever drops it the fallback is a plain textarea. Reach for a real
 * editor library only when notes need tables, images or collaboration.
 */
function richEditor({ html, placeholder, onInput } = {}) {
  const area = h('div', {
    class: 'gb-editor',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': placeholder || 'Note',
    'data-placeholder': placeholder || 'Write something…',
  });
  area.innerHTML = sanitize(html || '');

  const buttons = [];
  function syncState() {
    buttons.forEach(({ btn, tool }) => {
      let on = false;
      try {
        on = tool.state
          ? document.queryCommandValue('formatBlock').toLowerCase() === tool.state
          : document.queryCommandState(tool.cmd);
      } catch (_) {
        /* queryCommandState throws on some commands in some browsers */
      }
      btn.classList.toggle('is-on', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* window.prompt is browser chrome: unthemed, captioned with the origin
     ("growth-buddy-….onrender.com says"), and in the Capacitor WebView a system
     alert that looks nothing like the app. Ask in our own sheet instead.
     Opening one moves focus out of the editor and takes the selection with it,
     so the range is captured here and restored before execCommand runs —
     without that, createLink has nothing to wrap. */
  function promptFor(tool) {
    const sel = window.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const input = h('input', {
      type: 'url',
      class: 'gb-input',
      placeholder: 'https://example.com',
      'aria-label': tool.prompt,
    });
    openModal({
      title: tool.prompt,
      body: input,
      primary: 'Add link',
      errorMessage: 'That does not look like a link.',
      onPrimary: () => {
        const url = input.value.trim();
        // Same rule sanitize() applies on save, so the refusal lands here where
        // it can still be fixed instead of quietly dropping the href later.
        if (!url || !SAFE_HREF.test(url)) {
          throw new Error('Enter a link starting with https://');
        }
        area.focus();
        if (saved) {
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(saved);
        }
        document.execCommand(tool.cmd, false, url);
        syncState();
        if (onInput) onInput();
      },
    });
    setTimeout(() => input.focus(), 60);
  }

  function run(tool) {
    area.focus();
    let value = tool.value;
    if (tool.prompt) {
      promptFor(tool);
      return;
    }
    if (tool.cmd === 'formatBlock') {
      // Second press on a heading returns it to a paragraph.
      const current = (document.queryCommandValue('formatBlock') || '').toLowerCase();
      value = current === tool.state ? 'p' : tool.value;
    }
    document.execCommand(tool.cmd, false, value);
    syncState();
    if (onInput) onInput();
  }

  const bar = h('div', { class: 'gb-editor-bar', role: 'toolbar', 'aria-label': 'Formatting' });
  TOOLS.forEach((tool) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-editor-btn',
        'aria-label': tool.label,
        'aria-pressed': 'false',
        title: tool.label + (tool.key ? ' (⌘' + tool.key.toUpperCase() + ')' : ''),
        // mousedown, not click: click fires after the caret has already left the
        // editor, so the command would apply to nothing.
        onmousedown: (e) => {
          e.preventDefault();
          run(tool);
        },
      },
      Icon(tool.icon, { size: 16, sw: 2.4 })
    );
    buttons.push({ btn, tool });
    bar.appendChild(btn);
  });

  // Semantic tags (<b>, <i>) rather than <span style>, so sanitize() keeps the
  // formatting instead of stripping the style attribute and losing it.
  try {
    document.execCommand('styleWithCSS', false, false);
  } catch (_) {
    /* not supported → tags are the default anyway */
  }

  area.addEventListener('keyup', syncState);
  area.addEventListener('mouseup', syncState);
  area.addEventListener('input', () => onInput && onInput());
  // Paste as the sanitiser sees it, so what lands is what gets saved.
  area.addEventListener('paste', (e) => {
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    if (!html) return;
    e.preventDefault();
    document.execCommand('insertHTML', false, sanitize(html));
    if (onInput) onInput();
  });

  return {
    node: h('div', { class: 'gb-editor-wrap' }, bar, area),
    area,
    read: () => sanitize(area.innerHTML).trim(),
    focus: () => area.focus(),
  };
}

/* ---------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------ */

function sheet({ title, body, primary, onPrimary, headActions, onDismiss }) {
  let busy = false;
  /* One commit path for every way out of the sheet, so a backdrop tap landing
     while Save is already in flight can't fire a second write. A failure keeps
     the sheet open and toasts — whatever was typed stays on screen to retry. */
  async function commit(run) {
    if (busy) return;
    busy = true;
    try {
      await run();
      close();
    } catch (err) {
      busy = false;
      primaryBtn.disabled = false;
      toast.error(err, 'Could not save.');
    }
  }
  const { sheet: card, close } = openOverlay({
    label: title,
    className: 'gb-note-modal',
    onDismiss: onDismiss ? () => commit(onDismiss) : undefined,
  });
  const primaryBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--primary',
      onclick: () => {
        primaryBtn.disabled = true;
        commit(onPrimary);
      },
    },
    primary || 'Save'
  );
  card.append(
    h(
      'div',
      { class: 'gb-note-modal-head' },
      h('div', { class: 'gb-modal-title' }, title),
      ...(headActions || [])
    ),
    h('div', { class: 'gb-modal-body' }, body),
    /* One footer row, not a stack of full-width bars. Destructive actions live
       in the head as an icon — a red slab shouted louder than Save. */
    h(
      'div',
      { class: 'gb-note-foot' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--ghost',
          // Same rule as the backdrop: one way out, not two that disagree.
          onclick: onDismiss ? () => commit(onDismiss) : close,
        },
        'Close'
      ),
      primaryBtn
    )
  );
  refreshIcons();
  return { close, card };
}

/* Colour row. `null` is a real choice (no colour), so it gets a swatch too. */
function colorRow(selected, onPick) {
  const row = h('div', { class: 'gb-note-colors' });
  const swatch = (c) => {
    const key = c ? c.key : null;
    const btn = h('button', {
      type: 'button',
      class: 'gb-note-swatch' + (selected === key ? ' is-on' : ''),
      'aria-label': c ? c.label : 'No colour',
      'aria-pressed': selected === key ? 'true' : 'false',
      title: c ? c.label : 'No colour',
      // The saturated edge colour, not the card tint: a 14%-alpha wash in a
      // 24px circle is indistinguishable from the one beside it.
      style: c ? { background: c.line, borderColor: c.line } : null,
      onclick: () => {
        selected = key;
        Array.from(row.children).forEach((el) => el.classList.remove('is-on'));
        btn.classList.add('is-on');
        onPick(key);
      },
    });
    if (!c) btn.appendChild(Icon('x', { size: 13, sw: 2.6 }));
    return btn;
  };
  [null, ...COLORS].forEach((c) => row.appendChild(swatch(c)));
  return row;
}

function ScreenNotes({ onList, onCreate, onUpdate, onDelete, onMakeTask, onMakeReminder }) {
  const listEl = h('div', { class: 'gb-note-grid' });
  let notes = [];

  /* ---- composer: one line until you start, then the full editor ---- */
  const titleInput = h('input', {
    type: 'text',
    class: 'gb-input gb-note-title-input',
    placeholder: 'Title (optional)',
    maxlength: '200',
    'aria-label': 'Note title',
  });
  const editor = richEditor({ placeholder: 'Jot something down…' });
  let composerColor = null;
  const saveBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary gb-btn--compact', onclick: () => save() },
    'Save note'
  );
  const composerBody = h(
    'div',
    { class: 'gb-note-composer-body' },
    titleInput,
    editor.node,
    h(
      'div',
      { class: 'gb-note-composer-foot' },
      colorRow(null, (key) => {
        composerColor = key;
      }),
      saveBtn
    )
  );
  const opener = h(
    'button',
    {
      type: 'button',
      class: 'gb-note-opener',
      onclick: () => openComposer(),
    },
    Icon('notebook-pen', { size: 16, sw: 2.2, color: 'var(--fg3)' }),
    h('span', null, 'Jot something down…')
  );
  const composer = h('div', { class: 'gb-card gb-note-composer' }, opener, composerBody);

  function openComposer() {
    composer.classList.add('is-open');
    editor.focus();
  }
  function closeComposer() {
    composer.classList.remove('is-open');
    titleInput.value = '';
    editor.area.innerHTML = '';
    composerColor = null;
    Array.from(composer.querySelectorAll('.gb-note-swatch')).forEach((el, i) =>
      el.classList.toggle('is-on', i === 0)
    );
  }

  async function save() {
    const body = editor.read();
    const title = titleInput.value.trim();
    if (!title && !textOf(body)) {
      closeComposer();
      return;
    }
    saveBtn.disabled = true;
    try {
      const created = await onCreate({ title: title || null, body, color: composerColor });
      notes.unshift(created);
      closeComposer();
      paint();
    } catch (err) {
      toast.error(err, 'Could not save that note.');
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---- one note ---- */
  function NoteCard(note) {
    const c = colorOf(note.color);
    const preview = textOf(note.body);
    const card = h('article', {
      class: 'gb-note-card' + (note.pinned ? ' is-pinned' : ''),
      style: c ? { background: c.bg, borderColor: c.line } : null,
      tabindex: '0',
      role: 'button',
      'aria-label': note.title || preview.slice(0, 60) || 'Untitled note',
      onclick: (e) => {
        if (e.target.closest('.gb-note-pin')) return;
        openNote(note);
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNote(note);
        }
      },
    });
    card.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: 'gb-note-pin' + (note.pinned ? ' is-on' : ''),
          'aria-label': note.pinned ? 'Unpin this note' : 'Pin this note',
          'aria-pressed': note.pinned ? 'true' : 'false',
          title: note.pinned ? 'Unpin' : 'Pin to top',
          onclick: () => togglePin(note),
        },
        Icon(note.pinned ? 'pin-off' : 'pin', { size: 14, sw: 2.4 })
      )
    );
    if (note.title) card.appendChild(h('h3', { class: 'gb-note-card-title' }, note.title));
    if (note.body) {
      // Sanitised again on the way out: a note saved by an older build never
      // went through the version of sanitize() running now.
      const bodyEl = h('div', { class: 'gb-note-card-body' });
      bodyEl.innerHTML = sanitize(note.body);
      card.appendChild(bodyEl);
    }
    card.appendChild(h('div', { class: 'gb-note-card-time' }, relativeTime(note.updatedAt)));
    return card;
  }

  async function togglePin(note) {
    try {
      const saved = await onUpdate(note.id, { pinned: !note.pinned });
      Object.assign(note, saved);
      sortNotes();
      paint();
    } catch (err) {
      toast.error(err, 'Could not pin that note.');
    }
  }

  /* ---- edit sheet: everything a note can do lives here ---- */
  function openNote(note) {
    const title = h('input', {
      type: 'text',
      class: 'gb-input gb-note-title-input',
      placeholder: 'Title (optional)',
      maxlength: '200',
      value: note.title || '',
      'aria-label': 'Note title',
    });
    const ed = richEditor({ html: note.body, placeholder: 'Write something…' });
    let color = note.color || null;
    let pinned = !!note.pinned;

    const pinBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--soft gb-btn--compact',
        onclick: () => {
          pinned = !pinned;
          pinBtn.replaceChildren(
            Icon(pinned ? 'pin-off' : 'pin', { size: 14, sw: 2.4 }),
            pinned ? 'Unpin' : 'Pin to top'
          );
          refreshIcons();
        },
      },
      Icon(pinned ? 'pin-off' : 'pin', { size: 14, sw: 2.4 }),
      pinned ? 'Unpin' : 'Pin to top'
    );

    const turnInto = h(
      'div',
      { class: 'gb-note-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: async () => {
            const text = title.value.trim() || textOf(ed.read());
            if (!text) return toast.error(null, 'Write something first.');
            try {
              await onMakeTask(text.slice(0, 255));
              toast.success('Added to your tasks.');
            } catch (err) {
              toast.error(err, 'Could not make that a task.');
            }
          },
        },
        Icon('list-todo', { size: 14, sw: 2.4 }),
        'Make a task'
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => {
            const text = title.value.trim() || textOf(ed.read());
            if (!text) return toast.error(null, 'Write something first.');
            onMakeReminder(text.slice(0, 255));
          },
        },
        Icon('calendar-plus', { size: 14, sw: 2.4 }),
        'Add a reminder'
      ),
      pinBtn
    );

    const body = h(
      'div',
      null,
      title,
      ed.node,
      colorRow(color, (key) => {
        color = key;
      }),
      turnInto
    );

    const deleteBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-iconbtn gb-iconbtn--danger gb-note-del',
        'aria-label': 'Delete note',
        title: 'Delete note',
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Delete this note?',
            confirmLabel: 'Delete',
            cancelLabel: 'Keep',
            danger: true,
          });
          if (!ok) return;
          try {
            await onDelete(note.id);
            notes = notes.filter((n) => n.id !== note.id);
            paint();
            open.close();
          } catch (err) {
            toast.error(err, 'Could not delete that note.');
          }
        },
      },
      Icon('trash-2', { size: 16, sw: 2.2 })
    );

    /* Throws on failure and says nothing: commit() in sheet() is the one place
       that reports, and toasting here too put the same failure on screen twice.
       It also owns the close, so this doesn't call it either. */
    const persist = async () => {
      const saved = await onUpdate(note.id, {
        title: title.value.trim(),
        body: ed.read(),
        // '' clears it server-side; undefined would mean "leave it alone".
        color: color === null || color === undefined ? '' : color,
        pinned,
      });
      Object.assign(note, saved);
      sortNotes();
      paint();
    };

    /* Snapshot of everything the sheet can change, taken through the same
       readers the save uses — comparing against note.body directly would
       misfire, since the editor round-trips it through sanitize() on the way
       in. Leaving without an edit must not write: a no-op PATCH bumps
       updatedAt, and the list is sorted by it, so opening a note and closing it
       would jump it to the top. */
    const snapshot = () => JSON.stringify([title.value.trim(), ed.read(), color, pinned]);
    const opened = snapshot();

    const open = sheet({
      title: 'Note',
      body,
      primary: 'Save',
      headActions: [deleteBtn],
      onPrimary: persist,
      // Closing a note keeps it. Tapping outside, Escape and Close all land
      // here — the only way to lose the text was the one the user reached for
      // most often.
      onDismiss: async () => {
        if (snapshot() !== opened) await persist();
      },
    });
    setTimeout(() => ed.focus(), 60);
  }

  /* Same order the server returns, kept locally so a pin doesn't need a refetch. */
  function sortNotes() {
    notes.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });
  }

  function paint() {
    listEl.replaceChildren();
    if (!notes.length) {
      listEl.appendChild(
        h(
          'div',
          { class: 'gb-card' },
          h(
            'div',
            { class: 'gb-empty' },
            Icon('notebook-pen', { size: 26, color: 'var(--fg3)' }),
            h('p', null, 'No notes yet. Jot down the thing you keep forgetting.')
          )
        )
      );
    } else {
      notes.forEach((n) => listEl.appendChild(NoteCard(n)));
    }
    refreshIcons();
  }

  // Skeleton first: the list has real height before the fetch lands, so the
  // page doesn't jump the way every other screen here learned not to.
  const skelLine = (w) => h('div', { class: 'gb-skel-line', style: { width: w } });
  listEl.appendChild(
    h(
      'div',
      { class: 'gb-card gb-note-skel' },
      h('div', { class: 'gb-skel-lines' }, skelLine('55%'), skelLine('92%'), skelLine('38%'))
    )
  );
  onList()
    .then((data) => {
      notes = Array.isArray(data) ? data : [];
      paint();
    })
    .catch(() => {
      listEl.replaceChildren(
        h(
          'div',
          { class: 'gb-card' },
          h(
            'div',
            { class: 'gb-empty' },
            Icon('circle-alert', { size: 26, color: 'var(--fg3)' }),
            h('p', null, 'Could not load your notes. Pull down to try again.')
          )
        )
      );
    });

  return h('div', { class: 'gb-notes' }, composer, listEl);
}

/* =====================================================================
   Dev self-check (Vite dev only). The sanitiser is the security boundary
   for everything on this screen, so it is the thing with a check.
   ===================================================================== */
function _demo() {
  const a = console.assert;
  const script = '<scr' + 'ipt>alert(1)</scr' + 'ipt>hi';
  a(sanitize(script) === 'hi', 'script dropped, not unwrapped');
  a(!sanitize('<img src=x onerror=alert(1)>').includes('onerror'), 'handlers stripped');
  a(!sanitize('<a href="javascript:alert(1)">x</a>').includes('javascript:'), 'js: href stripped');
  a(
    sanitize('<a href="https://x.dev">x</a>').includes('rel="noopener noreferrer"'),
    'link hardened'
  );
  a(sanitize('<b>bold</b>') === '<b>bold</b>', 'formatting kept');
  a(sanitize('<ul><li>a</li></ul>') === '<ul><li>a</li></ul>', 'lists kept');
  a(sanitize('<marquee>hey</marquee>') === 'hey', 'unknown tag unwrapped, text kept');
  a(sanitize('<p class="x" style="color:red">p</p>') === '<p>p</p>', 'attributes stripped');
  a(sanitize('') === '' && sanitize(null) === '', 'empty is empty');
  a(textOf('<p>a</p><p>b</p>') === 'a b', 'textOf flattens');
}

if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    _demo();
  } catch (_) {
    /* never block the app */
  }
}

export { ScreenNotes, sanitize };
