/* =====================================================================
   Growth Buddy — contrast e2e

   Renders each component the ui-css and accessibility audits found failing
   (the reminder toast, the food total, the snoozed chips, the premium primary
   button, field borders and focus, off switches, the Home pills and mini
   calendar, the bell panel links, the calendar tab) and reads the colours the
   browser actually computed, in light and dark (and the premium skin for the
   button). Text needs 4.5:1 (3:1 when large); a control's edge or a focus
   indicator needs 3:1 against what it sits on.

   The background is the real stack under the element: every ancestor's
   background colour and gradient stops composited, so a gradient is as good as
   its worst stop. Colours are normalised through a 1px canvas, which reads any
   CSS colour Chrome computes (rgb, color(srgb), oklab).

   Theme and skin are flipped on the root attributes only, so nothing is saved
   to the shared account's ui_prefs. The snoozed chips need a snoozed reminder
   the seeded account doesn't have, so those two are mounted with their real
   classes inside a real card.

     GB_E2E_BASE (http://localhost:5187)  GB_E2E_CDP (http://127.0.0.1:9223)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)
     GB_E2E_OUT  screenshot dir (default: $TMPDIR/gb-e2e-contrast)
     GB_E2E_REPORT_ONLY=1  print the ratios, exit 0 (for a before/after run)
   ===================================================================== */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5187';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const OUT = process.env.GB_E2E_OUT || path.join(os.tmpdir(), 'gb-e2e-contrast');
const REPORT_ONLY = process.env.GB_E2E_REPORT_ONLY === '1';
mkdirSync(OUT, { recursive: true });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const problems = [];
const rows = [];

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so a tab on localhost shares gb.token
// with every other tab there, and another run signing out would end this one.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
// A background tab's transitions are throttled, and a dialog measured mid-fade reads 1:1.
await page.bringToFront();
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 180)}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 180)}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

/* In-page measurement. `prop` picks what is measured: the text colour, a
   border, or the first colour in a box-shadow; `against` is the element whose
   background stack it sits on (the element itself for text, its parent for an
   edge). */
const MEASURE = () => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (str) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = 'rgba(0,0,0,0)';
    cx.fillStyle = str;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const COLOR = /(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b)/gi;
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  function backgrounds(el) {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const color = rgba(cs.backgroundColor);
      const img = cs.backgroundImage;
      const stops = img && img !== 'none' && /gradient/.test(img) ? (img.match(COLOR) || []).map(rgba) : null;
      layers.push({ color, stops });
      if (color[3] === 1 && !stops) break;
    }
    let cands = [[255, 255, 255, 1]];
    for (const l of layers.reverse()) {
      cands = cands.map((c) => over(l.color, c));
      if (l.stops && l.stops.length) cands = cands.flatMap((c) => l.stops.map((s) => over(s, c)));
    }
    return cands;
  }
  function opacityOf(el) {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  }
  window.__gbMeasure = (selector, { prop = 'color', against = 'self', min = null, all = false } = {}) => {
    const els = [...document.querySelectorAll(selector)].filter((e) => {
      const r = e.getBoundingClientRect();
      // Not a sheet still fading out (a closed dialog lingers in the DOM for its exit).
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && opacityOf(e) > 0.05;
    });
    const out = [];
    for (const el of all ? els : els.slice(0, 1)) {
      const cs = getComputedStyle(el);
      let fgStr = cs.color;
      if (prop === 'border') fgStr = cs.borderTopColor;
      if (prop === 'shadow') fgStr = (cs.boxShadow.match(COLOR) || ['transparent'])[0];
      if (prop === 'outline') fgStr = cs.outlineColor;
      const bgs = backgrounds(against === 'parent' ? el.parentElement : el);
      const fg0 = rgba(fgStr);
      const o = opacityOf(el);
      let worst = Infinity;
      for (const bg of bgs) worst = Math.min(worst, ratio(over([fg0[0], fg0[1], fg0[2], fg0[3] * o], bg), bg));
      const px = parseFloat(cs.fontSize);
      const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      out.push({
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28),
        ratio: Math.round(worst * 100) / 100,
        need: min ?? (prop === 'color' ? (large ? 3 : 4.5) : 3),
      });
    }
    return out;
  };
};

async function check(label, selector, opts = {}) {
  const res = await page.evaluate((s, o) => window.__gbMeasure(s, o), selector, opts);
  const state = await page.evaluate(
    () =>
      document.documentElement.getAttribute('data-theme') +
      (document.documentElement.getAttribute('data-premium') === 'on' ? '+premium' : '')
  );
  if (!res.length) {
    if (opts.required) failures.push(`${state} ${label}: not rendered (${selector})`);
    else rows.push(`  -    ${state.padEnd(13)} ${label}: not on screen`);
    return;
  }
  for (const r of res) {
    const ok = r.ratio >= r.need;
    rows.push(`  ${ok ? 'ok  ' : 'FAIL'} ${state.padEnd(13)} ${label} ${r.ratio}:1 (needs ${r.need}) "${r.text}"`);
    if (!ok) failures.push(`${state} ${label}: ${r.ratio}:1 < ${r.need}:1 "${r.text}"`);
  }
}

