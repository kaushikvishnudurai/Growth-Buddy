/* =====================================================================
   Growth Buddy — UI primitives (vanilla JS)
   Element-returning factories, exported as ES module bindings.
   ===================================================================== */
import { createIcons } from 'lucide';
import { icons } from './icons.js';
import { toast } from './toast.js';

// Preserve the historic `window.lucide.createIcons()` call shape now that we've
// moved off the CDN UMD build. refreshIcons() (below) and timer.js both use it.
// We pass only the icon subset (scripts/icons.js) so the bundle stays small.
if (typeof window !== 'undefined' && !window.lucide) {
  window.lucide = { createIcons: (opts) => createIcons({ icons, ...(opts || {}) }) };
}

/* ---- Tiny hyperscript helper ----
     h('div', { class: 'x', onclick: fn }, child1, child2, ...)
     Children can be: strings, numbers, DOM nodes, arrays, null/false. */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const sk in v) {
          const sv = v[sk];
          if (sv == null) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset' && typeof v === 'object') {
        Object.assign(el.dataset, v);
      } else if (k in el && typeof v !== 'string') {
        try {
          el[k] = v;
        } catch (_) {
          el.setAttribute(k, String(v));
        }
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(parent, kids) {
  for (const c of kids) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) {
      appendChildren(parent, c);
      continue;
    }
    if (c instanceof Node) {
      parent.appendChild(c);
      continue;
    }
    parent.appendChild(document.createTextNode(String(c)));
  }
}

/* ---- Keyboard-operable clickable ----
     Spread into h() attrs to make a non-button element behave like a button
     for keyboard + screen-reader users: activate(fn) gives it a role, focus,
     and Enter/Space handling that mirror its onclick. */
function activate(fn) {
  return {
    role: 'button',
    tabindex: '0',
    onclick: fn,
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fn(e);
      }
    },
  };
}

/* ---- Pluralize helper ----
     plural(1, 'task') -> '1 task'; plural(3, 'task') -> '3 tasks'.
     Pass an explicit plural for irregular words: plural(2, 'entry', 'entries'). */
function plural(count, singular, pluralForm) {
  const word = count === 1 ? singular : pluralForm || singular + 's';
  return count + ' ' + word;
}

/* ---- Lucide icon ----
     Lucide's CDN script exposes `lucide.createIcons()` which scans the
     DOM for `<i data-lucide="...">` placeholders and replaces them with
     inline SVGs. We render the placeholder; whoever mounts the tree
     should call GB.refreshIcons() (or it's auto-debounced below). */
let _iconRaf = 0;
function refreshIcons() {
  if (_iconRaf) return;
  _iconRaf = requestAnimationFrame(() => {
    _iconRaf = 0;
    if (window.lucide && window.lucide.createIcons) {
      try {
        window.lucide.createIcons();
      } catch (_) {
        /* noop */
      }
    }
  });
}

