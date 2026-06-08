/* =====================================================================
   Growth Buddy — Study (Pomodoro) timer widget
   Owns its own DOM and updates in place every second so the dashboard
   around it doesn't re-render on every tick.
   ===================================================================== */
(function () {
  'use strict';

  const { h, Icon, Card, ProgressRing } = window.GB;

  const T = {
    mode: 'focus',
    durationSec: 25 * 60,
    remainingSec: 25 * 60,
    running: false,
    intervalId: null,
    // Live DOM refs.
    refs: null,
  };

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function fmt(s) { return pad(Math.floor(s / 60)) + ':' + pad(s % 60); }

  function paintRing() {
    if (!T.refs) return;
    const pct = T.durationSec ? Math.max(0, Math.min(100, (1 - T.remainingSec / T.durationSec) * 100)) : 0;
    const r = T.refs.r, c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    T.refs.ringFg.setAttribute('stroke-dashoffset', String(off));
    T.refs.ringFg.setAttribute('stroke', T.mode === 'focus' ? 'var(--iris-500)' : 'var(--leaf-500)');
    T.refs.timeEl.textContent = fmt(T.remainingSec);
    T.refs.modeEl.textContent = T.mode;
    T.refs.subEl.textContent = T.running ? 'In session — keep going.' : 'Start a study sprint.';
    T.refs.startBtn.textContent = '';
    T.refs.startBtn.append(
      T.running
        ? Icon('pause', { size: 16, sw: 2.4 })
        : Icon('play',  { size: 16, sw: 2.4 }),
      document.createTextNode(T.running ? 'Pause' : 'Start')
    );
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch (_) {}
    }
    // Highlight active mode chip.
    Object.keys(T.refs.chips).forEach(k => {
      T.refs.chips[k].classList.toggle('is-on', k === T.mode + ':' + (T.durationSec / 60));
    });
  }

  function setMode(mode, mins) {
    T.mode = mode;
    T.durationSec = mins * 60;
    T.remainingSec = T.durationSec;
    T.running = false;
    if (T.intervalId) { clearInterval(T.intervalId); T.intervalId = null; }
    paintRing();
  }

  function start() {
    if (T.running) return;
    T.running = true;
    T.intervalId = setInterval(() => {
      T.remainingSec -= 1;
      if (T.remainingSec <= 0) {
        T.remainingSec = 0;
        T.running = false;
        clearInterval(T.intervalId); T.intervalId = null;
        chime();
      }
      paintRing();
    }, 1000);
    paintRing();
  }

  function pause() {
    if (!T.running) return;
    T.running = false;
    if (T.intervalId) { clearInterval(T.intervalId); T.intervalId = null; }
    paintRing();
  }

  function reset() {
    pause();
    T.remainingSec = T.durationSec;
    paintRing();
  }

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.value = 0.12;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 450);
    } catch (_) { /* silent */ }
  }

  function buildRing(size, stroke) {
    const NS = 'http://www.w3.org/2000/svg';
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.style.transform = 'rotate(-90deg)';
    const bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('cx', size/2); bg.setAttribute('cy', size/2); bg.setAttribute('r', r);
    bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', 'var(--surface-3)');
    bg.setAttribute('stroke-width', stroke);
    svg.appendChild(bg);
    const fg = document.createElementNS(NS, 'circle');
    fg.setAttribute('cx', size/2); fg.setAttribute('cy', size/2); fg.setAttribute('r', r);
    fg.setAttribute('fill', 'none'); fg.setAttribute('stroke', 'var(--iris-500)');
    fg.setAttribute('stroke-width', stroke);
    fg.setAttribute('stroke-linecap', 'round');
    fg.setAttribute('stroke-dasharray', c);
    fg.setAttribute('stroke-dashoffset', 0);
    fg.style.transition = 'stroke-dashoffset 0.4s var(--ease-out, ease)';
    svg.appendChild(fg);
    return { svg, fg, r };
  }

  function TimerWidget() {
    // If this is a re-mount after navigating away and back, reuse running state
    // but rebuild DOM so the new tree contains live references.
    const timeEl = h('span', {
      style: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '22px', color: 'var(--fg1)' },
    }, fmt(T.remainingSec));
    const modeEl = h('span', {
      style: { fontSize: '10px', fontWeight: 700, color: 'var(--fg3)', textTransform: 'uppercase' },
    }, T.mode);

    const ring = buildRing(96, 11);
    const ringWrap = h('div', {
      style: { position: 'relative', width: '96px', height: '96px' },
    });
    ringWrap.appendChild(ring.svg);
    const inner = h('div', {
      style: {
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      },
    }, timeEl, modeEl);
    ringWrap.appendChild(inner);

    function modeChip(label, mode, mins) {
      const key = mode + ':' + mins;
      const btn = h('button', {
        type: 'button',
        class: 'gb-seg' + ((T.mode === mode && T.durationSec === mins * 60) ? ' is-on' : ''),
        onclick: () => setMode(mode, mins),
      }, label);
      btn.dataset.key = key;
      return btn;
    }
    const chipFocus25 = modeChip('25m', 'focus', 25);
    const chipFocus50 = modeChip('50m', 'focus', 50);
    const chipBreak5  = modeChip('Break 5', 'break', 5);
    function openCustomMinutesModal() {
      let overlay;
      const input = h('input', { type: 'number', class: 'gb-input', min: '1', max: '180', step: '1', value: '15' });
      const error = h('div', { class: 'gb-water-prompt-error', 'aria-live': 'polite' });
      function close() {
        overlay.classList.remove('is-open');
        setTimeout(() => overlay && overlay.remove(), 180);
      }
      function submit() {
        const m = Math.max(1, Math.min(180, parseInt(input.value, 10) || 0));
        if (!m) {
          error.textContent = 'Enter a number between 1 and 180.';
          return;
        }
        setMode('focus', m);
        close();
      }
      const sheet = h('div', { class: 'gb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Custom focus minutes' },
        h('div', { class: 'gb-modal-head' },
          h('div', { class: 'gb-modal-title' }, 'Custom focus minutes'),
          h('div', { class: 'gb-modal-sub' }, 'Choose any value from 1 to 180 minutes.')
        ),
        h('div', { class: 'gb-modal-body' },
          h('div', { class: 'gb-form' },
            h('div', { class: 'gb-field-label' }, 'Minutes'),
            input,
            error
          )
        ),
        h('div', { class: 'gb-water-prompt-actions' },
          h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel'),
          h('button', { type: 'button', class: 'gb-btn gb-btn--primary', onclick: submit }, 'Use minutes')
        )
      );
      overlay = h('div', { class: 'gb-modal-overlay', onclick: e => { if (e.target === overlay) close(); } }, sheet);
      document.body.appendChild(overlay);
      window.GB.refreshIcons && window.GB.refreshIcons();
      requestAnimationFrame(() => overlay.classList.add('is-open'));
      setTimeout(() => input.focus(), 60);
    }
    const chipCustom  = h('button', {
      type: 'button',
      class: 'gb-seg',
      onclick: openCustomMinutesModal,
    }, 'Custom…');

    const subEl = h('div', { class: 'gb-score-sub' },
      T.running ? 'In session — keep going.' : 'Start a study sprint.');
    const startBtn = h('button', {
      type: 'button',
      class: 'gb-btn ' + (T.running ? 'gb-btn--secondary' : 'gb-btn--primary'),
      onclick: () => (T.running ? pause() : start()),
    }, Icon(T.running ? 'pause' : 'play', { size: 16, sw: 2.4 }),
       document.createTextNode(T.running ? 'Pause' : 'Start'));
    const resetBtn = h('button', {
      type: 'button', class: 'gb-btn gb-btn--ghost', onclick: reset,
    }, Icon('rotate-ccw', { size: 16, sw: 2.4 }), 'Reset');

    // Toggle classes live when running flips.
    function paintStart() {
      startBtn.classList.toggle('gb-btn--primary', !T.running);
      startBtn.classList.toggle('gb-btn--secondary', T.running);
    }
    const paintRingOrig = paintRing;
    // Wrap paintRing to also keep the start button class in sync.
    T.refs = {
      r: ring.r,
      ringFg: ring.fg,
      timeEl, modeEl, subEl, startBtn,
      chips: {
        ['focus:25']: chipFocus25,
        ['focus:50']: chipFocus50,
        ['break:5']: chipBreak5,
      },
    };
    paintStart();
    paintRing();

    return Card({
      className: 'gb-timer-card',
      children: [
        ringWrap,
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'gb-score-heading' }, 'Focus timer'),
          subEl,
          h('div', { class: 'gb-segmented', style: { marginTop: '10px' } },
            chipFocus25, chipFocus50, chipBreak5, chipCustom),
          h('div', { class: 'gb-timer-actions' }, startBtn, resetBtn)
        ),
      ],
    });
  }

  window.GB.TimerWidget = TimerWidget;
})();
