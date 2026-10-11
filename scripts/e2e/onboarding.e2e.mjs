/* =====================================================================
   Growth Buddy: onboarding e2e

   A brand new account through the UI, at 390 and 1280: sign-up has no
   Confirm password, the pasted code verifies with no tap, first-run setup
   shows no timezone step (the browser emulates the zone the account got) and
   no features step, Home is set up after it, and the first timed reminder
   asks for notifications exactly once. Counts taps and fields from opening
   the app to the set-up Home.

   Needs Vite + a backend that logs its emails (no SMTP / Mailjet set), and a
   Chrome with remote debugging. The 6-digit code is read from that log:

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9223)
     GB_E2E_OTP_LOG  the backend's log file
     GB_E2E_SHOTS    screenshot dir (optional)

   GB_E2E_EMAIL / GB_E2E_PASSWORD are not used: the point is a new account.
   Each account it makes is scheduled for deletion at the end.
   ===================================================================== */

import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const OTP_LOG = process.env.GB_E2E_OTP_LOG;
const SHOTS = process.env.GB_E2E_SHOTS || '';
const PASSWORD = 'Onboard#2026pw';
const ZONE = 'Asia/Kolkata';

if (!OTP_LOG) {
  console.error('set GB_E2E_OTP_LOG to the backend log file (the code is read from it)');
  process.exit(2);
}
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const VIEWPORTS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const failures = [];
const check = (ok, msg) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
  if (!ok) failures.push(msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* The newest code logged for this address. */
async function codeFor(email) {
  for (let i = 0; i < 40; i++) {
    const log = readFileSync(OTP_LOG, 'utf8');
    const at = log.lastIndexOf('To:      ' + email);
    const m = at >= 0 && /Your Growth Buddy code: (\d{6})/.exec(log.slice(at));
    if (m) return m[1];
    await wait(250);
  }
  throw new Error('no code logged for ' + email);
}

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  // Its own incognito context: no session or cache from whoever else uses this Chrome.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const problems = [];
  let expectRefusal = false; // the deliberate wrong code's 400 is not a fault
  page.on('console', (m) => {
    if (m.type() === 'error' && !expectRefusal && !/status of 429/.test(m.text())) problems.push('console: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String((e && e.stack) || e).slice(0, 400)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.status() !== 429 && !expectRefusal) problems.push(r.status() + ' ' + r.request().method() + ' ' + r.url());
  });
  await page.setViewport(vp);
  await page.emulateTimezone(ZONE);
  // The OS prompt, counted. 'denied' keeps the run from subscribing for real.
  await page.evaluateOnNewDocument(() => {
    window.__permAsks = 0;
    if (window.Notification) {
      Notification.requestPermission = async () => {
        window.__permAsks++;
        return 'denied';
      };
    }
  });
  const shot = (s) => SHOTS && page.screenshot({ path: SHOTS + '/' + name + '-' + s + '.png' });
  let taps = 0;
  let fields = 0;
  const tap = async (el) => {
    taps++;
    await el.click();
  };
  const byText = (sel, text) =>
    page.waitForFunction(
      (s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === t && e.offsetParent),
      { timeout: 10000 },
      sel,
      text
    );

  const email = 'qa.onboard.' + Date.now() + '.' + name + '@example.com';
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await tap(await byText('.gb-login-link', 'Create account'));
    await page.waitForSelector('#gb-auth-email');
    await shot('1-signup');
    check(!(await page.$('#gb-auth-confirm')), name + ': sign-up has no Confirm password field');
    const fieldCount = await page.$$eval('.gb-login-input', (els) => els.length);
    for (const [sel, v] of [
      ['#gb-auth-email', email],
      ['#gb-auth-name', 'Onboard QA'],
      ['#gb-auth-password', PASSWORD],
      ['#gb-auth-confirm', PASSWORD],
    ]) {
      if (!(await page.$(sel))) continue;
      fields++;
      await page.type(sel, v);
    }
    check(fields === fieldCount, name + ': filled every sign-up field (' + fields + ')');
    await tap(await byText('.gb-login-btn', 'Create account'));
    // The shared local auth rate limit clears every 20 s: one retry, untallied.
    if (!(await page.waitForSelector('#gb-auth-otp', { timeout: 6000 }).catch(() => null))) {
      await wait(21000);
      await (await byText('.gb-login-btn', 'Create account')).click();
    }

    await page.waitForSelector('#gb-auth-otp', { timeout: 10000 });
    const code = await codeFor(email);
    // A wrong code first: refused once (not resent in a loop), and still editable.
    expectRefusal = true;
    let verifyPosts = 0;
    const countVerify = (r) => r.url().endsWith('/api/auth/verify') && verifyPosts++;
    page.on('request', countVerify);
    await page.focus('#gb-auth-otp');
    await page.keyboard.sendCharacter(code === '000000' ? '111111' : '000000');
    await page.waitForSelector('.gb-login-fielderr', { timeout: 8000 });
    await wait(1500);
    page.off('request', countVerify);
    check(verifyPosts === 1, name + ': a wrong code is sent once, not resent (' + verifyPosts + ')');
    check(
      await page.$eval('#gb-auth-otp', (el) => !el.disabled && el.value.length === 6),
      name + ': after the refusal the code is still in the field to edit'
    );
    await shot('1b-wrong-code');
    check(
      await page.$eval('.gb-login-card', (c) => c.getBoundingClientRect().right <= innerWidth + 0.5),
      name + ': the code screen fits the width (long address included)'
    );
    await page.$eval('#gb-auth-otp', (el) => el.select());
    await page.keyboard.press('Backspace');
    expectRefusal = false;
    fields++;
    // One insertText = a paste or the keyboard's one-time-code autofill.
    await page.keyboard.sendCharacter(code);
    const verified = await page
      .waitForFunction(() => !document.querySelector('#gb-auth-otp'), { timeout: 5000 })
      .then(() => true, () => false);
    check(verified, name + ': the pasted code verified with no tap');
    if (!verified) await tap(await byText('.gb-login-btn', 'Verify & continue'));

    // First-run setup: walk whatever it shows, writing down each step.
    await page.waitForSelector('.gb-setup-modal', { timeout: 15000 });
    const titles = [];
    for (let i = 0; i < 8 && (await page.$('.gb-setup-modal')); i++) {
      const title = await page.$eval('.gb-setup-modal .gb-modal-title', (e) => e.textContent.trim());
      if (titles[titles.length - 1] === title) {
        await wait(200);
        continue;
      }
      titles.push(title);
      await shot('2-setup-' + titles.length);
      if (title === 'What do you want to change?') {
        // Water: nothing timed, so the push ask has to come from the reminder below.
        await tap(await byText('.gb-setup-modal .gb-chip', 'Stay hydrated'));
      }
      const before = await page.evaluate(() => window.__permAsks);
      await tap(await page.$('.gb-setup-modal .gb-btn--primary'));
      await wait(600);
      if ((await page.evaluate(() => window.__permAsks)) > before) taps++; // the OS prompt
    }
    console.log('     ' + name + ': setup steps: ' + JSON.stringify(titles));
    check(!titles.includes('Your timezone'), name + ': no timezone step (zones match)');
    check(!titles.includes('Pick what you’ll use'), name + ': no features step');
    check(!titles.includes('Stay in the loop'), name + ': no notifications step');
    check((await page.evaluate(() => window.__permAsks)) === 0, name + ': nothing asked for push during setup');

    const home = await page
      .waitForFunction(() => /Drink water/.test(document.querySelector('#gb-main')?.textContent || ''), {
        timeout: 10000,
      })
      .then(() => true, () => false);
    check(home, name + ': Home is set up (the picked pack’s habit is on it)');
    await shot('3-home');
    console.log('     ' + name + ': opening the app to a set-up Home: ' + taps + ' taps, ' + fields + ' fields');

    // The first timed reminder asks, once; the second does not.
    await page.evaluate(() => (location.hash = '#/calendar'));
    for (const text of ['Onboarding e2e reminder', 'Onboarding e2e reminder two']) {
      await page.waitForSelector('input[aria-label="Reminder text"]', { visible: true, timeout: 10000 });
      await page.type('input[aria-label="Reminder text"]', text);
      await page.$eval('input[aria-label="Reminder time (optional)"]', (el) => {
        el.value = '23:59';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      // Not a mouse click: the toasts from the first one sit over the button.
      await page.$eval('.gb-rem-add', (b) => b.click());
      await page.waitForFunction((t) => (document.querySelector('#gb-main')?.textContent || '').includes(t), { timeout: 10000 }, text);
      await wait(1200);
    }
    await shot('4-reminder');
    const asks = await page.evaluate(() => window.__permAsks);
    check(asks === 1, name + ': the timed reminder asked for push exactly once (asked ' + asks + ')');
  } catch (err) {
    check(false, name + ': ' + String(err && err.message ? err.message : err).slice(0, 200));
    await shot('error');
  }

  // Clean up: schedule the new account for deletion.
  const del = await page
    .evaluate(async (pw) => {
      // The session token, where cache-storage.js keeps it.
      const c = await caches.open('gb-store-v2');
      const k = (await c.keys()).find((r) => r.url.includes(encodeURIComponent('gb.token')));
      const tok = k ? await (await c.match(k)).text() : '';
      if (!tok) return 'no token';
      const r = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ password: pw }),
      });
      return r.status;
    }, PASSWORD)
    .catch((e) => String(e));
  console.log('     ' + name + ': cleanup delete-account -> ' + del);
  // The delete revokes the session; the app's own 401s after it are not faults of the flow.
  const before = problems.filter((p) => !/delete-account/.test(p));
  check(before.length === 0, name + ': no console errors or failed requests' + (before.length ? ': ' + before.join(' | ') : ''));
  await ctx.close();
}

await browser.disconnect();
if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nonboarding e2e passed');
