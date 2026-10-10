/* =====================================================================
   Growth Buddy — Focus screen
   A dedicated study space: a Pomodoro timer plus an in-app ambient
   sound engine (no audio files — everything is synthesised live with
   the Web Audio API, so there's zero download weight and no licensing
   concerns). The timer owns its own DOM and ticks in place so the rest
   of the screen doesn't re-render every second.
   ===================================================================== */
import { h, Icon, Card, refreshIcons, openOverlay, submitOnEnter, confirmDialog } from './gb-kit.js';
import { toast } from './toast.js';
import {
  isNative,
  scheduleLocalNotifications,
  cancelLocalNotifications,
  TIMER_ALARM_ID,
} from './native.js';
import { CacheStorage } from './cache-storage.js';
import { playChime } from './chime.js';
import {
  remainingFrom,
  restoredSession,
  stripTitle,
  titleWith,
  afterSession,
  cycleLabel,
  goalMinutes,
  goalProgress,
  barLayout,
  SPRINTS_PER_CYCLE,
} from './timer-math.js';

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
  /* Wall-clock instant this session ends. While running it is the only truth;
     remainingSec is derived from it for display. */
  endsAt: 0,
  suggest: '', // the next step after a session ends ("Take your 5-minute break?")
  lastFocusMins: 25, // what a finished break lines back up
  cycleDone: 0, // sprints finished in this cycle of four (timer-math.js afterSession)
  link: null, // what this session is on: { taskId } | { goalId } | null ("Focusing on…")
  refs: null, // live DOM refs, rebuilt on every (re)mount
};

/* The session end, queued with the OS so a phone rings even when the WebView
   has been frozen behind a locked screen. Id 2 is this timer's alone: 1 is the
   push test notification, and the reminder queue starts far above both (its
   ids are derived from the minute they fire in). No-op on the web, where the
   tab either lives to chime or is gone. TIMER_ALARM_ID is native.js's, so
   push.js's reminder re-sync can leave it queued. */

function armEndAlarm() {
  scheduleLocalNotifications([
    {
      id: TIMER_ALARM_ID,
      title: T.mode === 'focus' ? 'Focus session done' : 'Break over',
      body: T.mode === 'focus' ? 'Nice work. Take a breather.' : 'Ready for the next one?',
      at: new Date(T.endsAt),
    },
  ]).catch(function () {});
}

function cancelEndAlarm() {
  cancelLocalNotifications([TIMER_ALARM_ID]).catch(function () {});
}

/* The session survives a reload or a killed app. It lived only in module
   state, so closing the tab mid-sprint lost it and finish() never posted.
   CacheStorage (never localStorage); `owner` keeps one account's session from
   being counted for the next one to sign in on this device. A session that
   ended while the app was gone is removed from the store BEFORE it is posted,
   so a second restore can't count it twice. */
const SESSION_KEY = 'gb.focusSession';

function saveSession() {
  try {
    const idle = !T.running && (T.remainingSec <= 0 || T.remainingSec === T.durationSec);
    if (idle) {
      CacheStorage.removeItem(SESSION_KEY);
      return;
    }
    CacheStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        owner: Focus.owner || null,
        mode: T.mode,
        durationSec: T.durationSec,
        remainingSec: T.remainingSec,
        running: T.running,
        endsAt: T.endsAt,
        cycle: T.cycleDone,
        link: T.link,
      })
    );
  } catch (_) {
    /* no storage: the session just won't outlive the page */
  }
}

function dropSession() {
  try {
    CacheStorage.removeItem(SESSION_KEY);
  } catch (_) {
    /* nothing stored */
  }
}

/* Called on mount and from app.js's boot (resumeFocusSession) once the Cache
   API has hydrated. A session already running here wins over a stored one. */
