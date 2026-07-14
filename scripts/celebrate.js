/* =====================================================================
   Growth Buddy — Achievement celebration
   A big, one-off "you earned it" moment: a badge that pops in over a
   burst of confetti. Fired only the first time an achievement unlocks
   (see checkAchievements in app.js). Self-contained — no confetti lib.
   Respects prefers-reduced-motion (shows the card, skips the confetti).
   ===================================================================== */
import { h, Icon } from './gb-kit.js';

const CONFETTI_COLORS = [
  'var(--coral-500)',
  'var(--leaf-500)',
  'var(--sun-500)',
  'var(--iris-500)',
  'var(--sky-500)',
  'var(--bloom-500)',
];

// One at a time: if several unlock together, show them in sequence.
const queue = [];
let showing = false;

export function celebrate(achievement) {
  if (!achievement) return;
  queue.push(achievement);
  if (!showing) showNext();
}

function showNext() {
  const ach = queue.shift();
  if (!ach) {
    showing = false;
    return;
  }
  showing = true;
  show(ach, showNext);
}

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function confettiLayer() {
  const layer = h('div', { class: 'gb-confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 46; i++) {
    const bit = document.createElement('span');
    bit.className = 'gb-confetti-bit';
    bit.style.left = Math.round(Math.random() * 100) + '%';
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.animationDelay = (Math.random() * 0.45).toFixed(2) + 's';
    bit.style.animationDuration = (1.5 + Math.random() * 1.3).toFixed(2) + 's';
    // Horizontal drift + spin, set per-bit so the burst looks scattered.
    bit.style.setProperty('--x', Math.round((Math.random() * 2 - 1) * 180) + 'px');
    bit.style.setProperty('--r', Math.round(Math.random() * 900 - 200) + 'deg');
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    layer.appendChild(bit);
  }
  return layer;
}

function show(ach, done) {
  const tierLabel = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }[ach.tier] || '';
  let closed = false;

  const overlay = h('div', {
    class: 'gb-celebrate',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Achievement unlocked: ' + ach.title,
  });

  if (!prefersReducedMotion()) overlay.appendChild(confettiLayer());

  const nice = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => close() },
    'Nice!'
  );

  const card = h(
    'div',
    { class: 'gb-celebrate-card' },
    h('div', { class: 'gb-celebrate-badge' }, Icon(ach.icon || 'award', { size: 40, sw: 2 })),
    h('div', { class: 'gb-celebrate-kicker' }, 'Achievement unlocked'),
    h('div', { class: 'gb-celebrate-title' }, ach.title),
    h('div', { class: 'gb-celebrate-desc' }, ach.desc + (tierLabel ? ' · ' + tierLabel : '')),
    nice
  );
  overlay.appendChild(card);

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('is-leaving');
    setTimeout(() => {
      overlay.remove();
      done();
    }, 240);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  requestAnimationFrame(() => nice.focus());
}
