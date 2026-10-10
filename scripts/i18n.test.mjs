/* Run with: node scripts/i18n.test.mjs
   Plain-assert check for i18n.js. Re-runs itself under TZ=America/Los_Angeles and
   TZ=Asia/Kolkata: a 'YYYY-MM-DD' key parsed as UTC reads a day early west of
   Greenwich, and that only shows in a timezone that isn't UTC. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZONES = ['America/Los_Angeles', 'Asia/Kolkata'];

if (!process.env.GB_I18N_CHILD) {
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, GB_I18N_CHILD: '1' },
      encoding: 'utf8',
    });
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.status !== 0) {
      console.error('i18n.test failed under TZ=' + tz);
      process.exit(1);
    }
  }
  console.log('i18n.test: ok in ' + ZONES.join(', '));
  process.exit(0);
}

const {
  t,
  setLocale,
  getLocale,
  localeFromUser,
  toDate,
  fmtDate,
  fmtTime,
  fmtNumber,
  fmtPercent,
  fmtRelativeDays,
  daysBetween,
  CATALOGS,
} = await import('./i18n.js');

const tz = process.env.TZ;
// The child really is in the zone (else the no-shift check proves nothing).
const offset = new Date(2026, 2, 8, 12).getTimezoneOffset();
assert.ok(offset !== 0, 'TZ not applied: ' + tz);

setLocale('en-US');
assert.equal(getLocale(), 'en-US');

// --- date keys are LOCAL dates, never shifted by UTC ---
{
  const d = toDate('2026-03-08'); // also the US spring-forward day
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 2, 8]);
  assert.equal(fmtDate('2026-03-08', 'dayMonth'), 'Mar 8');
  assert.equal(fmtDate('2026-01-01', 'medium'), 'Jan 1, 2026');
  assert.equal(fmtDate('2026-12-31', 'weekdayLong'), 'Thursday');
  assert.equal(fmtDate('2026-06', 'month'), 'June');
  assert.equal(fmtDate('2026-06', 'monthYear'), 'June 2026');
  assert.equal(fmtDate('2026-11-01', { day: 'numeric' }), '1'); // US fall-back day
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate('nope'), '');
}

// --- relative days, counted in local calendar days ---
assert.equal(fmtRelativeDays(-1), 'yesterday');
assert.equal(fmtRelativeDays(0), 'today');
assert.equal(fmtRelativeDays(3), 'in 3 days');
assert.equal(daysBetween('2026-03-09', '2026-03-07'), 2); // across a DST change
assert.equal(fmtRelativeDays('2026-03-06', '2026-03-08'), '2 days ago');

// --- times ---
assert.equal(fmtTime('19:05', { hour12: true }), '7:05 PM');
assert.equal(fmtTime('00:30', { hour12: false }), '00:30');
assert.equal(fmtTime('x'), '');

// --- numbers and percents ---
assert.equal(fmtNumber(1234567.5), '1,234,567.5');
assert.equal(fmtNumber(null), '');
assert.equal(fmtPercent(0.426), '43%');
assert.equal(fmtPercent(0.4256, 1), '42.6%');
setLocale('en-IN');
assert.equal(fmtNumber(1234567), '12,34,567'); // lakh grouping
setLocale('de-DE');
assert.equal(fmtNumber(1234.5), '1.234,5');
assert.equal(fmtDate('2026-03-08', 'medium'), '8. März 2026');

// --- t(): plurals, interpolation, fallback ---
setLocale('en-US');
assert.equal(t('common.days', { count: 1 }), '1 day');
assert.equal(t('common.days', { count: 0 }), '0 days');
assert.equal(t('common.days', { count: 2500 }), '2,500 days');
assert.equal(t('common.ofGoal', { value: 3, goal: 8 }), '3 of 8');
assert.equal(t('common.ofGoal', { value: 3 }), '3 of {goal}'); // missing var left visible
assert.equal(t('no.such.key'), 'no.such.key');
assert.equal(t('common.today'), 'Today');
// A locale with no catalog of its own falls back to English, then to the key.
setLocale('ta-IN');
assert.equal(t('common.today'), 'Today');
// A partial catalog: its own string wins, English fills the rest.
CATALOGS.ta = { 'common.today': 'இன்று' };
assert.equal(t('common.today'), 'இன்று');
assert.equal(t('common.yesterday'), 'Yesterday');
delete CATALOGS.ta;

// --- locale choice ---
assert.equal(localeFromUser({ uiPrefs: { locale: 'hi_IN' } }), 'hi-IN');
assert.equal(localeFromUser({ language: 'fr' }), 'fr');
assert.equal(localeFromUser({ uiPrefs: { qaLang: 'ta-IN' } }), localeFromUser(null)); // voice ≠ UI
assert.equal(setLocale('not a locale!!'), localeFromUser(null)); // junk → device

console.log('i18n.test: ok (TZ=' + tz + ')');