function restoreSession() {
  if (T.running) return;
  let saved = null;
  try {
    saved = JSON.parse(CacheStorage.getItem(SESSION_KEY) || 'null');
  } catch (_) {
    saved = null;
  }
  if (!saved) return;
  const r = restoredSession(saved, Date.now(), Focus.owner);
  if (r.action === 'none') {
    dropSession();
    return;
  }
  T.mode = r.mode;
  T.durationSec = r.durationSec;
  const c = Number(saved.cycle);
  T.cycleDone = c >= 0 && c <= SPRINTS_PER_CYCLE ? Math.floor(c) : 0;
  T.link = cleanLink(saved.link);
  if (r.action === 'finish') {
    dropSession();
    T.remainingSec = 0;
    postSession(r.mode, r.durationSec, r.mode === 'focus' ? T.link : null);
    toast.success(
      r.mode === 'focus'
        ? 'Your focus session finished while you were away. It counts.'
        : 'Your break finished while you were away.'
    );
    // The cycle moves on as if it had ended here: the next step is lined up.
    if (r.mode === 'focus') T.lastFocusMins = Math.round(r.durationSec / 60);
    const next = afterSession(r.mode, T.cycleDone, T.lastFocusMins);
    T.cycleDone = next.cycleDone;
    setMode(next.mode, next.mins, next.suggest);
    return;
  } else if (r.action === 'paused') {
    T.remainingSec = r.remainingSec;
  } else {
    T.endsAt = r.endsAt;
    T.running = true;
    T.remainingSec = remainingFrom(T.endsAt, Date.now());
    if (T.intervalId) clearInterval(T.intervalId);
    T.intervalId = setInterval(tick, 1000);
    armEndAlarm(); // same id, so this replaces the one queued before the reload
  }
  paintRing();
}

/** Persist a finished session and refresh the stats card. Not silent: a dropped POST is a session that never counts. */
function postSession(mode, durationSec, link) {
  if (!Focus.onSession) return;
  Promise.resolve(Focus.onSession(mode, durationSec, link || null))
    .then(function (s) {
      applyStats(s);
      if (mode === 'focus') loadHistory();
    })
    .catch(function (err) {
      toast.error(err, 'Could not save that focus session.');
    });
}

/* A link as stored or handed in: exactly one of taskId / goalId, else null. */
function cleanLink(l) {
  if (!l || typeof l !== 'object') return null;
  if (l.taskId) return { taskId: String(l.taskId) };
  if (l.goalId) return { goalId: String(l.goalId) };
  return null;
}

/* Screen readers: the ring's digits change every second, which is far too
   chatty for a live region, so it isn't one. Start, pause and the end are
   said once, here. */
function say(text) {
  const el = T.refs && T.refs.liveEl;
  if (!el) return;
  el.textContent = '';
  setTimeout(function () {
    el.textContent = text;
  }, 60);
}

/* The countdown rides in the tab title while running, in front of whatever
   app.js titled the page (it retitles on every render, hence strip-and-add). */
function paintTitle() {
  if (T.running) document.title = titleWith(fmt(T.remainingSec), T.mode, document.title);
  else if (stripTitle(document.title) !== document.title) document.title = stripTitle(document.title);
}

/* Space starts and pauses, from anywhere on the Focus screen that isn't a
   control of its own (a focused button already takes Space as a click). */
document.addEventListener('keydown', function (e) {
  if (e.key !== ' ' && e.code !== 'Space') return;
  if (!T.refs || !T.refs.startBtn.isConnected) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"], [role="alertdialog"]'))
    return;
  if (document.querySelector('[aria-modal="true"]')) return;
  e.preventDefault();
  if (T.running) pause();
  else start();
});

