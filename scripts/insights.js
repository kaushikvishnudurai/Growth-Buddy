/* =====================================================================
   Growth Buddy — Insights engine
   Pure, dependency-free pattern finder over the local wellness + trends
   stores. No AI and nothing server-side: plain statistics over what the user
   has logged. Two kinds of finding:

   1. Pair comparisons (TESTS). Split the days at the predictor's median and
      report where the outcome differs between the high and low halves. A pair
      may carry a lag of one day, so "stress today -> sleep tonight" can be
      asked. Sleep is keyed on the WAKE date, so same-day stress -> sleep
      would be the wrong way round; that pair is lagged.
   2. Patterns: sleep debt this week, mood this week vs usual, the weekday
      mood dips / stress peaks on, and the bedtime hour the user sleeps best
      after.

   Every finding carries an `effect` (difference / outcome range) so they rank
   on one scale. Exported functions are pure so they can be unit-checked with
   plain `node` (see insights.test.mjs).
   ===================================================================== */

// Ordinal value maps for the categorical check-ins.
const ORD = { low: 1, okay: 2, good: 3, great: 4, medium: 2, high: 3, calm: 1, normal: 2 };

const MIN_DAYS = 7; // need at least this many paired days to say anything
const MIN_HALF = 3; // and at least this many days on each side of the split
const MIN_EFFECT = 0.12; // |meanHigh - meanLow| as a fraction of the outcome's range
const MIN_REL = 0.25; // for outcomes with no fixed range (spend): a 25% difference
const MAX_INSIGHTS = 6;
const DAY_MS = 86400000;

// Per-signal display metadata + outcome range (max - min) for effect sizing.
// `hi` / `lo` name the two halves of a split in the insight text.
const META = {
  sleepHours: {
    label: 'sleep',
    hi: 'longer-sleep',
    lo: 'shorter-sleep',
    icon: 'moon',
    range: 6,
    fmt: (v) => round1(v) + 'h',
  },
  sleepQuality: {
    label: 'sleep quality',
    hi: 'better-sleep',
    lo: 'worse-sleep',
    icon: 'moon',
    range: 3,
    fmt: (v) => round1(v) + '/4',
  },
  mood: {
    label: 'mood',
    hi: 'better-mood',
    lo: 'lower-mood',
    icon: 'heart',
    range: 3,
    fmt: (v) => round1(v) + '/4',
  },
  energy: {
    label: 'energy',
    hi: 'high-energy',
    lo: 'low-energy',
    icon: 'zap',
    range: 2,
    fmt: (v) => round1(v) + '/3',
  },
  stress: {
    label: 'stress',
    hi: 'high-stress',
    lo: 'calmer',
    icon: 'activity',
    range: 2,
    fmt: (v) => round1(v) + '/3',
  },
  score: {
    label: 'growth score',
    hi: 'higher-score',
    lo: 'lower-score',
    icon: 'trending-up',
    range: 100,
    fmt: (v) => Math.round(v) + '%',
  },
  water: {
    label: 'water',
    hi: 'more-water',
    lo: 'less-water',
    icon: 'droplets',
    range: 1500,
    fmt: (v) => Math.round(v) + ' ml',
  },
  kcal: {
    label: 'calories',
    hi: 'higher-calorie',
    lo: 'lower-calorie',
    icon: 'utensils',
    range: 1500,
    fmt: (v) => Math.round(v) + ' kcal',
  },
  // How far a night's bedtime sat from the user's own median bedtime.
  bedShift: {
    label: 'bedtime drift',
    hi: 'irregular-bedtime',
    lo: 'regular-bedtime',
    icon: 'moon',
    range: 3,
    fmt: (v) => round1(v) + 'h',
  },
  // No fixed range: effect is relative to the larger half (see MIN_REL).
  spend: {
    label: 'spending',
    hi: 'higher-spend',
    lo: 'lower-spend',
    icon: 'wallet',
    range: null,
    fmt: (v) => String(Math.round(v)),
  },
};