function Icon(name, { size = 20, sw = 2, color, style, className } = {}) {
  const wrap = h('span', {
    class: 'gb-icon' + (className ? ' ' + className : ''),
    // Icons are decorative — the surrounding control carries the accessible
    // name (text or aria-label), so hide the glyph from assistive tech.
    'aria-hidden': 'true',
    style: Object.assign(
      { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
      color ? { color } : null,
      style || null
    ),
  });
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  i.setAttribute('width', String(size));
  i.setAttribute('height', String(size));
  i.setAttribute('stroke-width', String(sw));
  wrap.appendChild(i);
  refreshIcons();
  return wrap;
}

/* ---- Domain color map ---- */
const DOMAIN = {
  habit: { bg: 'var(--leaf-50)', fg: 'var(--leaf-600)', icon: 'repeat' },
  fitness: { bg: 'var(--coral-50)', fg: 'var(--coral-600)', icon: 'dumbbell' },
  ai: { bg: 'var(--iris-50)', fg: 'var(--iris-600)', icon: 'sparkles' },
  journal: { bg: 'var(--sky-50)', fg: 'var(--sky-600)', icon: 'notebook-pen' },
  social: { bg: 'var(--bloom-50)', fg: 'var(--bloom-600)', icon: 'users-round' },
  reward: { bg: 'var(--sun-50)', fg: 'var(--sun-700)', icon: 'trophy' },
  study: { bg: 'var(--iris-50)', fg: 'var(--iris-600)', icon: 'book-open' },
  career: { bg: 'var(--sky-50)', fg: 'var(--sky-600)', icon: 'briefcase' },
};

function IconChip({ domain = 'habit', icon, size = 40, iconSize = 20 } = {}) {
  const d = DOMAIN[domain] || DOMAIN.habit;
  return h(
    'div',
    {
      class: 'gb-iconchip',
      style: { background: d.bg, width: size + 'px', height: size + 'px' },
    },
    Icon(icon || d.icon, { size: iconSize, color: d.fg, sw: 2.2 })
  );
}

/* ---- Pill ---- */
function Pill({ icon, label, bg, fg, dot, style } = {}) {
  const styles = Object.assign({}, style);
  if (bg) styles.background = bg;
  if (fg) styles.color = fg;
  return h(
    'span',
    { class: 'gb-pill', style: styles },
    dot ? h('span', { class: 'dot', style: { background: dot } }) : null,
    icon ? Icon(icon, { size: 14, sw: 2.4 }) : null,
    label
  );
}

/* ---- Card ---- */
function Card({ children, style, className = '', onClick } = {}) {
  const node = h('div', {
    class: ('gb-card ' + className).trim(),
    style,
    onclick: onClick,
  });
  appendChildren(node, children || []);
  return node;
}

/* ---- Section title ---- */
function SectionTitle({ title, action, onAction } = {}) {
  return h(
    'div',
    { class: 'gb-sectiontitle' },
    h('h3', null, title),
    // A real <button>: an href-less <a role=button> took focus but ignored Enter
    // and Space. No handler means it is a count ("8 items"), not a control.
    action
      ? onAction
        ? h('button', { type: 'button', class: 'gb-sectiontitle-act', onclick: onAction }, action)
        : h('span', { class: 'gb-sectiontitle-act' }, action)
      : null
  );
}

/* ---- Progress ring (SVG) ---- */
function ProgressRing({
  value = 0,
  size = 96,
  stroke = 11,
  color = 'var(--brand)',
  children,
} = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.style.transform = 'rotate(-90deg)';

  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('cx', String(size / 2));
  bg.setAttribute('cy', String(size / 2));
  bg.setAttribute('r', String(r));
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'var(--surface-3)');
  bg.setAttribute('stroke-width', String(stroke));
  svg.appendChild(bg);

  const fg = document.createElementNS(NS, 'circle');
  fg.setAttribute('cx', String(size / 2));
  fg.setAttribute('cy', String(size / 2));
  fg.setAttribute('r', String(r));
  fg.setAttribute('fill', 'none');
  fg.setAttribute('stroke', color);
  fg.setAttribute('stroke-width', String(stroke));
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(off));
  fg.style.transition = 'stroke-dashoffset 0.6s var(--ease-out)';
  svg.appendChild(fg);

  const inner = h('div', {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
  appendChildren(inner, children || []);

  const wrap = h('div', {
    style: { position: 'relative', width: size + 'px', height: size + 'px' },
  });
  wrap.appendChild(svg);
  wrap.appendChild(inner);
  return wrap;
}

/* ---- Check (habit / task toggle) ---- */
function Check({ done = false, onToggle, color, label } = {}) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'gb-check' + (done ? ' is-done' : ''),
      'aria-pressed': String(!!done),
      // `label` names the item: a list of identical "Mark as done" buttons
      // told a screen reader nothing about which one it was on.
      'aria-label': (done ? 'Mark as not done' : 'Mark as done') + (label ? ': ' + label : ''),
      style: done && color ? { background: color, boxShadow: '0 2px 0 ' + color } : null,
      // onToggle re-renders the whole app, which replaced this button on the
      // tap's own frame — the press and the pop never got painted, so a tick
      // on a phone looked like a jump cut. Paint here first, hand over after.
      onclick: () => {
        if (btn.dataset.pending) return; // a second tap mid-pop would un-tick
        const ticking = !btn.classList.contains('is-done');
        btn.classList.toggle('is-done', ticking);
        if (ticking) btn.classList.add('just-popped');
        btn.dataset.pending = '1';
        setTimeout(
          () => {
            delete btn.dataset.pending;
            btn.classList.remove('just-popped');
            onToggle && onToggle();
            // Still mounted → nothing re-rendered (a measured habit opened its
            // dialog instead), so the local tick was a guess: take it back.
            if (btn.isConnected) btn.classList.toggle('is-done', !ticking);
          },
          ticking ? 400 : 0
        );
      },
    },
    Icon('check', { size: 17, sw: 3, color: '#fff' })
  );
  return btn;
}

