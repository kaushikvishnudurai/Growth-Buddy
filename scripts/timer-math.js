/* =====================================================================
   Growth Buddy — focus timer arithmetic
   The parts of timer.js that decide something, kept free of the DOM so
   `node scripts/timer.test.mjs` can check them: what the clock says, what a
   session saved before a reload or a kill turns back into, and the countdown
   prefix the tab title carries while a session runs.
   ===================================================================== */

/** Whole seconds left until `endsAt` (ms), never below zero. Rounded up, so 0 means done. */
export function remainingFrom(endsAt, now) {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** The longest session a saved one may claim: the server clamps to six hours too. */
const MAX_SEC = 6 * 3600;

/**
 * What a saved session becomes on load.
 *   { action: 'none' }                       nothing usable (or another account's)
 *   { action: 'finish', mode, durationSec }  it ended while the app was gone: count it once
 *   { action: 'resume', mode, durationSec, endsAt }
 *   { action: 'paused', mode, durationSec, remainingSec }
 */
export function restoredSession(saved, now, owner) {
  if (!saved || typeof saved !== 'object') return { action: 'none' };
  if (owner && saved.owner && saved.owner !== owner) return { action: 'none' };
  const mode = saved.mode === 'break' ? 'break' : 'focus';
  const durationSec = Math.round(Number(saved.durationSec));
  if (!(durationSec >= 60 && durationSec <= MAX_SEC)) return { action: 'none' };
  if (saved.running) {
    const endsAt = Number(saved.endsAt);
    // An end further off than a whole session is a clock that moved, not a session.
    if (!Number.isFinite(endsAt) || endsAt - now > durationSec * 1000 + 5000) return { action: 'none' };
    if (endsAt <= now) return { action: 'finish', mode, durationSec };
    return { action: 'resume', mode, durationSec, endsAt };
  }
  const remainingSec = Math.round(Number(saved.remainingSec));
  if (!(remainingSec > 0 && remainingSec <= durationSec)) return { action: 'none' };
  return { action: 'paused', mode, durationSec, remainingSec };
}

/* "12:34 focus · " in front of whatever the app titled the page. The app
   retitles on every render, so the prefix is stripped and re-added rather than
   remembering an original that may have gone stale. */
const TITLE_PREFIX = /^\d+:\d\d (focus|break) · /;

export function stripTitle(title) {
  return String(title || '').replace(TITLE_PREFIX, '');
}

export function titleWith(clock, mode, title) {
  return clock + ' ' + (mode === 'break' ? 'break' : 'focus') + ' · ' + stripTitle(title);
}

/* ---- The Pomodoro cycle ----
   Four sprints, a short break after each of the first three and a long one
   after the fourth. `cycleDone` is how many sprints of this cycle are finished
   (0..4); 4 means the long break is next (or under way). */
export const SPRINTS_PER_CYCLE = 4;
export const SHORT_BREAK_MINS = 5;
export const LONG_BREAK_MINS = 15;

function cycleCount(n) {
  const v = Math.floor(Number(n));
  return v >= 0 && v <= SPRINTS_PER_CYCLE ? v : 0;
}

/** The sprint a focus session started now would be: 1..4. Past a full cycle it starts over. */
export function sprintNumber(cycleDone) {
  const done = cycleCount(cycleDone);
  return done >= SPRINTS_PER_CYCLE ? 1 : done + 1;
}

/**
 * What a finished session lines up next — never auto-started.
 *   focus done → a break, 15 minutes after the 4th sprint, else 5
 *   break done → the last sprint length again; after the long break a new cycle
 * Returns { cycleDone, mode, mins, suggest }.
 */
export function afterSession(doneMode, cycleDone, lastFocusMins) {
  const done = cycleCount(cycleDone);
  if (doneMode === 'focus') {
    // A sprint run straight after a finished cycle (long break skipped) is sprint 1 of the next.
    const now = (done >= SPRINTS_PER_CYCLE ? 0 : done) + 1;
    const long = now >= SPRINTS_PER_CYCLE;
    return {
      cycleDone: now,
      mode: 'break',
      mins: long ? LONG_BREAK_MINS : SHORT_BREAK_MINS,
      suggest: long
        ? 'Four sprints done. Take a ' + LONG_BREAK_MINS + '-minute break?'
        : 'Sprint ' + now + ' of ' + SPRINTS_PER_CYCLE + ' done. Take your ' + SHORT_BREAK_MINS + '-minute break?',
    };
  }
  const next = done >= SPRINTS_PER_CYCLE ? 0 : done;
  const mins = Number(lastFocusMins) >= 1 ? Number(lastFocusMins) : 25;
  return {
    cycleDone: next,
    mode: 'focus',
    mins,
    suggest: 'Break over. Ready for sprint ' + (next + 1) + ' of ' + SPRINTS_PER_CYCLE + '?',
  };
}

/** The line over the controls: "Sprint 2 of 4", "Long break", "Break · 1 of 4 done". */
export function cycleLabel(mode, cycleDone) {
  const done = cycleCount(cycleDone);
  if (mode === 'break') {
    return done >= SPRINTS_PER_CYCLE ? 'Long break' : 'Break · ' + done + ' of ' + SPRINTS_PER_CYCLE + ' done';
  }
  return 'Sprint ' + sprintNumber(done) + ' of ' + SPRINTS_PER_CYCLE;
}

/* ---- The daily focus goal ---- */

/** The goal from ui_prefs (`focusGoalMins`): 0 = off, else 1..720 minutes. Mirrors FocusService.goalFromPrefs. */
export function goalMinutes(raw) {
  const v = Math.round(Number(raw));
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, 720);
}

/**
 * The history chart's bars: one per value, left to right, inside width × height.
 * Heights scale to the larger of the busiest day and the goal (so the goal line
 * stays on the chart); a day with any focus gets at least 2px, so it shows.
 * Returns { bars: [{x, y, w, h}], max }.
 */
export function barLayout(values, width, height, goal) {
  const n = values.length;
  const max = Math.max(1, goalMinutes(goal), ...values.map((v) => Number(v) || 0));
  const slot = n ? width / n : 0;
  const w = Math.max(1, slot * 0.7);
  const bars = values.map(function (v, i) {
    const m = Math.max(0, Number(v) || 0);
    const bh = m > 0 ? Math.max(2, (m / max) * height) : 0;
    return { x: i * slot + (slot - w) / 2, y: height - bh, w, h: bh };
  });
  return { bars, max };
}

/** Share of the goal met today, 0..1. */
export function goalProgress(todayMinutes, goal) {
  const g = goalMinutes(goal);
  if (!g) return 0;
  return Math.max(0, Math.min(1, (Number(todayMinutes) || 0) / g));
}
