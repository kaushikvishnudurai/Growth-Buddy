/* =====================================================================
   Growth Buddy — Notes (quick jottings, rich text)
   ===================================================================== */
import {
  h,
  Icon,
  refreshIcons,
  confirmDialog,
  openOverlay,
  openModal,
  submitOnEnter,
  landed,
  leave,
} from './gb-kit.js';
import { toast } from './toast.js';
import { CacheStorage } from './cache-storage.js';
import {
  parseLabels,
  validateLabels,
  labelsInUse,
  hasLabel,
  SORTS,
  SORT_PREF_KEY,
  sortKeyOf,
  compareNotes,
  queryWords,
  matchesAll,
  splitHighlights,
  snippetAround,
  createSearchCache,
  offlineKey,
  offlineCopy,
  readOfflineCopy,
  trashDaysLeft,
} from './notes-core.js';

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
  // A checklist is a <ul data-checklist> whose ticked items carry data-checked.
  // Presence is all either says: sanitize() empties their values.
  UL: ['data-checklist'],
  OL: [],
  LI: ['data-checked'],
  H2: [],
  H3: [],
  BLOCKQUOTE: [],
  CODE: [],
  PRE: [],
  A: ['href'],
  IMG: ['src', 'alt'],
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
/* The only images a note may carry: raster data the editor embedded itself.
   A remote src is a tracking pixel that phones home every time the note is
   painted, and data:image/svg+xml is a document, not a picture. */
const SAFE_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/]+=*$/i;

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
        // A flag, never a payload.
        else if (attr.name.startsWith('data-') && attr.value !== '')
          child.setAttribute(attr.name, '');
      });
      // An image has no text to keep, so a refused one goes entirely.
      if (tag === 'IMG' && !SAFE_IMG.test(child.getAttribute('src') || '')) {
        child.remove();
        return;
      }
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
  // textContent has no notion of blocks: two paragraphs came out as one word.
  doc.body
    .querySelectorAll('p, div, li, h1, h2, h3, h4, blockquote, pre, br')
    .forEach((el) => el.after(' '));
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

/* Plain text that keeps its lines, for Share / Copy: textOf() flattens to one
   line for a card preview. List items get a bullet, checklist items a box. */
function plainTextOf(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  doc.body.querySelectorAll('li').forEach((li) => {
    const box = li.parentElement && li.parentElement.hasAttribute('data-checklist');
    li.prepend(box ? (li.hasAttribute('data-checked') ? '[x] ' : '[ ] ') : '• ');
  });
  doc.body
    .querySelectorAll('p, div, li, h2, h3, blockquote, pre, br')
    .forEach((el) => el.after('\n'));
  return (doc.body.textContent || '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n')
    .trim();
}

/* A photo's alt text is what search finds it by. A picked file's name is a fair
   start ("receipt march"); a pasted one is always "image.png", which says nothing. */
function altOf(file) {
  const name = String((file && file.name) || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return /^image$/i.test(name) ? '' : name;
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* What search matches: title, text and every photo's alt text. The list's body
   has its photos cut out but keeps their alt (NoteResponse.listItem). */
function searchTextOf(note) {
  const doc = new DOMParser().parseFromString(
    '<body>' + (note.body || '') + '</body>',
    'text/html'
  );
  const alts = Array.from(doc.querySelectorAll('img[alt]')).map((img) => img.getAttribute('alt'));
  return [note.title || '', textOf(note.body), ...alts].join(' ').toLowerCase();
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
  // <s>/<strike> (whichever the browser writes) and the two below are all in ALLOWED.
  { cmd: 'strikeThrough', icon: 'strikethrough', label: 'Strikethrough' },
  // Not an execCommand either: wraps the selection in <code> (see inlineCode()).
  { cmd: 'inlineCode', icon: 'code', label: 'Inline code' },
  { cmd: 'formatBlock', value: 'h2', icon: 'heading-2', label: 'Heading', state: 'h2' },
  { cmd: 'formatBlock', value: 'blockquote', icon: 'quote', label: 'Quote', state: 'blockquote' },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bullet list' },
  { cmd: 'insertOrderedList', icon: 'list-ordered', label: 'Numbered list' },
  // Not an execCommand: a bullet list marked data-checklist (see checklist()).
  { cmd: 'checklist', icon: 'list-checks', label: 'Checklist' },
  { cmd: 'createLink', icon: 'link', label: 'Link', prompt: 'Link to…' },
  /* The browser's own undo stack, which every command here goes through
     (insertHTML included), so it undoes a photo or a paste as well as typing.
     No pressed state: there is nothing to be "on". */
  { cmd: 'undo', icon: 'undo-2', label: 'Undo', key: 'z', stateless: true, sep: true },
  { cmd: 'redo', icon: 'redo-2', label: 'Redo', stateless: true },
];

/* NoteService.MAX_BODY (2 MB) less headroom for what sanitize() adds on save
   (rel + target on every link), measured on the raw editor HTML. Checked as
   each photo goes in, so the refusal lands on the photo that would not fit
   rather than on Save. */
const NOTE_MAX = 1_990_000;
/* Long edge of an embedded photo. A phone photo is 4000px and 3-5 MB; at
   1280px JPEG it is 150-250 kB of base64 and still sharp at any size a note
   shows it, so a note holds about eight. */
const PHOTO_SIDE = 1280;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That photo could not be read. Try a JPEG or PNG.'));
    img.src = src;
  });
}

/** A region of `img` as a w x h JPEG data URL. */
function toJpeg(
  img,
  w,
  h,
  quality,
  [sx, sy, sw, sh] = [0, 0, img.naturalWidth, img.naturalHeight]
) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // JPEG has no alpha: a transparent screenshot would otherwise turn black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** An image file as a downscaled JPEG data URL. */
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    return toJpeg(img, w, h, 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* The card's cover, saved beside the body so the list can send it instead of
   the photos (NoteService.list). The first photo, centre-cropped to the card's
   wide cover box at 2:1 (between a phone card, ~2.6:1, and a desktop column,
   ~1.9:1, so object-fit trims little more on either) at 640x320,
   which is 25-50 kB. NoteService.MAX_COVER caps it; a second, rougher pass
   keeps a noisy photo under that, and '' (no cover) is the last resort. */
const COVER_W = 640;
const COVER_H = 320;
const COVER_MAX = 60_000;
async function coverOf(body) {
  const m = /<img\b[^>]*?\bsrc="([^"]+)"/i.exec(body || '');
  if (!m) return '';
  try {
    const img = await loadImage(m[1]);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const ratio = COVER_W / COVER_H;
    const sw = Math.min(iw, ih * ratio);
    const sh = sw / ratio;
    const w = Math.max(1, Math.min(COVER_W, Math.round(sw)));
    const h = Math.max(1, Math.round(w / ratio));
    for (const q of [0.72, 0.45]) {
      const url = toJpeg(img, w, h, q, [(iw - sw) / 2, (ih - sh) / 2, sw, sh]);
      if (url.length <= COVER_MAX) return url;
    }
  } catch (_) {
    /* unreadable: the card shows its placeholder cover */
  }
  return '';
}