/* A throttled or suspended interval is the normal case on a phone, so re-read
   the clock whenever the page comes back rather than trusting the tick. */
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) resync();
});
window.addEventListener('focus', resync);

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
  // The title first: it counts down on every screen, not only while Focus is open.
  paintTitle();
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
  T.refs.cycleEl.textContent = cycleLabel(T.mode, T.cycleDone);
  T.refs.subEl.textContent = T.running
    ? 'In session — keep going.'
    : T.remainingSec === 0
      ? 'Session complete! Reset to start a new sprint.'
      : 'Start a study sprint.';
  if (T.suggest && !T.running && T.remainingSec === T.durationSec) T.refs.subEl.textContent = T.suggest;
  // The button only changes when running does. Rebuilding it every tick meant
  // a lucide.createIcons() sweep of the whole document once a second.
  if (T.refs.paintedRunning !== T.running) {
    T.refs.paintedRunning = T.running;
    T.refs.startBtn.textContent = '';
    T.refs.startBtn.append(
      T.running ? Icon('pause', { size: 16, sw: 2.4 }) : Icon('play', { size: 16, sw: 2.4 }),
      document.createTextNode(T.running ? 'Pause' : 'Start')
    );
    T.refs.startBtn.classList.toggle('gb-btn--primary', !T.running);
    T.refs.startBtn.classList.toggle('gb-btn--secondary', T.running);
    refreshIcons();
  }
  Object.keys(T.refs.chips).forEach(function (k) {
    const on = k === T.mode + ':' + T.durationSec / 60;
    T.refs.chips[k].classList.toggle('is-on', on);
    T.refs.chips[k].setAttribute('aria-pressed', String(on));
  });
}

function setMode(mode, mins, suggest) {
  T.mode = mode;
  T.durationSec = mins * 60;
  T.remainingSec = T.durationSec;
  T.running = false;
  T.endsAt = 0;
  T.suggest = suggest || '';
  if (mode === 'focus') T.lastFocusMins = mins;
  cancelEndAlarm();
  if (T.intervalId) {
    clearInterval(T.intervalId);
    T.intervalId = null;
  }
  if (Sound.playing) stopSound();
  saveSession();
  paintRing();
}

/* A chip tapped mid-session used to throw the time on the clock away without
   a word. Ask first when there is something to lose. */
async function switchMode(mode, mins) {
  if (T.mode === mode && T.durationSec === mins * 60 && !T.running) return;
  const inProgress = T.running || (T.remainingSec > 0 && T.remainingSec < T.durationSec);
  if (inProgress) {
    const ok = await confirmDialog({
      title: 'End this ' + (T.mode === 'break' ? 'break' : 'session') + '?',
      message: fmt(T.remainingSec) + ' is left on the clock. Switching starts over and this one won’t count.',
      confirmLabel: 'Switch',
      danger: true,
    });
    if (!ok) return;
  }
  setMode(mode, mins);
}

/* The clock is the authority, not the tick.

   This used to be `remainingSec -= 1` once a second. A backgrounded tab gets
   its interval throttled to once a minute or suspended altogether, and an
   Android WebView behind a locked screen stops it dead — so a 25-minute session
   put in your pocket came back with twenty-some minutes still on it and never
   finished. Now `endsAt` is a wall-clock instant and every tick just reads it:
   throttling changes how often the ring repaints, never what it says. */
function tick() {
  if (!T.running) return;
  T.remainingSec = remainingFrom(T.endsAt, Date.now());
  if (T.remainingSec <= 0) {
    finish();
    return;
  }
  paintRing();
}

function finish() {
  T.remainingSec = 0;
  T.running = false;
  T.endsAt = 0;
  if (T.intervalId) {
    clearInterval(T.intervalId);
    T.intervalId = null;
  }
  cancelEndAlarm();
  // Off the store before the POST: a reload mid-request must not count it again.
  dropSession();
  if (Sound.playing) stopSound();
  chime();
  const doneMode = T.mode;
  postSession(T.mode, T.durationSec, doneMode === 'focus' ? T.link : null);
  notifyEnd(doneMode);
  say(doneMode === 'focus' ? 'Focus session complete.' : 'Break over.');
  // The cycle: a finished sprint lines up a short break (the fourth a long
  // one), and a finished break lines the last sprint length back up — ready,
  // never auto-started. timer-math.js afterSession decides.
  const next = afterSession(doneMode, T.cycleDone, T.lastFocusMins);
  T.cycleDone = next.cycleDone;
  setMode(next.mode, next.mins, next.suggest);
}

/* The web has no OS alarm (the phone's is queued in armEndAlarm), so a session
   ending in a background tab went unnoticed. A notification, if one is already
   allowed — this never asks. */