const setSkin = (theme, premium) =>
  page.evaluate(
    (t, p) => {
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.setAttribute('data-premium', p ? 'on' : 'off');
    },
    theme,
    premium
  );
const go = async (screen) => {
  await page.evaluate((s) => {
    location.hash = s;
  }, screen);
  await pause(1300);
};
const shot = async (name) => {
  const st = await page.evaluate(
    () =>
      document.documentElement.getAttribute('data-theme') +
      (document.documentElement.getAttribute('data-premium') === 'on' ? '-premium' : '')
  );
  const vw = page.viewport().width;
  await page.screenshot({ path: path.join(OUT, `${name}-${st}-${vw}.png`) });
};
// The open sheet has finished its entrance. openOverlay adds .is-open from a
// requestAnimationFrame, which a tab in a shared headless Chrome may never get,
// so after a beat the class is set by hand: what is measured is the open state.
const settle = async () => {
  await pause(600);
  await page.evaluate(() =>
    document.querySelectorAll('.gb-modal-overlay:not(.is-open)').forEach((o) => o.classList.add('is-open'))
  );
  await pause(500);
};
const clickText = (re) =>
  page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button, [role=button], [role=menuitem]')].find(
      (b) => rx.test((b.textContent || b.getAttribute('aria-label') || '').trim()) && b.offsetParent
    );
    if (!el) return false;
    el.click();
    return true;
  }, re.source);
const closeOverlays = async () => {
  await page.keyboard.press('Escape');
  await pause(450);
  await page.evaluate(() => document.querySelectorAll('.gb-modal-overlay').forEach((o) => o.remove()));
};

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// On every document: a viewport change to or from isMobile reloads the page.
await page.evaluateOnNewDocument(MEASURE);
await page.goto(BASE, { waitUntil: 'networkidle2' });
// The local auth rate limit clears every 20s: a 429 is retried once after it.
let limited = false;
page.on('response', (r) => {
  if (r.status() === 429 && /\/api\/auth\/login/.test(r.url())) limited = true;
});
for (let attempt = 0; attempt < 2 && (await page.$('input[type=email]')); attempt++) {
  limited = false;
  await page.evaluate(() => document.querySelectorAll('input').forEach((i) => (i.value = '')));
  await page.type('input[type=email]', EMAIL);
  await page.type('input[type=password]', PASSWORD);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
  );
  const ok = await page
    .waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (ok) break;
  if (!limited) throw new Error('sign-in did not complete');
  await pause(21000);
}
// The retried 429 is the rate limiter, not the app.
for (let i = problems.length - 1; i >= 0; i--) {
  if (/HTTP 429 POST .*\/api\/auth\/login|status of 429/.test(problems[i])) problems.splice(i, 1);
}
await pause(1500);

