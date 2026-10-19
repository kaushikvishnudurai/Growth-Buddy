/* Pure health-reading logic shared by the Health screen (health.js), the habit
   auto-tick (app.js) and the phone sync (native.js). No DOM, no network.
   `node scripts/health-logic.test.mjs`.

   A reading is one row of /api/health/readings:
     { id, type, value, value2?, day: 'YYYY-MM-DD', measuredAt?, source: 'manual' | 'phone', note? }
   `day` is the user's local day. The phone writes at most one row per type per
   day (re-synced in place); a person can add any number by hand.

   How a day's value is built depends on the metric:
   - 'sum' metrics (steps, distance, ...) add the phone's total and every hand
     entry: what you type is what the phone missed (a treadmill, a walk without
     the phone), never a correction of it.
   - 'latest' metrics (weight, blood pressure, ...) take the newest reading of
     the day, whoever wrote it. */
import { addDays } from './dates.js';

export const HEALTH_GROUPS = [
  { id: 'activity', label: 'Activity' },
  { id: 'heart', label: 'Heart' },
  { id: 'body', label: 'Body' },
];

/* min/max mirror HealthReadingService.LIMITS on the server. */
export const HEALTH_METRICS = {
  steps: { label: 'Steps', unit: 'steps', group: 'activity', agg: 'sum', dp: 0, min: 1, max: 100000, step: 1, icon: 'footprints' },
  distance: { label: 'Distance', unit: 'km', group: 'activity', agg: 'sum', dp: 1, min: 0.1, max: 300, step: 0.1, icon: 'route' },
  calories: { label: 'Active energy', unit: 'kcal', group: 'activity', agg: 'sum', dp: 0, min: 1, max: 10000, step: 1, icon: 'flame' },
  floors: { label: 'Floors', unit: 'floors', group: 'activity', agg: 'sum', dp: 0, min: 1, max: 1000, step: 1, icon: 'trending-up' },
  workout: { label: 'Workout', unit: 'min', group: 'activity', agg: 'sum', dp: 0, min: 1, max: 1440, step: 1, icon: 'dumbbell' },
  restingHeartRate: { label: 'Resting heart rate', unit: 'bpm', group: 'heart', agg: 'latest', dp: 0, min: 20, max: 250, step: 1, icon: 'heart' },
  bloodPressure: {
    label: 'Blood pressure',
    unit: 'mmHg',
    group: 'heart',
    agg: 'latest',
    dp: 0,
    min: 40,
    max: 260,
    step: 1,
    pair: { label: 'Diastolic', min: 20, max: 200 },
    icon: 'heart-pulse',
  },
  oxygenSaturation: { label: 'Blood oxygen', unit: '%', group: 'heart', agg: 'latest', dp: 0, min: 50, max: 100, step: 1, icon: 'droplets' },
  heartRateVariability: { label: 'HRV', unit: 'ms', group: 'heart', agg: 'latest', dp: 0, min: 1, max: 300, step: 1, icon: 'gauge' },
  respiratoryRate: { label: 'Breathing rate', unit: '/min', group: 'heart', agg: 'latest', dp: 0, min: 4, max: 60, step: 1, icon: 'wind' },
  weight: { label: 'Weight', unit: 'kg', group: 'body', agg: 'latest', dp: 1, min: 2, max: 500, step: 0.1, icon: 'scale' },
  bodyFat: { label: 'Body fat', unit: '%', group: 'body', agg: 'latest', dp: 1, min: 1, max: 75, step: 0.1, icon: 'percent' },
  height: { label: 'Height', unit: 'cm', group: 'body', agg: 'latest', dp: 0, min: 40, max: 260, step: 1, icon: 'ruler' },
};

export const HEALTH_TYPES = Object.keys(HEALTH_METRICS);

/* ---- days ---------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');
export const dayKeyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export { addDays }; // from dates.js; health.js and the test read it here

/** The `n` days ending on `endDay`, oldest first. */
export function lastDays(endDay, n) {
  return Array.from({ length: n }, (_, i) => addDays(endDay, i - n + 1));
}

/* ---- values -------------------------------------------------------------- */

