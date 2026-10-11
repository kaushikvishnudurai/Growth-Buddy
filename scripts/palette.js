/* =====================================================================
   Growth Buddy — Command palette + shortcut sheet (lazy: first open only)
   app.js owns the key hook, the header button and paletteApp(): the state
   already in memory and the openers the rest of the app uses. This file builds
   the items from that, draws one input over a grouped listbox ranked by
   palette-core.js, and hands a sentence nothing matched to Quick add
   (app.runQuickAdd: parse, preview, write nothing unseen).
   An openOverlay sheet (aria-modal), so a11y.js traps focus, Escape closes it
   and focus returns to whatever opened it. The input is an ARIA combobox.
   ===================================================================== */
import '../styles/palette.css';
import { h, Icon, openOverlay, refreshIcons, NAV_CATALOG } from './gb-kit.js';
import { occursOn } from './recurrence.js';
import { fmtDate } from './i18n.js';
import { dateKey } from './dates.js';
import { fmtIn, homeCur } from './money-core.js';
import { toast } from './toast.js';
import { rankItems, groupRanked, emptyResults, pushRecent, highlight, matchScore } from './palette-core.js';

const GROUP_LABEL = {
  recent: 'Recent',
  action: 'Actions',
  screen: 'Go to',
  task: 'Tasks',
  habit: 'Habits',
  goal: 'Goals',
  reminder: 'Reminders',
  note: 'Notes',
  expense: 'Money',
  circle: 'Circles',
  quickadd: 'Quick add',
};
const KIND_ICON = {
  task: 'list-todo',
  habit: 'repeat',
  goal: 'target',
  reminder: 'bell',
  note: 'notebook-pen',
  expense: 'receipt',
  circle: 'users-round',
  quickadd: 'sparkles',
};
const SCREEN_ICON = { home: 'house', achievements: 'award', summary: 'chart-column', settings: 'settings' };
const iconOf = (item) =>
  item.icon ||
  (item.kind === 'screen'
    ? SCREEN_ICON[item.screen] || (NAV_CATALOG.find((n) => n.id === item.screen) || {}).icon || 'circle'
    : KIND_ICON[item.kind] || 'circle');
// "g" then one of these (app.js's key hook hands the letter over as view 'go:<key>').
const GO_KEYS = { h: 'home', c: 'calendar', m: 'money', n: 'notes', o: 'goals', f: 'focus', r: 'report', s: 'settings' };
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/* Notes and circles live on their own screens, not in app state: listed once
   per page load, shown at once on later opens and refreshed behind it. */
const lists = { notes: null, circles: null };
const plain = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* Once the screen a pick went to has painted `selector`, run `fn` on it.
   ponytail: polls 50ms for up to 4s (lazy chunk + fetch); a MutationObserver if that ever misses. */
function whenThere(selector, fn) {
  let tries = 0;
  (function look() {
    const el = document.querySelector(selector);
    if (el) fn(el);
    else if (++tries < 80) setTimeout(look, 50);
  })();
}
// Bring a card into view and ring it for a moment.
function spotlight(el) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const folded = el.closest('details');
  if (folded) folded.open = true;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  el.classList.add('is-spotlit');
  setTimeout(() => el.classList.remove('is-spotlit'), 1600);
}

/* A reminder opens on its next day from today (a weekly one made months ago
   should not land on its first week), else on its own date.
   ponytail: a year's scan per pick; fine for one click. */
function nextDay(rem) {
  const d = new Date();
  for (let i = 0; i < 366; i++, d.setDate(d.getDate() + 1)) {
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    if (occursOn(rem, key)) return key;
  }
  return rem.date;
}
const dayOf = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d);
};

/* Everything there is to find or do, gated by the same featureOn / screenEnabled
   the nav and Quick add use. Order inside `actions` is the empty query's list. */
