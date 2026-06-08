/* =====================================================================
   Growth Buddy — UI primitives (vanilla JS)
   Exposes a `GB` namespace on window with element-returning factories.
   ===================================================================== */
(function () {
  'use strict';

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
          try { el[k] = v; } catch (_) { el.setAttribute(k, String(v)); }
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
      if (Array.isArray(c)) { appendChildren(parent, c); continue; }
      if (c instanceof Node) { parent.appendChild(c); continue; }
      parent.appendChild(document.createTextNode(String(c)));
    }
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
        try { window.lucide.createIcons(); } catch (_) { /* noop */ }
      }
    });
  }

  function Icon(name, { size = 20, sw = 2, color, style, className } = {}) {
    const wrap = h('span', {
      class: 'gb-icon' + (className ? ' ' + className : ''),
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
    habit:   { bg: 'var(--leaf-50)',  fg: 'var(--leaf-600)',  icon: 'repeat' },
    fitness: { bg: 'var(--coral-50)', fg: 'var(--coral-600)', icon: 'dumbbell' },
    ai:      { bg: 'var(--iris-50)',  fg: 'var(--iris-600)',  icon: 'sparkles' },
    journal: { bg: 'var(--sky-50)',   fg: 'var(--sky-600)',   icon: 'notebook-pen' },
    social:  { bg: 'var(--bloom-50)', fg: 'var(--bloom-600)', icon: 'users-round' },
    reward:  { bg: 'var(--sun-50)',   fg: 'var(--sun-700)',   icon: 'trophy' },
    study:   { bg: 'var(--iris-50)',  fg: 'var(--iris-600)',  icon: 'book-open' },
    career:  { bg: 'var(--sky-50)',   fg: 'var(--sky-600)',   icon: 'briefcase' },
  };

  function IconChip({ domain = 'habit', icon, size = 40, iconSize = 20 } = {}) {
    const d = DOMAIN[domain] || DOMAIN.habit;
    return h('div', {
      class: 'gb-iconchip',
      style: { background: d.bg, width: size + 'px', height: size + 'px' },
    }, Icon(icon || d.icon, { size: iconSize, color: d.fg, sw: 2.2 }));
  }

  /* ---- Button ---- */
  function Button({ variant = 'primary', icon, label, onClick, style, type = 'button' } = {}) {
    return h(
      'button',
      {
        type,
        class: 'gb-btn gb-btn--' + variant,
        onclick: onClick,
        style,
      },
      icon ? Icon(icon, { size: 18, sw: 2.4 }) : null,
      label
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
      action
        ? h('a', { onclick: onAction, role: 'button', tabindex: '0' }, action)
        : null
    );
  }

  /* ---- Progress bar ---- */
  function ProgressBar({ value = 0, color = 'var(--brand)', trackStyle, className } = {}) {
    return h(
      'div',
      { class: 'gb-track ' + (className || ''), style: trackStyle },
      h('i', { style: { width: value + '%', background: color } })
    );
  }

  /* ---- Progress ring (SVG) ---- */
  function ProgressRing({ value = 0, size = 96, stroke = 11, color = 'var(--brand)', children } = {}) {
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

    const inner = h(
      'div',
      {
        style: {
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        },
      }
    );
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
  function Avatar({ name = '?', size = 42, bg = 'var(--iris-100)', fg = 'var(--iris-700)', ring, onClick } = {}) {
    const initials = name
      .split(' ')
      .map(w => w[0] || '')
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
          fontSize: (size * 0.36) + 'px',
          border: ring ? '2.5px solid ' + ring : '2px solid var(--surface)',
        },
      },
      initials
    );
  }

  /* ---- Bottom nav ---- */
  function BottomNav({ active, onNav } = {}) {
    const tab = (id, icon, label) =>
      h(
        'button',
        {
          type: 'button',
          class: 'gb-nav-tab' + (active === id ? ' is-active' : ''),
          'aria-current': active === id ? 'page' : null,
          onclick: () => onNav && onNav(id),
        },
        Icon(icon, { size: 23, sw: active === id ? 2.4 : 2 }),
        h('span', null, label)
      );
    return h(
      'nav',
      { class: 'gb-nav', 'aria-label': 'Primary' },
      tab('home', 'house', 'Home'),
      tab('habits', 'repeat', 'Habits'),
      tab('food', 'utensils-crossed', 'Food'),
      tab('goals', 'target', 'Goals'),
      tab('calendar', 'calendar-days', 'Calendar'),
      tab('mentor', 'sparkles', 'Mentor'),
      tab('circle', 'users-round', 'Circle')
    );
  }

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
    svg.appendChild(make('path', { d: 'M32 48V30', stroke: '#fff', 'stroke-width': '5', 'stroke-linecap': 'round' }));
    svg.appendChild(make('path', { d: 'M32 33C24 33 17.5 27 18.5 17.5C28 16.5 34 23 32 33Z', fill: '#fff' }));
    svg.appendChild(make('path', { d: 'M32 30C40 30 46.5 24 45.5 14.5C36 13.5 30 20 32 30Z', fill: 'var(--sun-300)' }));
    return svg;
  }

  /* ---- App header ---- */
  function AppHeader({ label, name, userName, theme, onTheme, onAccount, unreadCount, onBell, onAdd } = {}) {
    const bellChildren = [Icon('bell', { size: 20 })];
    if (unreadCount > 0) {
      bellChildren.push(h('span', { class: 'gb-bell-badge' }, unreadCount > 99 ? '99+' : String(unreadCount)));
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
        onAdd ? h(
          'button',
          {
            type: 'button',
            class: 'gb-iconbtn',
            'aria-label': 'Quick add',
            onclick: onAdd,
          },
          Icon('plus', { size: 20 })
        ) : null,
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

  window.GB = {
    h, refreshIcons, DOMAIN,
    Icon, IconChip, Button, Pill, Card, SectionTitle,
    ProgressBar, ProgressRing, Check, Avatar,
    BottomNav, AppHeader, Logo,
  };
})();
