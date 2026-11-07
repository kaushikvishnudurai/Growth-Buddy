/* =====================================================================
   Growth Buddy — e2e for the tour / ring-row / reminder-notes work

   Playwright (chromium) run, top to bottom over what the working tree adds:

     1. Every screen loads clean (console errors, pageerrors, HTTP >= 400,
        horizontal overflow).
     2. Settings › Reminders: the new "The tour" block and its "Take the tour
        again" button; the Ring row is absent on the web (Android-only).
     3. The tour, replayed: all six steps walk forward, the real first
        reminder it adds lands on Home, and closing records tourDone.
     4. Reminder notes on Home (dashboard.js NotesLine): a reminder seeded
        with notes shows the clamped line, the tap expands it in place, and
        the full text is there for a screen reader.

   Needs the app running (npm run dev) with the backend up (./run.sh) and the
   seeded QA account. Playwright launches its own Chromium; if that fails the
   way puppeteer.launch() does on this machine, start Chrome yourself and set
   GB_E2E_CDP (http://127.0.0.1:9223) to attach instead.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (unset: launch Chromium)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)
     GB_E2E_OUT  screenshot dir (default: $TMPDIR/gb-e2e-tour)
   ===================================================================== */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || '';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const OUT = process.env.GB_E2E_OUT || path.join(os.tmpdir(), 'gb-e2e-tour');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const problems = [];
const check = (ok, label) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + label);
  if (!ok) failures.push(label);
};
const shot = async (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {});

/* API calls the page would make are made here instead: the app keeps its token
   in CacheStorage (gb.token), not plain localStorage, so in-page fetch can't
   read it. Same account, signed in through the real login. */
const AUTH = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then(async (r) => {
  if (!r.ok) {
    console.error('login for API calls failed: HTTP ' + r.status);
    process.exit(2);
  }
  return r.json();
});
const TOKEN = AUTH.token;
// The account's day, not this machine's: Home shows the account zone's today.
const ACCOUNT_TODAY = new Date().toLocaleDateString('en-CA', { timeZone: AUTH.timezone || 'UTC' });
const apiGet = (p) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + TOKEN } });
const apiPost = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(body),
  });

/* --- browser ------------------------------------------------------------- */
let browser;
if (CDP) {
  browser = await chromium.connectOverCDP(CDP);
} else {
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error('chromium.launch failed (' + e.message.split('\n')[0] + '). Start Chrome with --remote-debugging-port=9223 and set GB_E2E_CDP.');
    process.exit(2);
  }
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 180)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 180)}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

/* --- sign in -------------------------------------------------------------- */
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
if (await page.$('input[type=email]')) {
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || '')).click();
  });
}
await page.waitForSelector('.gb-head-actions', { timeout: 20000 });
await sleep(1000);

/* A tour left mid-way by an earlier run would open over every check below. */
async function closeTourIfOpen() {
  if (await page.$('.gb-tour')) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.gb-tour button')].find((x) => /skip the tour|not now/i.test(x.textContent || ''));
      if (b) b.click();
    });
    await sleep(500);
  }
}
await closeTourIfOpen();

/* --- 1. screen walk -------------------------------------------------------- */
const SCREENS = ['home', 'habits', 'food', 'goals', 'calendar', 'mentor', 'circle', 'family', 'money', 'report', 'focus'];
console.log('\n== screens ==');
for (const s of SCREENS) {
  problems.length = 0;
  await page.evaluate((h) => (location.hash = '#/' + h), s);
  await sleep(1200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(!overflow, s + ': no horizontal overflow');
  check(problems.length === 0, s + ': no console error / HTTP fault' + (problems.length ? ' — ' + problems[0] : ''));
  await shot(page, 'screen-' + s);
}

/* --- 2. Settings › Reminders ---------------------------------------------- */
console.log('\n== settings > reminders ==');
await page.evaluate(() => (location.hash = '#/home'));
await sleep(600);
await page.click('.gb-head-actions .gb-avatar');
await page.waitForSelector('.gb-profile-pop', { timeout: 5000 });
await page.evaluate(() =>
  [...document.querySelectorAll('.gb-profile-pop-item')].find((b) => b.textContent.trim() === 'Settings').click()
);
await page.waitForSelector('.gb-segnav', { timeout: 5000 });
await sleep(400);
await page.evaluate(() =>
  [...document.querySelectorAll('.gb-segnav-btn')].find((b) => b.textContent.trim() === 'Reminders').click()
);
await sleep(600);
await shot(page, 'settings-reminders');

const tourBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Take the tour again')
);
check(await tourBtn.evaluate((b) => !!b), 'settings: "Take the tour again" button present');
check(!(await page.$('.gb-ring-row')), 'settings: no Ring row on the web (Android-only)');

/* --- 3. the tour, replayed -------------------------------------------------- */
console.log('\n== tour replay ==');
await tourBtn.evaluate((b) => b.click());
await page.waitForSelector('.gb-tour', { timeout: 8000 });
await sleep(600);
await shot(page, 'tour-1-welcome');