function notifyEnd(mode) {
  if (isNative() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus && document.hasFocus()) return;
  const title = mode === 'focus' ? 'Focus session done' : 'Break over';
  const opts = {
    body: mode === 'focus' ? 'Nice work. Take a breather.' : 'Ready for the next one?',
    icon: '/icons/icon-192.png',
    tag: 'gb-focus-end',
  };
  try {
    new Notification(title, opts);
  } catch (_) {
    // Android Chrome refuses the constructor; the service worker can show it.
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(function () {});
    }
  }
}

function start() {
  if (T.running) return;
  // Start on a finished clock runs a fresh session. It used to arm a 0s one,
  // which finished on the next tick and POSTed a whole extra session to stats.
  if (T.remainingSec <= 0) T.remainingSec = T.durationSec;
  T.running = true;
  T.suggest = '';
  T.endsAt = Date.now() + T.remainingSec * 1000;
  if (Sound.enabled) playSound();
  T.intervalId = setInterval(tick, 1000);
  // On a phone the WebView may be frozen when this lands, so the session end
  // has to be queued with the OS to be heard at all.
  armEndAlarm();
  saveSession();
  say((T.mode === 'focus' ? 'Focus' : 'Break') + ' started, ' + Math.ceil(T.remainingSec / 60) + ' minutes.');
  paintRing();
}

/* Coming back from the background: the interval may have been throttled or
   stopped, so re-read the clock immediately — and if the end passed while we
   were away, finish now rather than pretending there is time left. */
function resync() {
  if (!T.running) return;
  tick();
}

function pause() {
  if (!T.running) return;
  // Freeze what the clock says right now; start() measures the next run from it.
  T.remainingSec = remainingFrom(T.endsAt, Date.now());
  T.running = false;
  T.endsAt = 0;
  if (T.intervalId) {
    clearInterval(T.intervalId);
    T.intervalId = null;
  }
  cancelEndAlarm();
  if (Sound.playing) stopSound();
  saveSession();
  say('Paused at ' + fmt(T.remainingSec) + '.');
  paintRing();
}

function reset() {
  if (T.running) pause();
  T.remainingSec = T.durationSec;
  saveSession();
  paintRing();
}

/* The user's own alert tone from Settings, which app.js hands in as
   Focus.chimeKey. The old fixed 880 Hz beep is the fallback if it can't play. */
function chime() {
  if (Focus.chimeKey && playChime(Focus.chimeKey)) return;
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
  const { sheet, close } = openOverlay({ label: 'Custom focus minutes' });
  const setBtn = h(
    'button',
    { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => submit() },
    'Set timer'
  );
  function submit() {
    // Checked, not clamped: clamping first made `!m` unreachable, so a blank or
    // a 0 silently started a one-minute timer and the error never showed.
    const m = parseInt(input.value, 10);
    if (!(m >= 1 && m <= 180)) {
      error.textContent = 'Enter a number between 1 and 180.';
      return;
    }
    close();
    switchMode('focus', m);
  }
  sheet.append(
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
      setBtn,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel')
    )
  );
  submitOnEnter(sheet, setBtn);
  refreshIcons();
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
        fontSize: '2.125rem',
        color: 'var(--fg1)',
      },
      // role=timer is implicitly aria-live="off": read on demand, not every second.
      role: 'timer',
      'aria-label': 'Time left',
    },
    fmt(T.remainingSec)
  );
  const liveEl = h('div', { class: 'gb-sr-only', role: 'status', 'aria-live': 'polite' });
  const modeEl = h(
    'span',
    {
      style: {
        fontSize: '0.6875rem',
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
        'aria-pressed': String(T.mode === mode && T.durationSec === mins * 60),
        onclick: function () {
          switchMode(mode, mins);
        },
      },
      label
    );
    btn.dataset.key = mode + ':' + mins;
    return btn;
  }
  const chipFocus25 = modeChip('25m', 'focus', 25);
  const chipFocus50 = modeChip('50m', 'focus', 50);
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

  const cycleEl = h('div', { class: 'gb-focus-cycle' }, cycleLabel(T.mode, T.cycleDone));
  const goalEl = h('div', { class: 'gb-focus-goal' });
  Focus.goalEl = goalEl;
  paintGoal();

  T.refs = {
    r: ring.r,
    ringFg: ring.fg,
    timeEl,
    modeEl,
    cycleEl,
    subEl,
    startBtn,
    liveEl,
    paintedRunning: T.running,
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
        cycleEl,
        h('div', { class: 'gb-score-heading' }, 'Focus timer'),
        subEl,
        FocusPicker(),
        h(
          'div',
          { class: 'gb-segmented', style: { marginTop: '12px' } },
          chipFocus25,
          chipFocus50,
          chipBreak5,
          chipCustom
        ),
        h('div', { class: 'gb-timer-actions' }, startBtn, resetBtn),
        goalEl,
        liveEl
      ),
    ],
  });
}

