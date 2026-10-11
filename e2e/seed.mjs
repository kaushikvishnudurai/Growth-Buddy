// Creates a verified, seeded account against a running backend and prints {email, password, token}.
// Usage: GB_API=http://localhost:8590 GB_BACKEND_LOG=<path> node e2e/seed.mjs [--empty]
// The OTP is read from the backend2.log: run the backend with --spring.mail.username= so the
// mail service prints the email instead of sending it.
import { readFileSync } from 'node:fs';

const API = process.env.GB_API || 'http://localhost:8590';
const LOG = process.env.GB_BACKEND_LOG;
const empty = process.argv.includes('--empty');

// The auth routes are rate limited per IP (10 per 5 min). Run the backend with
// --growthbuddy.trust-proxy=true and every seeded account comes from its own forwarded address.
const randomIp = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let fakeIp = randomIp();

async function call(path, method = 'GET', body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': fakeIp,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
}

export function otpFor(email) {
  if (!LOG) throw new Error('GB_BACKEND_LOG is not set');
  const log = readFileSync(LOG, 'utf8');
  // Console mail (no SMTP) prints "To:      <email>" then the body; a configured mailer logs the
  // subject line, which carries the code too.
  let at = log.lastIndexOf('To:      ' + email);
  if (at < 0) at = log.lastIndexOf('Sent email to ' + email);
  if (at < 0) return null;
  const m = log.slice(at, at + 2000).match(/\b(\d{6})\b/);
  return m && m[1];
}

export async function seedAccount({ seed = true, tag = 'e2e' } = {}) {
  // One address per account: a whole worker's sign-ups from one address trip the 10-per-5-min limit.
  fakeIp = randomIp();
  const email = `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;
  const password = 'E2eTest#2026pw';
  const up = await call('/api/auth/signup', 'POST', { email, password, displayName: 'Asha Rao' });
  if (up.status >= 300) throw new Error('signup ' + up.status + ' ' + up.text);
  let otp = null;
  for (let i = 0; i < 40 && !otp; i++) {
    otp = otpFor(email);
    if (!otp) await new Promise((r) => setTimeout(r, 250));
  }
  if (!otp) throw new Error('no OTP in backend2.log for ' + email);
  const v = await call('/api/auth/verify', 'POST', { email, otp });
  const token = v.json && v.json.token;
  const user = v.json && (v.json.user || v.json);
  if (!token) throw new Error('verify ' + v.status + ' ' + v.text);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await call('/api/auth/timezone', 'PUT', { timezone: tz }, token);
  // The verify answer predates the PUT; a cookie carrying its UTC zone makes the app offer a switch.
  user.timezone = tz;
  if (!seed) return { email, password, token, user };
  // A seeded account is a returning user: past the first-run setup sheet, which would
  // otherwise open over every screen and block clicks. --empty keeps the first run.
  const prefs = await call('/api/auth/ui-prefs', 'PUT', { prefs: { ...(user.uiPrefs || {}), setupDone: true } }, token);
  if (prefs.json && prefs.json.uiPrefs) user.uiPrefs = prefs.json.uiPrefs;

  const today = new Date().toLocaleDateString('en-CA');
  const failures = [];
  const post = async (path, body, method = 'POST') => {
    const r = await call(path, method, body, token);
    if (r.status >= 300) failures.push(`${method} ${path} ${r.status} ${r.text.slice(0, 120)}`);
    return r.json;
  };
  const h1 = await post('/api/habits', { name: 'Morning run', icon: 'dumbbell', domain: 'fitness', cadence: 'daily' });
  await post('/api/habits', { name: 'Read 20 pages', icon: 'book-open', domain: 'study', cadence: 'daily' });
  if (h1 && h1.id) await post(`/api/habits/${h1.id}/checkin`, { date: today, done: true });
  const goal = await post('/api/goals', { title: 'Run a 10K', description: 'Build up over 8 weeks', horizon: 'short_term' });
  await post('/api/tasks', { title: 'Book the dentist', priority: 'High', dueAt: new Date(Date.now() + 3600e3).toISOString() });
  await post('/api/tasks', { title: 'Plan this week', priority: 'Medium', goalId: goal && goal.id });
  await post('/api/tasks', { title: 'Renew passport', priority: 'Low' });
  await post('/api/notes', { title: 'Ideas for the trip', body: '<p>Pack light. Book the train early.</p>' });
  await post('/api/reminders', { text: 'Call mom', date: today, time: '19:00', repeat: 'daily', tag: 'personal' });
  await post('/api/reminders', { text: 'Team standup', date: today, time: '09:30', repeat: 'weekdays', tag: 'work' });
  await post('/api/water/entries', { amountMl: 500 });
  await post('/api/food/entries', { foodName: 'Idli', quantityGrams: 150, mealType: 'home', kcal: 220 });
  await post('/api/daily-logs/sleep', { date: today, bedtime: '23:00', wakeTime: '06:30', quality: 'good' });
  await post('/api/daily-logs/mood', { date: today, mood: 'good', energy: 'high', stress: 'calm' });
  if (failures.length) console.error('seed warnings:\n  ' + failures.join('\n  '));
  return { email, password, token, user };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedAccount({ seed: !empty }).then((a) => console.log(JSON.stringify(a)));
}