const tourText = () => page.evaluate(() => document.querySelector('.gb-tour .gb-modal-title').textContent);
check((await tourText()) === 'Welcome to Growth Buddy', 'tour: step 1 is the welcome');

const clickPrimary = () => page.evaluate(() => document.querySelector('.gb-tour .gb-tour-next').click());

await clickPrimary(); // -> first reminder
await sleep(400);
check((await tourText()) === 'Your first reminder', 'tour: step 2 is the first reminder');

await clickPrimary(); // empty text refuses
await sleep(400);
check((await tourText()) === 'Your first reminder', 'tour: empty reminder text refuses to move on');
const errShown = await page.evaluate(() => {
  const e = document.querySelector('.gb-tour .gb-field-error');
  return !!e && e.textContent.trim().length > 0;
});
check(errShown, 'tour: the refusal says why');

const TOUR_TEXT = 'E2E tour reminder ' + (Date.now() % 100000);
await page.fill('#gb-tour-text', TOUR_TEXT);
await clickPrimary();
await sleep(1500);
check((await tourText()) === 'Repeats', 'tour: adding the first reminder moves on');
await shot(page, 'tour-3-repeats');

await clickPrimary(); // -> done/snooze
await sleep(400);
check((await tourText()) === 'Done and Snooze', 'tour: step 4 is Done and Snooze');
await clickPrimary(); // -> alerts
await sleep(800);
check((await tourText()) === 'How reminders reach you', 'tour: step 5 is the permissions');
await shot(page, 'tour-5-alerts');
await clickPrimary(); // -> done
await sleep(400);
check((await tourText()) === 'You’re ready', 'tour: step 6 is the close');
await clickPrimary();
await sleep(1000);
check(!(await page.$('.gb-tour')), 'tour: closes after the last step');

const meR = await apiGet('/api/auth/me');
const me = meR.ok ? await meR.json() : null;
const tourDone = me && !!(me.uiPrefs || {}).tourDone;
check(tourDone === true, 'tour: closing recorded tourDone' + (me ? '' : ' (could not read /api/users/me: HTTP ' + meR.status + ')'));

/* The reminder the tour made is on Home. */
await page.evaluate(() => (location.hash = '#/home'));
await sleep(1800);
const homeHasTourRem = await page.evaluate((t) => document.body.textContent.includes(t), TOUR_TEXT);
check(homeHasTourRem, 'tour: its reminder shows on Home');
await shot(page, 'home-with-tour-reminder');

/* --- 4. reminder notes on Home ---------------------------------------------- */
console.log('\n== reminder notes ==');
const NOTE = 'E2E note: bring the blue folder, gate code 4412';
const created = await apiPost('/api/reminders', {
  text: 'E2E noted reminder',
  date: ACCOUNT_TODAY,
  time: '18:00',
  tag: 'other',
  repeat: 'none',
  notes: NOTE,
}).then(async (r) => (r.ok ? r.json() : null));
check(!!created, 'notes: seeded a reminder with notes');
await page.evaluate(() => (location.hash = '#/calendar'));
await sleep(600);
await page.evaluate(() => (location.hash = '#/home'));
// The seed POST carries no X-GB-Client, so this page gets a data_changed frame
// and re-renders: wait for the line, then let that reload flush before tapping.
await page.waitForSelector('.gb-remnote', { timeout: 15000 }).catch(() => null);
await sleep(2500);

const noteLines = await page.$$('.gb-remnote');
check(noteLines.length > 0, 'notes: the clamped notes line renders on Home (' + noteLines.length + ')');
if (noteLines.length) {
  const first = noteLines[0];
  const aria = await first.getAttribute('aria-label');
  check(!!aria && aria.startsWith('Notes: '), 'notes: the line carries the full text for a screen reader');
  const peek = await page.$('.gb-remnote-peek');
  check(!!peek, 'notes: the hover peek card is in the DOM');
  const expanded = async () => page.$eval('.gb-remnote', (el) => el.getAttribute('aria-expanded')).catch(() => null);
  for (let i = 0; i < 3 && (await expanded()) !== 'true'; i++) {
    await page.click('.gb-remnote').catch(() => {});
    await sleep(500);
  }
  check((await expanded()) === 'true', 'notes: a tap expands the line in place');
  await shot(page, 'notes-expanded');
  for (let i = 0; i < 3 && (await expanded()) !== 'false'; i++) {
    await page.click('.gb-remnote').catch(() => {});
    await sleep(500);
  }
  check((await expanded()) === 'false', 'notes: a second tap collapses it');
}

/* --- done ------------------------------------------------------------------- */
console.log('\n== result ==');
if (problems.length) {
  console.log('runtime problems seen:');
  [...new Set(problems)].slice(0, 20).forEach((p) => console.log('  ' + p));
}
if (failures.length) {
  console.log(failures.length + ' FAILED:');
  failures.forEach((f) => console.log('  - ' + f));
  await browser.close().catch(() => {});
  process.exit(1);
}
console.log('all checks passed — screenshots in ' + OUT);
await browser.close().catch(() => {});