const stamp = (r) => Date.parse(r.measuredAt || r.createdAt || '') || 0;

/**
 * One day's value for one metric, or null when nothing was recorded:
 * { value, value2?, phone, manual } where phone/manual say who contributed.
 */
export function dayValue(readings, type, day) {
  const meta = HEALTH_METRICS[type];
  const rows = (readings || []).filter((r) => r && r.type === type && r.day === day && Number.isFinite(Number(r.value)));
  if (!meta || !rows.length) return null;
  const phone = rows.some((r) => r.source === 'phone');
  const manual = rows.some((r) => r.source !== 'phone');
  if (meta.agg === 'sum') {
    // The phone counts once (its largest row: two syncs racing can leave two
    // rows for one day, each the whole day's total); hand entries add on top.
    const phoneMax = rows.filter((r) => r.source === 'phone').reduce((n, r) => Math.max(n, Number(r.value)), 0);
    const v = phoneMax + rows.filter((r) => r.source !== 'phone').reduce((n, r) => n + Number(r.value), 0);
    return { value: round(v, meta.dp), phone, manual };
  }
  const last = rows.reduce((a, b) => (stamp(b) >= stamp(a) ? b : a));
  const out = { value: round(Number(last.value), meta.dp), phone: last.source === 'phone', manual: last.source !== 'phone' };
  if (meta.pair && last.value2 != null) out.value2 = round(Number(last.value2), 0);
  return out;
}

/** [{day, value, value2?}] for the `n` days ending on `endDay`, oldest first; gaps are null. */
export function series(readings, type, endDay, n) {
  return lastDays(endDay, n).map((day) => {
    const v = dayValue(readings, type, day);
    return { day, value: v ? v.value : null, value2: v && v.value2 != null ? v.value2 : null };
  });
}

/** The newest day that has a value, with that value, or null. For a body reading taken last week. */
export function latestValue(readings, type, endDay, lookback = 90) {
  for (let i = 0; i < lookback; i++) {
    const day = addDays(endDay, -i);
    const v = dayValue(readings, type, day);
    if (v) return { day, ...v };
  }
  return null;
}