/* ---- Avatar ---- */
function Avatar({
  name = '?',
  size = 42,
  bg = 'var(--iris-100)',
  fg = 'var(--iris-700)',
  ring,
  onClick,
} = {}) {
  const initials = name
    .split(' ')
    .map((w) => w[0] || '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const tag = onClick ? 'button' : 'div';
  return h(
    tag,
    {
      type: onClick ? 'button' : null,
      class: 'gb-avatar',
      onclick: onClick,
      'aria-label': onClick ? 'Account' : null,
      style: {
        width: size + 'px',
        height: size + 'px',
        background: bg,
        color: fg,
        fontSize: size * 0.36 + 'px',
        border: ring ? '2.5px solid ' + ring : '2px solid var(--surface)',
      },
    },
    initials
  );
}

/* ---- Bottom nav ----
   Primary destinations stay inline; the rest live behind a "More" sheet so the
   bar never crowds on mobile. `feature: null` = always shown; 'food|water'
   means either feature keeps the tab. */
// Wedge: an AI-coached daily productivity app. The primary bar IS the daily
// loop — Home (tasks + today's score), Habits (the streak engine), Mentor (the
// AI coach, the differentiator), Report (progress). Everything else lives in
// "More". Mentor was previously buried in overflow while Food/Goals sat up
// front — backwards for this product.
const NAV_PRIMARY = [
  { id: 'home', icon: 'house', label: 'Home', feature: null },
  { id: 'habits', icon: 'repeat', label: 'Habits', feature: 'habits', group: 'plan' },
  // Labels match each screen's own header, so the tab name and the page
  // title never disagree ("Mentor" used to open a screen called "Buddy").
  { id: 'mentor', icon: 'sparkles', label: 'Buddy', feature: 'mentor', group: 'people' },
  { id: 'report', icon: 'chart-column', label: 'Progress', feature: 'report', group: 'track' },
];
const NAV_OVERFLOW = [
  { id: 'calendar', icon: 'calendar-days', label: 'Calendar', feature: 'calendar', group: 'plan' },
  { id: 'focus', icon: 'timer', label: 'Timer', feature: 'focus', group: 'plan' },
  { id: 'goals', icon: 'target', label: 'Goals', feature: 'goals', group: 'plan' },
  { id: 'notes', icon: 'notebook-pen', label: 'Notes', feature: 'notes', group: 'plan' },
  { id: 'food', icon: 'utensils-crossed', label: 'Food', feature: 'food|water', group: 'track' },
  { id: 'money', icon: 'wallet', label: 'Money', feature: 'money', group: 'track' },
  { id: 'circle', icon: 'users-round', label: 'Circle', feature: 'circle', group: 'people' },
  { id: 'family', icon: 'users', label: 'Family', feature: 'family', group: 'people' },
];

// "More" held seven unrelated destinations in one flat grid, which read as
// "this app has eleven sections" rather than as a place with a shape. The
// headings name what you go there to do. An entry with no group (Home) renders
// first, ungrouped — a heading over a single stray item is worse than none.
const NAV_GROUPS = [
  { id: 'plan', label: 'Plan your day' },
  { id: 'track', label: 'Track & log' },
  { id: 'people', label: 'People' },
];

// Full catalog of nav destinations. The `primary` flag here is the DEFAULT
// bar-vs-More split; a user's saved nav_layout (id + primary, in order)
// overrides both the split and the order.
const NAV_CATALOG = [
  ...NAV_PRIMARY.map((i) => ({ ...i, primary: true })),
  ...NAV_OVERFLOW.map((i) => ({ ...i, primary: false })),
];
// Most destinations the bar shows before the rest spill into "More" — keeps
// the bar pixel-clean even if a user marks everything primary.
// ponytail: hard cap of 5; raise only if the bar layout is redesigned.
const NAV_MAX_PRIMARY = 5;

// A feature is ON unless explicitly set to false (opt-out model). `null` =
// always on; a 'a|b' string is on when either side is on.
function navFeatureOn(features, feature) {
  if (!feature) return true;
  return feature.split('|').some((k) => !features || features[k] !== false);
}

/* Merge a saved nav layout with the catalog: keep saved order + primary flag
   for known ids, drop unknown ids, append any new catalog entries with their
   default split. Mirrors resolveHomeLayout. Null/empty → catalog defaults. */
function resolveNavLayout(saved) {
  const known = new Set(NAV_CATALOG.map((i) => i.id));
  const seen = new Set();
  const out = [];
  (Array.isArray(saved) ? saved : []).forEach((item) => {
    if (item && known.has(item.id) && !seen.has(item.id)) {
      out.push({ id: item.id, primary: item.primary !== false });
      seen.add(item.id);
    }
  });
  NAV_CATALOG.forEach((i) => {
    if (!seen.has(i.id)) out.push({ id: i.id, primary: i.primary });
  });
  return out;
}

/* Build the "More" sheet body: ungrouped items first, then one headed grid per
   group that still has items. Keeps each user's own ordering inside a group. */
function moreSections(overflow, active, onNav) {
  const item = (i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'gb-more-item' + (active === i.id ? ' is-active' : ''),
        onclick: () => onNav && onNav(i.id),
      },
      h('span', { class: 'gb-more-item-ic' }, Icon(i.icon, { size: 22, sw: 2.2 })),
      h('span', null, i.label)
    );
  const out = [];
  const loose = overflow.filter((i) => !i.group);
  if (loose.length) out.push(h('div', { class: 'gb-more-grid' }, loose.map(item)));
  NAV_GROUPS.forEach((g) => {
    const members = overflow.filter((i) => i.group === g.id);
    if (!members.length) return;
    out.push(h('div', { class: 'gb-more-group-label' }, g.label));
    out.push(h('div', { class: 'gb-more-grid' }, members.map(item)));
  });
  return out;
}

