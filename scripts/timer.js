/* =====================================================================
   Growth Buddy — Focus screen
   A dedicated study space: a Pomodoro timer plus an in-app ambient
   sound engine (no audio files — everything is synthesised live with
   the Web Audio API, so there's zero download weight and no licensing
   concerns). The timer owns its own DOM and ticks in place so the rest
   of the screen doesn't re-render every second.
   ===================================================================== */
import { h, Icon, Card, refreshIcons } from './gb-kit.js';

/* -------------------------------------------------------------------
     Timer state (module scope so a running session survives navigating
     away from and back to the Focus tab).
     ------------------------------------------------------------------- */
const T = {
  mode: 'focus',
  durationSec: 25 * 60,
  remainingSec: 25 * 60,
  running: false,
  intervalId: null,
  refs: null, // live DOM refs, rebuilt on every (re)mount
};

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}
function fmt(s) {
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
}

/* -------------------------------------------------------------------
     Ambient sound engine — synthesised noise soundscapes.
     ------------------------------------------------------------------- */
const SOUNDSCAPES = [
  {
    key: 'brown',
    label: 'Brown noise',
    icon: 'waves',
    hint: 'Deep, smooth rumble — great for deep work.',
  },
  {
    key: 'rain',
    label: 'Rain',
    icon: 'cloud-rain',
    hint: 'Steady rainfall to soften the silence.',
  },
  {
    key: 'ocean',
    label: 'Ocean',
    icon: 'sailboat',
    hint: 'Slow rolling waves that swell and fade.',
  },
  {
    key: 'white',
    label: 'White noise',
    icon: 'audio-lines',
    hint: 'Bright, even hiss that masks distractions.',
  },
];

const Sound = {
  ctx: null,
  master: null,
  enabled: false, // user wants sound during sessions
  playing: false, // a graph is currently connected & audible
  volume: 0.5,
  current: 'brown', // selected soundscape
  nodes: [], // live nodes to disconnect on stop
  oscillators: [], // LFOs / sources to stop on stop
  refs: null, // live DOM refs for the sound card
};

function ensureCtx() {
  if (!Sound.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    Sound.ctx = new AC();
    Sound.master = Sound.ctx.createGain();
    Sound.master.gain.value = Sound.volume;
    Sound.master.connect(Sound.ctx.destination);
  }
  if (Sound.ctx.state === 'suspended') {
    Sound.ctx.resume().catch(function () {});
  }
  return Sound.ctx;
}

// 2 seconds of looping noise. `brown` integrates white noise for a
// darker, lower-energy spectrum.
function noiseBuffer(ctx, brown) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

// Drive an AudioParam with a slow sine LFO oscillating between min/max.
function attachLfo(ctx, freq, min, max, param) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const depth = ctx.createGain();
  depth.gain.value = (max - min) / 2;
  param.value = (max + min) / 2;
  osc.connect(depth);
  depth.connect(param);
  osc.start();
  Sound.oscillators.push(osc);
  Sound.nodes.push(depth);
}