function buildItems(app, openHelp) {
  const { state, featureOn: on } = app;
  const act = (key, label, icon, run, alt) => ({ key: 'act:' + key, kind: 'action', label, icon, run, alt });
  const dark = state.theme === 'dark';
  const go = (id) => app.setScreen(id);
  const money = () => import('./money.js');
  const SETTINGS = [
    ['profile', 'Profile', ['name', 'timezone', 'birthday', 'height', 'weight']],
    ['display', 'Display', ['theme', 'text size', 'time format', 'language']],
    ['notifications', 'Alerts', ['notifications', 'push', 'sound']],
    ['reminders', 'Reminders', ['snooze', 'reminder lead', 'working week']],
    ['layout', 'Layout', ['navigation', 'home layout', 'features', 'turn off']],
    ['account', 'Account', ['password', 'email', 'sign out', 'export', 'delete account', 'two-step']],
  ];
  const actions = [
    act('new-task', 'New task', 'list-todo', () => app.openAddTask(), ['add task', 'to-do', 'todo']),
    on('money') &&
      act(
        'new-expense',
        'New expense',
        'receipt',
        () => money().then((m) => m.openExpenseModal(state.money, app.saveMoney, null, null, app.requestReceiptScan)),
        ['add expense', 'spent', 'log spend']
      ),
    on('calendar') &&
      act(
        'new-reminder',
        'New reminder',
        'calendar-plus',
        () => {
          app.calGoTo(new Date());
          go('calendar');
          whenThere('input[aria-label="Reminder text"]', (el) => el.focus());
        },
        ['add reminder', 'remind me']
      ),
    on('notes') &&
      act(
        'new-note',
        'New note',
        'notebook-pen',
        () => {
          go('notes');
          whenThere('.gb-note-opener', (el) => el.click());
        },
        ['add note', 'jot', 'write']
      ),
    on('habits') && act('new-habit', 'New habit', 'repeat', () => app.openAddHabit(), ['add habit']),
    on('focus') &&
      act('focus', 'Start focus', 'timer', () => app.applyIntent({ type: 'focus' }), ['pomodoro', 'deep work', 'timer']),
    act('theme', dark ? 'Switch to light mode' : 'Switch to dark mode', dark ? 'sun' : 'moon', app.toggleTheme, [
      'toggle theme',
      'dark mode',
      'light mode',
    ]),
    act('settings', 'Open Settings', 'settings', () => app.openProfileSettings(), ['preferences']),
    ...SETTINGS.map(([tab, name, alt]) =>
      act('settings-' + tab, 'Settings: ' + name, 'settings', () => app.openProfileSettings(tab), alt)
    ),
    act('shortcuts', 'Keyboard shortcuts', 'keyboard', openHelp, ['keys', 'hotkeys', 'help']),
  ];
  const screens = Object.keys(app.SCREENS)
    .filter(app.screenEnabled)
    .map((id) => ({
      key: 'screen:' + id,
      kind: 'screen',
      label: app.SCREEN_LABEL[id] || app.SCREENS[id].headerName(),
      alt: [app.SCREENS[id].headerName()],
      screen: id,
      run: () => go(id),
    }));
  const tasks = (state.tasks || []).map((t) => ({
    key: 'task:' + t.id,
    kind: 'task',
    label: t.title,
    sub: t.done ? 'Done' : t.dueAt ? fmtDate(t.dueAt, 'short') : '',
    run: () => app.openEditTask(t),
  }));
  const habits = (on('habits') ? state.habits || [] : []).map((hb) => ({
    key: 'habit:' + hb.id,
    kind: 'habit',
    label: hb.name,
    run: () => app.openHabitForm(hb),
  }));
  const goals = (on('goals') ? (state.goals || []).flatMap((sec) => sec.goals || []) : []).map((g) => ({
    key: 'goal:' + g.id,
    kind: 'goal',
    label: g.title,
    sub: g.completed ? 'Complete' : '',
    run: () => {
      go('goals');
      whenThere('[data-goal-id="' + CSS.escape(String(g.id)) + '"]', spotlight);
    },
  }));
  const seenRem = new Set();
  const reminders = (on('calendar') ? state.reminders || [] : [])
    .filter((r) => r && !seenRem.has(r.id) && seenRem.add(r.id))
    .map((r) => ({
      key: 'reminder:' + r.id,
      kind: 'reminder',
      label: r.text,
      sub: r.repeat && r.repeat !== 'none' ? 'Repeats' : fmtDate(r.date, 'short'),
      run: () => {
        app.calGoTo(dayOf(nextDay(r)));
        go('calendar');
      },
    }));
  const notes = (on('notes') ? lists.notes || [] : []).map((n) => ({
    key: 'note:' + n.id,
    kind: 'note',
    label: (n.title || plain(n.body)).slice(0, 80),
    run: () => {
      go('notes');
      whenThere('.gb-note-card[data-id="' + CSS.escape(String(n.id)) + '"]', (el) => el.click());
    },
  }));
  // Money's loaded window (state.money: the last 400 days), newest first as stored.
  const cur = homeCur(state.money);
  const expenses = (on('money') ? (state.money && state.money.expenses) || [] : []).map((x) => ({
    key: 'expense:' + x.id,
    kind: 'expense',
    label: x.note || x.category || 'Expense',
    alt: x.note ? [x.category] : [],
    sub: fmtIn(x.amount, cur) + ' · ' + fmtDate(x.date, 'short'),
    run: () => {
      go('money');
      money().then((m) => m.openExpenseModal(state.money, app.saveMoney, null, x));
    },
  }));
  const circles = (on('circle') ? lists.circles || [] : []).map((c) => ({
    key: 'circle:' + c.id,
    kind: 'circle',
    label: c.name,
    run: () => {
      go('circle');
      whenThere('[data-circle-id="' + CSS.escape(String(c.id)) + '"]', spotlight);
    },
  }));
  return [
    ...actions,
    ...screens,
    ...tasks,
    ...habits,
    ...goals,
    ...reminders,
    ...notes,
    ...expenses,
    ...circles,
  ].filter((x) => x && x.label);
}