/* "Focusing on…": the session can be spent on one of the user's open tasks or
   goals (validated server-side as theirs). Read at the end, so changing it
   mid-session credits the whole session to the new pick. A pick that has since
   left the lists (a task ticked off mid-sprint) stays as an extra option. */
function linkValue(l) {
  return l ? (l.taskId ? 'task:' + l.taskId : 'goal:' + l.goalId) : '';
}

function FocusPicker() {
  const targets = Focus.targets || { tasks: [], goals: [] };
  const tasks = targets.tasks || [];
  const goals = targets.goals || [];
  const current = linkValue(T.link);
  const known = tasks.some((t) => 'task:' + t.id === current) || goals.some((g) => 'goal:' + g.id === current);
  const sel = h(
    'select',
    {
      class: 'gb-input',
      id: 'gb-focus-on',
      onchange: function (e) {
        const v = String(e.target.value || '');
        const i = v.indexOf(':');
        T.link = i < 0 ? null : cleanLink(v.slice(0, i) === 'task' ? { taskId: v.slice(i + 1) } : { goalId: v.slice(i + 1) });
        saveSession();
      },
    },
    h('option', { value: '' }, 'Nothing in particular'),
    current && !known
      ? h('option', { value: current }, T.link.taskId ? 'The task you picked' : 'The goal you picked')
      : null,
    tasks.length
      ? h('optgroup', { label: 'Tasks' }, tasks.map((t) => h('option', { value: 'task:' + t.id }, t.title)))
      : null,
    goals.length
      ? h('optgroup', { label: 'Goals' }, goals.map((g) => h('option', { value: 'goal:' + g.id }, g.title)))
      : null
  );
  sel.value = current;
  return h(
    'div',
    { class: 'gb-focus-on' },
    h('label', { class: 'gb-field-label', for: 'gb-focus-on' }, 'Focusing on…'),
    sel
  );
}

/* ---- Daily focus goal: minutes a day (ui_prefs.focusGoalMins, off by default),
   today's progress under the timer, and the streak FocusService.stats counts. */
function paintGoal() {
  const el = Focus.goalEl;
  if (!el) return;
  el.textContent = '';
  const goal = goalMinutes(Focus.goalMins);
  if (!goal) {
    el.append(
      h('button', { type: 'button', class: 'gb-login-link', onclick: openGoalSheet }, 'Set a daily focus goal')
    );
    return;
  }
  const s = Focus.last || {};
  const today = s.todayMinutes || 0;
  const pct = Math.round(goalProgress(today, goal) * 100);
  // The streak is the server's, and only means this goal once the server has it.
  const streak = s.goalMinutes === goal ? s.goalStreak || 0 : 0;
  el.append(
    h(
      'div',
      { class: 'gb-focus-goal-head' },
      h('span', null, 'Today ' + today + ' / ' + goal + ' min'),
      streak
        ? h(
            'span',
            { class: 'gb-focus-goal-streak' },
            Icon('flame', { size: 13, sw: 2.4 }),
            streak + '-day streak'
          )
        : null,
      h(
        'button',
        { type: 'button', class: 'gb-login-link', 'aria-label': 'Change daily focus goal', onclick: openGoalSheet },
        'Change'
      )
    ),
    h(
      'div',
      {
        class: 'gb-focus-goal-bar' + (pct >= 100 ? ' is-met' : ''),
        role: 'progressbar',
        'aria-label': 'Daily focus goal',
        'aria-valuemin': '0',
        'aria-valuemax': String(goal),
        'aria-valuenow': String(Math.min(today, goal)),
        'aria-valuetext': today + ' of ' + goal + ' minutes',
      },
      h('div', { class: 'gb-focus-goal-fill', style: { width: pct + '%' } })
    )
  );
  refreshIcons();
}

