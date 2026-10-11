/* =====================================================================
   Growth Buddy — performance e2e (feat/ov-perf)

   At 390 and 1280, signed in, asserts:
     - boot loads neither Money's screen CSS nor the premium skin (premium off);
     - one boot paints #root at most BOOT_MAX_RENDERS times;
     - a task tick on Home issues at most TICK_MAX_REQUESTS API calls and is
       settled within TICK_MAX_MS, and no icon is re-created by a lucide sweep
       (an <i>/<svg data-lucide> swapped for a new <svg>) while it does;
     - the premium skin applies after the Settings toggle and after a reload,
       and no frame paints #root with premium on but the skin missing;
     - zero console errors, zero 4xx/5xx.
   Prints the measured numbers too, so it doubles as the before/after probe.

   GB_E2E_BASE (http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9223),
   GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_SHOTS (dir).
   Leaves the account as it found it: the task is ticked back, premium off.
   ===================================================================== */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
// Measured on build 88 + this branch (dev server, local backend): a tick is the
// PATCH, then /api/score/today and /api/auth/me together: 16-60 ms locally, ~610 ms
// with GB_E2E_LATENCY=300 (it was ~910 ms, three calls in a row, before).
const TICK_MAX_REQUESTS = 3;
const TICK_MAX_MS = 1500;
const BOOT_MAX_RENDERS = 6; // 7 before this branch (the back-to-back pair at boot)
const STRICT = process.env.GB_E2E_MEASURE !== '1'; // 1 = print numbers, assert nothing

const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* Installed before any page script: counts #root paints, lucide sweep
   replacements, and frames that show #root while premium is expected but the
   attribute is not 'on' (i.e. a classic frame flashed). */
function probe() {
  const P = (window.__gbPerf = { renders: 0, sweeps: 0, flash: 0, frames: 0 });
  const expectPremium = /(?:^|; )gb\.premium=1/.test(document.cookie);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.target.id === 'root' && r.type === 'childList' && r.addedNodes.length) P.renders++;
      const gone = [...r.removedNodes].some(
        (n) =>
          n.nodeType === 1 &&
          n.getAttribute &&
          n.getAttribute('data-lucide') &&
          n.parentNode === null
      );
      const added = [...r.addedNodes].some((n) => n.nodeName.toLowerCase() === 'svg');
      if (gone && added && r.target.id !== 'root') P.sweeps++;
    }
  }).observe(document, { childList: true, subtree: true });
  const tick = () => {
    const root = document.getElementById('root');
    if (expectPremium && root && root.childElementCount) {
      P.frames++;
      const shown = getComputedStyle(root).visibility !== 'hidden';
      if (shown && document.documentElement.getAttribute('data-premium') !== 'on') P.flash++;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* Whether any loaded stylesheet has a rule matching `re` (source or selector),
   so the check works the same on the dev server and on a build. */
const rulesLoaded = (re) =>
  [...document.styleSheets].some((s) => {
    try {
      return [...s.cssRules].some((r) => new RegExp(re).test(r.selectorText || ''));
    } catch (_) {
      return false;
    }
  });
// html[data-premium='on'] lives only in premium.css (app.css's one premium rule
// is nested in a media query, so it has no top-level selectorText);
// .gb-money-tape-day only in money.css.
const PREMIUM_RE = 'data-premium=["\']on["\']';
const MONEY_RE = 'gb-money-tape-day';
const premiumRulesLoaded = (page) => page.evaluate(rulesLoaded, PREMIUM_RE);

async function waitQuiet(page, apiLog, quietMs = 800, maxMs = 10000) {
  const t0 = Date.now();
  let last = apiLog.length;
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 100));
    const pending = apiLog.some((x) => !x.done);
    if (apiLog.length !== last || pending) {
      last = apiLog.length;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return;
  }
}

