/* =====================================================================
   Growth Buddy — Command palette + shortcut help (lazy: loaded on first open)
   app.js owns the key listener, the header button and paletteProps() — what
   there is to find and what each pick does. This file only draws: one input,
   a grouped listbox ranked by palette-core.js, and a last row that hands the
   text to Quick add (app.js runQuickAdd: parse, preview, write nothing unseen).
   A proper dialog (openOverlay -> aria-modal), so a11y.js traps focus and
   Escape closes it; the input is an ARIA combobox over the listbox.
   ===================================================================== */
import { h, Icon, openOverlay, refreshIcons, NAV_CATALOG } from './gb-kit.js';
import { occursOn } from './recurrence.js';
import { fmtDate } from './i18n.js';
import { toast } from './toast.js';
import { rankItems, groupRanked, emptyResults, pushRecent } from './palette-core.js';

const GROUP_LABEL = {
  recent: 'Recent',
  action: 'Actions',
  screen: 'Screens',
  task: 'Tasks',
  habit: 'Habits',
  goal: 'Goals',
  reminder: 'Reminders',
  note: 'Notes',
  quickadd: 'Quick add',
};
const KIND_ICON = {
  task: 'list-todo',
  habit: 'repeat',
  goal: 'target',
  reminder: 'bell',
  note: 'notebook-pen',
  quickadd: 'sparkles',
};
const SCREEN_ICON = { achievements: 'award', summary: 'chart-column', mentor: 'message-circle' };
const iconFor = (item) =>
  item.icon ||
  (item.kind === 'screen'
    ? (NAV_CATALOG.find((n) => n.id === item.screen) || {}).icon || SCREEN_ICON[item.screen] || 'circle'
    : KIND_ICON[item.kind] || 'circle');

/* The notes list, once per page load: Notes keeps its list on its own screen,
   not in app state. Shown at once on later opens, refreshed behind it. Keyed by
   props.userId: after a sign-out the next account must not see these titles. */
let notesCache = null;
let notesFor = null;
const notePlain = (n) => String(n.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const noteTitle = (n) => (n.title || notePlain(n)).slice(0, 80);

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
/* A reminder opens on its next day from today (a weekly one made months ago
   should not land on its first week), else on its own date.
   ponytail: a year's scan per pick; fine for one click. */
function nextDay(rem) {
  const d = new Date();
  for (let i = 0; i < 366; i++, d.setDate(d.getDate() + 1)) {
    if (occursOn(rem, keyOf(d))) return keyOf(d);
  }
  return rem.date;
}

/* Bring a goal's card into view once the Goals chunk has painted it. */
function spotlight(selector) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tries = 0;
  (function look() {
    const el = document.querySelector(selector);
    if (!el) {
      if (++tries < 60) setTimeout(look, 50);
      return;
    }
    const folded = el.closest('details');
    if (folded) folded.open = true;
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    el.classList.add('is-spotlit');
    setTimeout(() => el.classList.remove('is-spotlit'), 1600);
  })();
}

// A reminder says when it is: its day, or that it repeats.
const subOf = (item) =>
  item.kind === 'reminder'
    ? item.reminder.repeat && item.reminder.repeat !== 'none'
      ? 'Repeats'
      : fmtDate(item.reminder.date, 'short')
    : item.sub;

let uid = 0;