function openGoalSheet() {
  const input = h('input', {
    type: 'number',
    class: 'gb-input',
    min: '0',
    max: '720',
    step: '5',
    value: String(goalMinutes(Focus.goalMins) || 60),
  });
  const error = h('div', { class: 'gb-water-prompt-error', 'aria-live': 'polite' });
  const { sheet, close } = openOverlay({ label: 'Daily focus goal' });
  const saveBtn = h('button', { type: 'button', class: 'gb-btn gb-btn--primary', onclick: () => submit() }, 'Save goal');
  function submit() {
    const m = parseInt(input.value, 10);
    if (!(m >= 0 && m <= 720)) {
      error.textContent = 'Enter minutes from 0 to 720 (0 turns the goal off).';
      return;
    }
    close();
    setGoal(m);
  }
  sheet.append(
    h(
      'div',
      { class: 'gb-modal-head' },
      h('div', { class: 'gb-modal-title' }, 'Daily focus goal'),
      h('div', { class: 'gb-modal-sub' }, 'Minutes of focus a day. Meet it to build a streak.')
    ),
    h(
      'div',
      { class: 'gb-modal-body' },
      h('div', { class: 'gb-form' }, h('div', { class: 'gb-field-label' }, 'Minutes a day'), input, error)
    ),
    h(
      'div',
      { class: 'gb-water-prompt-actions' },
      saveBtn,
      goalMinutes(Focus.goalMins)
        ? h(
            'button',
            {
              type: 'button',
              class: 'gb-btn gb-btn--ghost',
              onclick: () => {
                close();
                setGoal(0);
              },
            },
            'Turn off'
          )
        : null,
      h('button', { type: 'button', class: 'gb-btn gb-btn--ghost', onclick: close }, 'Cancel')
    )
  );
  submitOnEnter(sheet, saveBtn);
  refreshIcons();
  setTimeout(function () {
    input.focus();
  }, 60);
}

function setGoal(m) {
  Focus.goalMins = m;
  paintGoal();
  paintHistory();
  if (!Focus.onSetGoal) return;
  // The streak is counted server-side against the stored goal: re-ask once it has landed.
  Promise.resolve(Focus.onSetGoal(m)).then(function () {
    if (Focus.reloadStats) Focus.reloadStats();
  });
}

/* ---- History: the last 30 days of focus minutes (GET /api/focus/history,
   bucketed on the user's own days server-side) and this week's minutes per
   linked task / goal. */
const History = { el: null, last: null, failed: false };

function loadHistory() {
  if (!Focus.getHistory) return;
  Promise.resolve(Focus.getHistory())
    .then(function (res) {
      History.last = res || null;
      History.failed = false;
      paintHistory();
    })
    .catch(function () {
      History.failed = true;
      paintHistory();
    });
}

function fmtMins(m) {
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}

function dayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function historyChart(days, goal) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 300;
  const H = 96;
  const values = days.map((d) => d.minutes || 0);
  const { bars, max } = barLayout(values, W, H, goal);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'gb-focus-hist-svg');
  svg.setAttribute('aria-hidden', 'true'); // the table below is what a screen reader gets
  bars.forEach(function (b, i) {
    const slot = W / bars.length;
    // A full-height hit area, wider than the bar, carries the tooltip.
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', String(i * slot));
    hit.setAttribute('y', '0');
    hit.setAttribute('width', String(slot));
    hit.setAttribute('height', String(H));
    hit.setAttribute('class', 'gb-focus-hist-hit');
    const tip = document.createElementNS(NS, 'title');
    tip.textContent = dayLabel(days[i].date) + ': ' + fmtMins(values[i]);
    hit.appendChild(tip);
    if (b.h > 0) {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', String(b.x));
      r.setAttribute('y', String(b.y));
      r.setAttribute('width', String(b.w));
      r.setAttribute('height', String(b.h));
      r.setAttribute('rx', '1.5');
      r.setAttribute('class', 'gb-focus-hist-bar' + (i === bars.length - 1 ? ' is-today' : ''));
      svg.appendChild(r);
    }
    svg.appendChild(hit);
  });
  if (goalMinutes(goal)) {
    const y = H - (goalMinutes(goal) / max) * H;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', String(W));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'gb-focus-hist-goal');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
  }
  return svg;
}

