/* =====================================================================
   Growth Buddy — a habit's history, as numbers. No DOM, so
   `node scripts/habit-stats.test.mjs` can check it; app.js draws it.

   Input is what GET /api/habits/{id}/history answers: `since` (the habit's
   creation day in the user's zone, or the window's start if it is older) and
   `days` — only the days that HAVE a check-in row, each `{date, done,
   protectedDay}`. A day with no row is a day nothing was recorded. All dates
   are YYYY-MM-DD keys in the account's zone; nothing here reads a clock.

   The streak rules mirror HabitService: a daily run counts done days and lets
   a protected (freeze) day bridge a gap without adding to it; a weekly /
   N-a-week run counts ISO weeks (Monday start) whose done days met the quota.
   A quit ("break a habit", `kind: 'quit'`) habit inverts it: a day is clean
   unless its row is a slip (not done, not frozen), and its streak is the days
   since the last slip (HabitService.quitStreak / longestQuitRun).
   ===================================================================== */

const DAY_MS = 86400000;

function toUtc(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  const d = new Date(ms);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/** `key` moved by `n` days (negative = back). */
export function addDays(key, n) {
  return fromUtc(toUtc(key) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysFrom(a, b) {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** The Monday of `key`'s ISO week — the bucket HabitService.weekStartOf uses. */
export function isoWeekStart(key) {
  const dow = new Date(toUtc(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

function byDate(days) {
  const out = {};
  (days || []).forEach((r) => {
    if (r && r.date) out[r.date] = r;
  });
  return out;
}

/** On a quit habit, the row that records a slip (HabitService.isSlip). */
export function isSlipRow(row) {
  return !!row && !row.done && !row.protectedDay;
}

/**
 * A quit habit's streak, HabitService.quitStreak: the clean days in the run
 * ending today, today included unless it was slipped — days since the last
 * slip, or since `since` when there has been none. Day one reads 1.
 */
export function quitStreak({ days, since, today }) {
  let anchor = addDays(since || today, -1);
  (days || []).forEach((r) => {
    if (isSlipRow(r) && r.date <= today && r.date > anchor) anchor = r.date;
  });
  return Math.max(0, daysFrom(anchor, today));
}

/** The longest clean run between slips (from `since`, and up to today) — HabitService.longestQuitRun. */
export function longestQuitRun({ days, since, today }) {
  const slips = [...new Set((days || []).filter(isSlipRow).map((r) => r.date))]
    .filter((d) => d <= today)
    .sort();
  let prev = addDays(since || today, -1);
  let best = 0;
  slips.forEach((s) => {
    if (s <= prev) return;
    best = Math.max(best, daysFrom(prev, s) - 1);
    prev = s;
  });
  return Math.max(best, daysFrom(prev, today));
}

/**
 * The days that carry a note, newest first, at most `limit` — the history
 * panel's "Recent notes". Each `{date, note, state}` with the day's dayState.
 */
export function recentNotes({ days, since, today, cadence, kind, limit = 5 }) {
  return (days || [])
    .filter((r) => r && r.date && typeof r.note === 'string' && r.note.trim())
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit)
    .map((r) => ({
      date: r.date,
      note: r.note.trim(),
      state: dayState(r, r.date, { today, since, cadence, kind }),
    }));
}

/** How many check-ins a week asks for: 1 for weekly, the target for N-a-week, 7 for daily. */
export function requiredPerWeek(cadence, targetPerWeek) {
  if (cadence === 'weekly') return 1;
  if (cadence === 'custom') return Math.min(7, Math.max(1, Number(targetPerWeek) || 1));
  return 7;
}

/**
 * What one day of a habit was. `missed` only for a daily habit: a weekly or
 * N-a-week habit is not owed on any given day, so a day it wasn't done is
 * `open`, not a failure.
 *   future · before (the habit didn't exist yet) · done · frozen · today (not
 *   done yet, the day isn't over) · missed · open
 */
export function dayState(row, key, { today, since, cadence, kind }) {
  if (key > today) return 'future';
  if (since && key < since) return 'before';
  // A quit ("break a habit") day is clean unless its row is a slip: not done
  // and not a freeze. No row at all is the normal, clean day. Today counts as
  // clean already — there is no tick to wait for.
  if (kind === 'quit') return isSlipRow(row) ? 'slipped' : 'clean';
  if (row && row.done) return 'done';
  if (row && row.protectedDay) return 'frozen';
  if (key === today) return 'today';
  return (cadence || 'daily') === 'daily' ? 'missed' : 'open';
}

/**
 * The heatmap's grid: `weeks` ISO weeks ending with the current one, oldest
 * first, each `{ start, cells: [7 × {date, state}] }` Monday to Sunday.
 */
export function heatmapWeeks({ days, since, today, cadence, kind, weeks = 12 }) {
  const rows = byDate(days);
  const lastMonday = isoWeekStart(today);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(lastMonday, -7 * w);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      cells.push({ date, state: dayState(rows[date], date, { today, since, cadence, kind }) });
    }
    out.push({ start, cells });
  }
  return out;
}

/**
 * Share of what was owed that got done, 0..1, over the last `windowDays` days
 * (Infinity = since the habit started). Owed is the cadence's daily share —
 * 1 a day for daily, target/7 for N-a-week, 1/7 for weekly — times the days
 * that count. A frozen day is not owed (that is what the token bought), and
 * today counts only once it is done: an unticked morning is not a miss yet.
 * Capped at 1, so a habit done more often than asked reads 100%, not 140%.
 * null when no day counts yet (created today, nothing done).
 */
export function completionRate({ days, since, today, cadence, targetPerWeek, windowDays, kind }) {
  const rows = byDate(days);
  // A quit habit: the share of its days that stayed clean, today included (it
  // is clean until a slip says otherwise). Needs `since` — clean days have no row.
  if (kind === 'quit') {
    let start = since || today;
    if (Number.isFinite(windowDays)) {
      const windowStart = addDays(today, -(Math.max(1, windowDays) - 1));
      if (windowStart > start) start = windowStart;
    }
    if (start > today) return null;
    let counted = 0;
    let clean = 0;
    for (let key = start; key <= today; key = addDays(key, 1)) {
      counted++;
      if (!isSlipRow(rows[key])) clean++;
    }
    return counted ? clean / counted : null;
  }
  const earliest = (days || []).reduce((m, r) => (r.date && r.date < m ? r.date : m), today);
  let start = since || earliest;
  if (Number.isFinite(windowDays)) {
    const windowStart = addDays(today, -(Math.max(1, windowDays) - 1));
    if (windowStart > start) start = windowStart;
  }
  if (start > today) return null;
  let counted = 0;
  let done = 0;
  for (let key = start; key <= today; key = addDays(key, 1)) {
    const r = rows[key];
    const isDone = !!(r && r.done);
    if (!isDone && r && r.protectedDay) continue;
    if (key === today && !isDone) continue;
    counted++;
    if (isDone) done++;
  }
  const owed = (counted * requiredPerWeek(cadence, targetPerWeek)) / 7;
  if (owed <= 0) return null;
  return Math.min(1, done / owed);
}

/**
 * Longest streak in the history, in the cadence's unit — HabitService's
 * longestDailyRun / longestWeeklyRun over the same rows. `{ best, unit }`,
 * unit 'day' or 'week'.
 */
export function bestStreak({ days, cadence, targetPerWeek, kind, since, today }) {
  if (kind === 'quit') return { best: longestQuitRun({ days, since, today }), unit: 'day' };
  const list = (days || []).filter((r) => r && r.date);
  if ((cadence || 'daily') === 'daily') {
    const active = list
      .filter((r) => r.done || r.protectedDay)
      .map((r) => r.date)
      .sort();
    const doneSet = new Set(list.filter((r) => r.done).map((r) => r.date));
    let best = 0;
    let run = 0;
    let prev = null;
    active.forEach((d) => {
      if (prev === null || addDays(prev, 1) !== d) run = 0;
      if (doneSet.has(d)) run++;
      best = Math.max(best, run);
      prev = d;
    });
    return { best, unit: 'day' };
  }
  const need = requiredPerWeek(cadence, targetPerWeek);
  const perWeek = {};
  list
    .filter((r) => r.done)
    .forEach((r) => {
      const w = isoWeekStart(r.date);
      perWeek[w] = (perWeek[w] || 0) + 1;
    });
  const met = Object.keys(perWeek)
    .filter((w) => perWeek[w] >= need)
    .sort();
  let best = 0;
  let run = 0;
  let prev = null;
  met.forEach((w) => {
    run = prev !== null && addDays(prev, 7) === w ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w;
  });
  return { best, unit: 'week' };
}

/** Everything the history panel prints, in one call. */
export function habitStats({ days, since, today, cadence, targetPerWeek, kind }) {
  const base = { days, since, today, cadence, targetPerWeek, kind };
  const streak = bestStreak(base);
  const quit = kind === 'quit';
  return {
    rate30: completionRate({ ...base, windowDays: 30 }),
    rateAll: completionRate({ ...base, windowDays: Infinity }),
    best: streak.best,
    unit: streak.unit,
    // A quit habit's "done" rows are only notes and taken-back slips; what it
    // counts is its slips.
    doneTotal: quit ? 0 : (days || []).filter((r) => r && r.done).length,
    slips: quit ? (days || []).filter(isSlipRow).length : 0,
  };
}

/** A rate as "83%", or an em dash when there is nothing to rate yet. */
export function pctLabel(rate) {
  return rate == null ? '—' : Math.round(rate * 100) + '%';
}

/**
 * Whether a heatmap day can be ticked (or un-ticked) from the history: today
 * or one of the `maxBack` days before it, never a future day (the server
 * refuses those) and never a day before the habit existed.
 */
export function canEditDay(key, { today, since, maxBack = 7 }) {
  if (!key || key > today) return false;
  if (since && key < since) return false;
  return daysFrom(key, today) <= maxBack;
}

function minutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The time to suggest for a habit reminder: the median of the reminder times
 * the user already set on their other habits — when they like to be nudged —
 * else `fallback`. The server keeps no check-in time of day (a check-in row is
 * keyed by its date; its created_at is the first tick, not the last, and the
 * history endpoint doesn't send it), so "when they usually check in" is not
 * something the client can know. An even count takes the earlier middle, so
 * the suggestion is always a time the user actually picked.
 */
export function suggestReminderTime(habits, fallback = '19:00') {
  const times = (habits || [])
    .filter((hb) => hb && hb.active !== false)
    .map((hb) => minutes(hb.reminderTime))
    .filter((m) => m != null)
    .sort((a, b) => a - b);
  if (!times.length) return fallback;
  const m = times[Math.floor((times.length - 1) / 2)];
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

/**
 * Linked habits' done check-ins for a goal, from per-habit history
 * (`historyByHabit[id] = days[]`) between `from` and `to` inclusive.
 * `checkins` counts every done habit-day (two linked habits on one day = 2);
 * `days` counts the distinct days ANY linked habit was done — what a day
 * tracker set to count from habits reads.
 */
export function linkedHabitActivity(historyByHabit, ids, from, to) {
  let checkins = 0;
  const daySet = new Set();
  [...new Set(ids || [])].forEach((id) => {
    ((historyByHabit && historyByHabit[id]) || []).forEach((r) => {
      if (!r || !r.done || !r.date) return;
      if ((from && r.date < from) || (to && r.date > to)) return;
      checkins++;
      daySet.add(r.date);
    });
  });
  return { checkins, days: daySet.size };
}

/** The first of `today`'s month. */
export function monthStart(today) {
  return String(today).slice(0, 8) + '01';
}