export function openPalette(props) {
  const { sheet, close } = openOverlay({ label: 'Search and commands', className: 'gb-palette' });
  const listId = 'gb-palette-list-' + ++uid;
  let recent = Array.isArray(props.recent) ? props.recent : [];
  let flat = []; // the options on screen, in order: [{ item, el }]
  let active = -1;
  let busy = false;

  const input = h('input', {
    type: 'text',
    class: 'gb-input gb-palette-input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': 'Search or type a command',
    placeholder: 'Search, or type something to add',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    autofocus: '',
  });
  const list = h('div', { id: listId, class: 'gb-palette-list', role: 'listbox', 'aria-label': 'Results' });
  const status = h('div', { class: 'gb-palette-status', role: 'status', 'aria-live': 'polite' });

  const noteItems = () =>
    (notesFor === props.userId ? notesCache || [] : [])
      .filter((n) => !n.deletedAt && !n.archivedAt)
      // The body matches too ("zebra" in a note titled "Saved QA note" found nothing); capped at 2,000 characters.
      .map((n) => ({ key: 'note:' + n.id, kind: 'note', label: noteTitle(n), alt: [notePlain(n).slice(0, 2000)], noteId: n.id }))
      .filter((x) => x.label);

  function setActive(i) {
    if (!flat.length) i = -1;
    else i = (i + flat.length) % flat.length;
    if (flat[active]) flat[active].el.setAttribute('aria-selected', 'false');
    active = i;
    if (i < 0) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    const el = flat[i].el;
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  function option(item) {
    const i = flat.length;
    const el = h(
      'div',
      {
        id: listId + '-' + i,
        class: 'gb-palette-opt',
        role: 'option',
        'aria-selected': 'false',
        // Keep focus (and the keyboard) on the input; the click still lands.
        onmousedown: (e) => e.preventDefault(),
        onmousemove: () => active !== i && setActive(i),
        onclick: () => choose(item),
      },
      h('span', { class: 'gb-palette-ic', 'aria-hidden': 'true' }, Icon(iconFor(item), { size: 18 })),
      h('span', { class: 'gb-palette-label' }, item.label),
      subOf(item) ? h('span', { class: 'gb-palette-sub' }, subOf(item)) : null
    );
    flat.push({ item, el });
    return el;
  }

  function paint() {
    const q = input.value.trim();
    const items = props.items.concat(noteItems());
    const groups = q ? groupRanked(rankItems(items, q, recent)) : emptyResults(items, recent);
    // Whatever matched, the sentence itself can always go to Quick add, last.
    if (q) groups.push({ kind: 'quickadd', items: [{ key: 'qa', kind: 'quickadd', label: 'Add with Quick add: ' + q, text: q }] });
    flat = [];
    active = -1;
    list.replaceChildren(
      ...groups.map((g, gi) => {
        const hid = listId + '-g' + gi;
        return h(
          'div',
          { class: 'gb-palette-group', role: 'group', 'aria-labelledby': hid },
          h('div', { id: hid, class: 'gb-palette-group-label' }, GROUP_LABEL[g.kind] || g.kind),
          g.items.map(option)
        );
      })
    );
    if (!flat.length) list.append(h('p', { class: 'gb-palette-empty' }, 'Type to search your tasks, habits, goals, reminders and notes.'));
    refreshIcons();
    const matches = flat.filter((x) => x.item.kind !== 'quickadd').length;
    status.textContent = q
      ? matches
        ? matches + (matches === 1 ? ' result' : ' results')
        : 'Nothing found. Enter adds it with Quick add.'
      : '';
    setActive(0);
  }

  async function choose(item) {
    if (busy) return;
    if (item.kind === 'quickadd') {
      busy = true;
      input.disabled = true;
      status.textContent = 'Reading…';
      try {
        if (await props.runQuickAdd(item.text, close)) return;
        status.textContent = '';
      } catch (err) {
        toast.error(err, 'Quick add failed. Try again?');
        status.textContent = '';
      }
      busy = false;
      input.disabled = false;
      input.focus();
      return;
    }
    recent = pushRecent(recent, item.key);
    props.saveRecent(recent);
    close();
    if (item.kind === 'reminder') props.openDay(nextDay(item.reminder));
    else if (item.kind === 'note') props.openNote(item.noteId);
    else {
      item.run();
      if (item.kind === 'goal') spotlight('[data-goal-id="' + CSS.escape(String(item.goalId)) + '"]');
    }
  }

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      setActive(flat.length - 1);
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (flat[active]) choose(flat[active].item);
    }
  });

  sheet.append(
    h('div', { class: 'gb-palette-bar' }, h('span', { class: 'gb-palette-glass', 'aria-hidden': 'true' }, Icon('search', { size: 18 })), input),
    list,
    h(
      'div',
      { class: 'gb-palette-foot' },
      status,
      h('span', { class: 'gb-palette-keys', 'aria-hidden': 'true' }, 'Up/Down to move · Enter to open · Esc to close')
    )
  );
  paint();

  if (props.listNotes) {
    props
      .listNotes()
      .then((data) => {
        notesCache = Array.isArray(data) ? data : [];
        notesFor = props.userId;
        if (sheet.isConnected && !busy) {
          const keep = flat[active] && flat[active].item.key;
          paint();
          const i = flat.findIndex((x) => x.item.key === keep);
          if (i > 0) setActive(i);
        }
      })
      // Offline or refused: search what is already here (the last list, or none).
      .catch(() => {});
  }
  input.focus();
}

/* "?": every shortcut, from the same GO_KEYS table the listener reads. */
export function openShortcutHelp(goKeys, screenLabel) {
  const { sheet, close } = openOverlay({ label: 'Keyboard shortcuts', className: 'gb-shortcuts' });
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Cmd' : 'Ctrl';
  const kbd = (...keys) =>
    h(
      'span',
      { class: 'gb-shortcut-keys' },
      keys.map((k) => (k === 'then' ? h('span', { class: 'gb-shortcut-then' }, 'then') : h('kbd', null, k)))
    );
  const rows = [
    [kbd(mod, 'K'), 'Search and commands'],
    [kbd('/'), 'Search and commands'],
    [kbd('N'), 'New task'],
    ...Object.entries(goKeys).map(([k, id]) => [kbd('G', 'then', k.toUpperCase()), 'Go to ' + (screenLabel[id] || id)]),
    [kbd('?'), 'This list'],
    [kbd('Esc'), 'Close a dialog'],
  ];
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Keyboard shortcuts'),
      h('div', { class: 'gb-modal-sub' }, 'Single keys work when you are not typing in a field.')
    ),
    h(
      'dl',
      { class: 'gb-modal-body gb-shortcut-list' },
      rows.map(([keys, what]) => h('div', { class: 'gb-shortcut-row' }, h('dt', null, keys), h('dd', null, what)))
    ),
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close, autofocus: '' }, 'Close')
  );
}
