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
    icon: 'activity',
  },
  oxygenSaturation: { label: 'Blood oxygen', unit: '%', group: 'heart', agg: 'latest', dp: 0, min: 50, max: 100, step: 1, icon: 'wind' },
  heartRateVariability: { label: 'HRV', unit: 'ms', group: 'heart', agg: 'latest', dp: 0, min: 1, max: 300, step: 1, icon: 'activity' },
  respiratoryRate: { label: 'Breathing rate', unit: '/min', group: 'heart', agg: 'latest', dp: 0, min: 4, max: 60, step: 1, icon: 'wind' },
  weight: { label: 'Weight', unit: 'kg', group: 'body', agg: 'latest', dp: 1, min: 2, max: 500, step: 0.1, icon: 'scale' },
  bodyFat: { label: 'Body fat', unit: '%', group: 'body', agg: 'latest', dp: 1, min: 1, max: 75, step: 0.1, icon: 'percent' },
  height: { label: 'Height', unit: 'cm', group: 'body', agg: 'latest', dp: 0, min: 40, max: 260, step: 1, icon: 'ruler' },
};

export const HEALTH_TYPES = Object.keys(HEALTH_METRICS);

/* ---- days ---------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');
export const dayKeyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/** `day` moved by `n` days (negative = earlier). Noon, so a DST day can't slip. */
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n, 12));
}

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
  const from = (bed - 18 * 60 + 1440) % 1440;
  let to = (wake - 18 * 60 + 1440) % 1440;
  if (to <= from) to += 1440;
  const minutes = to - from;
  if (minutes <= 0 || minutes > 20 * 60) return null;
  return { from, to: Math.min(to, 1080), minutes, bedtime: entry.bedtime, wakeTime: entry.wakeTime, quality: entry.quality || null };
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