let uid = 0;

/** view: 'help' for the shortcut sheet, 'go:<key>' for a go-to, else the palette;
    text: a line to start with (a cancelled Quick add). */
export function openPalette(app, view, text = '') {
  if (view === 'help') return openShortcutHelp(app);
  if (view && view.startsWith('go:')) {
    const id = GO_KEYS[view.slice(3)];
    if (id) app.applyIntent({ type: 'open', screen: id }); // gated by screenEnabled there
    return;
  }
  const open = document.querySelector('.gb-palette input');
  if (open) return open.select();
  const { sheet, close } = openOverlay({ label: 'Search and commands', className: 'gb-palette' });
  const listId = 'gb-palette-list-' + ++uid;
  const prefs = (app.state.user && app.state.user.uiPrefs) || {};
  let recent = Array.isArray(prefs.paletteRecent) ? prefs.paletteRecent : [];
  let items = [];
  let flat = []; // the options on screen, in order: [{ item, el }]
  let active = -1;
  let busy = false;
  const openHelp = () => openShortcutHelp(app);
  const rebuild = () => (items = buildItems(app, openHelp));

  const input = h('input', {
    type: 'text',
    class: 'gb-input gb-palette-input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': 'Search or type a command',
    placeholder: 'Search, go to, or type something to log',
    value: text,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    autofocus: '', // a11y.js focuses [autofocus] once the sheet is in, not the sheet itself
  });
  const list = h('div', { id: listId, class: 'gb-palette-list', role: 'listbox', 'aria-label': 'Results' });
  const status = h('div', { class: 'gb-palette-status', role: 'status', 'aria-live': 'polite' });

  function setActive(i) {
    if (flat[active]) flat[active].el.setAttribute('aria-selected', 'false');
    active = flat.length ? (i + flat.length) % flat.length : -1;
    if (active < 0) return input.removeAttribute('aria-activedescendant');
    const el = flat[active].el;
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  function option(item, q) {
    const i = flat.length;
    const label = q ? highlight(item.label, q).map((r) => (r.hit ? h('mark', null, r.text) : r.text)) : item.label;
    const el = h(
      'div',
      {
        id: listId + '-' + i,
        class: 'gb-palette-opt',
        role: 'option',
        'aria-selected': 'false',
        // Focus stays on the input (and the keyboard with it); the click still lands.
        onmousedown: (e) => e.preventDefault(),
        onmousemove: () => active !== i && setActive(i),
        onclick: () => choose(item),
      },
      h('span', { class: 'gb-palette-ic', 'aria-hidden': 'true' }, Icon(iconOf(item), { size: 18 })),
      h('span', { class: 'gb-palette-label' }, label),
      item.sub ? h('span', { class: 'gb-palette-sub' }, item.sub) : null
    );
    flat.push({ item, el });
    return el;
  }

  function paint() {
    const q = input.value.trim();
    const ranked = q ? rankItems(items, q, recent) : [];
    const groups = q ? groupRanked(ranked) : emptyResults(items, recent);
    if (q) {
      // The sentence can always go to Quick add: first when nothing matched it
      // well (a word start or better), else last.
      const qa = { kind: 'quickadd', items: [{ key: 'qa', kind: 'quickadd', label: 'Log with Quick add: “' + q + '”', text: q }] };
      if (!ranked.length || matchScore(ranked[0], q) < 2) groups.unshift(qa);
      else groups.push(qa);
    }
    flat = [];
    active = -1;
    list.replaceChildren(
      ...groups.map((g, gi) =>
        h(
          'div',
          { class: 'gb-palette-group', role: 'group', 'aria-labelledby': listId + '-g' + gi },
          h('div', { id: listId + '-g' + gi, class: 'gb-palette-group-label' }, GROUP_LABEL[g.kind] || g.kind),
          g.items.map((item) => option(item, item.kind === 'quickadd' ? '' : q))
        )
      )
    );
    refreshIcons();
    const n = ranked.length;
    status.textContent = q ? (n ? n + (n === 1 ? ' result' : ' results') : 'Nothing found. Enter logs it with Quick add.') : '';
    setActive(0);
  }

  async function choose(item) {
    if (busy) return;
    if (item.kind === 'quickadd') {
      busy = true;
      input.disabled = true;
      status.textContent = 'Reading…';
      try {
        const read = await app.runQuickAdd(item.text, {
          onLeave: close,
          // Dismissed the preview: back here with the line, to fix it.
          onCancel: () => openPalette(app, null, item.text),
        });
        if (read) return;
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
    app.saveUiPrefs({ paletteRecent: recent });
    close();
    item.run();
  }

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key] || (e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0);
    if (step) {
      e.preventDefault();
      e.stopPropagation(); // Tab moves the selection here, not focus out of the dialog
      setActive(active + step);
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (flat[active]) choose(flat[active].item);
    }
  });

  const mod = isMac() ? 'Cmd' : 'Ctrl';
  sheet.append(
    h(
      'div',
      { class: 'gb-palette-bar' },
      h('span', { class: 'gb-palette-glass', 'aria-hidden': 'true' }, Icon('search', { size: 18 })),
      input
    ),
    list,
    h(
      'div',
      { class: 'gb-palette-foot' },
      status,
      h(
        'span',
        { class: 'gb-palette-keys', 'aria-hidden': 'true' },
        h('kbd', null, 'Up'),
        h('kbd', null, 'Down'),
        ' move ',
        h('kbd', null, Icon('corner-down-left', { size: 12 })),
        ' open ',
        h('kbd', null, 'Esc'),
        ' close ',
        h('kbd', null, mod + ' K')
      )
    )
  );
  rebuild();
  paint();

  // Notes and circles: what was listed last time now, the fresh list when it lands.
  const fetches = [
    app.featureOn('notes') && app.api('/api/notes').then((d) => (lists.notes = Array.isArray(d) ? d : [])),
    app.featureOn('circle') && app.api('/api/circles/mine').then((d) => (lists.circles = Array.isArray(d) ? d : [])),
  ].filter(Boolean);
  fetches.forEach((p) =>
    p
      .then(() => {
        if (!sheet.isConnected || busy) return;
        const keep = flat[active] && flat[active].item.key;
        rebuild();
        paint();
        const i = flat.findIndex((x) => x.item.key === keep);
        if (i > 0) setActive(i);
      })
      // Offline or refused: search what is already here.
      .catch(() => {})
  );
  input.focus();
  if (text) input.setSelectionRange(text.length, text.length);
}