// [predictor x, outcome y, lag in days]. lag 1 pairs x on day d with y on d+1.
const TESTS = [
  ['sleepHours', 'mood'],
  ['sleepQuality', 'mood'],
  ['sleepHours', 'score'],
  ['sleepHours', 'energy'],
  ['bedShift', 'mood'],
  ['bedShift', 'energy'],
  ['mood', 'score'],
  ['water', 'score'],
  ['water', 'energy'],
  ['kcal', 'energy'],
  ['stress', 'sleepQuality', 1],
  ['stress', 'sleepHours', 1],
  ['stress', 'spend'],
  ['spend', 'mood'],
];

const WEEKDAYS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

function round1(v) {
  return Math.round(v * 10) / 10;
}

function ord(v) {
  return ORD[v];
}

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Day number for a YYYY-MM-DD key; NaN for anything else. */
function dayNum(key) {
  return Date.parse(key + 'T00:00:00Z') / DAY_MS;
}

function dayKey(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** "HH:MM" -> minutes after noon, so a bedtime either side of midnight sorts in order. */
function bedMinutes(bedtime) {
  const [h, m] = String(bedtime || '')
    .split(':')
    .map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60 + m + 720) % 1440;
}

/** Sleep hours from "HH:MM" bedtime/wake, handling the midnight wrap. */
function sleepHours(bedtime, wakeTime) {
  if (!bedtime || !wakeTime) return null;
  const [bh, bm] = String(bedtime).split(':').map(Number);
  const [wh, wm] = String(wakeTime).split(':').map(Number);
  if (![bh, bm, wh, wm].every(Number.isFinite)) return null;
  let mins = wh * 60 + wm - (bh * 60 + bm);
  if (mins <= 0) mins += 24 * 60; // crossed midnight
  const hrs = mins / 60;
  return hrs > 0 && hrs < 18 ? hrs : null; // ignore obviously bad entries
}