function BottomNav({ active, onNav, onMore, features, moreOpen, layout } = {}) {
  const tab = (item, opts) =>
    h(
      'button',
      {
        type: 'button',
        class:
          'gb-nav-tab' +
          ((opts && opts.active) || active === item.id ? ' is-active' : '') +
          (opts && opts.overflow ? ' gb-nav-tab--overflow' : '') +
          (opts && opts.more ? ' gb-nav-tab--more' : ''),
        // Below 360px .gb-nav-tab span is display:none (app.css) and the icon is
        // aria-hidden — without this the whole nav is unnamed buttons.
        'aria-label': item.label,
        'aria-current': active === item.id ? 'page' : null,
        'aria-expanded': opts && opts.more ? (moreOpen ? 'true' : 'false') : null,
        onclick: () => (opts && opts.more ? onMore && onMore() : onNav && onNav(item.id)),
      },
      Icon(item.icon, { size: 23, sw: active === item.id || (opts && opts.active) ? 2.4 : 2 }),
      h('span', null, item.label)
    );

  // Resolve the user's saved layout (or defaults) to renderable destinations,
  // dropping any whose feature is turned off.
  const byId = new Map(NAV_CATALOG.map((i) => [i.id, i]));
  const visible = resolveNavLayout(layout)
    .map((x) => ({ def: byId.get(x.id), primary: x.primary }))
    .filter((x) => x.def && navFeatureOn(features, x.def.feature));
  let primaryItems = visible.filter((x) => x.primary).map((x) => x.def);
  const overflowItems = visible.filter((x) => !x.primary).map((x) => x.def);
  // Bar can only hold so many — surplus primary spill to the front of "More".
  let spilled = [];
  if (primaryItems.length > NAV_MAX_PRIMARY) {
    spilled = primaryItems.slice(NAV_MAX_PRIMARY);
    primaryItems = primaryItems.slice(0, NAV_MAX_PRIMARY);
  }
  const overflow = spilled.concat(overflowItems);

  const tabs = primaryItems.map((i) => tab(i));

  // Overflow destinations also render inline: shown on desktop's vertical
  // sidebar (room for all), hidden on mobile where they live behind "More".
  overflow.forEach((i) => tabs.push(tab(i, { overflow: true })));

  if (overflow.length) {
    const moreActive = overflow.some((i) => i.id === active);
    tabs.push(
      tab({ id: '__more', icon: 'ellipsis', label: 'More' }, { more: true, active: moreActive })
    );
  }

  const children = [h('nav', { class: 'gb-nav', 'aria-label': 'Primary' }, ...tabs)];

  if (moreOpen && overflow.length) {
    children.push(
      h('div', {
        class: 'gb-more-backdrop',
        onclick: () => onMore && onMore(),
      }),
      h(
        'div',
        // A labelled group of plain buttons, not role=menu: a menu promises
        // arrow-key movement and menuitem children, and this had neither. app.js
        // moves focus into it on open (repaintOverlays).
        { class: 'gb-more-sheet', role: 'group', 'aria-label': 'More destinations' },
        ...moreSections(overflow, active, onNav)
      )
    );
  }

  // Wrap so the More sheet can anchor above the bar.
  return h('div', { class: 'gb-nav-wrap' }, ...children);
}

/* ---- Time formatting ----
   One formatter for the whole app. There were four: two hand-rolled AM/PM
   copies (calendar and dashboard), a locale-dependent toLocaleTimeString that
   read 12h or 24h depending on the device, and two places printing the raw
   `HH:MM` the server stores. So the same reminder read "7:30 PM" on one screen
   and "19:30" on another.

   The preference is always '12' or '24' — there is no "follow the device" any
   more. The device gets exactly one say: on the first load of an account,
   detectTimeFormat() reads it and app.js writes the answer into ui_prefs. Every
   load after that takes it from the server, so one account reads the same way on
   a phone and on a laptop whose locales disagree. */
let timePref = null;

/** This device's own 12/24 habit, as '12' or '24'. First run only. */
function detectTimeFormat() {
  try {
    const o = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    if (typeof o.hour12 === 'boolean') return o.hour12 ? '12' : '24';
    // Some engines fill in hourCycle and leave hour12 undefined.
    if (o.hourCycle) return o.hourCycle === 'h11' || o.hourCycle === 'h12' ? '12' : '24';
  } catch (_) {
    /* no Intl worth trusting */
  }
  return '12';
}

/* Anything that isn't '12' or '24' — nothing stored yet, or the 'auto' an older
   account still carries — resolves against the device right here, so no screen
   ever paints in an undecided state while the write to ui_prefs is in flight. */
function setTimeFormat(pref) {
  timePref = pref === '12' || pref === '24' ? pref : detectTimeFormat();
}

function timeFormat() {
  return timePref || (timePref = detectTimeFormat());
}

/** Accepts 'HH:MM', 'HH:MM:SS', a Date, an ISO string, or epoch millis. */
function formatTime(value, fallback = '') {
  if (value == null || value === '') return fallback;
  let date;
  const asText = String(value);
  const hhmm = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(asText);
  if (hhmm) {
    date = new Date();
    date.setHours(Number(hhmm[1]), Number(hhmm[2]), 0, 0);
  } else {
    date = value instanceof Date ? value : new Date(value);
  }
  if (Number.isNaN(date.getTime())) return fallback;
  // hourCycle rather than `hour12: false` for the 24h case: the two cannot be
  // combined (hour12 wins and hourCycle is dropped), and hour12:false alone
  // leaves the cycle to the locale — which on en-US used to mean h24, printing
  // midnight as "24:00". h23 is the one that says 00:00.
  const opts =
    timeFormat() === '12'
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    return date.toLocaleTimeString(undefined, opts);
  } catch (_) {
    return fallback;
  }
}

/* ---- The overlay every dialog shares ----
   The backdrop, click-outside-to-close, the mount, the open/close transition
   and the teardown. Fourteen dialogs used to carry their own copy of these
   eighteen lines, and they disagreed: some forgot the scroll body, some the
   dismiss, one forgot aria-modal and fell out of a11y.js entirely.

   Returns the empty `.gb-modal` to fill and the `close` it answers to. Callers
   wanting the ordinary title / body / primary / cancel layout want `openModal`
   below, which is built on this. */
/* Every overlay currently on screen, as { close, dismiss }, so navigation can
   drop them — see closeOverlays() below. Both are kept because they are not
   interchangeable: `close` abandons the sheet, `dismiss` is the caller's "this
   is a way out, not a cancel" path. */
const liveOverlays = new Set();