/* "?": every shortcut, from the same GO_KEYS the go-to reads; a go-to whose
   screen is switched off is left out, since the key would do nothing. */
function openShortcutHelp(app) {
  const { sheet, close } = openOverlay({ label: 'Keyboard shortcuts', className: 'gb-shortcuts' });
  const mod = isMac() ? 'Cmd' : 'Ctrl';
  const keys = (...ks) =>
    h(
      'span',
      { class: 'gb-shortcut-keys' },
      ks.map((k) => (k === 'then' ? h('span', { class: 'gb-shortcut-then' }, 'then') : h('kbd', null, k)))
    );
  const goes = Object.entries(GO_KEYS).filter(([, id]) => id === 'settings' || app.screenEnabled(id));
  const rows = [
    [keys(mod, 'K'), 'Search and commands, even while typing'],
    [keys('/'), 'Search and commands'],
    ...goes.map(([k, id]) => [keys('G', 'then', k.toUpperCase()), 'Go to ' + (app.SCREEN_LABEL[id] || id)]),
    [keys('Up', 'Down'), 'Move through results (Tab too)'],
    [keys('Enter'), 'Open the result, or log the line with Quick add'],
    [keys('Esc'), 'Close'],
    [keys('?'), 'This list'],
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
      rows.map(([k, what]) => h('div', { class: 'gb-shortcut-row' }, h('dt', null, k), h('dd', null, what)))
    ),
    h('button', { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close }, 'Close')
  );
  refreshIcons();
}