async function openDisplaySettings(page) {
  try {
    await openDisplaySettingsOnce(page);
  } catch (err) {
    const why = await page.evaluate(() => ({
      dialogs: [...document.querySelectorAll('[role=dialog]')].map((d) =>
        d.getAttribute('aria-label')
      ),
      pop: [...document.querySelectorAll('.gb-profile-pop-item')].map((b) => b.textContent.trim()),
      toasts: [...document.querySelectorAll('.gb-toast')].map((t) => t.textContent.trim()),
    }));
    await page
      .screenshot({ path: (process.env.GB_E2E_SHOTS || '.') + '/settings-fail.png' })
      .catch(() => {});
    throw new Error(
      'could not open Settings > Display: ' + JSON.stringify(why) + ' ' + err.message
    );
  }
}
async function openDisplaySettingsOnce(page) {
  await page.evaluate(() =>
    document.querySelector('.gb-head .gb-avatar, .gb-head button[class*="avatar"]').click()
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.gb-profile-pop-item')].some((b) =>
        /settings/i.test(b.textContent)
      ),
    { polling: 100 }
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('.gb-profile-pop-item')]
      .find((b) => /settings/i.test(b.textContent))
      .click()
  );
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button, [role=tab]')].some(
        (b) => b.textContent.trim() === 'Display'
      ),
    { polling: 100 }
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('button, [role=tab]')]
      .find((b) => b.textContent.trim() === 'Display')
      .click()
  );
  await page.waitForFunction(
    () => [...document.querySelectorAll('.gb-seg')].some((b) => b.textContent.trim() === 'Premium'),
    { polling: 100 }
  );
}
const pickLook = (page, label) =>
  page.evaluate(
    (l) =>
      [...document.querySelectorAll('.gb-seg')].find((b) => b.textContent.trim() === l).click(),
    label
  );

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
for (const vp of [
  { name: '390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: '1280', width: 1280, height: 800, deviceScaleFactor: 1 },
]) {
  // Own context: cookies are per host, so tabs of other runs on localhost would
  // otherwise share (and rewrite) this one's session.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.bringToFront(); // a background tab gets no animation frames to probe
  const shot = (n) => SHOTS && page.screenshot({ path: `${SHOTS}/${vp.name}-${n}.png` });
  await page.setViewport(vp);
  // GB_E2E_LATENCY=300 adds that many ms to every request (a mobile RTT), so
  // serial vs parallel round trips show up; off by default.
  const latency = Number(process.env.GB_E2E_LATENCY) || 0;
  if (latency) await page.emulateNetworkConditions({ download: -1, upload: -1, latency });
  await page.evaluateOnNewDocument(probe);
  const errors = [];
  const requests = [];
  const apiLog = [];
  // A 429 from sign-in is the shared local rate limit, retried below; anything else counts.
  let loginLimited = 0;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (loginLimited && / 429 /.test(m.text())) return loginLimited--;
    errors.push('console: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('request', (r) => {
    requests.push(r.url());
    if (r.url().includes('/api/'))
      apiLog.push({ req: r, url: r.url(), t: Date.now(), done: false });
  });
  const settle = (r) => {
    const x = apiLog.find((a) => a.req === r);
    if (x) Object.assign(x, { done: true, end: Date.now() });
  };
  page.on('requestfinished', settle);
  page.on('requestfailed', settle);
  page.on('response', (r) => {
    if (r.status() === 429 && r.url().endsWith('/api/auth/login')) return loginLimited++;
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /sign in/i.test(b.textContent || ''))
        .click()
    );
    const signedIn = () =>
      page
        .waitForFunction(() => !document.querySelector('input[type=password]'), {
          timeout: 20000,
          polling: 100,
        })
        .then(
          () => true,
          () => false
        );
    if (!(await signedIn())) {
      // The local auth rate limit (429) clears every 20 s: wait it out once.
      await new Promise((r) => setTimeout(r, 21000));
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find((b) => /sign in/i.test(b.textContent || ''))
          .click()
      );
      if (!(await signedIn())) throw new Error('sign-in failed');
    }
  }
  await waitQuiet(page, apiLog);
  // A premium left on by an earlier run would make the boot measurement wrong.
  if (await page.evaluate(() => document.documentElement.getAttribute('data-premium') === 'on')) {
    await openDisplaySettings(page);
    await pickLook(page, 'Classic');
    await page.keyboard.press('Escape');
    await waitQuiet(page, apiLog);
  }

  // ---- Boot, signed in, premium off ----
  requests.length = 0;
  // A real reload: a goto that only changes the hash would not boot again.
  await page.evaluate(() => (location.hash = '#/home'));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-task-id] .gb-check', { timeout: 20000 });
  await waitQuiet(page, apiLog);
  const boot = await page.evaluate(() => window.__gbPerf.renders);
  const cssBoot = {
    money: await page.evaluate(rulesLoaded, MONEY_RE),
    premium: await page.evaluate(rulesLoaded, PREMIUM_RE),
  };
  console.log(
    `[${vp.name}] boot: ${boot} #root paints; money.css ${cssBoot.money}, premium.css ${cssBoot.premium}`
  );
  check(
    !STRICT || (!cssBoot.money && !cssBoot.premium),
    `[${vp.name}] boot loads no money/premium CSS`
  );
  check(
    !STRICT || boot <= BOOT_MAX_RENDERS,
    `[${vp.name}] boot paints #root ${boot} times (max ${BOOT_MAX_RENDERS})`
  );
  await shot('home');

  // ---- Task tick ----
  // One open task, ticked on Home and then put back through the API (a done
  // task leaves Home's list, so there is no checkbox to tap the second time).
  const taskId = await page.evaluate(() =>
    document.querySelector('[data-task-id]').getAttribute('data-task-id')
  );
  await page.evaluate(() => (window.__gbPerf.sweeps = 0));
  const from = apiLog.length;
  const t0 = Date.now();
  const patched = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/toggle'),
    {
      timeout: 10000,
    }
  );
  await page.evaluate(
    (id) => document.querySelector(`[data-task-id="${id}"] .gb-check`).click(),
    taskId
  );
  await patched;
  await waitQuiet(page, apiLog, 600);
  // The bell refreshes itself on visibilitychange (another tab in this shared
  // Chrome taking focus); that is not the tick's doing.
  const calls = apiLog.slice(from).filter((c) => !/\/api\/notifications/.test(c.url));
  // From the PATCH leaving to the last answer: the server round trips. The
  // checkbox's own pop (~400 ms before it hands over) is not network time.
  const tickMs =
    Math.max(...calls.map((c) => c.end || Date.now())) - Math.min(...calls.map((c) => c.t));
  const sweeps = await page.evaluate(() => window.__gbPerf.sweeps);
  console.log(
    `[${vp.name}] tick: ${calls.length} requests in ${tickMs} ms, sweeps ${sweeps}: ` +
      calls
        .map(
          (c) =>
            `${c.req.method()} ${new URL(c.url).pathname.replace(/[0-9a-f-]{36}/, ':id')} @${c.t - t0}-${(c.end || 0) - t0}ms`
        )
        .join(' | ')
  );
  check(
    !STRICT || calls.length <= TICK_MAX_REQUESTS,
    `[${vp.name}] tick issues ${calls.length} API calls (max ${TICK_MAX_REQUESTS})`
  );
  check(
    !STRICT || tickMs <= TICK_MAX_MS,
    `[${vp.name}] tick settles in ${tickMs} ms (max ${TICK_MAX_MS})`
  );
  check(!STRICT || sweeps === 0, `[${vp.name}] tick re-creates ${sweeps} icons by sweep`);
  await shot('ticked');
  const undo = await page.evaluate(async (id) => {
    const tok = decodeURIComponent(
      (document.cookie.match(/(?:^|; )gb\.token=([^;]*)/) || [])[1] || ''
    );
    const headers = { Authorization: 'Bearer ' + tok };
    const done = async () =>
      (await (await fetch('/api/tasks', { headers })).json()).find((t) => t.id === id).done;
    if (await done())
      await fetch('/api/tasks/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH', headers });
    return !(await done());
  }, taskId);
  check(undo, `[${vp.name}] task put back to open`);

  if (STRICT) {
    // ---- Premium: toggle on, reload, toggle off ----
    await openDisplaySettings(page);
    await pickLook(page, 'Premium');
    await page
      .waitForFunction(() => document.documentElement.getAttribute('data-premium') === 'on', {
        timeout: 10000,
        polling: 100,
      })
      .catch(() => {});
    check(
      (await page.evaluate(() => document.documentElement.getAttribute('data-premium'))) === 'on',
      `[${vp.name}] premium on after the toggle`
    );
    check(await premiumRulesLoaded(page), `[${vp.name}] premium rules present after the toggle`);
    await page.keyboard.press('Escape');
    await waitQuiet(page, apiLog);
    await shot('premium-toggled');
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-task-id] .gb-check', { timeout: 20000 });
    await waitQuiet(page, apiLog);
    const p = await page.evaluate(() => ({
      on: document.documentElement.getAttribute('data-premium'),
      flash: window.__gbPerf.flash,
      frames: window.__gbPerf.frames,
    }));
    check(p.on === 'on', `[${vp.name}] premium on after reload (${p.on})`);
    check(await premiumRulesLoaded(page), `[${vp.name}] premium rules present after reload`);
    check(
      p.flash === 0,
      `[${vp.name}] no classic frame on a premium reload (${p.flash} of ${p.frames} frames)`
    );
    await shot('premium-reload');
    await openDisplaySettings(page);
    await pickLook(page, 'Classic');
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-premium') === 'off',
      { polling: 100 }
    );
    await page.keyboard.press('Escape');
    await waitQuiet(page, apiLog);
  }

  check(
    errors.length === 0,
    `[${vp.name}] no console errors / failed requests` +
      (errors.length ? ': ' + errors.join(' ; ') : '')
  );
  await ctx.close();
}
await browser.disconnect();
if (failures.length) {
  console.error(`\nperf.e2e: ${failures.length} failed`);
  process.exit(1);
}
console.log('\nperf.e2e: all passed');
