/* =====================================================================
   Growth Buddy — Report look-backs
   Pure functions behind the Report's year in pixels, personal records,
   period comparison and month-in-review card. No DOM, and its one import
   (i18n.js) is DOM-free too, so `node scripts/review.test.mjs` can check them.
   Everything reads data the
   app already holds: the local trends/wellness stores, the habit list, Money,
   and the history app.js `loadInsightHistory` fetches when Report opens.
   ===================================================================== */

import { fmtDate } from './i18n.js';

const DAY_MS = 86400000;
const MOOD = { low: 1, okay: 2, good: 3, great: 4 };

// Date keys are walked in UTC so a DST change never skips or repeats a day.
const dayNum = (key) => Math.floor(Date.parse(key + 'T00:00:00Z') / DAY_MS);
const dayKey = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Local YYYY-MM-DD of a Date or an instant. */
export function localKey(d) {
  const t = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
}

/** `n` date keys ending at `endKey`, oldest first. */
export function daysEnding(endKey, n) {
  const end = dayNum(endKey);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(end - i));
  return out;
}

/**
 * Daily habits done per day as a 0-1 share, from `/api/habits/:id/history`.
 * Runs from each habit's `since` to yesterday: today is still in progress.
 */
function habitShares(habitHistory, today) {
  const done = {};
  const total = {};
  const last = dayNum(today) - 1;
  for (const id in habitHistory || {}) {
    const hist = habitHistory[id];
    if (!hist || !hist.since) continue;
    const hit = new Set(
      (hist.days || []).filter((d) => d.done || d.protectedDay).map((d) => String(d.date))
    );
    for (let n = dayNum(String(hist.since)); n <= last; n++) {
      const k = dayKey(n);
      total[k] = (total[k] || 0) + 1;
      if (hit.has(k)) done[k] = (done[k] || 0) + 1;
    }
  }
  const out = {};
  for (const k in total) if (total[k]) out[k] = (done[k] || 0) / total[k];
  return out;
}

/**
 * One 0-1 value per date key for the year-in-pixels grid; a day with nothing
 * logged is absent (blank), never 0 (a bad day).
 * metric: 'score' | 'mood' | 'habits'
 */
export function pixelValues(metric, { trends, wellness, habitHistory, today } = {}) {
  const out = {};
  if (metric === 'score') {
    // Today's score is still climbing: as a finished day it shaded the square as
    // the worst level and dragged the average. Blank until the day is over.
    const todayKey = today || localKey(new Date());
    const by = (trends && trends.byDate) || {};
    for (const k in by) {
      if (k >= todayKey) continue;
      const v = Number(by[k] && by[k].score);
      if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v / 100));
    }
  } else if (metric === 'mood') {
    const by = (wellness && wellness.moodByDate) || {};
    for (const k in by) {
      const v = MOOD[by[k] && by[k].mood];
      if (v) out[k] = (v - 1) / 3;
    }
  } else if (metric === 'habits') {
    Object.assign(out, habitShares(habitHistory, today || localKey(new Date())));
  }
  return out;
}

/** Monday of the week holding `key`, as a key. */
function weekStart(key) {
  const n = dayNum(key);
  const dow = (new Date(n * DAY_MS).getUTCDay() + 6) % 7; // Mon = 0
  return dayKey(n - dow);
}

/**
 * Best-ever numbers from data already loaded. Each record is
 * {icon, label, value, sub}; one whose data is missing is left out.
 * `fmtMoney` formats a spend total in the user's currency.
 */