/** Mean of the non-null values, or null. */
export function mean(points) {
  const vs = points.map((p) => p.value).filter((v) => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

/** Every reading for one metric, newest first, for the detail sheet's list. */
export function entriesFor(readings, type) {
  return (readings || [])
    .filter((r) => r && r.type === type)
    .sort((a, b) => (a.day === b.day ? stamp(b) - stamp(a) : a.day < b.day ? 1 : -1));
}

/**
 * Why a hand-typed reading can't be saved, or null. Same limits as the server,
 * so the form says it before the round trip does.
 */
export function readingError(type, value, value2) {
  const meta = HEALTH_METRICS[type];
  if (!meta) return 'Pick what you are logging.';
  const v = Number(value);
  if (value === '' || value == null || !Number.isFinite(v)) return 'Enter a number.';
  if (v < meta.min || v > meta.max) return meta.label + ' must be ' + meta.min + ' to ' + meta.max.toLocaleString('en') + ' ' + meta.unit + '.';
  if (meta.pair) {
    const w = Number(value2);
    if (value2 === '' || value2 == null || !Number.isFinite(w)) return 'Enter both numbers.';
    if (w < meta.pair.min || w > meta.pair.max) return meta.pair.label + ' must be ' + meta.pair.min + ' to ' + meta.pair.max + '.';
    if (w >= v) return 'The first number (systolic) is the higher one.';
  }
  return null;
}

function round(v, dp) {
  const f = 10 ** (dp || 0);
  return Math.round(v * f) / f;
}

/* ---- sleep --------------------------------------------------------------- */

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * A night from the sleep log placed on the band: minutes after 18:00 the
 * evening before, so 23:00 is 300 and 07:00 is 780 (the band runs 18:00 to
 * 12:00, 1080 minutes). Null when the entry has no times.
 */
export function nightOnBand(entry) {
  if (!entry) return null;
  const bed = toMin(entry.bedtime);
  const wake = toMin(entry.wakeTime);
  if (bed == null || wake == null) return null;
  const minutes = (wake - bed + 1440) % 1440;
  if (minutes <= 0 || minutes > 20 * 60) return null;
  // A bedtime from 12:00 to 18:00 sits before the band: negative, then clipped to
  // its top. Wrapped to 1080+ it drew no bar and dragged the usual window off.
  let start = (bed - 18 * 60 + 1440) % 1440;
  if (start >= 1080) start -= 1440;
  const clip = (v) => Math.max(0, Math.min(v, 1080));
  return { from: clip(start), to: clip(start + minutes), minutes, bedtime: entry.bedtime, wakeTime: entry.wakeTime, quality: entry.quality || null };
}

/** The `n` nights ending on `endDay` (keyed on the wake date), oldest first; gaps are null. */
export function nights(sleepByDate, endDay, n) {
  return lastDays(endDay, n).map((day) => ({ day, night: nightOnBand((sleepByDate || {})[day]) }));
}

/** "7h 40m" */
export function durationLabel(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? h + 'h ' + pad(m) + 'm' : m + 'm';
}

/* ---- the screen's layout --------------------------------------------------- */

/* The Health screen's cards, top to bottom by default. The sentence and its
   footnote are the page's head and always lead; these three follow it. */
export const HEALTH_SECTIONS = [
  { id: 'insights', label: 'Insights', desc: 'What changed lately, in plain words', icon: 'lightbulb' },
  { id: 'sleep', label: 'Last night', desc: 'Your sleep against your usual window', icon: 'moon' },
  { id: 'ledger', label: 'Your ledger', desc: 'Every metric across the last two weeks', icon: 'chart-column' },
];

/**
 * The saved layout (ui_prefs.healthLayout: {sections: [{id, on}], metrics: [{type, on}]})
 * made whole: unknown ids dropped, duplicates dropped, anything new appended
 * where the defaults put it, shown. Metrics keep one order across groups; the
 * screen still groups them (Activity / Heart / Body), in this order within each.
 */
export function resolveHealthLayout(saved) {
  const pick = (list, key, known) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((x) => {
      const id = x && x[key];
      if (known.includes(id) && !seen.has(id)) {
        seen.add(id);
        out.push({ [key]: id, on: x.on !== false });
      }
    });
    known.forEach((id) => {
      if (!seen.has(id)) out.push({ [key]: id, on: true });
    });
    return out;
  };
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    sections: pick(s.sections, 'id', HEALTH_SECTIONS.map((x) => x.id)),
    metrics: pick(s.metrics, 'type', HEALTH_TYPES),
  };
}

/** Swap a metric with its neighbour in the same group (`delta` -1 up, +1 down). New layout; null at an end. */
export function moveHealthMetric(layout, type, delta) {
  const group = HEALTH_METRICS[type] && HEALTH_METRICS[type].group;
  const inGroup = layout.metrics.filter((m) => HEALTH_METRICS[m.type].group === group);
  const i = inGroup.findIndex((m) => m.type === type);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= inGroup.length) return null;
  const a = layout.metrics.indexOf(inGroup[i]);
  const b = layout.metrics.indexOf(inGroup[j]);
  const metrics = layout.metrics.slice();
  [metrics[a], metrics[b]] = [metrics[b], metrics[a]];
  return { ...layout, metrics };
}

/** Swap a card with its neighbour. New layout; null at an end. */
export function moveHealthSection(layout, id, delta) {
  const i = layout.sections.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.sections.length) return null;
  const sections = layout.sections.slice();
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...layout, sections };
}

/* ---- insights ---------------------------------------------------------------- */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const avgOf = (vs) => (vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null);
const valuesIn = (readings, type, endDay, n, key = 'value') =>
  series(readings, type, endDay, n)
    .map((p) => p[key])
    .filter((v) => v != null);

/**
 * What changed lately, in plain words, from the user's own readings and sleep.
 * Each: {id, metric, icon, tone: 'good' | 'watch' | 'info', title, text, basis}.
 * Every claim compares the user with themselves and needs enough days to mean
 * something; nothing here diagnoses. `shown(type)` false drops a metric the
 * user hid. Watch items first, then the biggest moves; at most `max`.
 */