/* ---- Back closes the sheet, not the screen behind it ----
   Android's back button is the WebView's history.back(), and so is the
   browser's. With nothing in history for a sheet, back either left the screen
   (hashchange -> setScreen, which then dropped the sheet with it) or, on Home
   with no history at all, closed the app with a half-filled form still up.

   While any overlay is open there is ONE extra entry on top, at the same URL
   (so no hashchange). Back pops it and closes the top sheet; a sheet closed
   any other way takes the entry back off. One entry for the whole stack rather
   than one per sheet: danger -> confirm and Quick add -> Task close one sheet
   and open the next in the same tick, and a back() racing a pushState is the
   thing that loses track of which entry is which.

   Deferred a tick so those close-then-open pairs coalesce, and so setScreen's
   own pushState lands first: by then the top entry is the new screen's, not
   ours, and it is left alone. The dead sheet entry under it just reads as the
   old screen again. */
let sheetBackPending = false;
let sheetSyncQueued = false;

function syncSheetHistory() {
  if (sheetSyncQueued) return;
  sheetSyncQueued = true;
  setTimeout(() => {
    sheetSyncQueued = false;
    if (sheetBackPending) return; // popstate re-syncs once that back() lands
    const ours = !!(history.state && history.state.gbSheet);
    if (liveOverlays.size && !ours) {
      history.pushState({ gbSheet: true }, '');
    } else if (!liveOverlays.size && ours) {
      sheetBackPending = true;
      history.back();
    }
  }, 0);
}

if (typeof window !== 'undefined') {
  // A reload keeps history.state: an entry we can't own any more would make
  // the first sheet's close step back off the page.
  if (history.state && history.state.gbSheet) history.replaceState(null, '');
  window.addEventListener('popstate', () => {
    if (sheetBackPending) {
      sheetBackPending = false;
      syncSheetHistory();
      return;
    }
    if (history.state && history.state.gbSheet) return; // forward onto our entry
    const top = [...liveOverlays].pop();
    if (!top) return;
    if (top.dismiss) top.dismiss();
    else top.close();
    syncSheetHistory(); // a sheet still under it gets its own entry back
  });

  // Android's hardware back. The App plugin lives in ../Growth-Buddy-Mobile, so
  // there's no JS package to import; the native bridge's own addListener reaches
  // it (the same door native.js uses for promise calls). With a listener
  // registered the plugin does nothing by itself, so back has to be routed here:
  // history.back() lands on the popstate above and closes the top sheet, or
  // steps back a screen. At the root, minimise rather than kill the app.
  const cap = window.Capacitor;
  if (cap && typeof cap.addListener === 'function' && cap.isNativePlatform?.()) {
    cap.addListener('App', 'backButton', (ev) => {
      if (ev && ev.canGoBack) history.back();
      else cap.nativePromise('App', 'minimizeApp', {}).catch(() => {});
    });
  }
}

function openOverlay({ label, className, role = 'dialog', onClose, onDismiss } = {}) {
  let closed = false;
  const sheet = h('div', {
    class: 'gb-modal' + (className ? ' ' + className : ''),
    role,
    'aria-modal': 'true',
    'aria-label': label,
  });
  const entry = { close, dismiss: onDismiss };
  function close() {
    if (closed) return;
    closed = true;
    liveOverlays.delete(entry);
    if (vv) vv.removeEventListener('resize', fitViewport);
    overlay.classList.remove('is-open');
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 180);
    syncSheetHistory();
    if (onClose) onClose();
  }
  const overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      // a11y.js drives Escape by dispatching a click here, so this one handler
      // is both the backdrop tap and the keyboard close.
      //
      // `onDismiss` takes over that path for a sheet where leaving is not the
      // same as abandoning — the note editor commits instead of discarding. It
      // owns the close from there, so it can keep the sheet up if the save
      // fails rather than dropping the text on the floor.
      // A click lands on the common ancestor of press and release, so a text
      // selection dragged out of the sheet and let go over the backdrop read as
      // a backdrop tap and threw the dialog away. A real click only counts when
      // the press began on the backdrop too; a11y.js's Escape click is
      // synthetic (untrusted) and has no press, so it still closes.
      onpointerdown: (e) => {
        pressedBackdrop = e.target === overlay;
      },
      onclick: (e) => {
        if (e.target !== overlay) return;
        if (e.isTrusted && !pressedBackdrop) return;
        if (onDismiss) onDismiss();
        else close();
      },
    },
    sheet
  );
  let pressedBackdrop = false;

  // The iOS keyboard (and Chrome's, by default) shrinks the visual viewport but
  // not the layout one this fixed overlay is sized to, so a tall sheet stayed
  // centred behind the keyboard with Save under it. Pin the overlay to what is
  // actually visible (the sheet's max-height follows it), and bring the focused
  // field back into view once the keyboard has settled. Where the WebView
  // resizes the layout viewport itself (Capacitor Android), nothing is covered
  // and this does nothing. Not interactive-widget=resizes-content: that would
  // also lift the bottom nav onto the keyboard on every screen.
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  function fitViewport() {
    const covered = vv && window.innerHeight - vv.height > 1;
    overlay.style.top = covered ? vv.offsetTop + 'px' : '';
    overlay.style.height = covered ? vv.height + 'px' : '';
    const f = document.activeElement;
    if (covered && f && sheet.contains(f)) f.scrollIntoView({ block: 'nearest' });
  }
  if (vv) vv.addEventListener('resize', fitViewport);
  sheet.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!t.matches || !t.matches('input, textarea, select, [contenteditable]')) return;
    setTimeout(() => {
      if (document.activeElement === t) t.scrollIntoView({ block: 'nearest' });
    }, 300);
  });
  document.body.appendChild(overlay);
  liveOverlays.add(entry);
  syncSheetHistory();
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  // No refreshIcons() here: the sheet is empty until the caller fills it, so
  // there is nothing to swap. Callers that draw icons call it after appending.
  return { overlay, sheet, close };
}

