/* =====================================================================
   Growth Buddy — Insights engine
   Pure, dependency-free correlation finder over the local wellness + trends
   stores. It pairs up date-keyed signals (sleep, mood, energy, stress, growth
   score, water), splits each predictor at its median, and reports where the
   outcome differs meaningfully between the high and low halves. No mood/sleep
   data lives on the server, so this runs entirely client-side over what the
   user has logged. Exported functions are pure so they can be unit-checked with
   plain `node` (see insights.test.mjs).
   ===================================================================== */

// Ordinal value maps for the categorical check-ins.
const ORD = { low: 1, okay: 2, good: 3, great: 4, medium: 2, high: 3, calm: 1, normal: 2 };

const MIN_DAYS = 4; // need at least this many paired days to say anything
const MIN_EFFECT = 0.12; // |meanHigh - meanLow| as a fraction of the outcome's range
const MAX_INSIGHTS = 3;

// Per-signal display metadata + outcome range (max - min) for effect sizing.
const META = {
  sleepHours: { label: 'sleep', icon: 'moon', range: 6, fmt: (v) => round1(v) + 'h' },
  sleepQuality: { label: 'sleep quality', icon: 'moon', range: 3, fmt: round1 },
  mood: { label: 'mood', icon: 'heart', range: 3, fmt: round1 },
  energy: { label: 'energy', icon: 'zap', range: 2, fmt: round1 },
  stress: { label: 'stress', icon: 'activity', range: 2, fmt: round1 },
  score: {
    label: 'growth score',
    icon: 'trending-up',
    range: 100,
    fmt: (v) => Math.round(v) + '%',
  },
  water: { label: 'water', icon: 'droplets', range: 1500, fmt: (v) => Math.round(v) + ' ml' },
  // Used only as a predictor below, so its `range` (for outcome effect-sizing) is unused.
  spend: { label: 'spending', icon: 'wallet', range: 1000, fmt: (v) => Math.round(v) },
};

// (predictor x -> outcome y) pairs worth surfacing.
const TESTS = [
  ['sleepHours', 'mood'],
  ['sleepQuality', 'mood'],
  ['sleepHours', 'score'],
  ['sleepHours', 'energy'],
  ['mood', 'score'],
  ['water', 'score'],
  ['stress', 'sleepQuality'],
  ['spend', 'mood'],
  ['spend', 'score'],
];

function round1(v) {
  return Math.round(v * 10) / 10;
}

function ord(v) {
  return ORD[v];
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

function mean(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/**
 * Split the days by predictor xs at its median and compare outcome ys between
 * the halves. Returns {meanHigh, meanLow, n, diff} or null if too little data.
 */
export function compare(xs, ys) {
  const dates = Object.keys(xs).filter((d) => d in ys);
  if (dates.length < MIN_DAYS) return null;
  const vals = dates.map((d) => xs[d]).sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];
  const high = [];
  const low = [];
  for (const d of dates) {
    (xs[d] >= median ? high : low).push(ys[d]);
  }
  if (high.length < 2 || low.length < 2) return null; // too lopsided (e.g. all ties)
  const meanHigh = mean(high);
  const meanLow = mean(low);
  return { meanHigh, meanLow, n: dates.length, diff: meanHigh - meanLow };
}

/** Total spend per date from the money doc's expenses list. */
function spendByDate(money) {
  const out = {};
  const expenses = (money && money.expenses) || [];
  for (const e of expenses) {
    const amt = Number(e.amount);
    if (e && e.date && Number.isFinite(amt)) out[e.date] = (out[e.date] || 0) + amt;
  }
  return out;
}

/** Compute all signal series from the local stores. */
export function signals({ wellness, trends, money }) {
  const sleep = (wellness && wellness.sleepByDate) || {};
  const mood = (wellness && wellness.moodByDate) || {};
  const byDate = (trends && trends.byDate) || {};
  return {
    sleepHours: series(sleep, (e) => sleepHours(e.bedtime, e.wakeTime)),
    sleepQuality: series(sleep, (e) => ord(e.quality)),
    mood: series(mood, (e) => ord(e.mood)),
    energy: series(mood, (e) => ord(e.energy)),
    stress: series(mood, (e) => ord(e.stress)),
    score: series(byDate, (e) => Number(e.score)),
    water: series(byDate, (e) => Number(e.waterMl)),
    spend: spendByDate(money),
  };
}

/**
 * Find the strongest real correlations and render them as plain insight cards:
 * { icon, title, text, effect }. Sorted by effect size, capped at MAX_INSIGHTS.
 */
export function buildInsights({ wellness, trends, money }) {
  const sig = signals({ wellness, trends, money });
  const found = [];
  for (const [x, y] of TESTS) {
    const r = compare(sig[x], sig[y]);
    if (!r) continue;
    const effect = Math.abs(r.diff) / META[y].range;
    if (effect < MIN_EFFECT) continue;
    const xm = META[x];
    const ym = META[y];
    const dir = r.diff >= 0 ? 'higher' : 'lower';
    found.push({
      icon: ym.icon,
      title: cap(xm.label) + ' ↔ ' + ym.label,
      text:
        'On your higher-' +
        xm.label +
        ' days, ' +
        ym.label +
        ' runs ' +
        dir +
        ' — ' +
        ym.fmt(r.meanHigh) +
        ' vs ' +
        ym.fmt(r.meanLow) +
        ' on lower-' +
        xm.label +
        ' days (' +
        r.n +
        ' days).',
      effect,
    });
  }
  return found.sort((a, b) => b.effect - a.effect).slice(0, MAX_INSIGHTS);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