export function healthInsights(readings, sleepByDate, today, { shown = () => true, max = 5, fmt = (n) => String(n), clock = (hhmm) => hhmm } = {}) {
  const out = [];
  const yday = addDays(today, -1);

  // Steps: the last 7 finished days against the 7 before (4+ days each).
  if (shown('steps')) {
    const now = valuesIn(readings, 'steps', yday, 7);
    const before = valuesIn(readings, 'steps', addDays(yday, -7), 7);
    if (now.length >= 4 && before.length >= 4) {
      const a = avgOf(now), b = avgOf(before);
      const pct = Math.round(((a - b) / b) * 100);
      if (Math.abs(pct) >= 10)
        out.push({
          id: 'steps-week', metric: 'steps', icon: 'footprints', tone: pct > 0 ? 'good' : 'watch', weight: Math.abs(pct),
          title: pct > 0 ? 'Walking more this week' : 'Walking less this week',
          text: fmt(Math.round(a)) + ' steps a day over the last 7 days, ' + Math.abs(pct) + '% ' + (pct > 0 ? 'more' : 'fewer') + ' than the week before (' + fmt(Math.round(b)) + ').',
          basis: now.length + before.length + ' days',
        });
      // A level week is news too: it is the habit holding.
      else
        out.push({
          id: 'steps-week', metric: 'steps', icon: 'footprints', tone: 'good', weight: 3,
          title: 'A steady week on your feet',
          text: 'About ' + fmt(Math.round(a)) + ' steps a day, level with the week before (' + fmt(Math.round(b)) + ').',
          basis: now.length + before.length + ' days',
        });
    }
  }

  // Steps by weekday over 4 weeks: the most and least active day, when they differ by 30%+.
  if (shown('steps')) {
    const byDow = Array.from({ length: 7 }, () => []);
    lastDays(yday, 28).forEach((d) => {
      const st = dayValue(readings, 'steps', d);
      if (st && st.value) byDow[new Date(d + 'T12:00:00').getDay()].push(st.value);
    });
    const avgs = byDow.map((vs, dow) => (vs.length >= 2 ? { dow, avg: avgOf(vs) } : null)).filter(Boolean);
    if (avgs.length >= 5) {
      avgs.sort((x, y) => y.avg - x.avg);
      const top = avgs[0], low = avgs[avgs.length - 1];
      if (low.avg > 0 && top.avg / low.avg >= 1.3)
        out.push({
          id: 'steps-weekday', metric: 'steps', icon: 'calendar', tone: 'info', weight: 8,
          title: WEEKDAYS[top.dow] + 's are your most active',
          text: 'About ' + fmt(Math.round(top.avg)) + ' steps on ' + WEEKDAYS[top.dow] + 's against ' + fmt(Math.round(low.avg)) + ' on ' + WEEKDAYS[low.dow] + 's, your quietest day.',
          basis: avgs.reduce((n, x) => n + byDow[x.dow].length, 0) + ' days',
        });
    }
  }

  // Sleep: the last 7 nights against the 7 hours most adults need, and against the 14 before.
  // No metric: sleep is its own card, not a ledger row, so these rows open nothing.
  {
    const mins = (end, n) => nights(sleepByDate, end, n).map((x) => x.night && x.night.minutes).filter((v) => v);
    const now = mins(today, 7);
    if (now.length >= 4) {
      const a = avgOf(now);
      const before = mins(addDays(today, -7), 14);
      const diff = before.length >= 5 ? Math.round(a - avgOf(before)) : 0;
      const short = now.filter((v) => v < 360).length;
      const enough = a >= 420;
      out.push({
        id: 'sleep-average', metric: null, icon: 'moon', tone: enough ? 'good' : 'watch', weight: enough ? 6 : 50,
        title: 'Averaging ' + durationLabel(Math.round(a)) + ' of sleep',
        text:
          (enough
            ? 'Within the 7 to 9 hours most adults need.'
            : 'Under the 7 hours most adults need' + (short ? ', with ' + short + (short === 1 ? ' night' : ' nights') + ' under 6 hours.' : '.')) +
          (Math.abs(diff) >= 20 ? ' ' + durationLabel(Math.abs(diff)) + (diff > 0 ? ' more' : ' less') + ' a night than the two weeks before.' : ''),
        basis: now.length + (now.length === 1 ? ' night' : ' nights'),
      });
    }
    // Bedtime: how far it wanders over 2 weeks (standard deviation of the start).
    const beds = nights(sleepByDate, today, 14).map((x) => x.night && x.night.from).filter((v) => v != null);
    if (beds.length >= 5) {
      const m = avgOf(beds);
      const sd = Math.sqrt(avgOf(beds.map((v) => (v - m) ** 2)));
      const at = Math.round((m + 18 * 60) % 1440);
      const hhmm = pad(Math.floor(at / 60)) + ':' + pad(at % 60);
      const spread = Math.max(5, Math.round(sd / 5) * 5);
      if (sd >= 60)
        out.push({
          id: 'sleep-bedtime', metric: null, icon: 'clock', tone: 'watch', weight: 30,
          title: 'Bedtime moves around',
          text: 'Around ' + clock(hhmm) + ' on average, but it shifts by about ' + durationLabel(spread) + ' either way. A steadier bedtime tends to make sleep come easier.',
          basis: beds.length + ' nights',
        });
      else if (sd <= 30)
        out.push({
          id: 'sleep-bedtime', metric: null, icon: 'clock', tone: 'good', weight: 4,
          title: 'A steady bedtime',
          text: 'You go to bed around ' + clock(hhmm) + ' most nights, within about ' + durationLabel(spread) + '.',
          basis: beds.length + ' nights',
        });
    }
  }

  // Resting heart rate and HRV: the last 7 days against the 30 before them.
  const versusUsual = (type, minDiff, words) => {
    if (!shown(type)) return;
    const now = valuesIn(readings, type, today, 7);
    const usual = valuesIn(readings, type, addDays(today, -7), 30);
    if (now.length < 3 || usual.length < 7) return;
    const a = avgOf(now), b = avgOf(usual);
    const diff = a - b;
    if (Math.abs(diff) < minDiff(b)) return;
    out.push(words(a, b, diff, now.length + usual.length));
  };
  versusUsual('restingHeartRate', () => 3, (a, b, d, n) => ({
    id: 'rhr-usual', metric: 'restingHeartRate', icon: 'heart', tone: d > 0 ? 'watch' : 'good', weight: Math.abs(d) * 10,
    title: d > 0 ? 'Resting heart rate is up' : 'Resting heart rate is down',
    text: Math.round(a) + ' bpm this week against your usual ' + Math.round(b) + '. ' + (d > 0
      ? 'Short sleep, stress, a cold or a hard training week can all raise it; an easy day helps.'
      : 'A lower resting rate usually tracks better fitness and recovery.'),
    basis: n + ' days',
  }));
  versusUsual('heartRateVariability', (b) => Math.max(4, b * 0.1), (a, b, d, n) => ({
    id: 'hrv-usual', metric: 'heartRateVariability', icon: 'gauge', tone: d < 0 ? 'watch' : 'good', weight: (Math.abs(d) / b) * 100,
    title: d < 0 ? 'HRV is below your usual' : 'HRV is above your usual',
    text: Math.round(a) + ' ms this week against your usual ' + Math.round(b) + ' ms. ' + (d < 0
      ? 'A dip often means your body is still recovering.'
      : 'Higher than usual is a sign of good recovery.'),
    basis: n + ' days',
  }));

  // Weight: first vs last reading across the last 28 days (4+ readings, 14+ days apart).
  if (shown('weight')) {
    const pts = series(readings, 'weight', today, 28).filter((p) => p.value != null);
    if (pts.length >= 4) {
      const first = pts[0], last = pts[pts.length - 1];
      const span = (Date.parse(last.day) - Date.parse(first.day)) / 864e5;
      const change = Math.round((last.value - first.value) * 10) / 10;
      if (span >= 14 && Math.abs(change) >= 0.5) {
        const weeks = span / 7;
        out.push({
          id: 'weight-trend', metric: 'weight', icon: 'scale', tone: 'info', weight: Math.abs(change) * 10,
          title: change < 0 ? 'Weight is trending down' : 'Weight is trending up',
          text: (change < 0 ? 'Down ' : 'Up ') + Math.abs(change).toFixed(1) + ' kg in ' + Math.round(weeks) + ' weeks, about ' + (Math.abs(change) / weeks).toFixed(1) + ' kg a week.',
          basis: pts.length + ' weigh-ins',
        });
      } else if (span >= 14 && Math.max(...pts.map((p) => p.value)) - Math.min(...pts.map((p) => p.value)) <= 1)
        out.push({
          id: 'weight-trend', metric: 'weight', icon: 'scale', tone: 'info', weight: 2,
          title: 'Weight is holding steady',
          text: 'Within half a kilo over ' + Math.round(span / 7) + ' weeks, at ' + last.value.toFixed(1) + ' kg now.',
          basis: pts.length + ' weigh-ins',
        });
    }
  }

  // Blood pressure: the last 14 days' average (3+ readings), against the 120/80 line.
  if (shown('bloodPressure')) {
    const pts = series(readings, 'bloodPressure', today, 14).filter((p) => p.value != null && p.value2 != null);
    if (pts.length >= 3) {
      const sys = Math.round(avgOf(pts.map((p) => p.value)));
      const dia = Math.round(avgOf(pts.map((p) => p.value2)));
      const high = sys >= 130 || dia >= 80;
      const raised = !high && sys >= 120;
      out.push({
        id: 'bp-average', metric: 'bloodPressure', icon: 'heart-pulse', tone: high || raised ? 'watch' : 'good', weight: high ? 100 : raised ? 40 : 5,
        title: 'Blood pressure averages ' + sys + '/' + dia,
        // Name the number that tripped it: 126/81 is high on the bottom number alone.
        text: high
          ? 'Over the last 2 weeks, ' +
            (sys >= 130 && dia >= 80
              ? 'both numbers are at or above 130/80'
              : sys >= 130
                ? 'the top number is 130 or more'
                : 'the bottom number is 80 or more') +
            '. If it stays there, mention it at your next check-up.'
          : raised
            ? 'Over the last 2 weeks, a little above the 120/80 line. Keep logging; a few more readings make the picture clearer.'
            : 'Over the last 2 weeks, under 120/80.',
        basis: pts.length + ' readings',
      });
    }
  }

  // Steps and sleep: the night after a high-step day against the night after a low one.
  // Sleep is keyed on the wake day, so a day's night is the next day's entry.
  if (shown('steps')) {
    const days = lastDays(yday, 28);
    const pairs = days
      .map((d) => {
        const st = dayValue(readings, 'steps', d);
        const n = nightOnBand((sleepByDate || {})[addDays(d, 1)]);
        return st && n ? { steps: st.value, sleep: n.minutes } : null;
      })
      .filter(Boolean);
    if (pairs.length >= 6) {
      const sorted = pairs.map((x) => x.steps).sort((a, b) => a - b);
      const mid = sorted[Math.floor(sorted.length / 2)];
      const hi = pairs.filter((x) => x.steps >= mid), lo = pairs.filter((x) => x.steps < mid);
      if (hi.length >= 3 && lo.length >= 3) {
        const diff = Math.round(avgOf(hi.map((x) => x.sleep)) - avgOf(lo.map((x) => x.sleep)));
        if (Math.abs(diff) >= 15)
          out.push({
            id: 'steps-sleep', metric: 'steps', icon: 'moon', tone: 'info', weight: Math.abs(diff),
            title: diff > 0 ? 'Busier days, longer nights' : 'Busier days, shorter nights',
            text: 'After days of ' + fmt(Math.round(mid / 500) * 500) + '+ steps you sleep ' + durationLabel(Math.abs(diff)) + (diff > 0 ? ' longer' : ' less') + ' than after quieter days.',
            basis: pairs.length + ' days',
          });
      }
    }
  }

  const rank = { watch: 0, good: 1, info: 2 };
  return out
    .sort((a, b) => rank[a.tone] - rank[b.tone] || b.weight - a.weight)
    .slice(0, max)
    .map(({ weight: _rank, ...x }) => x);
}
