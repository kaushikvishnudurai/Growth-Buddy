/* Web side of the app-parity fixes, in a real browser.

   GB_E2E_BASE (default http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9222),
   GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_OUT (screenshots).

   - Back closes the bell / profile / More panel first, then leaves the screen.
     The app's hardware Back calls history.back() (gb-kit's backButton
     listener), so the browser's back is the same path.
   - A deep-link hash route lands on its screen, and one with a query repaints
     the screen already showing.
   - Voice input: shown with the Web Speech API, hidden without it, and hidden
     when a Capacitor bridge lists no SpeechRecognition plugin (the iOS build),
     shown again when it does.
   - Zero console errors and no 4xx/5xx, at 390 and 1280.

   Native-only paths (appUrlOpen, a notification tap, the plugin headers on a
   real bridge) are covered by push.test.mjs and on a device. */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const OUT = process.env.GB_E2E_OUT || 'assets/e2e/parity';
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};

const failures = [];
const check = (ok, what) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures.push(what);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 60000 });

async function openPage(name, vp, stub) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.bringToFront(); // a background tab in a shared Chrome is throttled
  page.on('console', (m) => {
    // A browser extension's message port, not the page.
    if (m.type() === 'error' && !m.text().startsWith('Unchecked runtime.lastError'))
      failures.push(`[${name}] console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => failures.push(`[${name}] pageerror: ${String(e).slice(0, 200)}`));
  page.on('response', (r) => {
    if (r.status() >= 400)
      failures.push(
        `[${name}] HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`
      );
  });
  if (stub) await page.evaluateOnNewDocument(stub);
  return page;
}

async function signedIn(page, hash = '#/home') {
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle2' });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /sign in/i.test(b.textContent || ''))
        .click()
    );
    await page.waitForSelector('.gb-head', { timeout: 20000 });
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle2' });
  }
  await page.waitForSelector('.gb-head', { timeout: 20000 });
  await pause(600);
}

// A DOM click, not page.click(): that waits on a rendered frame, and a tab in a
// Chrome other runs are driving too may not be the one rendering.
const tap = (page, sel) => page.$eval(sel, (el) => el.click());
const hash = (page) => page.evaluate(() => location.hash);
const has = (page, sel) => page.$(sel).then(Boolean);
async function back(page) {
  await page.evaluate(() => history.back());
  await pause(450);
}

for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  const page = await openPage(vpName, vp);
  await signedIn(page, '#/home');

  // ---- Back closes a panel before it leaves the screen ----
  await tap(page, '.gb-bell');
  await page.waitForSelector('.gb-notif-pop');
  await pause(300);
  await page.screenshot({ path: `${OUT}/${vpName}-bell-open.png` });
  await back(page);
  check(!(await has(page, '.gb-notif-pop')), `[${vpName}] Back closes the bell`);
  check((await hash(page)) === '#/home', `[${vpName}] ...and stays on Home`);

  await page.evaluate(() => (location.hash = '#/habits'));
  await pause(800);
  await tap(page, '.gb-avatar');
  await page.waitForSelector('.gb-profile-pop');
  await pause(300);
  await page.screenshot({ path: `${OUT}/${vpName}-profile-open.png` });
  await back(page);
  check(!(await has(page, '.gb-profile-pop')), `[${vpName}] Back closes the profile panel`);
  check((await hash(page)) === '#/habits', `[${vpName}] ...and stays on Habits`);
  await back(page);
  check((await hash(page)) === '#/home', `[${vpName}] the next Back leaves Habits for Home`);

  // The phone's bottom nav only; the desktop rail lists every screen.
  if (await page.$eval('.gb-nav-tab--more', (b) => !!b.offsetParent).catch(() => false)) {
    await tap(page, '.gb-nav-tab--more');
    await page.waitForSelector('.gb-more-sheet');
    await pause(300);
    await page.screenshot({ path: `${OUT}/${vpName}-more-open.png` });
    await back(page);
    check(!(await has(page, '.gb-more-sheet')), `[${vpName}] Back closes the More sheet`);
    check((await hash(page)) === '#/home', `[${vpName}] ...and stays on Home`);
  }

  // Bell -> profile switches panels without leaving a second back entry.
  await tap(page, '.gb-bell');
  await page.waitForSelector('.gb-notif-pop');
  await pause(200);
  await tap(page, '.gb-avatar');
  await page.waitForSelector('.gb-profile-pop');
  await pause(200);
  await back(page);
  check(
    !(await has(page, '.gb-profile-pop')) && !(await has(page, '.gb-notif-pop')),
    `[${vpName}] one Back closes a panel switched from another`
  );
  check((await hash(page)) === '#/home', `[${vpName}] ...still on Home`);

  // ---- Deep-link routes ----
  await page.goto(BASE + '/#/calendar', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.gb-head');
  await pause(800);
  check(
    /^Calendar/.test(await page.title()),
    `[${vpName}] #/calendar opens Calendar (title "${await page.title()}")`
  );
  await page.screenshot({ path: `${OUT}/${vpName}-deeplink-calendar.png` });
  await page.evaluate(() => (location.hash = '#/money'));
  await pause(1500);
  check(
    (await hash(page)) === '#/money' && /Money/.test(await page.title()),
    `[${vpName}] a hash change routes to Money`
  );
  // A query on the screen already showing repaints it rather than being ignored.
  await page.evaluate(() => {
    window.__marker = document.getElementById('gb-main')?.firstElementChild;
    location.hash = '#/money?from=link';
  });
  await pause(1200);
  check(
    await page.evaluate(
      () => document.getElementById('gb-main')?.firstElementChild !== window.__marker
    ),
    `[${vpName}] a query on the current screen repaints it`
  );
  await page.close();
}

// ---- Voice input follows what the platform really has ----
const noWebSpeech = () => {
  delete window.SpeechRecognition;
  delete window.webkitSpeechRecognition;
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
};
const bridge = (plugins) => `(${noWebSpeech})();
  window.Capacitor = { nativePromise: () => Promise.resolve({}), PluginHeaders: ${JSON.stringify(
    plugins.map((name) => ({ name, methods: [] }))
  )} };`;
const cases = [
  ['web speech', null, true],
  ['no speech API', `(${noWebSpeech})()`, false],
  ['bridge without the plugin (iOS)', bridge(['App', 'LocalNotifications']), false],
  ['bridge with the plugin (Android)', bridge(['App', 'SpeechRecognition']), true],
];
for (const [label, stub, expected] of cases) {
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const page = await openPage(`${vpName} ${label}`, vp, stub);
    await signedIn(page, '#/home');
    await tap(page, '[aria-label="Quick add"]');
    await page.waitForSelector('.gb-modal');
    await pause(900); // past the open transition, for the screenshot
    const mic = await has(page, '.gb-modal .gb-mic');
    check(mic === expected, `[${vpName}] ${label}: Quick add mic ${expected ? 'shown' : 'hidden'}`);
    if (vpName === 'phone')
      await page.screenshot({
        path: `${OUT}/${vpName}-quickadd-${label.replace(/\W+/g, '-')}.png`,
      });
    await page.keyboard.press('Escape');
    await pause(300);
    await page.close();
  }
}

await browser.disconnect();
if (failures.length) {
  console.error('\n' + failures.length + ' problem(s):\n' + failures.join('\n'));
  process.exit(1);
}
console.log('parity.e2e: all passed');