function buildGraph(key) {
  const ctx = Sound.ctx;
  const src = ctx.createBufferSource();
  const out = ctx.createGain();
  src.loop = true;

  if (key === 'brown') {
    src.buffer = noiseBuffer(ctx, true);
    out.gain.value = 0.9;
    src.connect(out);
  } else if (key === 'white') {
    src.buffer = noiseBuffer(ctx, false);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 8200;
    out.gain.value = 0.22;
    src.connect(lp);
    lp.connect(out);
    Sound.nodes.push(lp);
  } else if (key === 'rain') {
    src.buffer = noiseBuffer(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    out.gain.value = 0.4;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    // Subtle intensity shimmer so it doesn't read as flat static.
    attachLfo(ctx, 0.25, 0.3, 0.46, out.gain);
    Sound.nodes.push(hp, lp);
  } else if (key === 'ocean') {
    src.buffer = noiseBuffer(ctx, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    out.gain.value = 0.7;
    src.connect(lp);
    lp.connect(out);
    // Slow swells: sweep the filter and the volume in a wave rhythm.
    attachLfo(ctx, 0.08, 380, 1100, lp.frequency);
    attachLfo(ctx, 0.1, 0.3, 1.0, out.gain);
    Sound.nodes.push(lp);
  } else {
    src.buffer = noiseBuffer(ctx, true);
    src.connect(out);
  }

  out.connect(Sound.master);
  src.start();
  Sound.nodes.push(src, out);
  Sound.oscillators.push(src);
}

function stopGraph() {
  Sound.oscillators.forEach(function (o) {
    try {
      o.stop();
    } catch (_) {}
  });
  Sound.nodes.forEach(function (n) {
    try {
      n.disconnect();
    } catch (_) {}
  });
  Sound.oscillators = [];
  Sound.nodes = [];
  Sound.playing = false;
}

// Begin (or swap) playback of the selected soundscape.
function playSound() {
  if (!ensureCtx()) return;
  stopGraph();
  buildGraph(Sound.current);
  Sound.playing = true;
  paintSound();
}

function stopSound() {
  stopGraph();
  paintSound();
}

function setVolume(v) {
  Sound.volume = Math.max(0, Math.min(1, v));
  if (Sound.master) {
    try {
      Sound.master.gain.value = Sound.volume;
    } catch (_) {}
  }
}

function setSoundscape(key) {
  Sound.current = key;
  if (Sound.playing)
    playSound(); // swap live
  else paintSound();
}

// Master toggle: "do I want sound while focusing?"
function setSoundEnabled(on) {
  Sound.enabled = on;
  if (on) {
    // Start immediately so the user hears the choice; if a focus
    // session is paused we still let them preview the soundscape.
    playSound();
  } else {
    stopSound();
  }
  paintSound();
}

/* -------------------------------------------------------------------
     Timer mechanics.
     ------------------------------------------------------------------- */
function paintRing() {
  if (!T.refs) return;
  const pct = T.durationSec
    ? Math.max(0, Math.min(100, (1 - T.remainingSec / T.durationSec) * 100))
    : 0;
  const r = T.refs.r,
    c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  T.refs.ringFg.setAttribute('stroke-dashoffset', String(off));
  T.refs.ringFg.setAttribute('stroke', T.mode === 'focus' ? 'var(--iris-500)' : 'var(--leaf-500)');
  T.refs.timeEl.textContent = fmt(T.remainingSec);
  T.refs.modeEl.textContent = T.mode;
  T.refs.subEl.textContent = T.running
    ? 'In session — keep going.'
    : T.remainingSec === 0
      ? 'Session complete! Reset to start a new sprint.'
      : 'Start a study sprint.';
  T.refs.startBtn.textContent = '';
  T.refs.startBtn.append(
    T.running ? Icon('pause', { size: 16, sw: 2.4 }) : Icon('play', { size: 16, sw: 2.4 }),
    document.createTextNode(T.running ? 'Pause' : 'Start')
  );
  T.refs.startBtn.classList.toggle('gb-btn--primary', !T.running);
  T.refs.startBtn.classList.toggle('gb-btn--secondary', T.running);
  Object.keys(T.refs.chips).forEach(function (k) {
    T.refs.chips[k].classList.toggle('is-on', k === T.mode + ':' + T.durationSec / 60);
  });
  if (window.lucide && window.lucide.createIcons) {
    try {
      window.lucide.createIcons();
    } catch (_) {}
  }
}

function setMode(mode, mins) {
  T.mode = mode;
  T.durationSec = mins * 60;
  T.remainingSec = T.durationSec;
  T.running = false;
  if (T.intervalId) {
    clearInterval(T.intervalId);
    T.intervalId = null;
  }
  if (Sound.playing) stopSound();
  paintRing();
}

function start() {
  if (T.running) return;
  T.running = true;
  if (Sound.enabled) playSound();
  T.intervalId = setInterval(function () {
    T.remainingSec -= 1;
    if (T.remainingSec <= 0) {
      T.remainingSec = 0;
      T.running = false;
      clearInterval(T.intervalId);
      T.intervalId = null;
      if (Sound.playing) stopSound();
      chime();
      // Persist the completed session and refresh the stats card.
      if (Focus.onSession) {
        Promise.resolve(Focus.onSession(T.mode, T.durationSec)).then(applyStats).catch(function () {});
      }
    }
    paintRing();
  }, 1000);
  paintRing();
}

function pause() {
  if (!T.running) return;
  T.running = false;
  if (T.intervalId) {
    clearInterval(T.intervalId);
    T.intervalId = null;
  }
  if (Sound.playing) stopSound();
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
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.12;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(function () {
      o.stop();
      ctx.close();
    }, 450);
  } catch (_) {
    /* silent */
  }
}

function buildRing(size, stroke) {
  const NS = 'http://www.w3.org/2000/svg';
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.style.transform = 'rotate(-90deg)';
  const bg = document.createElementNS(NS, 'circle');
  bg.setAttribute('cx', size / 2);
  bg.setAttribute('cy', size / 2);
  bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'var(--surface-3)');
  bg.setAttribute('stroke-width', stroke);
  svg.appendChild(bg);
  const fg = document.createElementNS(NS, 'circle');
  fg.setAttribute('cx', size / 2);
  fg.setAttribute('cy', size / 2);
  fg.setAttribute('r', r);
  fg.setAttribute('fill', 'none');
  fg.setAttribute('stroke', 'var(--iris-500)');
  fg.setAttribute('stroke-width', stroke);
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('stroke-dasharray', c);
  fg.setAttribute('stroke-dashoffset', 0);
  fg.style.transition = 'stroke-dashoffset 0.4s var(--ease-out, ease)';
  svg.appendChild(fg);
  return { svg, fg, r };
}