export function personalRecords({ habits, trends, focus, money, today, fmtMoney } = {}) {
  const out = [];
  const todayKey = today || localKey(new Date());

  const best = (habits || []).reduce(
    (m, x) => ((x.longestStreak || 0) > (m ? m.longestStreak || 0 : 0) ? x : m),
    null
  );
  if (best && best.longestStreak > 0)
    out.push({
      icon: 'flame',
      label: 'Longest streak',
      value: best.longestStreak + (best.longestStreak === 1 ? ' day' : ' days'),
      sub: best.name,
    });

  const byDay = {};
  for (const s of focus || []) {
    if (!s || !(s.durationSec > 0) || !s.completedAt) continue;
    const k = localKey(Date.parse(s.completedAt));
    byDay[k] = (byDay[k] || 0) + s.durationSec;
  }
  const focusDay = Object.keys(byDay).sort((a, b) => byDay[b] - byDay[a] || (a < b ? 1 : -1))[0];
  if (focusDay)
    out.push({
      icon: 'timer',
      label: 'Best focus day',
      value: fmtMinutes(byDay[focusDay] / 60),
      sub: shortDate(focusDay) + ' · last 30 days',
    });

  // A day counts once water reaches that day's own goal; a gap in the log ends a run.
  const by = (trends && trends.byDate) || {};
  let run = 0;
  let top = 0;
  let prev = null;
  for (const k of Object.keys(by).sort()) {
    const e = by[k];
    const met = e && e.waterGoalMl > 0 && e.waterMl >= e.waterGoalMl;
    run = met ? (prev != null && dayNum(k) === prev + 1 && run > 0 ? run + 1 : 1) : 0;
    prev = dayNum(k);
    top = Math.max(top, run);
  }
  if (top > 0)
    out.push({
      icon: 'droplets',
      label: 'Longest water streak',
      value: top + (top === 1 ? ' day' : ' days'),
      sub: 'daily goal reached',
    });

  // Only finished weeks with something logged: an untracked week is not a frugal one.
  const thisWeek = weekStart(todayKey);
  const weeks = {};
  for (const e of (money && money.expenses) || []) {
    if (!e || !e.date) continue;
    const w = weekStart(e.date);
    if (w < thisWeek) weeks[w] = (weeks[w] || 0) + (Number(e.amount) || 0);
  }
  for (const k of (money && money.noSpendDays) || []) {
    const w = weekStart(k);
    if (w < thisWeek && !(w in weeks)) weeks[w] = 0;
  }
  const keys = Object.keys(weeks);
  if (keys.length >= 2) {
    const low = keys.sort((a, b) => weeks[a] - weeks[b] || (a < b ? 1 : -1))[0];
    out.push({
      icon: 'wallet',
      label: 'Lowest-spend week',
      value: fmtMoney ? fmtMoney(weeks[low]) : String(Math.round(weeks[low])),
      sub: 'week of ' + shortDate(low),
    });
  }
  return out;
}

/**
 * Mean of this period against the one before it. null when either side has
 * fewer than 2 logged values (a single day is not a period).
 */
export function periodDelta(current, previous) {
  const ok = (xs) => xs.filter((v) => v != null && !Number.isNaN(v));
  const a = ok(current);
  const b = ok(previous);
  if (a.length < 2 || b.length < 2) return null;
  const cur = mean(a);
  const prev = mean(b);
  return { cur, prev, diff: cur - prev, pct: prev ? (cur - prev) / Math.abs(prev) : null };
}

/**
 * The month-in-review story card (shape `share-card.js` draws), or null when
 * the month has nothing to show.
 */
export function monthReview({ trends, wellness, habits, history, today, month } = {}) {
  const todayKey = today || localKey(new Date());
  // `month` ('YYYY-MM') reviews an earlier month: Report offers last month on the
  // 1st to 3rd, when this one has a day or two in it.
  const prefix = month || todayKey.slice(0, 7);
  const past = prefix < todayKey.slice(0, 7);
  const inMonth = (k) => typeof k === 'string' && k.slice(0, 7) === prefix;
  const monthName = fmtDate(prefix, 'month');

  const by = (trends && trends.byDate) || {};
  // Finished days only (see pixelValues): on the 3rd, today's 0 turned 47% into 31%.
  const scores = Object.keys(by)
    .filter((k) => inMonth(k) && k < todayKey)
    .map((k) => Number(by[k].score))
    .filter(Number.isFinite);
  const waterDays = Object.keys(by).filter(
    (k) => inMonth(k) && by[k].waterGoalMl > 0 && by[k].waterMl >= by[k].waterGoalMl
  ).length;
  const h = history || {};
  const finished = (h.finished || []).filter(
    (t) => t && t.doneAt && inMonth(localKey(Date.parse(t.doneAt)))
  ).length;
  const focusMin =
    (h.focus || [])
      .filter((s) => s && s.completedAt && inMonth(localKey(Date.parse(s.completedAt))))
      .reduce((a, s) => a + (s.durationSec || 0), 0) / 60;
  // The streak is today's, not the month's: labelled so, and left off a past month.
  const streak = past ? 0 : (habits || []).reduce((m, x) => Math.max(m, x.streak || 0), 0);
  const moods = Object.keys((wellness && wellness.moodByDate) || {})
    .filter(inMonth)
    .map((k) => MOOD[wellness.moodByDate[k].mood])
    .filter(Boolean);

  const stats = [
    finished && { label: 'Tasks finished', value: String(finished) },
    focusMin >= 1 && { label: 'Focus time', value: fmtMinutes(focusMin) },
    streak && { label: 'Current streak', value: streak + (streak === 1 ? ' day' : ' days') },
    waterDays && {
      label: 'Water goal hit',
      value: waterDays + (waterDays === 1 ? ' day' : ' days'),
    },
  ].filter(Boolean);
  if (!scores.length && !stats.length) return null;

  const good = moods.filter((v) => v >= 3).length;
  return {
    eyebrow: monthName + ' in review',
    headline: scores.length ? Math.round(mean(scores)) + '%' : stats[0].value,
    sub: scores.length ? 'average daily score' : stats[0].label.toLowerCase(),
    stats: (scores.length ? stats : stats.slice(1)).slice(0, 3),
    note:
      moods.length >= 3
        ? 'Mood was good or great on ' + good + ' of ' + moods.length + ' check-ins.'
        : 'Every day logged makes next month clearer.',
    month: prefix,
    footer: 'Tracked with Growth Buddy',
  };
}