for (const width of [390, 1280]) {
  await page.setViewport(
    width < 1024
      ? { width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { width, height: 800, deviceScaleFactor: 1 }
  );
  for (const theme of ['light', 'dark']) {
    await setSkin(theme, false);

    // Home: priority / horizon pills (Lighthouse), the mini calendar's other-month days.
    await go('home');
    await check('Home .gb-pill', '.gb-pill', { all: true });
    await check('mini calendar other-month day', '.gb-mini-cal-day.is-other-month .num', { all: true });
    await check('mini calendar badge', '.gb-mini-cal-day .badge', { all: true });
    await check('bell badge', '.gb-bell-badge');
    await shot('home');

    // UI-01: the reminder ("info") toast, raised through the app's own toast.
    await page.evaluate(async () => {
      const { toast } = await import('/scripts/toast.js');
      toast.action('Reminder due: drink water', 'Open', () => {});
    });
    await pause(500);
    await check('info toast text', '.gb-toast.is-info .gb-toast-msg', { required: true });
    await shot('toast-info');
    await page.evaluate(() => document.querySelectorAll('.gb-toast-close').forEach((b) => b.click()));
    await pause(300);

    // A11Y-03: the notification panel's header links.
    if (await page.evaluate(() => !!document.querySelector('.gb-bell')?.click() || !!document.querySelector('.gb-bell'))) {
      await pause(500);
      await check('notif panel link', '.gb-notif-link', { all: true });
      await check('notif load older', '.gb-notif-more');
      await shot('notif-panel');
      await page.evaluate(() => document.querySelector('.gb-bell')?.click());
      await page.keyboard.press('Escape');
      await pause(400);
    }

    // UI-04 / UI-06: Quick add carries a primary button and a text field.
    if (await clickText(/^quick add$/i)) {
      // Past the entrance: mid-fade, the sheet's opacity reads every pair as 1:1.
      await settle();
      await check('field border (resting)', '.gb-modal .gb-input', { prop: 'border', against: 'parent' });
      await page.evaluate(() => document.querySelector('.gb-modal input.gb-input, .gb-modal textarea.gb-input')?.focus());
      await pause(400);
      await check('field border (focused)', '.gb-modal .gb-input:focus', {
        prop: 'border',
        against: 'parent',
        required: true,
      });
      await check('primary button label', '.gb-modal .gb-btn--primary', { required: true });
      await shot('quick-add');
      await setSkin(theme, true);
      await pause(400);
      await check('primary button label', '.gb-modal .gb-btn--primary', { required: true });
      await shot('quick-add');
      await setSkin(theme, false);
      await closeOverlays();
    } else failures.push(`${theme} quick add: could not open it`);

    // UI-02: the food card's day total.
    await go('food');
    await check('food total chip', '.gb-food-total', { required: true });
    await shot('food');

    // A11Y-05: the calendar's Day/Week switch (schedule view) and its stats.
    await go('calendar');
    await check('calendar Day/Week tab', '.gb-sched-tab.is-on');
    await check('schedule busy stat', '.gb-sched-stat.is-busy');
    // UI-03: both snoozed chips, mounted with their real classes in a real card.
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('#gb-main .gb-card')].find((c) => c.offsetParent);
      if (!card) return;
      const a = document.createElement('button');
      a.className = 'gb-remset-snoozed';
      a.dataset.e2e = '1';
      a.textContent = 'Snoozed until 09:20';
      const b = document.createElement('button');
      b.className = 'meta-item gb-rem-snoozed gb-rem-snoozed--btn';
      b.dataset.e2e = '1';
      b.textContent = 'Snoozed till 09:20';
      card.prepend(a, b);
    });
    await check('settings snoozed chip', '.gb-remset-snoozed[data-e2e]', { required: true });
    await check('reminder row snoozed chip', '.gb-rem-snoozed--btn[data-e2e]', { required: true });
    await shot('calendar-snoozed');
    await page.evaluate(() => document.querySelectorAll('[data-e2e]').forEach((n) => n.remove()));

    // UI-07 / A11Y-01: an off switch and an unchecked check in Settings.
    await go('home');
    await page.evaluate(() => document.querySelector('.gb-head-actions .gb-avatar, .gb-avatar')?.click());
    await pause(500);
    if (await clickText(/^settings$/i)) {
      await settle();
      // The first pane has no switch; walk the tabs until one shows.
      for (let i = 0; i < 8; i++) {
        const found = await page.evaluate((n) => {
          if ([...document.querySelectorAll('.gb-modal .gb-switch')].some((x) => x.offsetParent)) return true;
          const tabs = [...document.querySelectorAll('.gb-modal [role=tab], .gb-modal .gb-segnav-btn')];
          tabs[n]?.click();
          return false;
        }, i);
        if (found) break;
        await pause(500);
      }
      await check('off switch track edge', '.gb-modal .gb-switch:not(.is-on)', { prop: 'shadow', against: 'parent' });
      await shot('settings');
      await closeOverlays();
    } else rows.push(`  -    ${theme} settings: no Settings entry in the profile menu`);
    await go('habits');
    await check('unchecked habit check edge', '.gb-check:not(.is-done)', { prop: 'border', against: 'parent' });
  }
}

// UI-05: on a landscape phone the premium skin keeps the flush icon rail (it
// lost to premium's floating pill: 40px radius, gaps, no notch padding).
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const theme of ['light', 'dark']) {
  await setSkin(theme, true);
  await go('home');
  const nav = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.gb-nav'));
    return { radius: cs.borderTopLeftRadius, margin: cs.marginLeft + ' ' + cs.marginBottom, dir: cs.flexDirection };
  });
  const ok = nav.radius === '0px' && nav.margin === '0px 0px' && nav.dir === 'column';
  rows.push(`  ${ok ? 'ok  ' : 'FAIL'} ${(theme + '+premium').padEnd(13)} landscape rail ${JSON.stringify(nav)}`);
  if (!ok) failures.push(`${theme}+premium landscape rail: ${JSON.stringify(nav)}`);
  await shot('landscape-rail');
}
await setSkin('light', false);

console.log(rows.join('\n'));
await ctx.close();
await browser.disconnect();

const all = [...failures, ...problems];
if (all.length) {
  console.error(`\ncontrast e2e: ${failures.length} contrast failure(s), ${problems.length} page problem(s)`);
  for (const f of all) console.error('  - ' + f);
  if (!REPORT_ONLY) process.exit(1);
} else console.log(`\ncontrast e2e: every rendered pair passes; screenshots in ${OUT}`);