/* -------------------------------------------------------------------
     UI — timer card.
     ------------------------------------------------------------------- */
function openCustomMinutesModal() {
  let overlay;
  const input = h('input', {
    type: 'number',
    class: 'gb-input',
    'aria-label': 'Minutes',
    min: '1',
    max: '180',
    step: '1',
    value: '15',
  });
  const error = h('div', { class: 'gb-water-prompt-error', 'aria-live': 'polite' });
  function close() {
    overlay.classList.remove('is-open');
    setTimeout(function () {
      overlay && overlay.remove();
    }, 180);
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
  const sheet = h(
    'div',
    {
      class: 'gb-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Custom focus minutes',
    },
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Custom focus minutes'),
      h('div', { class: 'gb-modal-sub' }, 'Choose any value from 1 to 180 minutes.')
    ),
    h(
      'div',
      { class: 'gb-modal-body' },
      h('div', { class: 'gb-form' }, h('div', { class: 'gb-field-label' }, 'Minutes'), input, error)
    ),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel'),
      h(
        'button',
        { type: 'button', class: 'gb-btn gb-btn--primary', onclick: submit },
        'Set timer'
      )
    )
  );
  overlay = h(
    'div',
    {
      class: 'gb-modal-overlay',
      onclick: function (e) {
        if (e.target === overlay) close();
      },
    },
    sheet
  );
  document.body.appendChild(overlay);
  refreshIcons();
  requestAnimationFrame(function () {
    overlay.classList.add('is-open');
  });
  setTimeout(function () {
    input.focus();
  }, 60);
}

