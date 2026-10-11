/* Responsive audit lows (R-13, R-15..R-22), checked at the widths each one names.
     GB_E2E_BASE (http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9222),
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_SHOTS (screenshot dir).
   Toasts and the food loader are injected as the app's own markup: neither has
   a trigger that is safe to fire on a shared account (a long-email error, a
   slow food save). The More sheet is padded with clones of its own items to
   stand for a user who moved most destinations into it. Nothing is saved. */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || 'e2e-shots/responsive-low';
mkdirSync(SHOTS, { recursive: true });

const fails = [];
const check = (ok, msg) => {
  if (!ok) fails.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context opens its own window: a tab behind other agents' tabs in a
// shared Chrome gets frozen, and evaluate() then hangs until the timeout.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && fails.push('console: ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => fails.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() >= 400) fails.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

const phone = (width, height) => ({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const desk = (width, height) => ({ width, height, deviceScaleFactor: 1 });
async function go(vp, screen) {
  console.log(`  .. #${screen} at ${vp.width}x${vp.height}`);
  await page.setViewport(vp);
  // Not networkidle: Circle keeps a socket and polls, so it never idles.
  await page.goto(`${BASE}/#${screen}`, { waitUntil: 'load' });
  await pause(1500);
}
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  await page.setViewport(phone(390, 844));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  // The local auth rate limit is cleared every 20s: a 429 waits that out and retries once.
  for (let attempt = 0; attempt < 2 && (await page.$('input[type=password]')); attempt++) {
    const res = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20000 });
    await page.$eval('input[type=email]', (e) => (e.value = ''));
    await page.$eval('input[type=password]', (e) => (e.value = ''));
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
    );
    if ((await res).status() === 429 && attempt === 0) {
      fails.length = 0; // the retry is expected; its 429 is not a failure
      await pause(21000);
      continue;
    }
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
    await pause(1200);
  }

  const toast = (msg) =>
    page.evaluate((msg) => {
      document.querySelector('.e2e-toast')?.remove();
      const s = document.createElement('div');
      s.className = 'gb-toast-stack e2e-toast';
      s.innerHTML =
        '<div class="gb-toast is-error is-settled"><span class="gb-toast-icon"></span>' +
        '<span class="gb-toast-msg"></span><button class="gb-toast-close" aria-label="Dismiss">x</button></div>';
      s.querySelector('.gb-toast-msg').textContent = msg;
      document.body.append(s);
      const t = s.querySelector('.gb-toast').getBoundingClientRect();
      const c = s.querySelector('.gb-toast-close').getBoundingClientRect();
      const app = document.querySelector('.gb-app').getBoundingClientRect();
      return { t: t.toJSON(), c: c.toJSON(), app: app.toJSON(), vh: innerHeight };
    }, msg);

  // R-15: a long unbroken email at 320.
  await go(phone(320, 640), 'home');
  let g = await toast('We sent a code to someone.with.a.very.long.address@example-company.co.uk');
  await shot('r15-toast-320');
  check(g.c.right <= g.t.right && g.c.left >= g.t.left, 'R-15 toast close button inside the toast at 320');
  check(g.t.right <= 320, 'R-15 toast inside the viewport at 320');
  check(await noOverflow(), 'R-15 no horizontal overflow at 320');

  // R-17: frame mode (800x1100) and the landscape rail (844x390).
  await go(desk(800, 1100), 'home');
  g = await toast('Saved.');
  await shot('r17-toast-frame-800');
  check(g.t.left >= g.app.left && g.t.right <= g.app.right, 'R-17 toast within the 600px frame at 800x1100');
  g.nav = await page.evaluate(() => document.querySelector('.gb-nav').getBoundingClientRect().top);
  check(g.t.bottom <= g.nav, `R-17 toast clears the frame's nav (${Math.round(g.t.bottom)} vs ${Math.round(g.nav)})`);
  await go(phone(844, 390), 'home');
  g = await toast('Saved.');
  await shot('r17-toast-landscape');
  check(g.vh - g.t.bottom <= 24, `R-17 toast sits at the bottom in landscape (gap ${Math.round(g.vh - g.t.bottom)}px)`);
  await page.evaluate(() => document.querySelector('.e2e-toast')?.remove());

  // R-16: notification panel on a 390x664 visible viewport.
  await go(phone(390, 664), 'home');
  await page.click('.gb-bell');
  await pause(500);
  g = await page.evaluate(() => document.querySelector('.gb-notif-pop')?.getBoundingClientRect().toJSON());
  await shot('r16-notif-390x664');
  check(g && g.bottom <= 664, `R-16 notification panel ends inside the viewport (${g && Math.round(g.bottom)})`);
  await page.keyboard.press('Escape');

  // R-18: header avatar shrinks at 360, a sized avatar elsewhere keeps its size.
  await go(phone(360, 740), 'home');
  g = await page.evaluate(() => {
    const a = document.createElement('div');
    a.className = 'gb-avatar';
    a.style.cssText = 'width:64px;height:64px';
    document.body.append(a);
    const big = a.getBoundingClientRect().width;
    a.remove();
    return { big, head: document.querySelector('.gb-head-actions .gb-avatar')?.getBoundingClientRect().width };
  });
  check(g.big === 64, `R-18 a 64px avatar outside the header stays 64 at 360 (${g.big})`);
  check(g.head === 38, `R-18 header avatar is 38 at 360 (${g.head})`);

  // R-19: More sheet with ~11 items in portrait at 320x568.
  await go(phone(320, 568), 'home');
  await page.click('.gb-nav-tab--more');
  await pause(400);
  g = await page.evaluate(() => {
    const sheet = document.querySelector('.gb-more-sheet');
    const grid = sheet.querySelector('.gb-more-grid');
    const item = sheet.querySelector('.gb-more-item');
    const have = sheet.querySelectorAll('.gb-more-item').length;
    for (let i = have; i < 11; i++) grid.append(item.cloneNode(true));
    for (let i = 0; i < 2; i++) {
      const l = sheet.querySelector('.gb-more-group-label')?.cloneNode(true);
      if (l) sheet.append(l, grid.cloneNode(true));
    }
    const r = sheet.getBoundingClientRect();
    return { top: r.top, scrollable: sheet.scrollHeight > sheet.clientHeight, oy: getComputedStyle(sheet).overflowY };
  });
  await shot('r19-more-320x568');
  check(g.top >= 0, `R-19 More sheet top on screen (${Math.round(g.top)})`);
  check(g.scrollable && g.oy === 'auto', 'R-19 overfull More sheet scrolls');
  await page.keyboard.press('Escape');

  // R-20: food loader on a landscape phone.
  await go(phone(844, 390), 'food');
  g = await page.evaluate(() => {
    const n = document.createElement('div');
    n.className = 'gb-food-loader e2e-loader';
    n.innerHTML =
      '<div class="gb-fl-art"><div class="gb-fl-steam"><i></i><i></i><i></i></div><div class="gb-fl-plate"></div></div>' +
      '<div class="gb-fl-title">Estimating calories</div><div class="gb-fl-sub">Paneer butter masala</div>' +
      '<div class="gb-fl-bar"><span></span></div><div class="gb-fl-steps"><span>Reading what you ate</span></div>';
    document.body.append(n);
    const r = (s) => n.querySelector(s).getBoundingClientRect();
    return { title: r('.gb-fl-title').top, steps: r('.gb-fl-steps').bottom, art: r('.gb-fl-art').top, vh: innerHeight };
  });
  await pause(500); // past its fade-in
  await shot('r20-food-loader-844x390');
  check(g.art >= 0 && g.steps <= g.vh, `R-20 food loader fits 390 tall (art ${Math.round(g.art)}, steps ${Math.round(g.steps)})`);
  await page.evaluate(() => document.querySelector('.e2e-loader')?.remove());

  // R-21: search sheet at 1280 vs 768, note editor at 1280.
  for (const w of [768, 1280]) {
    await go(desk(w, 900), 'circle');
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /find someone/i.test(b.textContent))?.click()
    );
    await page.waitForSelector('.gb-search-modal', { timeout: 5000 });
    await pause(500);
    g = await page.evaluate(() => document.querySelector('.gb-search-modal').getBoundingClientRect().width);
    await shot(`r21-search-${w}`);
    check(Math.round(g) === 520, `R-21 search sheet is 520 wide at ${w} (${Math.round(g)})`);
    await page.keyboard.press('Escape');
    await pause(400);
  }
  await go(desk(1280, 900), 'notes');
  await page.waitForSelector('.gb-note-card', { timeout: 8000 });
  await page.click('.gb-note-card');
  await page.waitForSelector('.gb-note-modal', { timeout: 5000 });
  await pause(500);
  g = await page.evaluate(() => document.querySelector('.gb-note-modal').getBoundingClientRect().width);
  await shot('r21-note-1280');
  // The note sheet is a page from 720 up: ~65 characters a line (app.css, main's rule).
  check(Math.round(g) === 660, `R-21 note editor is 660 wide at 1280 (${Math.round(g)})`);
  await page.keyboard.press('Escape');
  await pause(400);

  // R-13: badge rules visible, focus chart readout on tap, sound hint on pick.
  await go(phone(390, 844), 'money');
  // Tabs re-render on a pick, so each one is looked up afresh.
  for (let i = 0; i < 8 && !(await page.$('.gb-money-badge')); i++) {
    const more = await page.evaluate((i) => {
      const t = document.querySelectorAll('.gb-money-tab')[i];
      t?.click();
      return !!t;
    }, i);
    if (!more) break;
    await pause(500);
  }
  await page.evaluate(() => document.querySelector('.gb-money-badges')?.scrollIntoView());
  await pause(300);
  g = await page.evaluate(() => {
    const s = document.querySelector('.gb-money-badge-lbl small');
    return s ? s.getBoundingClientRect().height > 0 && s.textContent : null;
  });
  await shot('r13-money-badges-390');
  check(!!g, `R-13 badge rule shown under its label (${g})`);
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll('.gb-money-badge')].every((b) => b.scrollWidth <= b.clientWidth)
    ),
    'R-13 badge rules wrap inside their badge at 390'
  );
  await go(phone(390, 844), 'focus');
  await page.waitForSelector('.gb-focus-hist-hit', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('.gb-focus-hist-svg').scrollIntoView({ block: 'center' }));
  await pause(300);
  const before = await page.$eval('.gb-focus-hist-sum', (e) => e.textContent);
  const hits = await page.$$('.gb-focus-hist-hit');
  await hits[hits.length - 1].tap();
  await pause(200);
  const after = await page.$eval('.gb-focus-hist-sum', (e) => e.textContent);
  await shot('r13-focus-readout-390');
  check(after !== before && /:/.test(after), `R-13 tapping a focus column reads it out ("${after}")`);
  await hits[hits.length - 1].tap();
  check((await page.$eval('.gb-focus-hist-sum', (e) => e.textContent)) === before, 'R-13 second tap restores the summary');
  const status = await page.evaluate(() => {
    const t = document.querySelector('.gb-sound-tile');
    return t && t.closest('.gb-card')?.querySelector('.gb-score-sub')?.textContent;
  });
  check(!status || /Off/.test(status) || status.split(' · ').length === 3, `R-13 sound status carries the hint ("${status}")`);
} catch (e) {
  fails.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
} finally {
  await ctx.close();
  await browser.disconnect();
}

if (fails.length) {
  console.error('\n' + fails.length + ' problem(s):\n' + fails.join('\n'));
  process.exit(1);
}
console.log('\nresponsive-low: all checks passed → ' + SHOTS);
