/* Security Lows SEC-09 and SEC-15, at 390 and 1280 wide.

   SEC-09: after sign-in the token and session cookies expire in 60 days (the
   server's session TTL), the session cookie carries no email / phone / body /
   token, and after a reload the app still holds the full profile (restored from
   the Cache API) — the settings form shows the account's email.
   SEC-15: Settings > Account > "Download my data" downloads a file, and the
   export now carries the tables owned through a parent or a relationship
   (Buddy chat messages, habit streaks, reminder skips, mentorship requests and
   messages, the account's own family rows). The seeded account is mentored, so
   its mentorship rows are non-empty.
   Zero console errors and no 4xx/5xx.

     node scripts/e2e/security-low.e2e.mjs
   env: GB_E2E_BASE (http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9223),
        GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_SHOTS (screenshot dir, optional) */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
const DAY_S = 86400;
const NEW_TABLES = [
  'mentor_messages',
  'habit_streaks',
  'calendar_reminder_skips',
  'mentorship_requests',
  'mentorship_messages',
  'family_members',
];

const failures = [];
const problems = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP });
/* Its own context: cookies are per host, not per port, so every other tab on
   localhost (any Vite, any branch) shares and keeps rewriting the default jar. */
const context = await browser.createBrowserContext();
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-export-'));
/* One page per width: switching an isMobile page to a desktop viewport in place
   left it painting into the old 800x600 surface. */
let page;
async function openPage(view) {
  if (page) await page.close();
  page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await page.setViewport(view);
}
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function clickButton(re, scope = 'body') {
  const ok = await page.evaluate(
    (src, flags, scope) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll(scope + ' button')].find(
        (x) =>
          x.offsetParent !== null &&
          (re.test(x.getAttribute('aria-label') || '') || re.test((x.textContent || '').trim()))
      );
      if (b) b.click();
      return !!b;
    },
    re.source,
    re.flags,
    scope
  );
  if (!ok) throw new Error('no button ' + re);
}
const cookie = async (name) => (await page.cookies()).find((c) => c.name === name);

try {
  await openPage(PHONE);
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  if (await page.$('input[type=password]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await clickButton(/^sign in$/i);
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
  }
  await wait(2500);

  /* ---- SEC-09: cookie lifetime and contents ---- */
  const now = Date.now() / 1000;
  const tok = await cookie('gb.token');
  const ses = await cookie('gb.session');
  check(!!tok && !!ses, 'token and session cookies are set after sign-in');
  for (const c of [tok, ses].filter(Boolean)) {
    const days = (c.expires - now) / DAY_S;
    check(days > 59 && days <= 60.01, `${c.name} expires in 60 days (got ${days.toFixed(2)})`);
  }
  const slim = ses ? JSON.parse(decodeURIComponent(ses.value)) : {};
  check(!!slim.id && !!slim.displayName, 'session cookie keeps id and displayName for first paint');
  for (const pii of ['email', 'whatsappNumber', 'dob', 'heightCm', 'weightKg', 'token']) {
    check(!(pii in slim), `session cookie carries no ${pii}`);
  }
  const theme = await cookie('gb.theme');
  if (theme) check((theme.expires - now) / DAY_S > 300, 'first-paint pref cookie keeps its one-year life');

  await page.reload({ waitUntil: 'networkidle2' });
  await wait(2000);
  const restored = await page.evaluate(async () => {
    // The app's own in-memory store (Vite serves the module; window.CacheStorage is gone).
    const CacheStorage = (await import('/scripts/cache-storage.js')).CacheStorage;
    const u = JSON.parse(CacheStorage.getItem('gb.session') || 'null');
    return u && u.email;
  });
  check(restored === EMAIL, 'after a reload the in-app profile is whole again (email restored)');

  /* ---- SEC-15: the export, through the real button, at both widths ---- */
  for (const [name, view] of [
    ['390', PHONE],
    ['1280', { width: 1280, height: 800, deviceScaleFactor: 1 }],
  ]) {
    await openPage(view);
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    await wait(1200);
    await clickButton(/^(\w+, )?account$/i); // the avatar reads "AR, account"
    await wait(300);
    await clickButton(/^settings$/i);
    await page.waitForSelector('.gb-segnav', { timeout: 8000 });
    await wait(400);
    const emailShown = await page.evaluate(
      (e) => [...document.querySelectorAll('input')].some((i) => i.value === e) || document.body.innerText.includes(e),
      EMAIL
    );
    check(emailShown, `[${name}] settings show the account email after a reload`);
    await clickButton(/^account$/i, '.gb-segnav');
    await wait(500);
    await shot(`account-pane-${name}`);
    fs.readdirSync(downloads).forEach((f) => fs.rmSync(path.join(downloads, f)));
    const resp = page.waitForResponse((r) => r.url().includes('/api/auth/export'), { timeout: 15000 });
    await clickButton(/download my data/i);
    const r = await resp;
    check(r.status() === 200, `[${name}] export answers 200`);
    const body = await r.json();
    const tables = body.tables || {};
    for (const t of NEW_TABLES) check(Array.isArray(tables[t]), `[${name}] export carries ${t}`);
    check((tables.mentorship_requests || []).length > 0, `[${name}] the mentored account's mentorship rows are in it`);
    check(!('sessions' in tables) && !('password_credentials' in tables), `[${name}] credentials stay out`);
    check(
      !('circle_post_reactions' in tables) ||
        (tables.circle_post_reactions || []).every((x) => !x.user_id || x.user_id === slim.id),
      `[${name}] only this account's own kudos are exported`
    );
    await page
      .waitForFunction(() => document.body.innerText.includes('Your data is downloading.'), { timeout: 8000 })
      .then(() => check(true, `[${name}] the download toast shows`))
      .catch(() => check(false, `[${name}] the download toast shows`));
    let file = null;
    for (let i = 0; i < 40 && !file; i++) {
      await wait(250);
      file = fs.readdirSync(downloads).find((f) => f.endsWith('.json'));
    }
    check(!!file, `[${name}] a growth-buddy-export JSON file lands on disk`);
    if (file) {
      const saved = JSON.parse(fs.readFileSync(path.join(downloads, file), 'utf8'));
      check(NEW_TABLES.every((t) => t in saved.tables), `[${name}] the saved file has the new tables`);
    }
    await shot(`export-${name}`);
    await page.keyboard.press('Escape');
    await wait(300);
  }
} catch (err) {
  failures.push('threw: ' + (err && err.message));
  console.log('FAIL threw: ' + (err && err.stack));
} finally {
  fs.rmSync(downloads, { recursive: true, force: true });
  if (page) await page.close();
  await context.close();
  await browser.disconnect();
}

problems.forEach((p) => console.log('FAIL ' + p));
const bad = failures.length + problems.length;
console.log(bad ? `\n${bad} problem(s)` : '\nsecurity-low: all checks passed');
process.exit(bad ? 1 : 0);
