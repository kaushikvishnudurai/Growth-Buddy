/* Run: node scripts/e2e/session.e2e.mjs
   Env: GB_E2E_BASE (http://localhost:5191), GB_E2E_CDP (http://127.0.0.1:9223),
        GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_SHOTS (screenshot dir).

   The one sign-out path (app.js endSession), end to end, at 390 and 1280:
     1. Sign out from Settings: the sheet closes, nothing of the account is left in the DOM,
        no /api response is left in the service worker's gb-api-get cache.
     2. A 401 mid-session (one request answered 401 by interception) while the focus timer
        runs: the timer stops, the sign-in card says the session ended, no stale data.
     3. Offline cold start: Home renders from cache under the offline banner, no crash card.
        That is the service worker's path, so it needs a build (`vite preview`); on the dev
        server it is reported as skipped. The phone app's own path (session.js boot
        snapshot) can't run in a browser: scripts/session.test.mjs covers its logic.
   Runs in its own incognito context: cookies ignore the port, so signing out in the shared
   browser's default context would sign every other localhost tab out too. */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5191';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const notes = [];
const check = (ok, what) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures.push(what);
};

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const VIEWPORTS = [
  ['390', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['1280', { width: 1280, height: 800, deviceScaleFactor: 1 }],
];

for (const [vpName, vp] of VIEWPORTS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(vp);
  let offline = false; // console noise expected only while the network is cut
  let expect401 = false;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Expected while the network is cut: the browser's failed loads and socket, and the
    // app's own "No connection" logs for fire-and-forget writes (recordTrendsToday).
    if (
      offline &&
      /ERR_INTERNET_DISCONNECTED|net::|WebSocket connection|No connection\. Check your internet/i.test(
        t
      )
    )
      return;
    if (expect401 && /status of 401/.test(t)) return;
    failures.push(`[${vpName}] console: ${t.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => failures.push(`[${vpName}] pageerror: ${String(e).slice(0, 200)}`));
  let loginLimited = false;
  page.on('response', (r) => {
    if (r.status() < 400) return;
    // The local auth rate limit (cleared every 20 s on the shared backend): retried once below.
    if (r.status() === 429 && /\/api\/auth\/login$/.test(r.url())) {
      loginLimited = true;
      return;
    }
    if (expect401 && r.status() === 401) return;
    failures.push(
      `[${vpName}] HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`
    );
  });
  const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${vpName}-${name}.png` });
  const step = (s) => console.log(`\n[${vpName}] ${s}`);
  const clickText = (sel, re) =>
    page.evaluate(
      (sel, src) => {
        const el = [...document.querySelectorAll(sel)].find((b) =>
          new RegExp(src, 'i').test(b.textContent || '')
        );
        if (el) el.click();
        return !!el;
      },
      sel,
      re.source
    );
  const signIn = async () => {
    await page.waitForSelector('input[type=email]', { timeout: 20000 });
    await page.$eval('input[type=email]', (el) => (el.value = ''));
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    loginLimited = false;
    await clickText('button', /^\s*sign in\s*$/);
    await sleep(1500);
    if (loginLimited) {
      await sleep(20000);
      await clickText('button', /^\s*sign in\s*$/);
    }
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
      timeout: 30000,
    });
    await page.waitForFunction(() => document.querySelector('.gb-avatar[aria-label="Account"]'), {
      timeout: 30000,
    });
    await sleep(2500); // wave 2
  };
  const me = async () =>
    page.evaluate(async () => {
      const r = await caches.open('gb-store-v2');
      const res = await r.match('https://gb-store/' + encodeURIComponent('gb.session'));
      return res ? JSON.parse(await res.text()) : null;
    });
  // Nothing of the account on screen: its name or email anywhere in the DOM (sheets included).
  const leftovers = (who) =>
    page.evaluate(
      (name, email) => {
        const text =
          document.body.innerText +
          ' ' +
          [...document.querySelectorAll('input')].map((i) => i.value).join(' ');
        return {
          name: !!name && text.includes(name),
          email: text.includes(email),
          sheets: document.querySelectorAll('.gb-modal-overlay:not(.is-closing)').length,
        };
      },
      who.displayName || '',
      who.email
    );
  const apiCached = () =>
    page.evaluate(async () => {
      const out = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys())
          if (/\/api\//.test(req.url)) out.push(name + ' ' + req.url);
      }
      return out;
    });
  const userKeys = (uid) =>
    page.evaluate(async (uid) => {
      const c = await caches.open('gb-store-v2');
      return (await c.keys())
        .map((r) => decodeURIComponent(r.url.replace('https://gb-store/', '')))
        .filter((k) => k.endsWith('.' + uid) || k.includes('.' + uid + '.'));
    }, uid);

  await page.goto(BASE, { waitUntil: 'networkidle2' });

  // ---- 1. Sign out from Settings ----
  step('sign in, open Settings, sign out from Account');
  await signIn();
  // A reload so the service worker (a build only) controls the page and fills gb-api-get.
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(2500);
  const user = (await me()) || {};
  check(!!user.email, 'signed in as ' + user.email);
  const sw = await page.evaluate(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller)
  );
  if (sw) check((await apiCached()).length > 0, 'gb-api-get holds /api responses while signed in');
  await page.click('.gb-avatar[aria-label="Account"]');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.gb-profile-pop-item')].some((b) =>
      /settings/i.test(b.textContent)
    )
  );
  await clickText('.gb-profile-pop-item', /settings/);
  await page.waitForSelector('.gb-modal-overlay.is-open');
  await clickText('[role=tab]', /account/);
  await sleep(400);
  await shot('1-settings-account');
  check(await clickText('.gb-account-signout', /sign out/), 'Sign out button found in Settings');
  await page.waitForSelector('input[type=password]', { timeout: 15000 });
  await sleep(800);
  await shot('2-signed-out');
  const after = await leftovers(user);
  check(after.sheets === 0, 'Settings sheet closed on sign-out');
  check(!after.email, 'no previous email in the DOM');
  check(!after.name, 'no previous display name in the DOM');
  check((await apiCached()).length === 0, 'no /api entries in any Cache API cache after sign-out');
  check((await userKeys(user.id)).length === 0, 'no gb.*.<uid> keys left in gb-store-v2');

  // ---- 2. A 401 while the focus timer runs ----
  step('sign in again, start the focus timer, answer one request 401');
  await signIn();
  await page.goto(BASE + '/#focus', { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) => /^\s*start\s*$/i.test(b.textContent)),
    { timeout: 15000 }
  );
  await clickText('button', /^\s*start\s*$/);
  await sleep(1500);
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => /^\s*pause\s*$/i.test(b.textContent))
    ),
    'focus timer running'
  );
  await shot('3-timer-running');
  // A request the service worker answers never reaches page-level interception.
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  let answered = false;
  const on401 = (req) => {
    if (!answered && /\/api\/tasks$/.test(req.url())) {
      answered = true;
      req.respond({ status: 401, contentType: 'application/json', body: '{"message":"expired"}' });
    } else req.continue();
  };
  page.on('request', on401);
  expect401 = true;
  // offline then online -> handleOnline -> loadData() refresh -> GET /api/tasks, answered 401 above.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForSelector('input[type=password]', { timeout: 15000 });
  await sleep(1500);
  page.off('request', on401);
  await page.setRequestInterception(false);
  await page.setBypassServiceWorker(false);
  await shot('4-after-401');
  check(answered, 'one request was answered 401');
  const expired = await leftovers(user);
  check(expired.sheets === 0, 'no sheet over the sign-in card');
  check(!expired.email && !expired.name, 'no stale account data in the DOM after the 401');
  check(
    await page.evaluate(() => /session ended/i.test(document.body.innerText)),
    'sign-in card says the session ended'
  );
  check(
    await page.evaluate(
      async () =>
        !(await (await caches.open('gb-store-v2')).match('https://gb-store/gb.focusSession'))
    ),
    'focus session dropped from storage'
  );
  check(
    !(await page.evaluate(() => /\d+:\d\d/.test(document.title))),
    'no timer ticking in the tab title'
  );
  check((await apiCached()).length === 0, 'no /api entries cached after the 401');
  expect401 = false;
  await signIn();
  await page.goto(BASE + '/#focus', { waitUntil: 'networkidle2' });
  await sleep(1200);
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].some((b) => /^\s*start\s*$/i.test(b.textContent))
    ),
    'after signing back in, the timer is idle (Start, not Pause)'
  );

  // ---- 3. Offline cold start ----
  step('offline cold start');
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  await sleep(2500);
  if (!sw) {
    notes.push(
      `[${vpName}] offline cold start skipped: no service worker (dev server). Run against vite preview.`
    );
  } else {
    offline = true;
    await page.setOfflineMode(true);
    // Headless keeps navigator.onLine true under setOfflineMode; a real offline phone doesn't.
    const fakeOffline = await page.evaluateOnNewDocument(() =>
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false })
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await shot('5-offline-home');
    const home = await page.evaluate(() => ({
      crash: !!document.querySelector('.gb-crash'),
      banner: !!document.querySelector('.gb-offline-banner'),
      header: !!document.querySelector('.gb-avatar[aria-label="Account"]'),
      signin: !!document.querySelector('input[type=password]'),
      onLine: navigator.onLine,
    }));
    check(!home.crash, 'offline reload: no crash card');
    check(home.header && !home.signin, 'offline reload: Home shell signed in');
    check(!home.onLine && home.banner, 'offline reload: offline banner shown');
    await page.removeScriptToEvaluateOnNewDocument(fakeOffline.identifier);
    await page.setOfflineMode(false);
    await sleep(3000); // the socket's reconnect attempt from the offline spell still reports
    offline = false;
  }

  // Leave signed out, through Settings again: no session of ours left behind.
  await page.click('.gb-avatar[aria-label="Account"]');
  await sleep(300);
  await clickText('.gb-profile-pop-item', /settings/);
  await page.waitForSelector('.gb-modal-overlay.is-open');
  await clickText('[role=tab]', /account/);
  await sleep(300);
  await clickText('.gb-account-signout', /sign out/);
  await page.waitForSelector('input[type=password]', { timeout: 15000 });
  await sleep(500);
  await page.close();
  await ctx.close();
}

await browser.disconnect();
notes.forEach((n) => console.log('note ' + n));
if (failures.length) {
  console.log('\n' + failures.length + ' failure(s):\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nsession e2e: all checks passed');
