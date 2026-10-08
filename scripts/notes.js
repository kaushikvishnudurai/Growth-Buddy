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
  { cmd: 'formatBlock', value: 'h2', icon: 'heading-2', label: 'Heading', state: 'h2' },
  { cmd: 'insertUnorderedList', icon: 'list', label: 'Bullet list' },
  { cmd: 'insertOrderedList', icon: 'list-ordered', label: 'Numbered list' },
  { cmd: 'createLink', icon: 'link', label: 'Link', prompt: 'Link to…' },
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
  area.addEventListener('input', () => {
    normalize();
    if (onInput) onInput();
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

function ScreenNotes({ onList, onGet, onCreate, onUpdate, onDelete, onMakeTask, onMakeReminder }) {
  const listEl = h('div', { class: 'gb-note-grid' });
  let notes = [];
  let query = '';
  let searchTimer = null;
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
    { class: 'gb-notes-search', hidden: true },
    Icon('search', { size: 16, sw: 2.2, color: 'var(--fg3)' }),
    searchInput
  );

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
      });
      notes.unshift(created);
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
        if (e.target.closest('.gb-note-pin')) return;
        openNote(note, card);
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNote(note, card);
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
    if (note.title) card.appendChild(h('h3', { class: 'gb-note-card-title' }, note.title));
    if (preview) card.appendChild(bodyEl);
    card.appendChild(h('div', { class: 'gb-note-card-time' }, relativeTime(note.updatedAt)));
    return card;
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
            open.close();
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

    /* Throws on failure and says nothing: commit() in sheet() is the one place
       that reports, and toasting here too put the same failure on screen twice.
       It also owns the close, so this doesn't call it either. */
    const persist = async () => {
      const body = ed.read();
      const saved = await onUpdate(note.id, {
        title: title.value.trim(),
        body,
        cover: await coverOf(body),
        // '' clears it server-side; undefined would mean "leave it alone".
        color: color === null || color === undefined ? '' : color,
        pinned,
      });
      Object.assign(note, saved);
      sortNotes();
      paint();
      // sheet() closes once this resolves; land the card after it has gone.
      setTimeout(() => landed(cardOf(note.id)), SHEET_EXIT);
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
          { class: 'gb-card gb-note-state' },
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
      listEl.appendChild(noMatch);
      filter();
    }
    searchBar.hidden = !notes.length;
    refreshIcons();
  }

  /* Every word must appear somewhere. Toggles the cards already built.
     ponytail: re-parses each body per search, fine for hundreds of notes;
     cache searchTextOf by body if not. */
  function filter() {
    if (!notes.length) return;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const byId = new Map(notes.map((n) => [n.id, n]));
    let any = false;
    listEl.querySelectorAll('.gb-note-card').forEach((card) => {
      const n = byId.get(card.dataset.id);
      const hay = n ? searchTextOf(n) : '';
      const show = words.every((w) => hay.includes(w));
      card.hidden = !show;
      any = any || show;
    });
    noMatchText.textContent = 'No notes match "' + query.trim() + '".';
    noMatch.hidden = any;
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
  const load = () =>
    onList()
      .then((data) => {
        // A note saved while this was in flight (a cold server takes seconds) is
        // already in `notes` and may be missing from `data`, which the server read
        // first. Replacing outright dropped it and put "No notes yet" back.
        const fetched = Array.isArray(data) ? data : [];
        const ids = new Set(fetched.map((n) => n.id));
        notes = fetched.concat(notes.filter((n) => !ids.has(n.id)));
        sortNotes();
        paint();
      })
      .catch(() => {
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
  load();

  return h('div', { class: 'gb-notes' }, composer, searchBar, listEl);
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
}

if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
  try {
    _demo();
  } catch (_) {
    /* never block the app */
  }
}

export { ScreenNotes, sanitize, shrinkPhoto };