function TimerCard() {
  const timeEl = h(
    'span',
    {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: '34px',
        color: 'var(--fg1)',
      },
    },
    fmt(T.remainingSec)
  );
  const modeEl = h(
    'span',
    {
      style: {
        fontSize: '11px',
        fontWeight: 700,
        color: 'var(--fg3)',
        textTransform: 'uppercase',
        letterSpacing: '.06em',
      },
    },
    T.mode
  );

  const ring = buildRing(184, 14);
  const ringWrap = h('div', { class: 'gb-focus-ring' });
  ringWrap.appendChild(ring.svg);
  ringWrap.appendChild(h('div', { class: 'gb-focus-ring-inner' }, timeEl, modeEl));

  function modeChip(label, mode, mins) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'gb-seg' + (T.mode === mode && T.durationSec === mins * 60 ? ' is-on' : ''),
        onclick: function () {
          setMode(mode, mins);
        },
      },
      label
    );
    btn.dataset.key = mode + ':' + mins;
    return btn;
  }
  const chipFocus25 = modeChip('Focus 25m', 'focus', 25);
  const chipFocus50 = modeChip('Focus 50m', 'focus', 50);
  const chipBreak5 = modeChip('Break 5m', 'break', 5);
  const chipCustom = h(
    'button',
    { type: 'button', class: 'gb-seg', onclick: openCustomMinutesModal },
    'Custom…'
  );

  const subEl = h(
    'div',
    { class: 'gb-score-sub' },
    T.running
      ? 'In session — keep going.'
      : T.remainingSec === 0
        ? 'Session complete! Reset to start a new sprint.'
        : 'Start a study sprint.'
  );
  const startBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn ' + (T.running ? 'gb-btn--secondary' : 'gb-btn--primary'),
      onclick: function () {
        return T.running ? pause() : start();
      },
    },
    Icon(T.running ? 'pause' : 'play', { size: 16, sw: 2.4 }),
    document.createTextNode(T.running ? 'Pause' : 'Start')
  );
  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'gb-btn gb-btn--ghost',
      'aria-label': 'Reset timer',
      onclick: reset,
    },
    Icon('rotate-ccw', { size: 16, sw: 2.4 }),
    'Reset'
  );

  T.refs = {
    r: ring.r,
    ringFg: ring.fg,
    timeEl,
    modeEl,
    subEl,
    startBtn,
    chips: { ['focus:25']: chipFocus25, ['focus:50']: chipFocus50, ['break:5']: chipBreak5 },
  };
  paintRing();

  return Card({
    className: 'gb-focus-card',
    children: [
      ringWrap,
      h(
        'div',
        { class: 'gb-focus-controls' },
        h('div', { class: 'gb-score-heading' }, 'Focus timer'),
        subEl,
        h(
          'div',
          { class: 'gb-segmented', style: { marginTop: '12px' } },
          chipFocus25,
          chipFocus50,
          chipBreak5,
          chipCustom
        ),
        h('div', { class: 'gb-timer-actions' }, startBtn, resetBtn)
      ),
    ],
  });
}

/* -------------------------------------------------------------------
     UI — ambient sound card.
     ------------------------------------------------------------------- */
function paintSound() {
  if (!Sound.refs) return;
  Sound.refs.toggle.classList.toggle('is-on', Sound.enabled);
  Sound.refs.toggle.setAttribute('aria-checked', Sound.enabled ? 'true' : 'false');
  Sound.refs.statusEl.textContent = !Sound.enabled
    ? 'Off — silent focus.'
    : (Sound.playing ? 'Playing' : 'Ready') +
      ' · ' +
      (
        SOUNDSCAPES.find(function (s) {
          return s.key === Sound.current;
        }) || {}
      ).label;
  Object.keys(Sound.refs.tiles).forEach(function (k) {
    Sound.refs.tiles[k].classList.toggle('is-on', k === Sound.current);
  });
  Sound.refs.card.classList.toggle('is-muted', !Sound.enabled);
}

