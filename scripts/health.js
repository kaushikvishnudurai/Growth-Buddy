/* Health screen: today's numbers from Apple Health / Health Connect, read by
   native.js `readHealthSummary()`. Display only: this module reads nothing
   itself and writes nothing; app.js passes the summary and the handlers.
   A missing reading is a muted dash, never a zero. */
import { h, Card, Icon, formatTime } from './gb-kit.js';
import { fmtDate, fmtNumber } from './i18n.js';

const DASH = '—';
const dayKey = (d) => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
const isAndroid = () => {
  try {
    return window.Capacitor.getPlatform() === 'android';
  } catch (_) {
    return false;
  }
};
const storeName = () => (isAndroid() ? 'Health Connect' : 'Apple Health');

const num = (s) => (s && Number.isFinite(Number(s.value)) ? Number(s.value) : null);
// ponytail: HealthKit's percent unit is 0-1, Health Connect's is 0-100. No real
// SpO2 or body-fat reading is at or under 1%, so <= 1 means a fraction.
const pct = (s) => {
  const v = num(s);
  return v == null ? null : v <= 1 ? v * 100 : v;
};
const minutes = (m) => {
  if (m == null || !Number.isFinite(m)) return null;
  const hrs = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return hrs ? hrs + 'h ' + rest + 'm' : rest + 'm';
};
// 'functionalStrengthTraining' -> 'Functional strength training'
const humanize = (t) => {
  const s = String(t || 'workout')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return s[0].toUpperCase() + s.slice(1);
};
/* "12 Oct" when a sample is older than today, else null. */
const asOf = (s) => {
  if (!s) return null;
  const d = new Date(s.endDate || s.startDate);
  if (Number.isNaN(d.getTime()) || dayKey(d) === dayKey(new Date())) return null;
  return fmtDate(d, 'short');
};

function Stat(label, value, unit, note) {
  const empty = value == null || value === '';
  return h(
    'div',
    { class: 'gb-health-stat' },
    h('span', { class: 'gb-health-label' }, label),
    empty
      ? h('span', { class: 'gb-health-val is-empty', 'aria-label': 'No data' }, DASH)
      : h('span', { class: 'gb-health-val' }, String(value), unit ? h('small', null, unit) : null),
    note ? h('span', { class: 'gb-health-asof' }, 'as of ' + note) : null
  );
}

function Section(icon, title, body, foot, className = '') {
  return Card({
    className: ('gb-health-card ' + className).trim(),
    children: [
      h('div', { class: 'gb-health-head' }, Icon(icon, { size: 18 }), h('h2', null, title)),
      body,
      foot || null,
    ],
  });
}

const grid = (...stats) => h('div', { class: 'gb-health-grid' }, ...stats);
const fixed = (v, d) =>
  v == null ? null : fmtNumber(v, { maximumFractionDigits: d, minimumFractionDigits: d });

const Notice = (title, text, action) =>
  h(
    'div',
    { class: 'gb-health' },
    Section('heart', title, h('p', null, text), action, 'gb-health-notice')
  );

const btn = (label, cls, onclick, icon) =>
  h(
    'button',
    { type: 'button', class: 'gb-btn ' + cls, onclick },
    icon ? Icon(icon, { size: 16 }) : null,
    label
  );

function isEmpty(s) {
  if (!s) return true;
  return Object.keys(s).every((k) =>
    k === 'workouts' ? !(s.workouts && s.workouts.length) : s[k] == null
  );
}

function Skeleton() {
  const block = () =>
    Card({
      className: 'gb-health-card',
      children: h(
        'div',
        { class: 'gb-skel-lines' },
        h('div', { class: 'gb-skel-line', style: { width: '40%' } }),
        h('div', { class: 'gb-skel-line' }),
        h('div', { class: 'gb-skel-line', style: { width: '70%' } })
      ),
    });
  return h('div', { class: 'gb-health', 'aria-busy': 'true' }, block(), block(), block());
}