/* Enter / Go in a single-line field submits, as it would in a <form>. Not a
   real <form>: a11y.js keys off .gb-modal-overlay > .gb-modal, and callers'
   bodies hold their own buttons that would all turn into submits. Textareas
   and contenteditable aren't INPUTs, so they keep their newlines. Exported for
   the sheets that build their own footer on openOverlay (reminder edit, the
   note sheet): without it, Enter did nothing there. */
function submitOnEnter(sheet, primaryBtn) {
  sheet.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || t.tagName !== 'INPUT') return;
    if (/^(button|submit|reset|checkbox|radio|file|color|range)$/.test(t.type)) return;
    e.preventDefault();
    if (!primaryBtn.disabled) primaryBtn.click();
  });
}

/* A surface that isn't an openOverlay sheet (Family's panels) joining the same
   back stack: back closes it like a sheet, and closeOverlays() drops it on
   navigation. Returns the untrack, which the surface calls from its own close
   — so the history entry comes off whichever way it was shut. */
function trackOverlay({ close }) {
  const entry = { close };
  liveOverlays.add(entry);
  syncSheetHistory();
  return () => {
    if (liveOverlays.delete(entry)) syncSheetHistory();
  };
}

/* A dialog belongs to the screen that opened it. setScreen() calls this, next
   to the notif/profile/more panels it already drops on navigation: a button
   that both navigates and leaves its own sheet up — notes' "Add a reminder",
   which hands the text to the calendar — stranded the sheet on top of a screen
   it had nothing to do with, hiding the very form it had just filled in.

   Through `dismiss` when the sheet has one, for the same reason the backdrop
   does: navigating away from a note is leaving it, not discarding it, and going
   straight to close() threw away the edit — on the one button ("Add a
   reminder") that navigates FROM the note editor, which is exactly the case
   this function exists for.

   Snapshot the set first: each close() removes its own entry from it. */
function closeOverlays() {
  [...liveOverlays].forEach((entry) => (entry.dismiss ? entry.dismiss() : entry.close()));
}

/* ---- The standard dialog ----
   Title, optional sub, a scrolling body, a full-width primary, an optional
   destructive action under it, and a dismiss. app.js, money.js and goals.js
   each had their own byte-identical copy of this; the only real differences
   were the error message and whether the app re-rendered afterwards, which are
   both arguments now.

   `onPrimary` may throw: the sheet shakes, the message is toasted, and the
   button comes back enabled so the value can be corrected in place. */
function openModal({
  title,
  sub,
  body,
  primary,
  onPrimary,
  danger,
  dismiss,
  modalClass,
  errorMessage = 'Something went wrong.',
  afterPrimary,
}) {
  const { sheet, close } = openOverlay({ label: title, className: modalClass });

  const primaryBtn = primary
    ? h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--primary',
          style: { width: '100%', marginTop: '14px' },
          onclick: async () => {
            // A slow save showed a dead, disabled button with no word on it.
            // Past 300ms it says so; a quick one never flickers.
            let undoBusy = null;
            const slow = setTimeout(() => (undoBusy = setThinking(primaryBtn, 'Saving')), 300);
            try {
              primaryBtn.disabled = true;
              await onPrimary();
              clearTimeout(slow);
              close();
              if (afterPrimary) afterPrimary();
            } catch (err) {
              clearTimeout(slow);
              if (undoBusy) undoBusy();
              primaryBtn.disabled = false;
              // The modal refused what you gave it, so the modal is what shakes
              // — the same head-shake the sign-in card does.
              shakeRefusal(sheet);
              // The complaint is about what was typed, so it goes as soon as
              // the user starts fixing it rather than sitting over the fix.
              const id = toast.error(err, errorMessage);
              sheet.addEventListener('input', () => toast.dismiss(id), { once: true });
            }
          },
        },
        primary
      )
    : null;

  // Destructive action, under the primary: close first, so what it opens (a
  // confirm) isn't stacked on a sheet still showing the thing being deleted.
  const dangerBtn = danger
    ? h(
        'button',
        {
          type: 'button',
          class: 'gb-btn gb-btn--danger',
          style: { width: '100%', marginTop: '8px' },
          onclick: () => {
            close();
            danger.onClick();
          },
        },
        danger.label
      )
    : null;

  if (primaryBtn) submitOnEnter(sheet, primaryBtn);

  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, title),
      sub ? h('div', { class: 'gb-modal-sub' }, sub) : null
    ),
    h('div', { class: 'gb-modal-body' }, body),
    ...[primaryBtn, dangerBtn].filter(Boolean),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: close },
      dismiss || (primary ? 'Cancel' : 'Close')
    )
  );
  refreshIcons();
  return close;
}

/* A surface refusing what it was given: one head-shake, one short buzz. Lives
   here because every dialog's primary uses it and the sign-in card does too. */
function shakeRefusal(el) {
  if (!el) return;
  el.classList.remove('gb-shake');
  void el.offsetWidth; // restart the animation when the same surface fails twice
  el.classList.add('gb-shake');
  el.addEventListener('animationend', () => el.classList.remove('gb-shake'), { once: true });
  try {
    if (navigator.vibrate) navigator.vibrate([14, 70, 14]);
  } catch (_) {}
}