/** Build a {date: number} series from a store, dropping null/non-finite values. */
function series(store, fn) {
  const out = {};
  for (const k in store || {}) {
    const v = fn(store[k]);
    if (v != null && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Re-key a series so that out[d] holds the value from day d + lag. */
export function shift(s, lag) {
  if (!lag) return s;
  const out = {};
  for (const k in s) {
    const n = dayNum(k);
    if (Number.isFinite(n)) out[dayKey(n - lag)] = s[k];
  }
  return out;
}

/**
 * Split the days by predictor xs at its median and compare outcome ys between
 * the halves. Returns {meanHigh, meanLow, n, diff} or null if too little data.
 */
export function compare(xs, ys) {
  const dates = Object.keys(xs).filter((d) => d in ys);
  if (dates.length < MIN_DAYS) return null;
  const mid = median(dates.map((d) => xs[d]));
  const high = [];
  const low = [];
  for (const d of dates) {
    (xs[d] >= mid ? high : low).push(ys[d]);
  }
  if (high.length < MIN_HALF || low.length < MIN_HALF) return null; // too lopsided (e.g. all ties)
  const meanHigh = mean(high);
  const meanLow = mean(low);
  return { meanHigh, meanLow, n: dates.length, diff: meanHigh - meanLow };
}

/** Total spend per date from the money doc's expenses list. */
function spendByDate(money) {
  const out = {};
  const expenses = (money && money.expenses) || [];
  for (const e of expenses) {
    const amt = Number(e && e.amount);
    if (e && e.date && Number.isFinite(amt)) out[e.date] = (out[e.date] || 0) + amt;
  }
  return out;
}

/** Compute all signal series from the local stores. */
export function signals({ wellness, trends, money }) {
  const sleep = (wellness && wellness.sleepByDate) || {};
  const mood = (wellness && wellness.moodByDate) || {};
  const byDate = (trends && trends.byDate) || {};
  const bedtime = series(sleep, (e) => bedMinutes(e.bedtime));
  const vals = Object.values(bedtime);
  const usualBed = vals.length ? median(vals) : 0;
  // "Irregular" needs a usual bedtime to drift from. Bedtimes in two equal camps
  // (23:00 and 00:45) put the median at the edge of one camp, and the other camp
  // comes out as the drifters, so a regular 23:00 night reads as irregular.
  // Only measure drift when most nights sit within an hour of the median.
  const settled = vals.filter((m) => Math.abs(m - usualBed) <= 60).length > vals.length / 2;
  return {
    sleepHours: series(sleep, (e) => sleepHours(e.bedtime, e.wakeTime)),
    sleepQuality: series(sleep, (e) => ord(e.quality)),
    bedtime,
    bedShift: settled ? series(bedtime, (m) => Math.abs(m - usualBed) / 60) : {},
    mood: series(mood, (e) => ord(e.mood)),
    energy: series(mood, (e) => ord(e.energy)),
    stress: series(mood, (e) => ord(e.stress)),
    score: series(byDate, (e) => Number(e.score)),
    water: series(byDate, (e) => Number(e.waterMl)),
    // 0 means nothing was logged that day, not a fast.
    kcal: series(byDate, (e) => Number(e.kcal) || null),
    spend: spendByDate(money),
  };
}

/** One pair comparison -> insight card, or null when there is nothing real. */
function pairInsight(sig, [x, y, lag = 0]) {
  const r = compare(sig[x], shift(sig[y], lag));
  if (!r) return null;
  const xm = META[x];
  const ym = META[y];
  const effect =
    ym.range == null
      ? Math.abs(r.diff) / Math.max(Math.abs(r.meanHigh), Math.abs(r.meanLow), 1)
      : Math.abs(r.diff) / ym.range;
  if (effect < (ym.range == null ? MIN_REL : MIN_EFFECT)) return null;
  const dir = r.diff >= 0 ? 'higher' : 'lower';
  const when = lag ? 'The day after ' + xm.hi + ' days' : 'On your ' + xm.hi + ' days';
  const vs = lag ? ' the day after ' : ' on ';
  return {
    icon: ym.icon,
    title: cap(xm.label) + (lag ? ' → next-day ' : ' ↔ ') + ym.label,
    text:
      when +
      ', ' +
      ym.label +
      ' runs ' +
      dir +
      ': ' +
      ym.fmt(r.meanHigh) +
      ' vs ' +
      ym.fmt(r.meanLow) +
      vs +
      xm.lo +
      ' days (' +
      r.n +
      ' days).',
    effect,
  };
}

/** Split a series into the latest 7 days and everything before them. */
function thisWeek(s) {
  const keys = Object.keys(s).filter((k) => Number.isFinite(dayNum(k)));
  if (!keys.length) return null;
  const end = Math.max(...keys.map(dayNum));
  const recent = keys.filter((k) => end - dayNum(k) < 7).map((k) => s[k]);
  const before = keys.filter((k) => end - dayNum(k) >= 7).map((k) => s[k]);
  if (recent.length < 4 || before.length < MIN_DAYS) return null;
  return { recent: mean(recent), usual: mean(before), nights: recent.length };
}

/** Sleeping less than usual this week, as total hours owed. */
function sleepDebt(sig) {
  const w = thisWeek(sig.sleepHours);
  if (!w) return null;
  const gap = w.usual - w.recent;
  if (gap < 0.5) return null;
  const f = META.sleepHours.fmt;
  return {
    icon: 'moon',
    title: 'Sleep debt this week',
    text:
      'You averaged ' +
      f(w.recent) +
      ' a night over the last ' +
      w.nights +
      ' nights, against your usual ' +
      f(w.usual) +
      '. That is about ' +
      f(gap * w.nights) +
      ' short.',
    effect: gap / META.sleepHours.range,
  };
}

/** Mood this week vs the weeks before it, either direction. */
function moodShift(sig) {
  const w = thisWeek(sig.mood);
  if (!w) return null;
  const diff = w.recent - w.usual;
  const effect = Math.abs(diff) / META.mood.range;
  if (effect < MIN_EFFECT) return null;
  const f = META.mood.fmt;
  return {
    icon: 'heart',
    title: diff < 0 ? 'Mood dipping this week' : 'Mood lifting this week',
    text:
      'This week your mood averaged ' +
      f(w.recent) +
      ', ' +
      (diff < 0 ? 'below' : 'above') +
      ' your usual ' +
      f(w.usual) +
      '.',
    effect,
  };
}

/** The weekday a signal runs furthest from the user's average, in one direction. */
function weekdayPattern(sig, key, worst) {
  const s = sig[key];
  const groups = [[], [], [], [], [], [], []];
  for (const k in s) {
    const n = dayNum(k);
    if (Number.isFinite(n)) groups[new Date(n * DAY_MS).getUTCDay()].push(s[k]);
  }
  const all = groups.flat();
  if (all.length < 14) return null;
  const overall = mean(all);
  let pick = -1;
  let pickMean = 0;
  groups.forEach((g, i) => {
    if (g.length < 2) return;
    const m = mean(g);
    if (pick < 0 || (worst === 'min' ? m < pickMean : m > pickMean)) {
      pick = i;
      pickMean = m;
    }
  });
  if (pick < 0) return null;
  const meta = META[key];
  const effect = Math.abs(pickMean - overall) / meta.range;
  if (effect < MIN_EFFECT) return null;
  const which = worst === 'min' ? 'lowest-' + meta.label : 'highest-' + meta.label;
  return {
    icon: 'calendar',
    title: WEEKDAYS[pick] + ' and your ' + meta.label,
    text:
      WEEKDAYS[pick] +
      ' are your ' +
      which +
      ' day: ' +
      meta.fmt(pickMean) +
      ' vs ' +
      meta.fmt(overall) +
      ' on average (' +
      groups[pick].length +
      ' ' +
      WEEKDAYS[pick] +
      ').',
    effect,
  };
}

/** The bedtime hour after which the user rates their sleep best. */
function bestBedtime(sig) {
  const buckets = {};
  let n = 0;
  for (const k in sig.bedtime) {
    const q = sig.sleepQuality[k];
    if (q == null) continue;
    const b = Math.floor(sig.bedtime[k] / 60);
    (buckets[b] = buckets[b] || []).push(q);
    n++;
  }
  if (n < 10) return null;
  let best = null;
  for (const b in buckets) {
    if (buckets[b].length < 3) continue;
    const m = mean(buckets[b]);
    if (!best || m > best.m) best = { b: Number(b), m };
  }
  if (!best) return null;
  const others = Object.keys(buckets)
    .filter((b) => Number(b) !== best.b)
    .flatMap((b) => buckets[b]);
  if (others.length < 3) return null;
  const rest = mean(others);
  const effect = (best.m - rest) / META.sleepQuality.range;
  if (effect < MIN_EFFECT) return null;
  const f = META.sleepQuality.fmt;
  return {
    icon: 'moon',
    title: 'Your best bedtime',
    text:
      'You rate your sleep best when you go to bed between ' +
      hh(best.b + 12) +
      ' and ' +
      hh(best.b + 13) +
      ': ' +
      f(best.m) +
      ' vs ' +
      f(rest) +
      ' on other nights (' +
      n +
      ' nights).',
    effect,
  };
}

/* ---------------------------------------------------------------------
   Everything below reads history the Report screen fetches on open
   (app.js `loadInsightHistory`): focus sessions, daily habits' check-ins,
   finished tasks, water log times and two finished days' score parts. Times
   are instants; the hour and the day are taken in the device's own zone.
   --------------------------------------------------------------------- */

const pct = (v) => Math.round(v * 100) + '%';
const hh = (h) => String(h % 24).padStart(2, '0') + ':00';
const fmtMoney = (v) => Math.round(v).toLocaleString();

/** Local YYYY-MM-DD of a Date. */
function localKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** The two-hour window in which focus sessions run longest. */
export function focusHours(sessions) {
  const ok = (sessions || []).filter((s) => s && s.durationSec > 0 && s.completedAt);
  if (ok.length < 10) return null;
  // The hour a session STARTED is the one the user chose; it ended an hour later.
  const at = ok.map((s) => ({
    h: new Date(Date.parse(s.completedAt) - s.durationSec * 1000).getHours(),
    min: s.durationSec / 60,
  }));
  let best = null;
  for (let h = 0; h < 24; h++) {
    const inside = at.filter((x) => x.h === h || x.h === (h + 1) % 24).map((x) => x.min);
    const rest = at.filter((x) => x.h !== h && x.h !== (h + 1) % 24).map((x) => x.min);
    // A window opens on an hour that has sessions, or an empty 08:00 ties with 09:00.
    if (!at.some((x) => x.h === h) || inside.length < 3 || rest.length < 3) continue;
    const lift = mean(inside) / mean(rest) - 1;
    if (!best || lift > best.lift) best = { h, lift, inside: mean(inside), rest: mean(rest) };
  }
  if (!best || best.lift < 0.2) return null;
  return {
    icon: 'timer',
    title: 'Your best focus hours',
    text:
      'You focus best between ' +
      hh(best.h) +
      ' and ' +
      hh(best.h + 2) +
      '. Sessions started then run ' +
      pct(best.lift) +
      ' longer (' +
      Math.round(best.inside) +
      ' vs ' +
      Math.round(best.rest) +
      ' min). A good slot for hard tasks.',
    effect: Math.min(best.lift, 1) / 2,
  };
}

/**
 * Each daily habit as {name, days: [{key, done}]}, from the day it started (or
 * the history window) to yesterday. A protected (frozen) day is not a miss.
 */
export function habitDays(habits, history, today) {
  const out = [];
  const end = dayNum(today) - 1;
  for (const hab of habits || []) {
    const hist = hab && history && history[hab.id];
    if (!hist || hab.cadence !== 'daily') continue;
    const done = new Set(
      (hist.days || []).filter((d) => d.done || d.protectedDay).map((d) => String(d.date))
    );
    const days = [];
    for (let n = dayNum(String(hist.since)); n <= end; n++) {
      const key = dayKey(n);
      days.push({ key, done: done.has(key) });
    }
    if (days.length) out.push({ id: hab.id, name: hab.name, doneToday: !!hab.doneToday, days });
  }
  return out;
}

/** The weekday one daily habit is missed on far more than the others. */
export function habitWeekdayMiss(hdays) {
  let best = null;
  for (const hab of hdays) {
    if (hab.days.length < 14) continue;
    const by = [[], [], [], [], [], [], []];
    for (const d of hab.days) by[new Date(dayNum(d.key) * DAY_MS).getUTCDay()].push(!d.done);
    const overall = hab.days.filter((d) => !d.done).length / hab.days.length;
    by.forEach((g, i) => {
      const missed = g.filter(Boolean).length;
      if (g.length < 2 || missed < 2) return;
      const gap = missed / g.length - overall;
      if (gap >= 0.25 && (!best || gap > best.gap))
        best = { name: hab.name, i, missed, of: g.length, gap };
    });
  }
  if (!best) return null;
  return {
    icon: 'calendar',
    title: best.name + ' on ' + WEEKDAYS[best.i],
    text:
      'You skip ' +
      best.name +
      ' most on ' +
      WEEKDAYS[best.i] +
      ': missed ' +
      best.missed +
      ' of ' +
      best.of +
      '. Plan a smaller version for that day.',
    effect: best.gap,
  };
}

/**
 * "Never miss twice": how often one missed day (after a done one) became two.
 * Only shown when a habit was missed yesterday and isn't done yet today.
 */
export function missTwice(hdays) {
  let single = 0;
  let twice = 0;
  for (const hab of hdays) {
    const d = hab.days;
    for (let i = 1; i + 1 < d.length; i++) {
      if (d[i - 1].done && !d[i].done) {
        single++;
        if (!d[i + 1].done) twice++;
      }
    }
  }
  if (single < 4 || twice / single < 0.5) return null;
  const now = hdays.find((hab) => {
    const d = hab.days;
    return d.length >= 2 && !d[d.length - 1].done && d[d.length - 2].done && !hab.doneToday;
  });
  if (!now) return null;
  return {
    icon: 'flame',
    title: 'Never miss twice',
    text:
      now.name +
      ' slipped yesterday. After one missed day you usually miss the next one too (' +
      twice +
      ' of ' +
      single +
      ' times). Today matters.',
    effect: 0.6,
  };
}

/** The daily habit whose done days line up with the best mood. */
export function keystoneHabit(hdays, sig) {
  let best = null;
  for (const hab of hdays) {
    const on = [];
    const off = [];
    for (const d of hab.days) {
      const m = sig.mood[d.key];
      if (m != null) (d.done ? on : off).push(m);
    }
    if (on.length < MIN_HALF || off.length < MIN_HALF || on.length + off.length < MIN_DAYS)
      continue;
    const diff = mean(on) - mean(off);
    if (diff / META.mood.range >= MIN_EFFECT && (!best || diff > best.diff))
      best = { name: hab.name, diff, on: mean(on), off: mean(off), n: on.length + off.length };
  }
  if (!best) return null;
  const f = META.mood.fmt;
  return {
    icon: 'sparkles',
    title: 'Keystone habit: ' + best.name,
    text:
      'On days you do ' +
      best.name +
      ', mood runs higher: ' +
      f(best.on) +
      ' vs ' +
      f(best.off) +
      ' on days you skip it (' +
      best.n +
      ' days).',
    effect: best.diff / META.mood.range,
  };
}

/** How far through a goal is, 0..1, from its milestones or its day tracker. */
function goalFraction(p) {
  const ms = (p && p.milestones) || [];
  if (ms.length) return ms.filter((m) => m && m.done).length / ms.length;
  if (p && p.durationDays > 0) return Math.min(1, (p.daysFollowed || 0) / p.durationDays);
  return null;
}

/**
 * Straight line from the goal's creation (0%) to today's progress, run on to
 * 100%. ponytail: two points, because progress has no history; a real fit
 * needs a dated progress log.
 */
export function goalPace(goals, progressById, now) {
  let worst = null;
  for (const g of goals || []) {
    if (!g || g.completed || !g.targetDate || !g.createdAt) continue;
    const frac = goalFraction((progressById && progressById[g.id]) || g.progress);
    const elapsed = (now - Date.parse(g.createdAt)) / DAY_MS;
    if (frac == null || frac <= 0 || frac >= 1 || elapsed < 3) continue;
    const finish = now + ((1 - frac) / (frac / elapsed)) * DAY_MS;
    const late = Math.round((finish - Date.parse(g.targetDate + 'T23:59:59')) / DAY_MS);
    if (late > 2 && (!worst || late > worst.late)) worst = { g, late, finish, frac };
  }
  if (!worst) return null;
  const d = new Date(worst.finish).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  return {
    icon: 'target',
    title: worst.g.title + ' is behind pace',
    text:
      'You are ' +
      pct(worst.frac) +
      ' of the way. At this pace you finish around ' +
      d +
      ', ' +
      worst.late +
      ' day' +
      (worst.late === 1 ? '' : 's') +
      ' after your target.',
    effect: Math.min(0.5, 0.15 + worst.late / 100),
  };
}

/** Days from created to done, per priority, for priorities with 3+ tasks. */
export function taskTiming(finished) {
  const by = {};
  for (const t of finished || []) {
    const days = (Date.parse(t.doneAt) - Date.parse(t.createdAt)) / DAY_MS;
    if (Number.isFinite(days) && days >= 0) (by[t.priority] = by[t.priority] || []).push(days);
  }
  const parts = ['High', 'Medium', 'Low']
    .filter((p) => (by[p] || []).length >= 3)
    .map((p) => {
      const d = round1(mean(by[p]));
      return p + ' ' + d + (d === 1 ? ' day' : ' days');
    });
  if (!parts.length) return null;
  return {
    icon: 'clock',
    title: 'How long tasks take you',
    text: 'From adding a task to ticking it off: ' + parts.join(', ') + '.',
    effect: 0.13,
  };
}

/** The open task pushed to a later day most often, at three pushes or more. */
export function pushedTask(tasks) {
  const t = (tasks || [])
    .filter((x) => x && !x.done && x.pushCount >= 3)
    .sort((a, b) => b.pushCount - a.pushCount)[0];
  if (!t) return null;
  return {
    icon: 'repeat',
    title: 'Keeps getting pushed',
    text:
      '“' +
      t.title +
      '” has been moved to a later day ' +
      t.pushCount +
      ' times. Break it down or drop it?',
    effect: 0.3 + Math.min(t.pushCount, 10) / 100,
  };
}

/** The weekday most tasks get finished on. */
export function taskWeekday(finished) {
  const by = [0, 0, 0, 0, 0, 0, 0];
  let n = 0;
  for (const t of finished || []) {
    const ms = Date.parse(t.doneAt);
    if (!Number.isFinite(ms)) continue;
    by[new Date(ms).getDay()]++;
    n++;
  }
  if (n < 10) return null;
  const i = by.indexOf(Math.max(...by));
  const lift = by[i] / n - 1 / 7;
  if (lift < 0.1) return null;
  return {
    icon: 'calendar',
    title: WEEKDAYS[i] + ' get things done',
    text: 'You finish the most tasks on ' + WEEKDAYS[i] + ': ' + by[i] + ' of ' + n + ' lately.',
    effect: lift,
  };
}

/** One expense this week far above that category's usual amount. */
export function unusualExpense(m, today) {
  const exps = ((m && m.expenses) || []).filter(
    (e) => e && e.date && e.category && Number(e.amount) > 0
  );
  const cut = dayNum(today) - 7;
  let best = null;
  for (const e of exps) {
    if (dayNum(e.date) <= cut) continue;
    const before = exps
      .filter((x) => x.category === e.category && x.date < e.date)
      .map((x) => Number(x.amount));
    if (before.length < 5) continue;
    const usual = median(before);
    const x = Number(e.amount) / usual;
    if (x >= 3 && (!best || x > best.x)) best = { e, usual, x };
  }
  if (!best) return null;
  return {
    icon: 'wallet',
    title: 'Unusual expense',
    text:
      fmtMoney(best.e.amount) +
      ' on ' +
      best.e.category +
      (best.e.note ? ' (' + best.e.note + ')' : '') +
      ' is ' +
      Math.round(best.x) +
      'x your usual ' +
      fmtMoney(best.usual) +
      '.',
    effect: Math.min(0.5, best.x / 10),
  };
}

/**
 * Same note, about the same amount, about every month, not yet a subscription.
 * The note stands in for a payee: expenses have no payee field.
 */
export function hiddenSubscription(m, today) {
  const subs = ((m && m.subscriptions) || []).map((s) => String(s.name || '').toLowerCase());
  const groups = {};
  for (const e of (m && m.expenses) || []) {
    const k = String((e && e.note) || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (k && e.date && Number(e.amount) > 0) (groups[k] = groups[k] || []).push(e);
  }
  for (const k in groups) {
    const g = groups[k].slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (g.length < 3 || dayNum(today) - dayNum(g[g.length - 1].date) > 40) continue;
    if (subs.some((s) => s && (s.includes(k) || k.includes(s)))) continue;
    const amt = median(g.map((e) => Number(e.amount)));
    const steady = g.every((e) => Math.abs(Number(e.amount) - amt) <= amt * 0.15);
    const monthly = g.slice(1).every((e, i) => {
      const gap = dayNum(e.date) - dayNum(g[i].date);
      return gap >= 25 && gap <= 35;
    });
    if (!steady || !monthly) continue;
    return {
      icon: 'repeat',
      title: 'Looks like a monthly payment',
      text:
        '“' +
        g[0].note +
        '”: about ' +
        fmtMoney(amt) +
        ' every month (' +
        g.length +
        ' times). Track it as a subscription in Money?',
      effect: 0.35,
    };
  }
  return null;
}

/** Per local hour, the share of logged days with a glass in it. */
export function drinkRateByHour(times) {
  const days = new Set();
  const hours = Array.from({ length: 24 }, () => new Set());
  for (const t of times || []) {
    const d = new Date(t);
    if (!Number.isFinite(d.getTime())) continue;
    const k = localKey(d);
    days.add(k);
    hours[d.getHours()].add(k);
  }
  return { days: days.size, rate: hours.map((s) => (days.size ? s.size / days.size : 0)) };
}

/** The longest stretch of waking hours with almost no water. */
export function waterGap(times) {
  const { days, rate } = drinkRateByHour(times);
  if (days < 5) return null;
  let best = null;
  let start = -1;
  for (let h = 9; h <= 21; h++) {
    const dry = h < 21 && rate[h] < 0.2;
    if (dry && start < 0) start = h;
    if (!dry && start >= 0) {
      if (!best || h - start > best.len) best = { from: start, len: h - start };
      start = -1;
    }
  }
  if (!best || best.len < 3) return null;
  return {
    icon: 'droplets',
    title: 'When water slips',
    text:
      'You rarely log water between ' +
      hh(best.from) +
      ' and ' +
      hh(best.from + best.len) +
      ' (' +
      days +
      ' days). A glass there is the easiest win. Water nudges, when on, skip the hours you already drink in.',
    effect: 0.15 + best.len / 50,
  };
}

/** Why yesterday's score moved from the day before: the part that moved most. */
export function scoreChange(days) {
  const [a, b] = days || [];
  if (!a || !b) return null;
  const delta = b.score - a.score;
  if (Math.abs(delta) < 10) return null;
  const rate = (s, k) => (s[k + 'Total'] > 0 ? s[k + 'Done'] / s[k + 'Total'] : null);
  const move = ['tasks', 'habits']
    .map((k) => ({ k, d: (rate(b, k) ?? 0) - (rate(a, k) ?? 0) }))
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
  const k = move.k;
  return {
    icon: 'trending-up',
    title: 'Why your score ' + (delta < 0 ? 'fell' : 'rose'),
    text:
      'Yesterday scored ' +
      b.score +
      '%, ' +
      Math.abs(delta) +
      ' points ' +
      (delta < 0 ? 'down' : 'up') +
      ' on the day before, mostly from ' +
      k +
      ': ' +
      b[k + 'Done'] +
      ' of ' +
      b[k + 'Total'] +
      ' done vs ' +
      a[k + 'Done'] +
      ' of ' +
      a[k + 'Total'] +
      '.',
    effect: Math.abs(delta) / 100,
  };
}

/**
 * Find the strongest real patterns and render them as plain insight cards:
 * { icon, title, text, effect }. Sorted by effect size, capped at MAX_INSIGHTS.
 * `history` (see above) and the rest are optional; each card that lacks its
 * data simply doesn't appear.
 */
export function buildInsights({
  wellness,
  trends,
  money: m,
  habits,
  tasks,
  goals,
  goalProgress,
  history,
  now = Date.now(),
}) {
  const sig = signals({ wellness, trends, money: m });
  const today = localKey(new Date(now));
  const hist = history || {};
  const hdays = habitDays(habits, hist.habits, today);
  const found = [
    ...TESTS.map((t) => pairInsight(sig, t)),
    sleepDebt(sig),
    moodShift(sig),
    weekdayPattern(sig, 'mood', 'min'),
    weekdayPattern(sig, 'stress', 'max'),
    bestBedtime(sig),
    focusHours(hist.focus),
    habitWeekdayMiss(hdays),
    missTwice(hdays),
    keystoneHabit(hdays, sig),
    goalPace(goals, goalProgress, now),
    taskTiming(hist.finished),
    pushedTask(tasks),
    taskWeekday(hist.finished),
    unusualExpense(m, today),
    hiddenSubscription(m, today),
    waterGap(hist.waterTimes),
    scoreChange(hist.scores),
  ].filter(Boolean);
  return found.sort((a, b) => b.effect - a.effect).slice(0, MAX_INSIGHTS);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