function ScreenHealth({
  native,
  available,
  loading,
  summary,
  onConnect,
  onRefresh,
} = {}) {
  if (!native)
    return Notice(
      'Health lives on your phone',
      'Steps, sleep, heart rate and workouts come from Apple Health on iPhone and Health Connect on Android. Open Growth Buddy on your phone to see them here.'
    );
  if (!available)
    return Notice(
      'No health store on this phone',
      isAndroid()
        ? 'Health Connect is not installed or needs an update. Get it from the Play Store, then come back.'
        : 'Apple Health is not available on this device.'
    );
  if (loading) return Skeleton();
  if (isEmpty(summary))
    return Notice(
      'Connect your health data',
      'Nothing to show yet. Allow Growth Buddy to read ' +
        storeName() +
        ' and today’s numbers appear here.',
      h(
        'div',
        { class: 'gb-health-actions' },
        onConnect ? btn('Connect health data', 'gb-btn--primary', onConnect) : null,
        onRefresh ? btn('Refresh', 'gb-btn--secondary', onRefresh, 'refresh-cw') : null
      )
    );

  const s = summary;
  const hr = s.heartRate;
  const bp = s.bloodPressure;
  const sleep = s.sleep;
  const workouts = s.workouts || [];

  const top = h(
    'div',
    { class: 'gb-health-top' },
    h('p', null, 'Today, from ' + storeName()),
    h(
      'div',
      { class: 'gb-health-actions' },
      onConnect
        ? h(
            'button',
            { type: 'button', class: 'gb-health-link', onclick: onConnect },
            'Manage access'
          )
        : null,
      onRefresh
        ? btn('Refresh', 'gb-btn--secondary gb-btn--compact', onRefresh, 'refresh-cw')
        : null
    )
  );

  const activity = Section(
    'footprints',
    'Activity',
    grid(
      Stat('Steps', s.steps == null ? null : fmtNumber(s.steps)),
      Stat('Distance', fixed(s.distanceMeters == null ? null : s.distanceMeters / 1000, 1), 'km'),
      Stat('Active energy', s.activeCalories == null ? null : fmtNumber(s.activeCalories), 'kcal'),
      Stat('Floors', s.floors)
    )
  );

  const sleepCard = Section(
    'moon',
    'Sleep',
    grid(
      Stat(
        'Bed to wake',
        sleep ? formatTime(sleep.bedtime) + ' – ' + formatTime(sleep.wakeTime) : null
      ),
      Stat('Duration', sleep ? minutes(sleep.minutes) : null)
    ),
    null,
    'gb-health-sleep'
  );

  const heart = Section(
    'heart',
    'Heart',
    grid(
      Stat('Average today', hr ? hr.avg : null, 'bpm'),
      Stat('Range today', hr ? hr.min + '–' + hr.max : null, 'bpm'),
      Stat(
        'Resting',
        num(s.restingHeartRate) == null ? null : Math.round(num(s.restingHeartRate)),
        'bpm',
        asOf(s.restingHeartRate)
      ),
      Stat(
        'HRV',
        num(s.heartRateVariability) == null ? null : Math.round(num(s.heartRateVariability)),
        'ms',
        asOf(s.heartRateVariability)
      ),
      Stat(
        'Blood oxygen',
        pct(s.oxygenSaturation) == null ? null : Math.round(pct(s.oxygenSaturation)),
        '%',
        asOf(s.oxygenSaturation)
      ),
      Stat('Respiratory rate', fixed(num(s.respiratoryRate), 0), '/min', asOf(s.respiratoryRate))
    )
  );

  const bpOk = bp && Number.isFinite(Number(bp.systolic)) && Number.isFinite(Number(bp.diastolic));
  const body = Section(
    'user',
    'Body',
    grid(
      Stat('Weight', fixed(num(s.weight), 1), 'kg', asOf(s.weight)),
      Stat('Height', fixed(num(s.height), 0), 'cm', asOf(s.height)),
      Stat('Body fat', fixed(pct(s.bodyFat), 1), '%', asOf(s.bodyFat)),
      Stat(
        'Blood pressure',
        bpOk ? Math.round(bp.systolic) + '/' + Math.round(bp.diastolic) : null,
        'mmHg',
        bpOk ? asOf(bp) : null
      )
    )
  );

  const workoutCard = Section(
    'dumbbell',
    'Workouts',
    workouts.length
      ? h(
          'ul',
          { class: 'gb-health-workouts' },
          ...workouts.map((w) =>
            h(
              'li',
              null,
              h(
                'div',
                { class: 'gb-health-wk-name' },
                h('strong', null, humanize(w.workoutType)),
                h('span', null, fmtDate(w.startDate, 'weekdayDate'))
              ),
              h(
                'div',
                { class: 'gb-health-wk-nums' },
                h('span', null, minutes(Number(w.duration) / 60) || DASH),
                h(
                  'span',
                  null,
                  w.totalEnergyBurned > 0
                    ? fmtNumber(Math.round(w.totalEnergyBurned)) + ' kcal'
                    : DASH
                )
              )
            )
          )
        )
      : h('p', { class: 'gb-health-none' }, 'No workouts in the last 7 days.')
  );

  return h('div', { class: 'gb-health' }, top, activity, sleepCard, heart, body, workoutCard);
}

export { ScreenHealth };
