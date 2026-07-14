/* =====================================================================
   Growth Buddy — UI primitives (vanilla JS)
   Element-returning factories, exported as ES module bindings.
   ===================================================================== */
import { createIcons } from 'lucide';
import { icons } from './icons.js';

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
    action ? h('a', { onclick: onAction, role: 'button', tabindex: '0' }, action) : null
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
function Check({ done = false, onToggle, color } = {}) {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'gb-check' + (done ? ' is-done' : ''),
      'aria-pressed': String(!!done),
      'aria-label': done ? 'Mark as not done' : 'Mark as done',
      style: done && color ? { background: color, boxShadow: '0 2px 0 ' + color } : null,
      onclick: () => {
        if (!btn.classList.contains('is-done')) {
          btn.classList.add('just-popped');
          setTimeout(() => btn.classList.remove('just-popped'), 420);
        }
        onToggle && onToggle();
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
  { id: 'habits', icon: 'repeat', label: 'Habits', feature: 'habits' },
  // Labels match each screen's own header, so the tab name and the page
  // title never disagree ("Mentor" used to open a screen called "Buddy").
  { id: 'mentor', icon: 'sparkles', label: 'Buddy', feature: 'mentor' },
  { id: 'report', icon: 'chart-column', label: 'Progress', feature: 'report' },
];
const NAV_OVERFLOW = [
  { id: 'calendar', icon: 'calendar-days', label: 'Calendar', feature: 'calendar' },
  { id: 'focus', icon: 'timer', label: 'Timer', feature: 'focus' },
  { id: 'goals', icon: 'target', label: 'Goals', feature: 'goals' },
  { id: 'food', icon: 'utensils-crossed', label: 'Food', feature: 'food|water' },
  { id: 'money', icon: 'wallet', label: 'Money', feature: 'money' },
  { id: 'circle', icon: 'users-round', label: 'Circle', feature: 'circle' },
  { id: 'family', icon: 'users', label: 'Family', feature: 'family' },
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
        'aria-current': active === item.id ? 'page' : null,
        'aria-haspopup': opts && opts.more ? 'true' : null,
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
        { class: 'gb-more-sheet', role: 'menu', 'aria-label': 'More destinations' },
        h(
          'div',
          { class: 'gb-more-grid' },
          overflow.map((i) =>
            h(
              'button',
              {
                type: 'button',
                role: 'menuitem',
                class: 'gb-more-item' + (active === i.id ? ' is-active' : ''),
                onclick: () => onNav && onNav(i.id),
              },
              h('span', { class: 'gb-more-item-ic' }, Icon(i.icon, { size: 22, sw: 2.2 })),
              h('span', null, i.label)
            )
          )
        )
      )
    );
  }

  // Wrap so the More sheet can anchor above the bar.
  return h('div', { class: 'gb-nav-wrap' }, ...children);
}

/* ---- Confirm dialog ----
   Replaces window.confirm: the buttons carry the verbs ("Remove" / "Keep")
   so the choice reads at a glance instead of mapping OK/Cancel to a question.
   Cancel gets focus by default — Enter never destroys anything by accident. */
function confirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    function close(result) {
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 180);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
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
      { type: 'button', class: 'gb-btn gb-btn--ghost gb-modal-cancel', onclick: () => close(false) },
      cancelLabel
    );
    const sheet = h(
      'div',
      { class: 'gb-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'gb-modal-head' },
        h('div', { class: 'gb-modal-title' }, title),
        message ? h('div', { class: 'gb-modal-sub' }, message) : null
      ),
      confirmBtn,
      cancelBtn
    );
    const overlay = h(
      'div',
      {
        class: 'gb-modal-overlay',
        onclick: (e) => {
          if (e.target === overlay) close(false);
        },
      },
      sheet
    );
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    cancelBtn.focus();
  });
}

/* ---- Google "G" mark (inline SVG string; set via innerHTML) ----
   Used wherever synced Google Calendar content needs to be recognizable at a
   glance — the settings integration card and calendar event pills. */
const GOOGLE_G_SVG =
  '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

/* ---- Logo (inline SVG, theme-aware) ---- */
function Logo({ size = 48, radius = 14 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Growth Buddy');
  svg.style.borderRadius = radius + 'px';
  svg.style.display = 'block';
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
function AppHeader({
  label,
  name,
  userName,
  theme,
  onTheme,
  onAccount,
  unreadCount,
  onBell,
  onAdd,
} = {}) {
  const bellChildren = [Icon('bell', { size: 20 })];
  if (unreadCount > 0) {
    bellChildren.push(
      h('span', { class: 'gb-bell-badge' }, unreadCount > 99 ? '99+' : String(unreadCount))
    );
  }
  return h(
    'header',
    { class: 'gb-head' },
    h(
      'div',
      null,
      label ? h('div', { class: 'greet-label' }, label) : null,
      h('div', { class: 'greet-name' }, name)
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
          class: 'gb-iconbtn',
          'aria-label': 'Toggle theme',
          onclick: onTheme,
        },
        Icon(theme === 'dark' ? 'sun' : 'moon', { size: 20 })
      ),
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
        fg: 'var(--coral-700)',
        onClick: onAccount,
      })
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

export {
  h,
  activate,
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
  GOOGLE_G_SVG,
  confirmDialog,
};
