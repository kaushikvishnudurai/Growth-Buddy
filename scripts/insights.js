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
const MAX_INSIGHTS = 4;
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
  return {
    sleepHours: series(sleep, (e) => sleepHours(e.bedtime, e.wakeTime)),
    sleepQuality: series(sleep, (e) => ord(e.quality)),
    bedtime,
    bedShift: series(bedtime, (m) => Math.abs(m - usualBed) / 60),
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
  const hh = (h) => String(h % 24).padStart(2, '0') + ':00';
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

/**
 * Find the strongest real patterns and render them as plain insight cards:
 * { icon, title, text, effect }. Sorted by effect size, capped at MAX_INSIGHTS.
 */
export function buildInsights({ wellness, trends, money }) {
  const sig = signals({ wellness, trends, money });
  const found = [
    ...TESTS.map((t) => pairInsight(sig, t)),
    sleepDebt(sig),
    moodShift(sig),
    weekdayPattern(sig, 'mood', 'min'),
    weekdayPattern(sig, 'stress', 'max'),
    bestBedtime(sig),
  ].filter(Boolean);
  return found.sort((a, b) => b.effect - a.effect).slice(0, MAX_INSIGHTS);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