function paintHistory() {
  const el = History.el;
  if (!el) return;
  el.textContent = '';
  const res = History.last;
  if (!res) {
    el.append(
      History.failed
        ? h(
            'div',
            { class: 'gb-focus-stats-error', role: 'alert' },
            h('span', null, 'Couldn’t load your focus history. '),
            h('button', { type: 'button', class: 'gb-login-link', onclick: loadHistory }, 'Try again')
          )
        : h('div', { class: 'gb-focus-hist-note' }, 'Loading…')
    );
    return;
  }
  const days = Array.isArray(res.days) ? res.days : [];
  const goal = goalMinutes(Focus.goalMins);
  const total = days.reduce((a, d) => a + (d.minutes || 0), 0);
  const active = days.filter((d) => d.minutes > 0).length;
  el.append(
    h(
      'div',
      { class: 'gb-focus-hist-sum' },
      fmtMins(total) + ' over ' + days.length + ' days · ' + active + (active === 1 ? ' day' : ' days') + ' with focus' +
        (goal ? ' · ' + days.filter((d) => d.minutes >= goal).length + ' met your goal' : '')
    ),
    historyChart(days, goal),
    h(
      'div',
      { class: 'gb-focus-hist-axis', 'aria-hidden': 'true' },
      h('span', null, days.length ? dayLabel(days[0].date) : ''),
      h('span', null, 'Today')
    ),
    h(
      'table',
      { class: 'gb-sr-only' },
      h('caption', null, 'Focus minutes per day, last ' + days.length + ' days'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Minutes'))),
      h(
        'tbody',
        null,
        days.map((d) => h('tr', null, h('td', null, dayLabel(d.date)), h('td', null, String(d.minutes || 0))))
      )
    )
  );
  const week = Array.isArray(res.week) ? res.week : [];
  el.append(h('div', { class: 'gb-focus-hist-sub' }, 'This week by task or goal'));
  if (!week.length) {
    el.append(
      h('div', { class: 'gb-focus-hist-note' }, 'Pick a task or goal under “Focusing on…” to see where your time goes.')
    );
    return;
  }
  el.append(
    h(
      'ul',
      { class: 'gb-focus-links' },
      week.map((w) =>
        h(
          'li',
          { class: 'gb-focus-link' },
          Icon(w.kind === 'goal' ? 'target' : 'list-todo', { size: 14, sw: 2.4, color: 'var(--fg3)' }),
          h('span', { class: 'gb-focus-link-title' }, w.title || (w.kind === 'goal' ? 'A removed goal' : 'A removed task')),
          h('span', { class: 'gb-focus-link-mins' }, fmtMins(w.minutes || 0))
        )
      )
    )
  );
  refreshIcons();
}

function HistoryCard() {
  const body = h('div', { class: 'gb-focus-hist' });
  History.el = body;
  paintHistory();
  loadHistory();
  return Card({
    className: 'gb-focus-histcard',
    children: [h('div', { class: 'gb-score-heading' }, 'Last 30 days'), body],
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
/* `last` is the newest stats answer. Each visit builds a fresh card, which used
   to start on dashes and flip to numbers a round trip later; it now starts on
   the last numbers and the refresh corrects them in place. */
const Focus = {
  onSession: null,
  getStats: null,
  getHistory: null,
  reloadStats: null,
  statsEl: null,
  goalEl: null,
  last: null,
  owner: undefined,
  chimeKey: null,
  targets: null, // { tasks: [{id,title}], goals: [{id,title}] } for "Focusing on…"
  goalMins: 0, // daily focus goal, minutes; 0 = off
  onSetGoal: null,
};

function applyStats(s) {
  if (s) Focus.last = s;
  if (!s || !Focus.statsEl) return;
  Focus.statsEl.today.textContent = (s.todayMinutes || 0) + 'm';
  Focus.statsEl.sessions.textContent = String(s.todaySessions || 0);
  Focus.statsEl.week.textContent = (s.weekMinutes || 0) + 'm';
  paintGoal();
}

function statTile(valEl, label) {
  return h('div', { class: 'gb-focus-stat' }, valEl, h('div', { class: 'gb-focus-stat-lbl' }, label));
}

function StatsCard() {
  const today = h('div', { class: 'gb-focus-stat-val' }, '—');
  const sessions = h('div', { class: 'gb-focus-stat-val' }, '—');
  const week = h('div', { class: 'gb-focus-stat-val' }, '—');
  // A failed load used to leave dashes with no word why. Say so, with a retry.
  const errorEl = h('div', { class: 'gb-focus-stats-error', role: 'alert', hidden: true });
  Focus.statsEl = { today, sessions, week };
  applyStats(Focus.last);
  Focus.reloadStats = load;
  function load() {
    if (!Focus.getStats) return;
    errorEl.hidden = true;
    Promise.resolve(Focus.getStats())
      .then(applyStats)
      .catch(function () {
        errorEl.textContent = '';
        errorEl.append(
          h('span', null, Focus.last ? 'Couldn’t refresh these. ' : 'Couldn’t load your focus stats. '),
          h('button', { type: 'button', class: 'gb-login-link', onclick: load }, 'Try again')
        );
        errorEl.hidden = false;
      });
  }
  load();
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
      errorEl,
    ],
  });
}

/* -------------------------------------------------------------------
     Screen.
     ------------------------------------------------------------------- */
function bind(props) {
  Focus.onSession = props && props.onFocusSession;
  Focus.getStats = props && props.getFocusStats;
  Focus.chimeKey = (props && props.chimeKey) || null;
  Focus.getHistory = props && props.getFocusHistory;
  Focus.targets = (props && props.focusTargets) || null;
  Focus.goalMins = goalMinutes(props && props.focusGoalMins);
  Focus.onSetGoal = props && props.onSetFocusGoal;
  // Another account signed in on this device must not open on these numbers.
  const owner = props && props.statsOwner;
  if (owner !== Focus.owner) {
    Focus.last = null;
    History.last = null;
    T.link = null;
  }
  Focus.owner = owner;
}

function ScreenFocus(props) {
  bind(props);
  restoreSession();
  // A task or goal row's "Start focus": open with it picked.
  const pre = cleanLink(props && props.preselect);
  if (pre) {
    // Mid-sprint, the running session moves over to the new pick rather than starting over.
    if (T.running && T.mode === 'focus' && linkValue(T.link) !== linkValue(pre)) {
      toast.success('The session running now counts for ' + (pre.taskId ? 'that task.' : 'that goal.'));
    }
    T.link = pre;
    if (T.mode === 'break' && !T.running && (T.remainingSec <= 0 || T.remainingSec === T.durationSec))
      setMode('focus', T.lastFocusMins || 25);
    saveSession();
  }
  return h('div', { class: 'gb-rise gb-focus' }, TimerCard(), StatsCard(), HistoryCard(), SoundCard());
}

/* app.js's boot calls this once the Cache API has hydrated, when a session
   was stored: one that ended while the app was gone is counted then, rather
   than whenever the user next happens to open Focus. */
function resumeFocusSession(props) {
  bind(props);
  restoreSession();
}

/* Sign-out: a running clock would otherwise tick on and, at its end, chime and
   post the session with the next account's token. Back to an idle 25-minute
   focus, nothing queued with the OS, nothing stored. */
function resetFocusSession() {
  if (T.intervalId) clearInterval(T.intervalId);
  cancelEndAlarm();
  if (Sound.playing) stopSound();
  Object.assign(T, {
    mode: 'focus',
    durationSec: 25 * 60,
    remainingSec: 25 * 60,
    running: false,
    intervalId: null,
    endsAt: 0,
    suggest: '',
    lastFocusMins: 25,
    cycleDone: 0,
    link: null,
  });
  dropSession();
}

export { ScreenFocus, resumeFocusSession, resetFocusSession };