/* The other half of shakeRefusal: something just saved lands where it now
   lives. It drops in and settles while a brand ring fades, with one short tap.
   The toast says it worked; this shows where it went. */
function landed(el) {
  if (!el) return;
  // A row below the fold landed where nobody saw it: bring it into view, but
  // only when it is out of view, so a visible one never makes the page jump.
  const r = el.getBoundingClientRect();
  if (r.bottom > window.innerHeight || r.top < 0) {
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }
  el.classList.remove('gb-landed');
  void el.offsetWidth; // replay when the same row lands twice
  el.classList.add('gb-landed');
  const done = (e) => {
    if (e.target !== el) return; // a child's own animation ending
    el.classList.remove('gb-landed');
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
  try {
    if (navigator.vibrate) navigator.vibrate(10);
  } catch (_) {}
}

/* Something deleted leaves visibly instead of blinking out. Resolves once it
   has gone, so the caller drops it from the list then. The timeout covers a
   background tab, where animationend never fires. */
function leave(el) {
  if (!el || !el.isConnected) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (e) => {
      if (e && e.target !== el) return;
      el.removeEventListener('animationend', done);
      resolve();
    };
    el.addEventListener('animationend', done);
    setTimeout(done, 400);
    el.classList.add('gb-leaving');
  });
}

/* ---- Confirm dialog ----
   Replaces window.confirm: the buttons carry the verbs ("Remove" / "Keep")
   so the choice reads at a glance instead of mapping OK/Cancel to a question.
   Cancel gets focus by default — Enter never destroys anything by accident. */
function confirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    // Dismissing any way that isn't the confirm button answers false, which is
    // what the backdrop tap and Escape both come through as.
    const { sheet, close: dismiss } = openOverlay({
      label: title,
      role: 'alertdialog',
      onClose: () => resolve(false),
    });
    function close(result) {
      if (result) resolve(true);
      dismiss();
    }
    const confirmBtn = h(
      'button',
      {
        type: 'button',
        class: 'gb-btn ' + (danger ? 'gb-btn--danger' : 'gb-btn--primary'),
        style: { width: '100%', marginTop: '14px' },
        onclick: () => close(true),
      },
      confirmLabel
    );
    const cancelBtn = h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: dismiss },
      cancelLabel
    );
    sheet.append(
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, title),
        message ? h('div', { class: 'gb-modal-sub' }, message) : null
      ),
      confirmBtn,
      cancelBtn
    );
    cancelBtn.focus();
  });
}

/* ---- Logo (inline SVG, theme-aware) ---- */
/* `alive: true` returns the same mark wired for motion — the seedling in the
   header that settles, perks up and shakes its head. It's the brand mark, not
   a second mascot, so the thing you meet on the login screen is the thing that
   reacts to you all day. Decorative there (the greeting carries the name), so
   it drops the img role. Motion lives in styles/premium.css. */
function Logo({ size = 48, radius = 14, alive = false } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 64 64');
  if (alive) {
    svg.setAttribute('class', 'gb-sprout');
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Growth Buddy');
  }
  svg.style.borderRadius = radius + 'px';
  // The alive variant leaves `display` to CSS — an inline value would outrank
  // the stylesheet and leak the seedling into the classic skin.
  if (!alive) svg.style.display = 'block';
  svg.style.flex = 'none';

  const make = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  svg.appendChild(make('rect', { width: '64', height: '64', rx: '18', fill: 'var(--brand)' }));
  svg.appendChild(
    make('path', { d: 'M32 48V30', stroke: '#fff', 'stroke-width': '5', 'stroke-linecap': 'round' })
  );
  svg.appendChild(
    make('path', { d: 'M32 33C24 33 17.5 27 18.5 17.5C28 16.5 34 23 32 33Z', fill: '#fff' })
  );
  svg.appendChild(
    make('path', {
      d: 'M32 30C40 30 46.5 24 45.5 14.5C36 13.5 30 20 32 30Z',
      fill: 'var(--sun-300)',
    })
  );
  return svg;
}

/* ---- App header ---- */
// Theme and the premium skin used to sit here as two more icon buttons. They
// are preferences, not daily actions — they live in Settings → Display now, so
// the bar holds only what you reach for while using the app.
function AppHeader({ label, name, userName, onAccount, unreadCount, onBell, onAdd } = {}) {
  const bellChildren = [Icon('bell', { size: 20 })];
  if (unreadCount > 0) {
    bellChildren.push(
      h('span', { class: 'gb-bell-badge' }, unreadCount > 99 ? '99+' : String(unreadCount))
    );
  }
  return h(
    'header',
    { class: 'gb-head' },
    // Always in the DOM, shown by CSS in premium only — so the skin stays a
    // stylesheet rather than a JS fork. See styles/premium.css §9.
    Logo({ size: 38, radius: 12, alive: true }),
    h(
      'div',
      null,
      label ? h('div', { class: 'greet-label' }, label) : null,
      // The screen's one <h1>: every screen named itself only here, in a div,
      // so a screen reader's heading list started at the first card.
      h('h1', { class: 'greet-name' }, name)
    ),
    h(
      'div',
      { class: 'gb-head-actions' },
      onAdd
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-iconbtn',
              'aria-label': 'Quick add',
              onclick: onAdd,
            },
            Icon('plus', { size: 20 })
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          class: 'gb-iconbtn gb-bell',
          'aria-label': 'Notifications',
          onclick: onBell,
        },
        bellChildren
      ),
      Avatar({
        name: userName || 'Buddy',
        bg: 'var(--coral-100)',
        fg: 'var(--coral-800)', // coral-700 is 4.1:1 on coral-100; 800 is 6.0
        onClick: onAccount,
      }),
      // The notification and profile panels render into these, filled by
      // `repaintOverlays()` in app.js. They live here rather than at the app
      // root so the panels are positioned by the row the bell and the avatar
      // are actually in — a header offset can't drift away from them any more.
      // Both are 0×0 until filled, so the row's layout is unchanged.
      h('div', { id: 'gb-notif-slot' }),
      h('div', { id: 'gb-profile-slot' })
    )
  );
}