/**
 * Daily values averaged per Monday-start week, for the 1-year trend.
 * `values[i]` belongs to `days[i]` (keys, oldest first). A null / NaN day is
 * skipped; a week with nothing logged is null (a gap, never 0).
 * Returns {keys: week-start keys, values: averages, counts: days logged}.
 */
export function weeklyBuckets(days, values) {
  const keys = [];
  const sums = [];
  const counts = [];
  (days || []).forEach((d, i) => {
    const w = weekStart(d);
    if (keys[keys.length - 1] !== w) {
      keys.push(w);
      sums.push(0);
      counts.push(0);
    }
    const v = values[i];
    if (v != null && Number.isFinite(v)) {
      sums[sums.length - 1] += v;
      counts[counts.length - 1]++;
    }
  });
  return { keys, values: sums.map((s, i) => (counts[i] ? s / counts[i] : null)), counts };
}

/**
 * Where each month starts in `keys`, as [{i, month: 'YYYY-MM'}], for axis
 * labels. A tick closer than `minGap` positions to the next one is dropped
 * (a stub month at the left edge would print on top of its neighbour).
 */
export function monthTicks(keys, minGap = 0) {
  const all = [];
  (keys || []).forEach((k, i) => {
    const month = String(k).slice(0, 7);
    if (!all.length || all[all.length - 1].month !== month) all.push({ i, month });
  });
  return all.filter((t, j) => j === all.length - 1 || all[j + 1].i - t.i >= minGap);
}

/**
 * Pearson r between two {dateKey: number} series over the days both logged.
 * `before` drops that day and later (today is half-logged). null under `min`
 * shared days, or when either side never varies (r is undefined there, not 0).
 * Returns {r, n, points: [{key, x, y}] oldest first}.
 */
export function correlate(xs, ys, { min = 14, before } = {}) {
  const points = [];
  for (const key in xs || {}) {
    if (before && key >= before) continue;
    const x = xs[key];
    const y = ys ? ys[key] : undefined;
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({ key, x, y });
  }
  const n = points.length;
  if (n < Math.max(2, min)) return null;
  points.sort((a, b) => (a.key < b.key ? -1 : 1));
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return { r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), n, points };
}

/**
 * Plain words for an r: {strength: 'none'|'weak'|'moderate'|'strong', text}.
 * Cut-offs are the usual rough ones (0.1 / 0.3 / 0.5).
 */
export function correlationWords(r) {
  const a = Math.abs(r);
  const strength = a < 0.1 ? 'none' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : 'strong';
  if (strength === 'none') return { strength, text: 'No clear link' };
  return {
    strength,
    text:
      strength[0].toUpperCase() +
      strength.slice(1) +
      (r > 0 ? ' link: they tend to rise together' : ' link: when one is higher, the other tends to be lower'),
  };
}

/** Completed focus minutes per local day, from `/api/focus` sessions. */
export function focusMinutesByDay(sessions) {
  const out = {};
  for (const s of sessions || []) {
    if (!s || !(s.durationSec > 0) || !s.completedAt) continue;
    const t = Date.parse(s.completedAt);
    if (!Number.isFinite(t)) continue;
    const k = localKey(t);
    out[k] = (out[k] || 0) + s.durationSec / 60;
  }
  return out;
}

/**
 * This calendar week (Monday to yesterday: today is half-logged) against the
 * whole week before, as a per-day average of each `fields` entry of
 * `byDate[key]` over the days that logged it. 0 / missing is "not logged": the
 * daily snapshot writes 0 water and 0 kcal on a day nothing was entered.
 * Returns [{field, cur, prev, curDays, prevDays, diff}]; a field neither week
 * logged is left out, `cur`/`prev`/`diff` are null for a week with none.
 */
export function weekOverWeek(byDate, today, fields) {
  const start = dayNum(weekStart(today));
  const end = dayNum(today);
  const avg = (from, to, f) => {
    const xs = [];
    for (let n = from; n < to; n++) {
      const e = byDate && byDate[dayKey(n)];
      const v = e ? Number(e[f]) : NaN;
      if (Number.isFinite(v) && v > 0) xs.push(v);
    }
    return { v: xs.length ? mean(xs) : null, n: xs.length };
  };
  const out = [];
  for (const field of fields || []) {
    const cur = avg(start, end, field);
    const prev = avg(start - 7, start, field);
    if (!cur.n && !prev.n) continue;
    out.push({
      field,
      cur: cur.v,
      prev: prev.v,
      curDays: cur.n,
      prevDays: prev.n,
      diff: cur.n && prev.n ? cur.v - prev.v : null,
    });
  }
  return out;
}

function fmtMinutes(min) {
  const m = Math.round(min);
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min';
}

function shortDate(key) {
  return fmtDate(key, 'dayMonth');
}