const imageFiles = (list) => Array.from(list || []).filter((f) => f && /^image\//.test(f.type));
/* A clipboard's photos. Older Safari leaves `files` empty on paste and only
   lists them under `items`, so fall back to those. */
const clipboardPhotos = (cd) => {
  if (!cd) return [];
  const files = imageFiles(cd.files);
  if (files.length) return files;
  return imageFiles(
    Array.from(cd.items || [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
  );
};

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
  /* Where the caret last was inside the editor. The photo picker takes focus
     away (a file dialog, on a phone a whole camera app), and the photo should
     land where the user was writing, not at the top. */
  let lastRange = null;
  function syncState() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && area.contains(sel.getRangeAt(0).startContainer)) {
      lastRange = sel.getRangeAt(0).cloneRange();
    }
    // The caret moved on (arrow, End, typing): the photo is no longer picked.
    if (sel && sel.isCollapsed) {
      area.querySelectorAll('img.is-picked').forEach((img) => img.classList.remove('is-picked'));
    }
    buttons.forEach(({ btn, tool }) => {
      let on = false;
      try {
        on = tool.stateless
          ? false
          : tool.cmd === 'checklist'
            ? !!(caretList() && caretList().hasAttribute('data-checklist'))
            : tool.cmd === 'inlineCode'
              ? !!caretCode()
              : tool.state
                ? document.queryCommandValue('formatBlock').toLowerCase() === tool.state
                : document.queryCommandState(tool.cmd);
      } catch (_) {
        /* queryCommandState throws on some commands in some browsers */
      }
      btn.classList.toggle('is-on', !!on);
      if (!tool.stateless) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
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

  /* The <ul> the caret is in, if it is in this editor. */
  function caretList() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    const ul = n && n.closest ? n.closest('ul') : null;
    return ul && area.contains(ul) ? ul : null;
  }
  /* Checklist on/off. A checklist is a bullet list with a flag, so the browser
     keeps doing what it already does well (Enter for a new item, Backspace
     out of it) and sanitize() needs two attributes, not a new tag. */
  function checklist() {
    let ul = caretList();
    if (ul && ul.hasAttribute('data-checklist')) {
      document.execCommand('insertUnorderedList', false); // off: back to text
      return;
    }
    if (!ul) {
      document.execCommand('insertUnorderedList', false);
      ul = caretList();
    }
    if (ul) ul.setAttribute('data-checklist', '');
  }

  /* The inline <code> the caret is in (not a <pre> block), if in this editor. */
  function caretCode() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    const code = n && n.closest ? n.closest('code') : null;
    return code && area.contains(code) && !code.closest('pre') ? code : null;
  }
  /* Inline code on/off. There is no execCommand for it, so it goes through
     insertHTML / insertText, which keeps it on the undo stack. The selected
     text is escaped, never parsed: it is the user's, not markup. */
  function inlineCode() {
    const sel = window.getSelection();
    const code = caretCode();
    if (code) {
      const r = document.createRange();
      r.selectNode(code);
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('insertText', false, code.textContent);
      // Chrome keeps the removed element's look as an inline style.
      area.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
      return;
    }
    const text = sel && sel.rangeCount ? sel.toString() : '';
    if (!text) {
      toast.error(null, 'Select a few words first, then mark them as code.');
      return;
    }
    if (/\n/.test(text)) {
      toast.error(null, 'Inline code is for a few words on one line.');
      return;
    }
    document.execCommand('insertHTML', false, '<code>' + escAttr(text) + '</code>');
  }

  function run(tool) {
    area.focus();
    /* Reached from the keyboard (Tab to the button, Enter), focus left the
       editor and the selection may have gone with it: put back where the user
       was, or the command lands at the start of the note or on nothing. */
    const sel = window.getSelection();
    const inside = sel && sel.rangeCount && area.contains(sel.getRangeAt(0).startContainer);
    if (!inside && lastRange && area.contains(lastRange.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(lastRange);
    }
    let value = tool.value;
    if (tool.prompt) {
      promptFor(tool);
      return;
    }
    if (tool.cmd === 'checklist' || tool.cmd === 'inlineCode') {
      if (tool.cmd === 'checklist') checklist();
      else inlineCode();
      syncState();
      if (onInput) onInput();
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
    if (tool.sep) bar.appendChild(h('span', { class: 'gb-editor-sep', 'aria-hidden': 'true' }));
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-editor-btn',
        'aria-label': tool.label,
        'aria-pressed': tool.stateless ? null : 'false',
        title: tool.label + (tool.key ? ' (⌘' + tool.key.toUpperCase() + ')' : ''),
        // mousedown, not click: click fires after the caret has already left the
        // editor, so the command would apply to nothing.
        onmousedown: (e) => {
          e.preventDefault();
          run(tool);
        },
        // Keyboard activation fires click with no mousedown (detail 0); a
        // pointer press already ran above, so it must not run twice.
        onclick: (e) => {
          if (e.detail === 0) run(tool);
        },
      },
      Icon(tool.icon, { size: 16, sw: 2.4 })
    );
    buttons.push({ btn, tool });
    bar.appendChild(btn);
  });

  /* ---- photos: pasted, dropped or picked, all through addPhotos ---- */
  async function addPhotos(files) {
    for (const file of files) {
      let src;
      try {
        src = await shrinkPhoto(file);
      } catch (err) {
        toast.error(err, 'That photo could not be read.');
        continue;
      }
      if (area.innerHTML.length + src.length > NOTE_MAX) {
        toast.error(null, 'This note is full. Remove a photo to add another.');
        return;
      }
      /* Shrinking is async. If the sheet closed or the composer folded away in
         the meantime, execCommand would write into whatever has focus now. */
      if (!area.isConnected || !area.getClientRects().length) return;
      area.focus();
      const sel = window.getSelection();
      if (lastRange && area.contains(lastRange.startContainer)) {
        // Collapsed: a photo goes beside selected text, never over it.
        const at = lastRange.cloneRange();
        at.collapse(false);
        sel.removeAllRanges();
        sel.addRange(at);
      } else if (!sel.rangeCount || !area.contains(sel.getRangeAt(0).startContainer)) {
        const end = document.createRange();
        end.selectNodeContents(area);
        end.collapse(false);
        sel.removeAllRanges();
        sel.addRange(end);
      }
      document.execCommand(
        'insertHTML',
        false,
        '<img src="' + src + '" alt="' + escAttr(altOf(file)) + '" class="is-new">'
      );
      area.querySelectorAll('img.is-new').forEach((img) => {
        img.classList.replace('is-new', 'is-developing');
        img.addEventListener('animationend', () => img.classList.remove('is-developing'), {
          once: true,
        });
      });
      syncState();
      if (onInput) onInput();
    }
  }

  const picker = h('input', {
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onchange: () => {
      const files = imageFiles(picker.files);
      picker.value = ''; // picking the same photo twice must fire again
      addPhotos(files);
    },
  });
  bar.append(
    h('span', { class: 'gb-editor-sep', 'aria-hidden': 'true' }),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-editor-btn',
        'aria-label': 'Add a photo',
        title: 'Add a photo (or paste one)',
        // click, not mousedown like the others: nothing applies to the
        // selection here, lastRange already holds it, and click is what a
        // keyboard Enter fires.
        onclick: () => picker.click(),
      },
      Icon('image-plus', { size: 16, sw: 2.4 })
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-editor-btn',
        'aria-label': 'Describe the selected photo',
        title: 'Describe the selected photo, so search can find it',
        // mousedown keeps focus in the editor, so the picked photo stays picked.
        onmousedown: (e) => e.preventDefault(),
        onclick: describePhoto,
      },
      Icon('tag', { size: 16, sw: 2.4 })
    ),
    picker
  );

  /* The photo last clicked. Tabbing to the button blurs the editor, which
     clears .is-picked, so the keyboard path needs this to know which photo. */
  let lastPicked = null;
  function describePhoto() {
    const img = area.querySelector('img.is-picked') || (area.contains(lastPicked) && lastPicked);
    if (!img) {
      toast.error(null, 'Tap a photo first, then describe it.');
      return;
    }
    const input = h('input', {
      type: 'text',
      class: 'gb-input',
      value: img.getAttribute('alt') || '',
      maxlength: 200,
      placeholder: 'e.g. electricity bill, March',
      'aria-label': 'Photo description',
    });
    openModal({
      title: 'Describe this photo',
      body: input,
      primary: 'Save',
      onPrimary: () => {
        img.setAttribute('alt', input.value.trim());
        if (onInput) onInput();
      },
    });
    setTimeout(() => input.focus(), 60);
  }

  // Semantic tags (<b>, <i>) rather than <span style>, so sanitize() keeps the
  // formatting instead of stripping the style attribute and losing it.
  try {
    document.execCommand('styleWithCSS', false, false);
  } catch (_) {
    /* not supported → tags are the default anyway */
  }

  /* Deleting the last character leaves a stray <br> behind, so :empty stops
     matching and the placeholder never comes back. Clear it here instead of
     asking CSS to recognise the shape — a selector can't tell "one <br>" from
     "text and a <br>", because :only-child counts elements and ignores text. */
  function normalize() {
    // A note with a photo isn't empty, and reading innerHTML would serialise
    // every photo's data URL on each keystroke.
    if (area.querySelector('img')) return;
    if (/^\s*(<br\s*\/?>)?\s*$/i.test(area.innerHTML)) area.innerHTML = '';
  }
  normalize();

  area.addEventListener('keyup', syncState);
  area.addEventListener('mouseup', syncState);
  /* A touch selection (long-press, drag the handles) fires no keyup or mouseup,
     so Bold/Italic showed the state of wherever the caret was before. Only
     while focused: selectionchange is document-wide. */
  function onSelection() {
    if (!area.isConnected) document.removeEventListener('selectionchange', onSelection);
    else if (document.activeElement === area) syncState();
  }
  area.addEventListener('focus', () => document.addEventListener('selectionchange', onSelection));
  area.addEventListener('blur', () => document.removeEventListener('selectionchange', onSelection));
  area.addEventListener('input', (e) => {
    // Enter on a ticked item clones its attributes into the new one, which
    // would arrive already ticked.
    if (e && e.inputType === 'insertParagraph') {
      const ul = caretList();
      const sel = window.getSelection();
      let n = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      if (n && n.nodeType === 3) n = n.parentNode;
      const li = n && n.closest ? n.closest('li') : null;
      if (ul && li && !li.textContent.trim()) li.removeAttribute('data-checked');
    }
    normalize();
    if (onInput) onInput();
  });

  /* Ticking: the box is the item's ::before, in its left padding, so a tap
     there toggles and a tap on the words just places the caret. Ctrl/⌘+Enter
     ticks the item the caret is in, for the keyboard. */
  function tick(li) {
    if (li.hasAttribute('data-checked')) li.removeAttribute('data-checked');
    else li.setAttribute('data-checked', '');
    if (onInput) onInput();
  }
  area.addEventListener('click', (e) => {
    const li = e.target && e.target.closest ? e.target.closest('li') : null;
    if (!li || !area.contains(li) || !li.parentElement.hasAttribute('data-checklist')) return;
    const r = li.getBoundingClientRect();
    if (e.clientX - r.left > 28) return;
    e.preventDefault();
    tick(li);
  });
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    const ul = caretList();
    if (!ul || !ul.hasAttribute('data-checklist')) return;
    const sel = window.getSelection();
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const li = n.closest('li');
    if (!li) return;
    e.preventDefault();
    tick(li);
  });
  // Paste as the sanitiser sees it, so what lands is what gets saved.
  area.addEventListener('paste', (e) => {
    /* Photos first. "Copy image" in a browser puts both the picture and an
       <img src="https://..."> on the clipboard, and the HTML one would be
       stripped to nothing by sanitize(). */
    const photos = clipboardPhotos(e.clipboardData);
    const html = e.clipboardData && e.clipboardData.getData('text/html');
    /* ...but only when the HTML has no words. Word, Excel and Notes on a Mac
       also put a PNG *rendering* of the copied text on the clipboard, and
       taking that pasted a picture of a paragraph instead of the paragraph. */
    if (photos.length && (!html || !textOf(html))) {
      e.preventDefault();
      addPhotos(photos);
      return;
    }
    if (!html) return;
    e.preventDefault();
    /* Some apps put their pictures in the HTML itself as data URLs, full size
       and unshrunk. sanitize() keeps those, so the cap is checked here too or
       the note fails on Save with the cause long gone. */
    const clean = sanitize(html);
    if (area.innerHTML.length + clean.length > NOTE_MAX) {
      toast.error(null, 'That is too big to paste into a note. Paste the photos one at a time.');
      return;
    }
    document.execCommand('insertHTML', false, clean);
    /* Chrome's insertHTML re-adds inline styles (font, colour, size) to keep
       the source's look. sanitize() drops them on save, so leaving them meant
       the note looked one way now and another when reopened. */
    area.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));
    if (onInput) onInput();
  });

  /* Clicking a photo selects it whole, so Backspace removes it and the ring
     says which one. The class is display-only: sanitize() strips it on read. */
  area.addEventListener('click', (e) => {
    area.querySelectorAll('img.is-picked').forEach((img) => img.classList.remove('is-picked'));
    if (e.target.tagName !== 'IMG') return;
    const r = document.createRange();
    r.selectNode(e.target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    e.target.classList.add('is-picked');
    lastPicked = e.target;
  });

  area.addEventListener('blur', () =>
    area.querySelectorAll('img.is-picked').forEach((img) => img.classList.remove('is-picked'))
  );

  const wrap = h('div', { class: 'gb-editor-wrap' }, bar, area);
  const dragsFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  wrap.addEventListener('dragover', (e) => {
    if (!dragsFiles(e)) return;
    e.preventDefault();
    wrap.classList.add('is-dropping');
  });
  wrap.addEventListener('dragleave', (e) => {
    if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('is-dropping');
  });
  wrap.addEventListener('drop', (e) => {
    wrap.classList.remove('is-dropping');
    if (!dragsFiles(e)) return; // dragged text: the browser's own drop is right
    // Always: a file the browser handles itself is a PDF opened over the app.
    e.preventDefault();
    const photos = imageFiles(e.dataTransfer.files);
    if (!photos.length) {
      toast.error(null, 'Only photos can go in a note.');
      return;
    }
    // Land where it was dropped, where the browser can say where that is.
    const at = document.caretRangeFromPoint && document.caretRangeFromPoint(e.clientX, e.clientY);
    if (at && area.contains(at.startContainer)) lastRange = at;
    addPhotos(photos);
  });

  return {
    node: wrap,
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
  async function commit(run, fallback) {
    if (busy) return;
    busy = true;
    try {
      await run();
      close();
    } catch (err) {
      busy = false;
      primaryBtn.disabled = false;
      toast.error(err, fallback || 'Could not save.');
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
  submitOnEnter(card, primaryBtn);
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
  return { close, card, commit };
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

/* A note's labels as removable chips plus one input: Enter or a comma adds,
   Backspace in the empty input takes the last one off. Same rules as the
   server (notes-core.js parseLabels/validateLabels = NoteLabels.java), checked
   here so a refusal lands while the label can still be fixed. */
function labelEditor(initial, suggestions, onChange) {
  let labels = parseLabels(initial || []);
  const chips = h('div', { class: 'gb-note-label-chips' });
  const listId = 'gb-note-labels-' + Math.random().toString(36).slice(2, 8);
  const input = h('input', {
    type: 'text',
    class: 'gb-note-label-input',
    placeholder: labels.length ? 'Add another' : 'Add a label',
    'aria-label': 'Add a label',
    list: listId,
    autocomplete: 'off',
    onkeydown: (e) => {
      if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) {
        // An empty Enter is still the sheet's Save (submitOnEnter).
        if (e.key === 'Enter' && !input.value.trim()) return;
        e.preventDefault();
        e.stopPropagation();
        commit();
      } else if (e.key === 'Backspace' && !input.value && labels.length) {
        labels = labels.slice(0, -1);
        paintChips();
        onChange && onChange();
      }
    },
    // A pasted "a, b, c" lands whole.
    oninput: () => {
      if (input.value.includes(',')) commit();
    },
    onblur: () => commit(),
  });
  const options = h(
    'datalist',
    { id: listId },
    (suggestions || []).map((l) => h('option', { value: l }))
  );
  function commit() {
    const add = parseLabels(input.value);
    if (!add.length) {
      input.value = '';
      return true;
    }
    const next = parseLabels([...labels, ...add]);
    const err = validateLabels(next);
    if (err) {
      toast.error(null, err);
      return false;
    }
    labels = next;
    input.value = '';
    paintChips();
    onChange && onChange();
    return true;
  }
  function paintChips() {
    chips.replaceChildren(
      ...labels.map((label) =>
        h(
          'span',
          { class: 'gb-note-label' },
          label,
          h(
            'button',
            {
              type: 'button',
              class: 'gb-note-label-x',
              'aria-label': 'Remove label ' + label,
              onclick: () => {
                labels = labels.filter((l) => l !== label);
                paintChips();
                onChange && onChange();
                input.focus();
              },
            },
            Icon('x', { size: 12, sw: 2.6 })
          )
        )
      ),
      input
    );
    input.placeholder = labels.length ? 'Add another' : 'Add a label';
    refreshIcons();
  }
  paintChips();
  return {
    node: h(
      'div',
      { class: 'gb-note-labels-edit' },
      Icon('tag', { size: 14, sw: 2.4, color: 'var(--fg3)' }),
      chips,
      options
    ),
    /** The labels, a half-typed one included; throws the rule it breaks. */
    read() {
      if (!commit()) throw new Error(validateLabels(parseLabels([...labels, input.value])));
      return labels.slice();
    },
    /** For the sheet's "anything changed?" snapshot: no commit, no toast. */
    peek: () => labels.join(',') + '|' + input.value.trim(),
    /** The committed chips only, for the edit draft: no commit, no toast. */
    list: () => labels.slice(),
    /** Replace the chips (an edit draft's restore). */
    set(next) {
      labels = parseLabels(next || []);
      paintChips();
    },
  };
}

/* Text with every match of `words` wrapped in <mark>. DOM nodes only, never
   innerHTML: the text is the user's (sanitize()'s rule for this screen). */
function marked(text, words) {
  return splitHighlights(text, words).map((run) =>
    run.hit ? h('mark', { class: 'gb-note-hit' }, run.text) : document.createTextNode(run.text)
  );
}

/* Put the caret on the first match in an open editor and scroll it into view. */
function revealMatch(area, words) {
  if (!words.length || !area.isConnected) return;
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const lower = t.nodeValue.toLowerCase();
    let at = -1;
    let len = 0;
    words.forEach((w) => {
      const i = lower.indexOf(w);
      if (i >= 0 && (at < 0 || i < at)) {
        at = i;
        len = w.length;
      }
    });
    if (at < 0) continue;
    const r = document.createRange();
    r.setStart(t, at);
    r.setEnd(t, at + len);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    t.parentElement.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    return;
  }
}

/* The composer's unsaved note. ScreenNotes is rebuilt on every visit, so a draft
   kept only in its inputs died the moment you went Home. It is autosaved to the
   server (note_drafts, one per user) so it also survives a reload or another
   device; module memory is just the instant copy for coming back mid-session,
   before the server's answer. Save or an empty close deletes both. */
let composerDraft = null; // { title, html, color }
const DRAFT_SAVE_MS = 800;

function ScreenNotes({
  onList,
  onGet,
  onCreate,
  onUpdate,
  onDelete,
  onMakeTask,
  onMakeReminder,
  onGetDraft,
  onSaveDraft,
  onDeleteDraft,
  onRestore,
  onGetEditDraft,
  onSaveEditDraft,
  onDeleteEditDraft,
  onTrash,
  onCounts,
  onDeleteForever,
  userId,
}) {
  const listEl = h('div', { class: 'gb-note-grid' });
  let notes = [];
  let query = '';
  let searchTimer = null;
  /* Which list is showing: the main one, the Archived view or the Trash. */
  let view = 'notes';
  let activeLabel = null; // the label filter chip that is on, or null for all
  let offline = false; // showing the saved copy: read-only until a load succeeds
  let counts = null; // { archived, trash } once onCounts answers
  let sortKey = 'updated';
  try {
    sortKey = sortKeyOf(CacheStorage.getItem(SORT_PREF_KEY));
  } catch (_) {
    /* storage unavailable: the default order */
  }
  /* What search reads per note, parsed once per version (id + updatedAt)
     rather than on every keystroke for every card. */
  const searchCache = createSearchCache((n) => ({ hay: searchTextOf(n), text: textOf(n.body) }));
  const inView = (n) =>
    view === 'trash' ? !!n.deletedAt : !n.deletedAt && (view === 'archived') === !!n.archivedAt;
  const searchInput = h('input', {
    type: 'search',
    class: 'gb-input',
    placeholder: 'Search notes and photo descriptions',
    'aria-label': 'Search notes',
    // Debounced, and it only hides cards: rebuilding them on every keystroke
    // re-decoded every cover image, so the grid blinked while you typed.
    oninput: () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = searchInput.value;
        filter();
      }, 150);
    },
  });
  const noMatchText = h('p');
  const noMatch = h(
    'div',
    { class: 'gb-card gb-note-state', hidden: true },
    h('div', { class: 'gb-empty' }, noMatchText)
  );
  const searchBar = h(
    'div',
    { class: 'gb-notes-search' },
    Icon('search', { size: 16, sw: 2.2, color: 'var(--fg3)' }),
    searchInput
  );
  const sortSelect = h(
    'select',
    {
      class: 'gb-input gb-notes-sort',
      'aria-label': 'Sort notes',
      title: 'Sort notes',
      onchange: () => {
        sortKey = sortKeyOf(sortSelect.value);
        try {
          CacheStorage.setItem(SORT_PREF_KEY, sortKey);
        } catch (_) {
          /* the choice still holds for this visit */
        }
        sortNotes();
        paint();
      },
    },
    SORTS.map((o) => h('option', { value: o.key }, o.label))
  );
  sortSelect.value = sortKey;
  /* The screen's top bar, always shown: hiding it while a view loads or is
     empty made everything under it jump when it came back. */
  const tools = h('div', { class: 'gb-notes-tools' }, searchBar, sortSelect);
  const labelRow = h('div', {
    class: 'gb-note-filter',
    role: 'group',
    'aria-label': 'Filter by label',
    hidden: true,
  });

  /* ---- views: Notes / Archived (n) / Trash (n) ---- */
  const viewRow = h('div', { class: 'gb-note-views', role: 'group', 'aria-label': 'Which notes' });
  function paintViews() {
    const btn = (key, label, n) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-note-view' + (view === key ? ' is-on' : ''),
          'aria-pressed': view === key ? 'true' : 'false',
          onclick: () => setView(key),
        },
        label + (n ? ' (' + n + ')' : '')
      );
    viewRow.replaceChildren(
      btn('notes', 'Notes'),
      btn('archived', 'Archived', counts && counts.archived),
      btn('trash', 'Trash', counts && counts.trash)
    );
    viewRow.hidden = offline;
  }
  function refreshCounts() {
    if (!onCounts) return;
    onCounts()
      .then((c) => {
        counts = c || null;
        paintViews();
      })
      .catch(() => {});
  }
  function setView(key) {
    if (key === view) return;
    view = key;
    activeLabel = null;
    notes = [];
    paintViews();
    composer.hidden = view !== 'notes';
    showSkeleton();
    load();
  }

  /* Offline: the last list this device loaded, read-only. */
  const offlineBanner = h(
    'div',
    { class: 'gb-note-offline', role: 'status', hidden: true },
    Icon('wifi-off', { size: 16, sw: 2.2 }),
    h('span', null, 'Offline — showing saved copy, editing disabled'),
    h(
      'button',
      {
        type: 'button',
        class: 'gb-btn gb-btn--ghost gb-btn--compact',
        onclick: (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          load().finally(() => (b.disabled = false));
        },
      },
      'Try again'
    )
  );
  function saveOffline() {
    if (!userId || offline || view !== 'notes') return;
    try {
      CacheStorage.setItem(offlineKey(userId), JSON.stringify(offlineCopy(notes)));
    } catch (_) {
      /* a full or missing store: there is simply no offline copy */
    }
  }
  function showOffline() {
    let copy = null;
    try {
      copy = userId ? readOfflineCopy(CacheStorage.getItem(offlineKey(userId))) : null;
    } catch (_) {
      copy = null;
    }
    if (!copy) return false;
    offline = true;
    notes = copy.notes;
    sortNotes();
    paint();
    return true;
  }

  /* ---- composer: one line until you start, then the full editor ---- */
  const titleInput = h('input', {
    type: 'text',
    class: 'gb-input gb-note-title-input',
    placeholder: 'Title (optional)',
    maxlength: '200',
    'aria-label': 'Note title',
    value: composerDraft ? composerDraft.title : '',
    oninput: () => keepDraft(),
  });
  const editor = richEditor({
    placeholder: 'Jot something down…',
    html: composerDraft ? composerDraft.html : '',
    onInput: () => keepDraft(),
  });
  let composerColor = composerDraft ? composerDraft.color : null;
  let draftTimer = null;
  let draftTouched = false; // typed here, so a late server copy must not overwrite it
  function keepDraft() {
    draftTouched = true;
    composerDraft = { title: titleInput.value, html: editor.area.innerHTML, color: composerColor };
    const draft = composerDraft;
    clearTimeout(draftTimer);
    // Not cancelled when the screen goes: leaving right after typing still saves.
    draftTimer = setTimeout(() => {
      if (onSaveDraft)
        onSaveDraft({ title: draft.title, body: draft.html, color: draft.color }).catch(() => {});
    }, DRAFT_SAVE_MS);
  }
  function dropDraft() {
    clearTimeout(draftTimer);
    composerDraft = null;
    if (onDeleteDraft) onDeleteDraft().catch(() => {});
  }
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
      colorRow(composerColor, (key) => {
        composerColor = key;
        keepDraft();
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
  if (composerDraft) composer.classList.add('is-open');
  // A reload or another device: fetch the server's copy, unless typing here started first.
  if (!composerDraft && onGetDraft) {
    onGetDraft()
      .then((d) => {
        if (!d || draftTouched) return;
        titleInput.value = d.title || '';
        editor.area.innerHTML = sanitize(d.body || '');
        composerColor = d.color || null;
        const on = [null, ...COLORS].findIndex((c) => (c ? c.key : null) === composerColor);
        Array.from(composer.querySelectorAll('.gb-note-swatch')).forEach((el, i) => {
          el.classList.toggle('is-on', i === on);
          el.setAttribute('aria-pressed', i === on ? 'true' : 'false');
        });
        composerDraft = {
          title: titleInput.value,
          html: editor.area.innerHTML,
          color: composerColor,
        };
        composer.classList.add('is-open');
      })
      .catch(() => {});
  }

  function openComposer() {
    composer.classList.add('is-open');
    editor.focus();
  }
  function closeComposer() {
    composer.classList.remove('is-open');
    dropDraft();
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
    if (!title && !textOf(body) && !body.includes('<img')) {
      closeComposer();
      return;
    }
    saveBtn.disabled = true;
    try {
      const created = await onCreate({
        title: title || null,
        body,
        color: composerColor,
        cover: await coverOf(body),
        // Written under a label filter, it wears that label, or it would
        // vanish from the list the moment it was saved.
        labels: activeLabel ? [activeLabel] : [],
      });
      notes.unshift(created);
      sortNotes();
      closeComposer();
      paint();
      landed(cardOf(created.id));
    } catch (err) {
      toast.error(err, 'Could not save that note.');
    } finally {
      saveBtn.disabled = false;
    }
  }

  const cardOf = (id) => listEl.querySelector('[data-id="' + id + '"]');
  // openOverlay's exit is 180ms; an effect on a card behind it waits that out.
  const SHEET_EXIT = 200;

  /* ---- one note ---- */
  // The parts filter() re-marks for a search: title, body and its snippet.
  const cardParts = new WeakMap();
  function NoteCard(note) {
    const c = colorOf(note.color);
    const preview = textOf(note.body);
    // Sanitised again on the way out: a note saved by an older build never
    // went through the version of sanitize() running now.
    const bodyEl = h('div', { class: 'gb-note-card-body' });
    bodyEl.innerHTML = sanitize(note.body);
    /* The first photo becomes the card's cover and the rest wait inside the
       note: five photos stacked in a card is a scroll, not a preview. */
    const photos = Array.from(bodyEl.querySelectorAll('img'));
    photos.forEach((img) => img.remove());
    /* A list item arrives with its photos cut out (bodyTrimmed) and a cover
       and count in their place; a note this screen just loaded whole still
       has them in the body. */
    const count = Math.max(note.photoCount || 0, photos.length);
    const coverSrc = SAFE_IMG.test(note.cover || '')
      ? note.cover
      : photos[0] && photos[0].getAttribute('src');
    const card = h('article', {
      class: 'gb-note-card' + (note.pinned ? ' is-pinned' : '') + (count ? ' has-cover' : ''),
      'data-id': note.id,
      style: c ? { background: c.bg, borderColor: c.line } : null,
      tabindex: '0',
      role: 'button',
      'aria-label':
        (note.title || preview.slice(0, 60) || (count ? 'Photo note' : 'Untitled note')) +
        (count ? ', ' + count + (count === 1 ? ' photo' : ' photos') : ''),
      onclick: (e) => {
        if (e.target.closest('button')) return; // the pin, Restore, Delete forever
        activate(note, card);
      },
      onkeydown: (e) => {
        if (e.target !== card) return; // Enter on a button inside is that button's
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate(note, card);
        }
      },
    });
    // The Trash has no pin: a deleted note has no place in the order.
    if (view !== 'trash') {
      card.appendChild(
        h(
          'button',
          {
            type: 'button',
            class: 'gb-note-pin' + (note.pinned ? ' is-on' : ''),
            'aria-label': note.pinned ? 'Unpin this note' : 'Pin this note',
            'aria-pressed': note.pinned ? 'true' : 'false',
            title: offline ? 'Offline: editing is off' : note.pinned ? 'Unpin' : 'Pin to top',
            disabled: offline,
            onclick: () => togglePin(note),
          },
          Icon(note.pinned ? 'pin-off' : 'pin', { size: 14, sw: 2.4 })
        )
      );
    }
    if (count) {
      card.appendChild(
        h(
          'div',
          { class: 'gb-note-cover' + (coverSrc ? '' : ' is-empty') },
          coverSrc
            ? h('img', { src: coverSrc, alt: '', decoding: 'async' })
            : Icon('image-plus', { size: 22, sw: 2, color: 'var(--fg3)' }),
          count > 1
            ? h(
                'span',
                { class: 'gb-note-cover-count', 'aria-hidden': 'true' },
                Icon('image-plus', { size: 12, sw: 2.6 }),
                '+' + (count - 1)
              )
            : null
        )
      );
    }
    const titleEl = note.title ? h('h3', { class: 'gb-note-card-title' }, note.title) : null;
    const snippetEl = h('p', { class: 'gb-note-card-snippet', hidden: true });
    if (titleEl) card.appendChild(titleEl);
    if (preview) card.appendChild(bodyEl);
    card.appendChild(snippetEl);
    cardParts.set(card, { titleEl, bodyEl, snippetEl, title: note.title || '' });
    if (note.labels && note.labels.length) {
      card.appendChild(
        h(
          'div',
          { class: 'gb-note-card-labels' },
          note.labels.map((l) => h('span', { class: 'gb-note-label' }, l))
        )
      );
    }
    if (view === 'trash') {
      const left = trashDaysLeft(note.deletedAt);
      card.appendChild(
        h(
          'div',
          { class: 'gb-note-card-time' },
          left
            ? 'Deleted · gone for good in ' + left + (left === 1 ? ' day' : ' days')
            : 'Deleted · goes tonight'
        )
      );
      card.appendChild(
        h(
          'div',
          { class: 'gb-note-trash-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--soft gb-btn--compact',
              disabled: offline,
              onclick: () => restoreFromTrash(note),
            },
            Icon('rotate-ccw', { size: 14, sw: 2.4 }),
            'Restore'
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost gb-btn--compact gb-note-forever',
              disabled: offline,
              onclick: () => deleteForever(note),
            },
            Icon('trash-2', { size: 14, sw: 2.4 }),
            'Delete forever'
          )
        )
      );
    } else {
      card.appendChild(h('div', { class: 'gb-note-card-time' }, relativeTime(note.updatedAt)));
    }
    return card;
  }

  /* A card's tap: the editor, or (offline, or in the Trash) a read-only view. */
  function activate(note, card) {
    if (offline || view === 'trash') readOnly(note);
    else openNote(note, card);
  }

  function readOnly(note) {
    const { sheet: card, close } = openOverlay({
      label: note.title || 'Note',
      className: 'gb-note-modal',
    });
    const bodyEl = h('div', { class: 'gb-editor gb-note-readonly' });
    // Sanitised on the way out, like every paint of a note body.
    bodyEl.innerHTML = sanitize(note.body);
    let why = '';
    if (String(note.id).startsWith('tmp-')) {
      why = 'This note is still waiting to sync. Edit it once it has.';
    } else if (offline && note.bodyDropped) {
      why = 'This note is too big to keep offline. It opens when you are back online.';
    } else if (note.bodyTrimmed) {
      why = offline
        ? 'Photos open when you are back online.'
        : 'Restore the note to see its photos.';
    }
    const foot = [
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Close'),
    ];
    if (view === 'trash' && !offline) {
      foot.push(
        h(
          'button',
          {
            type: 'button',
            class: 'gb-btn gb-btn--primary',
            onclick: () => {
              close();
              restoreFromTrash(note);
            },
          },
          'Restore'
        )
      );
    }
    card.append(
      h(
        'div',
        { class: 'gb-note-modal-head' },
        h('div', { class: 'gb-modal-title' }, note.title || 'Note')
      ),
      h(
        'div',
        { class: 'gb-modal-body' },
        bodyEl,
        why ? h('p', { class: 'gb-note-readonly-why' }, why) : null
      ),
      h('div', { class: 'gb-note-foot' }, foot)
    );
    refreshIcons();
  }

  async function restoreFromTrash(note) {
    try {
      await onRestore(note.id);
      notes = notes.filter((n) => n.id !== note.id);
      paint();
      refreshCounts();
      toast.success(note.archivedAt ? 'Restored to Archived.' : 'Restored to your notes.');
    } catch (err) {
      toast.error(err, 'Could not restore that note.');
    }
  }

  async function deleteForever(note) {
    const ok = await confirmDialog({
      title: 'Delete forever?',
      message: 'This note and its photos are removed for good. This cannot be undone.',
      confirmLabel: 'Delete forever',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    try {
      await onDeleteForever(note.id);
      await leave(cardOf(note.id));
      notes = notes.filter((n) => n.id !== note.id);
      paint();
      refreshCounts();
    } catch (err) {
      toast.error(err, 'Could not delete that note.');
    }
  }

  const pinning = new Set();
  async function togglePin(note) {
    // A double tap pinned and then unpinned: one request per note at a time.
    if (pinning.has(note.id)) return;
    pinning.add(note.id);
    try {
      const saved = await onUpdate(note.id, { pinned: !note.pinned });
      Object.assign(note, saved);
      sortNotes();
      paint();
      landed(cardOf(note.id)); // it moved: show where to
    } catch (err) {
      toast.error(err, 'Could not pin that note.');
    } finally {
      pinning.delete(note.id);
    }
  }

  /* ---- edit sheet: everything a note can do lives here ---- */
  const opening = new Set();
  async function openNote(note, card) {
    /* Created offline and still in the outbox: the server has no such id, so a
       save can't land (onUpdate refuses it), Close would keep failing on that and
       the edit draft would PUT to a 404. Read it until it has synced; the next
       load swaps in the real id. */
    if (String(note.id).startsWith('tmp-')) return readOnly(note);
    /* A list item has no photos in its body. Editing that copy would save it
       back and delete them, so the whole note is fetched first. */
    if (note.bodyTrimmed) {
      if (opening.has(note.id)) return; // second tap while it loads
      opening.add(note.id);
      card && card.classList.add('is-opening');
      card && card.setAttribute('aria-busy', 'true');
      try {
        Object.assign(note, await onGet(note.id));
      } catch (err) {
        toast.error(err, 'Could not open that note.');
        return;
      } finally {
        opening.delete(note.id);
        card && card.classList.remove('is-opening');
        card && card.removeAttribute('aria-busy');
      }
    }
    const title = h('input', {
      type: 'text',
      class: 'gb-input gb-note-title-input',
      placeholder: 'Title (optional)',
      maxlength: '200',
      value: note.title || '',
      'aria-label': 'Note title',
      oninput: () => keepEdit(),
    });
    const ed = richEditor({
      html: note.body,
      placeholder: 'Write something…',
      onInput: () => keepEdit(),
    });
    let color = note.color || null;
    let pinned = !!note.pinned;
    const labelEd = labelEditor(
      note.labels,
      labelsInUse(notes).filter((l) => !hasLabel(note, l)),
      () => keepEdit()
    );

    /* An edit autosaves as a draft of THIS note (note_edit_drafts, keyed by its
       id), the way the composer's new note always has. Only the composer's
       did: an edit lived in the open sheet alone, so a reload or a killed app
       lost it. Saving the note drops the draft server-side. */
    let editTimer = null;
    let editStored = false; // a draft row may exist for this note
    let editTouched = false; // typed here, so a late server copy must not overwrite it
    function keepEdit() {
      editTouched = true;
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        if (!onSaveEditDraft) return;
        editStored = true;
        onSaveEditDraft(note.id, {
          title: title.value,
          body: ed.read(),
          color,
          labels: labelEd.list(),
        }).catch(() => {});
      }, DRAFT_SAVE_MS);
    }
    function dropEdit() {
      clearTimeout(editTimer);
      if (editStored && onDeleteEditDraft) onDeleteEditDraft(note.id).catch(() => {});
      editStored = false;
    }

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
          onclick: async (e) => {
            const text = title.value.trim() || textOf(ed.read());
            if (!text) return toast.error(null, 'Write something first.');
            // Disabled in flight: a double tap made two identical tasks.
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await onMakeTask(text.slice(0, 255));
              toast.success('Added to your tasks.');
            } catch (err) {
              toast.error(err, 'Could not make that a task.');
            } finally {
              btn.disabled = false;
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
      h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--soft gb-btn--compact',
          onclick: () => shareNote(title.value.trim(), ed.read()),
        },
        Icon('share-2', { size: 14, sw: 2.4 }),
        'Share'
      ),
      pinBtn
    );

    const body = h(
      'div',
      null,
      title,
      ed.node,
      labelEd.node,
      colorRow(color, (key) => {
        color = key;
        keepEdit();
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
            clearTimeout(editTimer); // the server dropped the draft with the note
            open.close();
            refreshCounts(); // one more in the Trash
            // Soft delete, so it can come straight back.
            if (onRestore && toast.action) {
              toast.action('Note deleted.', 'Undo', () => restoreNote(note));
            }
            // The card is behind the closing sheet: let the sheet go first.
            setTimeout(async () => {
              await leave(cardOf(note.id));
              notes = notes.filter((n) => n.id !== note.id);
              paint();
            }, SHEET_EXIT);
          } catch (err) {
            toast.error(err, 'Could not delete that note.');
          }
        },
      },
      Icon('trash-2', { size: 16, sw: 2.2 })
    );

    /* Archive is a save that also moves the note out of this list, so it goes
       through persist (one PATCH, same 409 check) by way of the sheet's commit:
       that sets busy, so an Escape or backdrop tap mid-PATCH can't fire a second
       persist on the stale baseUpdatedAt (a false 409), and closes on success. */
    const wasArchived = !!note.archivedAt;
    const archiveBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-iconbtn gb-note-del',
        'aria-label': wasArchived ? 'Unarchive note' : 'Archive note',
        title: wasArchived ? 'Unarchive: back to your notes' : 'Archive: keep it, out of the list',
        onclick: async () => {
          archiveBtn.disabled = true;
          await open.commit(async () => {
            const done = await persist(false, { archived: !wasArchived });
            if (!done) return; // took the newer copy instead; it reopens itself
            refreshCounts();
            if (wasArchived) toast.success('Back in your notes.');
            else if (toast.action) {
              toast.action('Note archived.', 'Undo', () => setArchived(note, false));
            }
          }, wasArchived ? 'Could not unarchive that note.' : 'Could not archive that note.');
          archiveBtn.disabled = false;
        },
      },
      Icon(wasArchived ? 'archive-restore' : 'archive', { size: 16, sw: 2.2 })
    );

    /* Throws on failure and says nothing: commit() in sheet() is the one place
       that reports, and toasting here too put the same failure on screen twice.
       It also owns the close, so this doesn't call it either. Resolves true
       when saved, false when the newer copy was loaded instead. */
    const persist = async (overwrite, extra) => {
      clearTimeout(editTimer);
      const body = ed.read();
      const labels = labelEd.read(); // throws the rule a half-typed label breaks
      let saved;
      try {
        saved = await onUpdate(
          note.id,
          Object.assign(
            {
              title: title.value.trim(),
              body,
              cover: await coverOf(body),
              // '' clears it server-side; undefined would mean "leave it alone".
              color: color === null || color === undefined ? '' : color,
              pinned,
              // [] clears them, like '' for the colour.
              labels,
              // The version this sheet opened. Newer on the server (another device
              // saved since) is a 409, which asks rather than overwriting it.
              baseUpdatedAt: overwrite ? null : note.updatedAt || null,
            },
            extra || {}
          )
        );
      } catch (err) {
        if (!err || err.status !== 409) throw err;
        const choice = await askConflict();
        if (choice === 'mine') return persist(true, extra);
        if (choice === 'theirs') {
          Object.assign(note, await onGet(note.id));
          dropEdit();
          sortNotes();
          paint();
          // This sheet closes once persist resolves; reopen on the newer copy.
          setTimeout(() => openNote(note, cardOf(note.id)), SHEET_EXIT);
          return false;
        }
        throw new Error('Not saved. Your changes are still here.');
      }
      editStored = false; // the PATCH dropped the draft
      Object.assign(note, saved);
      opened = snapshot(); // saved: the sheet now matches the server again
      // Archived (or brought back) from here: it belongs to the other list now.
      if (!inView(note)) notes = notes.filter((n) => n.id !== note.id);
      sortNotes();
      paint();
      // sheet() closes once this resolves; land the card after it has gone.
      setTimeout(() => landed(cardOf(note.id)), SHEET_EXIT);
      return true;
    };

    /* Snapshot of everything the sheet can change, taken through the same
       readers the save uses — comparing against note.body directly would
       misfire, since the editor round-trips it through sanitize() on the way
       in. Leaving without an edit must not write: a no-op PATCH bumps
       updatedAt, and the list is sorted by it, so opening a note and closing it
       would jump it to the top. */
    const snapshot = () =>
      JSON.stringify([title.value.trim(), ed.read(), color, pinned, labelEd.peek()]);
    let opened = snapshot();

    const open = sheet({
      title: 'Note',
      body,
      primary: 'Save',
      headActions: [archiveBtn, deleteBtn],
      onPrimary: persist,
      // Closing a note keeps it. Tapping outside, Escape and Close all land
      // here — the only way to lose the text was the one the user reached for
      // most often.
      onDismiss: async () => {
        if (snapshot() !== opened) await persist();
        else dropEdit();
      },
    });
    setTimeout(() => ed.focus(), 60);
    // Opened from a search: land on the first match, not the top of the note.
    const words = queryWords(query);
    if (words.length) setTimeout(() => revealMatch(ed.area, words), 90);

    // Unsaved edits from a reload or another device, unless typing here began
    // first. A draft older than the note itself is stale (saved over since).
    if (onGetEditDraft) {
      onGetEditDraft(note.id)
        .then((d) => {
          if (!d || editTouched) return;
          if (note.updatedAt && d.updatedAt && new Date(d.updatedAt) < new Date(note.updatedAt)) {
            editStored = true;
            dropEdit();
            return;
          }
          editStored = true;
          title.value = d.title || '';
          ed.area.innerHTML = sanitize(d.body || '');
          color = d.color || null;
          // null: a draft from before labels were kept; leave the note's own.
          if (Array.isArray(d.labels)) labelEd.set(d.labels);
          const on = [null, ...COLORS].findIndex((c) => (c ? c.key : null) === color);
          Array.from(body.querySelectorAll('.gb-note-swatch')).forEach((el, i) => {
            el.classList.toggle('is-on', i === on);
            el.setAttribute('aria-pressed', i === on ? 'true' : 'false');
          });
          toast.success('Picked up your unsaved changes.');
        })
        .catch(() => {});
    }
  }

  /* Someone saved this note elsewhere since the sheet opened. Three answers,
     so not confirmDialog: overwrite, take theirs, or keep editing. */
  function askConflict() {
    return new Promise((resolve) => {
      const { sheet: card, close } = openOverlay({
        label: 'This note changed elsewhere',
        role: 'alertdialog',
        onClose: () => resolve('cancel'),
      });
      const pick = (v) => () => {
        resolve(v);
        close();
      };
      card.append(
        h(
          'div',
          { class: 'gb-modal-head' },
          h('div', { class: 'gb-modal-title' }, 'This note changed elsewhere'),
          h(
            'div',
            { class: 'gb-modal-sub' },
            'It was saved on another device after you opened it here.'
          )
        ),
        h(
          'div',
          { class: 'gb-note-conflict' },
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--primary', onclick: pick('mine') },
            'Save mine over it'
          ),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--soft', onclick: pick('theirs') },
            'Load the newer one'
          ),
          h(
            'button',
            { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: pick('cancel') },
            'Keep editing'
          )
        )
      );
    });
  }

  async function restoreNote(note) {
    try {
      const back = Object.assign({}, note, await onRestore(note.id));
      notes = notes.filter((n) => n.id !== note.id);
      if (inView(back)) notes.push(back); // the view may have changed since the delete
      sortNotes();
      paint();
      refreshCounts();
      landed(cardOf(note.id));
    } catch (err) {
      toast.error(err, 'Could not bring that note back.');
    }
  }

  /* Archive's Undo (and any other flip of it from outside the sheet). */
  async function setArchived(note, archived) {
    try {
      const saved = Object.assign({}, note, await onUpdate(note.id, { archived }));
      notes = notes.filter((n) => n.id !== note.id);
      if (inView(saved)) notes.push(saved);
      sortNotes();
      paint();
      refreshCounts();
      landed(cardOf(note.id));
    } catch (err) {
      toast.error(err, 'Could not change that note.');
    }
  }

  /* Plain text out: the share sheet where there is one, else the clipboard. */
  async function shareNote(titleText, html) {
    const text = [titleText, plainTextOf(html)].filter(Boolean).join('\n\n');
    if (!text) return toast.error(null, 'Write something first.');
    if (navigator.share) {
      try {
        await navigator.share({ title: titleText || 'Note', text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // closed the sheet: not a failure
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied as plain text.');
    } catch (err) {
      toast.error(err, 'Could not copy that note.');
    }
  }

  /* The chosen order (Last edited / Date created / Title), pinned first in
     each; kept locally so a pin doesn't need a refetch. The Trash keeps the
     server's order, most recently deleted first. */
  function sortNotes() {
    if (view !== 'trash') notes.sort(compareNotes(sortKey));
  }

  const EMPTY = {
    notes: ['notebook-pen', 'No notes yet. Jot down the thing you keep forgetting.'],
    archived: ['archive', 'Nothing archived. Archive a note to keep it out of the way.'],
    trash: ['trash-2', 'The Trash is empty. Deleted notes wait here for 30 days.'],
  };

  function paint() {
    listEl.replaceChildren();
    if (!notes.length) {
      const [icon, text] = EMPTY[view];
      listEl.appendChild(
        h(
          'div',
          { class: 'gb-card gb-note-state' },
          h(
            'div',
            { class: 'gb-empty' },
            Icon(icon, { size: 26, color: 'var(--fg3)' }),
            h('p', null, text)
          )
        )
      );
    } else {
      notes.forEach((n) => listEl.appendChild(NoteCard(n)));
      listEl.appendChild(noMatch);
    }
    paintLabels();
    filter();
    offlineBanner.hidden = !offline;
    composer.hidden = offline || view !== 'notes';
    viewRow.hidden = offline;
    saveOffline();
    refreshIcons();
  }

  /* One chip per label in use in this list, plus All. Tapping the one that is
     on turns it off. */
  function paintLabels() {
    const all = labelsInUse(notes);
    if (activeLabel && !all.some((l) => l.toLowerCase() === activeLabel.toLowerCase())) {
      activeLabel = null; // its last note went
    }
    const chip = (label, text) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-note-chip' + (activeLabel === label ? ' is-on' : ''),
          'aria-pressed': activeLabel === label ? 'true' : 'false',
          onclick: () => {
            activeLabel = activeLabel === label ? null : label;
            paintLabels();
            filter();
          },
        },
        text
      );
    labelRow.replaceChildren(chip(null, 'All'), ...all.map((l) => chip(l, l)));
    labelRow.hidden = !all.length;
  }

  /* Every word must appear somewhere (title, text, photo descriptions), and
     the label chip that is on must be on the note. Toggles the cards already
     built, and marks the matches in the ones it shows. */
  function filter() {
    if (!notes.length) return;
    const words = queryWords(query);
    const byId = new Map(notes.map((n) => [n.id, n]));
    searchCache.prune(byId.keys());
    let any = false;
    listEl.querySelectorAll('.gb-note-card').forEach((card) => {
      const n = byId.get(card.dataset.id);
      const found = n ? searchCache.get(n) : null;
      const show = !!n && hasLabel(n, activeLabel) && matchesAll(found.hay, words);
      card.hidden = !show;
      any = any || show;
      if (show) highlight(card, found.text, words);
    });
    const where = activeLabel ? ' labelled "' + activeLabel + '"' : '';
    noMatchText.textContent = words.length
      ? 'No notes' + where + ' match "' + query.trim() + '".'
      : 'No notes' + where + '.';
    noMatch.hidden = any;
  }

  /* A search shows where it matched: the title marked, and the body swapped
     for a snippet around the first hit. No search, the card as painted. */
  function highlight(card, text, words) {
    const parts = cardParts.get(card);
    if (!parts) return;
    const { titleEl, bodyEl, snippetEl, title } = parts;
    if (titleEl) titleEl.replaceChildren(...(words.length ? marked(title, words) : [title]));
    const lower = (text || '').toLowerCase();
    const inBody = words.length && words.some((w) => lower.includes(w));
    if (inBody) snippetEl.replaceChildren(...marked(snippetAround(text, words), words));
    snippetEl.hidden = !inBody;
    bodyEl.hidden = !!inBody;
  }

  // Skeleton first: the list has real height before the fetch lands, so the
  // page doesn't jump the way every other screen here learned not to.
  const skelLine = (w) => h('div', { class: 'gb-skel-line', style: { width: w } });
  function showSkeleton() {
    labelRow.hidden = true;
    listEl.replaceChildren(
      h(
        'div',
        { class: 'gb-card gb-note-skel' },
        h('div', { class: 'gb-skel-lines' }, skelLine('55%'), skelLine('92%'), skelLine('38%'))
      )
    );
  }
  showSkeleton();

  /* A failure that means "no network" rather than "the server said no": the
     api() wrapper throws those without a status. */
  const looksOffline = (err) =>
    (typeof navigator !== 'undefined' && navigator.onLine === false) || !(err && err.status);

  const fetchView = () =>
    view === 'trash' ? onTrash() : view === 'archived' ? onList({ archived: true }) : onList();

  const load = () => {
    const forView = view;
    return fetchView()
      .then((data) => {
        if (forView !== view) return; // switched while this was in flight
        const fetched = Array.isArray(data) ? data : [];
        if (view === 'notes' && !offline) {
          // A note saved while this was in flight (a cold server takes seconds) is
          // already in `notes` and may be missing from `data`, which the server read
          // first. Replacing outright dropped it and put "No notes yet" back.
          const ids = new Set(fetched.map((n) => n.id));
          // Not a `tmp-` one, though: an offline note the outbox has since sent
          // is in `data` under its real id, and keeping both showed it twice.
          notes = fetched.concat(notes.filter((n) => !ids.has(n.id) && !String(n.id).startsWith('tmp-')));
        } else {
          notes = fetched; // the offline copy is replaced whole
        }
        offline = false;
        sortNotes();
        paint();
        paintViews();
        refreshCounts();
      })
      .catch((err) => {
        if (forView !== view) return;
        // The list this device last saw, read-only, beats an error card.
        if (view === 'notes' && looksOffline(err) && showOffline()) return;
        if (offline) return; // still offline: keep showing the copy
        listEl.replaceChildren(
          h(
            'div',
            { class: 'gb-card gb-note-state' },
            h(
              'div',
              { class: 'gb-empty' },
              Icon('circle-alert', { size: 26, color: 'var(--fg3)' }),
              h('p', null, 'Could not load your notes.'),
              h(
                'button',
                {
                  type: 'button',
                  class: 'gb-btn gb-btn--secondary gb-btn--compact',
                  onclick: (e) => {
                    e.currentTarget.disabled = true;
                    load();
                  },
                },
                'Try again'
              )
            )
          )
        );
      });
  };
  paintViews();
  load();

  // Search (with sort) is the top bar, sticky while the list scrolls; everything
  // else — banner, composer, views, label chips — sits under it.
  return h('div', { class: 'gb-notes' }, tools, offlineBanner, composer, viewRow, labelRow, listEl);
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
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  a(
    sanitize('<img src="' + jpeg + '" alt="">') === '<img src="' + jpeg + '" alt="">',
    'photo kept'
  );
  a(
    sanitize('<img src="' + jpeg + '" class="is-picked" width="9">') === '<img src="' + jpeg + '">',
    'photo attributes stripped'
  );
  a(sanitize('<img src="https://t.example/p.gif">x') === 'x', 'remote image dropped');
  a(sanitize('<img src="data:image/svg+xml;base64,PHN2Zz4=">') === '', 'svg image dropped');
  a(textOf('<p>a</p><p>b</p>') === 'a b', 'textOf flattens');
  a(
    sanitize('<ul data-checklist="x" onclick="y"><li data-checked="1">a</li><li>b</li></ul>') ===
      '<ul data-checklist=""><li data-checked="">a</li><li>b</li></ul>',
    'checklist kept, its flags emptied, handlers stripped'
  );
  a(sanitize('<p data-checked="1">p</p>') === '<p>p</p>', 'checklist flags only on their own tags');
  a(
    plainTextOf('<ul data-checklist=""><li data-checked="">milk</li><li>eggs</li></ul>') ===
      '[x] milk\n[ ] eggs',
    'checklist shares as boxes'
  );
  // The toolbar's strikethrough, quote and inline code write these four tags.
  a(sanitize('<s>x</s><strike>y</strike>') === '<s>x</s><strike>y</strike>', 'strikethrough kept');
  a(
    sanitize('<blockquote cite="https://x.dev" onclick="y">q</blockquote>') ===
      '<blockquote>q</blockquote>',
    'quote kept, its attributes stripped'
  );
  a(
    sanitize('<code class="x">a &lt; b</code>') === '<code>a &lt; b</code>',
    'inline code kept, escaped text stays text'
  );
  a(
    sanitize('<code><img src=x onerror=alert(1)></code>') === '<code></code>',
    'nothing executable rides in inside code'
  );
}

if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    _demo();
  } catch (_) {
    /* never block the app */
  }
}

function clearNoteDraft() {
  composerDraft = null;
}

export { ScreenNotes, sanitize, shrinkPhoto, clearNoteDraft };