/* Friendly full-screen error state — a woozy little mascot + warm copy, no raw
   status codes. Shared so every screen shows the same on-brand failure UI. */
function CrashCard(onRetry) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 160 160');
  svg.setAttribute('class', 'gb-crash-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <g class="gb-crash-stars" fill="none" stroke="var(--warning)" stroke-width="4" stroke-linecap="round">
      <path d="M120 30 l0 10 M115 35 l10 0"/>
      <path d="M136 48 l0 8 M132 52 l8 0"/>
      <path d="M30 44 l0 8 M26 48 l8 0"/>
    </g>
    <rect x="34" y="42" width="92" height="82" rx="26"
          fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="4"/>
    <line x1="80" y1="42" x2="80" y2="26" stroke="var(--brand)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="80" cy="22" r="5" fill="var(--brand)"/>
    <g fill="none" stroke="var(--brand-soft-fg)" stroke-width="3.5" stroke-linecap="round">
      <path d="M62 74 a7 7 0 1 1 -6 -6 a4 4 0 1 1 3 3.5"/>
      <path d="M98 74 a7 7 0 1 1 -6 -6 a4 4 0 1 1 3 3.5"/>
    </g>
    <path d="M64 98 q8 -8 16 0 q8 8 16 0" fill="none"
          stroke="var(--brand-soft-fg)" stroke-width="4" stroke-linecap="round"/>
    <path d="M18 138 q14 -14 30 -8" fill="none" stroke="var(--fg3)" stroke-width="5" stroke-linecap="round"/>
    <path d="M142 138 q-14 -14 -30 -8" fill="none" stroke="var(--fg3)" stroke-width="5" stroke-linecap="round"/>
    <rect x="46" y="126" width="10" height="10" rx="2" fill="var(--fg3)"/>
    <rect x="104" y="126" width="10" height="10" rx="2" fill="var(--fg3)"/>
  `;
  return h(
    'div',
    { class: 'gb-placeholder gb-rise gb-crash' },
    svg,
    h('h2', null, 'That didn’t go through'),
    h('p', null, "We couldn't reach your data just now. Check your connection and give it another go."),
    h(
      'button',
      { type: 'button', class: 'gb-btn gb-btn--primary', style: { marginTop: '6px', maxWidth: '260px' }, onclick: onRetry },
      'Try again'
    )
  );
}

/* ---- Buddy is thinking (app.css "Buddy is thinking") ----
   thinkingLabel() is a busy AI button's content, under .is-thinking.
   setThinking() puts a live button into that state and returns the undo.
   Thinking() stands in for an AI answer while it is written: always three
   steps, because the CSS shows each for a third of a 7.5s cycle. */
function thinkingLabel(text) {
  return [
    h('span', { class: 'gb-think-spark' }, Icon('sparkles', { size: 16, sw: 2.4 })),
    h('span', null, text),
    h(
      'span',
      { class: 'gb-think-dots', 'aria-hidden': 'true' },
      h('i', null),
      h('i', null),
      h('i', null)
    ),
  ];
}

function setThinking(btn, text) {
  const kids = [...btn.childNodes];
  btn.disabled = true;
  btn.classList.add('is-thinking');
  btn.replaceChildren(...thinkingLabel(text));
  return () => {
    btn.disabled = false;
    btn.classList.remove('is-thinking');
    btn.replaceChildren(...kids);
  };
}

function Thinking(label, steps) {
  return h(
    'div',
    { class: 'gb-thinking', role: 'status' },
    h('span', { class: 'gb-think-sr' }, label),
    h(
      'div',
      { class: 'gb-think-orb', 'aria-hidden': 'true' },
      Icon('sparkles', { size: 20, sw: 2.2 })
    ),
    h(
      'div',
      { class: 'gb-think-body', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'gb-think-steps' },
        steps.map((s) => h('span', null, s))
      ),
      h('div', { class: 'gb-think-lines' }, h('i', null), h('i', null), h('i', null))
    )
  );
}

export {
  h,
  activate,
  trackOverlay,
  submitOnEnter,
  thinkingLabel,
  setThinking,
  Thinking,
  refreshIcons,
  DOMAIN,
  plural,
  Icon,
  IconChip,
  Pill,
  Card,
  SectionTitle,
  ProgressRing,
  Check,
  Avatar,
  BottomNav,
  NAV_CATALOG,
  resolveNavLayout,
  AppHeader,
  CrashCard,
  Logo,
  confirmDialog,
  openOverlay,
  closeOverlays,
  openModal,
  shakeRefusal,
  landed,
  leave,
  formatTime,
  setTimeFormat,
  timeFormat,
  detectTimeFormat,
};