function SoundCard() {
  const toggle = h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': Sound.enabled ? 'true' : 'false',
      'aria-label': 'Focus sound',
      class: 'gb-switch' + (Sound.enabled ? ' is-on' : ''),
      onclick: function () {
        setSoundEnabled(!Sound.enabled);
      },
    },
    h('span', { class: 'gb-switch-knob' })
  );

  const statusEl = h('div', { class: 'gb-score-sub' });

  const tiles = {};
  const grid = h('div', { class: 'gb-sound-grid' });
  SOUNDSCAPES.forEach(function (s) {
    const tile = h(
      'button',
      {
        type: 'button',
        class: 'gb-sound-tile' + (s.key === Sound.current ? ' is-on' : ''),
        title: s.hint,
        onclick: function () {
          setSoundscape(s.key);
          if (!Sound.enabled) setSoundEnabled(true); // picking a sound turns it on
        },
      },
      Icon(s.icon, { size: 22, sw: 2 }),
      h('span', { class: 'gb-sound-tile-label' }, s.label)
    );
    tiles[s.key] = tile;
    grid.appendChild(tile);
  });

  const volume = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: String(Math.round(Sound.volume * 100)),
    class: 'gb-range',
    'aria-label': 'Sound volume',
    oninput: function (e) {
      setVolume(parseInt(e.target.value, 10) / 100);
    },
  });

  const card = Card({
    className: 'gb-sound-card' + (Sound.enabled ? '' : ' is-muted'),
    children: [
      h(
        'div',
        { class: 'gb-sound-head' },
        h('div', null, h('div', { class: 'gb-score-heading' }, 'Focus sound'), statusEl),
        toggle
      ),
      grid,
      h(
        'div',
        { class: 'gb-sound-volume' },
        Icon('volume-2', { size: 18, sw: 2, color: 'var(--fg3)' }),
        volume
      ),
      h(
        'div',
        { class: 'gb-sound-hint' },
        'Soundscapes play right in your browser and pause with your timer.'
      ),
    ],
  });

  Sound.refs = { card, toggle, statusEl, tiles };
  paintSound();
  return card;
}

/* -------------------------------------------------------------------
     Focus stats (backend-backed; bounded retention server-side).
     ------------------------------------------------------------------- */
const Focus = { onSession: null, getStats: null, statsEl: null };

function applyStats(s) {
  if (!s || !Focus.statsEl) return;
  Focus.statsEl.today.textContent = (s.todayMinutes || 0) + 'm';
  Focus.statsEl.sessions.textContent = String(s.todaySessions || 0);
  Focus.statsEl.week.textContent = (s.weekMinutes || 0) + 'm';
}

function statTile(valEl, label) {
  return h('div', { class: 'gb-focus-stat' }, valEl, h('div', { class: 'gb-focus-stat-lbl' }, label));
}

function StatsCard() {
  const today = h('div', { class: 'gb-focus-stat-val' }, '—');
  const sessions = h('div', { class: 'gb-focus-stat-val' }, '—');
  const week = h('div', { class: 'gb-focus-stat-val' }, '—');
  Focus.statsEl = { today, sessions, week };
  if (Focus.getStats) {
    Promise.resolve(Focus.getStats()).then(applyStats).catch(function () {});
  }
  return Card({
    className: 'gb-focus-statscard',
    children: [
      h('div', { class: 'gb-score-heading' }, 'Your focus'),
      h(
        'div',
        { class: 'gb-focus-stats-grid' },
        statTile(today, 'focused today'),
        statTile(sessions, 'sessions today'),
        statTile(week, 'this week')
      ),
    ],
  });
}

/* -------------------------------------------------------------------
     Screen.
     ------------------------------------------------------------------- */
function ScreenFocus(props) {
  Focus.onSession = props && props.onFocusSession;
  Focus.getStats = props && props.getFocusStats;
  return h('div', { class: 'gb-rise gb-focus' }, TimerCard(), StatsCard(), SoundCard());
}

export { ScreenFocus };
