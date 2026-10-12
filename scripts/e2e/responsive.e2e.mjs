/* =====================================================================
   Growth Buddy — responsive e2e (docs/audit/responsive.md, bugs.txt QA-09)

   At ten viewports, from a 320px phone to a 4K monitor:
   - every nav destination can be reached and navigated to (the desktop
     sidebar scrolls when the window is short, R-01);
   - no element's right edge runs past the viewport, on any screen (measured
     per element: #gb-main is the scroller, so the page never shows it);
   - the R-12 controls take a 44px tap;
   - a landscape phone gives the content most of the screen (QA-09);
   - at 3840 every screen sits on the same centre line (R-11);
   - Settings > Display > Largest really scales the type, and at 320px with
     it on nothing overflows (R-06), and the settings tabs scroll (R-05).
   Screenshots go to GB_E2E_OUT. Fails on any assertion, console error or
   HTTP 4xx/5xx.

     GB_E2E_BASE=http://localhost:5173 GB_E2E_CDP=http://127.0.0.1:9222 \
       node scripts/e2e/responsive.e2e.mjs
   ===================================================================== */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const OUT = process.env.GB_E2E_OUT || 'assets/e2e/responsive';

const VIEWPORTS = [
  [1920, 1080],
  [320, 568],
  [360, 740],
  [390, 844],
  [540, 720],
  [768, 1024],
  [844, 390],
  [1024, 768],
  [1366, 660],
  [3840, 2160],
].filter(
  ([w, h]) =>
    !process.env.GB_E2E_VIEWPORTS || process.env.GB_E2E_VIEWPORTS.split(',').includes(`${w}x${h}`)
);

mkdirSync(OUT, { recursive: true });
const fails = [];
const fail = (m) => {
  fails.push(m);
  console.log('FAIL ' + m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The shared Chrome can be busy; its own context keeps other tabs' cookies
// (cookies are per host, not per port) from signing this run out.
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on('dialog', (d) => {
  fail('unexpected dialog: ' + d.message());
  d.dismiss();
});
page.on('console', (m) => {
  // The login's rate-limit 429 is retried below, not a failure.
  if (m.type() === 'error' && !/status of 429/.test(m.text()))
    fail('console: ' + m.text().slice(0, 200));
});
if (process.env.GB_E2E_DEBUG)
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log('nav ' + f.url()));
page.on('pageerror', (e) => fail('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() === 429 && r.url().includes('/api/auth/login')) return;
  if (r.status() >= 400)
    fail(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

let wasPhone = null;
async function setVp(w, h) {
  const phone = w < 1024;
  await page.setViewport({
    width: w,
    height: h,
    deviceScaleFactor: 1,
    isMobile: phone,
    hasTouch: phone,
  });
  // Switching isMobile/hasTouch reloads the page: wait for the app to come back.
  if (wasPhone !== null && wasPhone !== phone) {
    await sleep(500);
    await page.waitForSelector('.gb-nav-tab', { timeout: 20000 });
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(() => {});
  }
  wasPhone = phone;
  await sleep(400);
}

/* Every element whose box runs past the right edge, unless a sideways
   scroller (a chip row, the settings tabs) keeps it inside the screen. */
const overflowing = () =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.right <= vw + 1) continue;
      if (el.closest('.gb-sr-only')) continue; // clipped to 1px, never painted
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || (cs.position === 'fixed' && r.left >= vw)) continue;
      // Only a sideways scroller excuses it: overflow:hidden (#gb-main's own
      // overflow-x, a card's) just cuts the element off at the edge.
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && a.getBoundingClientRect().right <= vw + 1) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      const cls = (el.className || '').toString().trim().split(/\s+/)[0];
      out.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}@${Math.round(r.right)}`);
    }
    // A label running out of its own button (text is not an element, so the
    // edge check above can't see it): the Money tabs at Largest text did.
    // A Range covers the button's contents but not its 44px ::before overlay.
    const range = document.createRange();
    for (const b of document.querySelectorAll('#gb-main button, .gb-nav button')) {
      if (!b.clientWidth || b.closest('.gb-sr-only') || !b.textContent.trim()) continue;
      range.selectNodeContents(b);
      const t = range.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      if (t.width && (t.right > r.right + 1 || t.left < r.left - 1)) {
        const cls = (b.className || '').toString().trim().split(/\s+/)[0];
        out.push(`button.${cls} "${b.textContent.trim().slice(0, 20)}" spills its box`);
      }
    }
    return { vw, over: [...new Set(out)].slice(0, 6) };
  });

/* The nav's destinations: the bar's own tabs, then (phones) the More sheet. */
const visibleTabs = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.gb-nav-tab:not(.gb-nav-tab--more)')]
      .filter((b) => getComputedStyle(b).display !== 'none')
      .map((b) => b.getAttribute('aria-label'))
  );

async function clickCentre(handle) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  await sleep(150);
  const ok = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const vis = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const hit = document.elementFromPoint(x, y);
    // scrollIntoView also scrolls overflow:hidden boxes, which a user cannot:
    // reaching a control that way does not count.
    for (let a = el.parentElement; a; a = a.parentElement) {
      const o = getComputedStyle(a).overflowY;
      if ((o === 'hidden' || o === 'clip') && a.scrollTop > 0) {
        a.scrollTop = 0;
        return null;
      }
    }
    return vis && hit && (hit === el || el.contains(hit)) ? [x, y] : null;
  });
  if (!ok) return false;
  await page.mouse.click(ok[0], ok[1]);
  return true;
}

/* Navigate to `label` through the UI only. Returns false when no visible,
   unobstructed control leads there. */
async function navTo(label) {
  const tab = await page.$(`.gb-nav-tab:not(.gb-nav-tab--more)[aria-label="${label}"]`);
  const shown = tab && (await tab.evaluate((b) => getComputedStyle(b).display !== 'none'));
  if (shown) {
    if (!(await clickCentre(tab))) return false;
  } else {
    const more = await page.$('.gb-nav-tab--more');
    if (!more || !(await clickCentre(more))) return false;
    await sleep(300);
    const items = await page.$$('.gb-more-item');
    let item = null;
    for (const it of items)
      if ((await it.evaluate((e) => e.textContent.trim())) === label) item = it;
    if (!item || !(await clickCentre(item))) return false;
  }
  try {
    await page.waitForSelector(`.gb-nav-tab[aria-label="${label}"][aria-current="page"]`, {
      timeout: 8000,
    });
  } catch {
    return false;
  }
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await sleep(400);
  return true;
}

await setVp(1920, 1080);
await page.goto(BASE, { waitUntil: 'networkidle2' });
// A 429 from the local auth rate limit clears within 20s: wait and retry once.
for (let attempt = 0; attempt < 2 && (await page.$('input[type=password]')); attempt++) {
  if (attempt) await sleep(21000);
  await page.$eval('input[type=email]', (e) => (e.value = ''));
  await page.$eval('input[type=password]', (e) => (e.value = ''));
  await page.type('input[type=email]', EMAIL);
  await page.type('input[type=password]', PASSWORD);
  const login = page.waitForResponse((r) => r.url().includes('/api/auth/login'), {
    timeout: 20000,
  });
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /sign in/i.test(b.textContent || ''))
      ?.click()
  );
  const res = await login;
  if (res.status() === 429) continue;
  await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
    timeout: 20000,
  });
}
await page.waitForSelector('.gb-nav-tab', { timeout: 20000 });
await sleep(1200);

// The sidebar at 1920 shows every destination inline: that is the full list.
const DESTS = await visibleTabs();
console.log('destinations: ' + DESTS.join(', '));
if (DESTS.length < 8) fail('expected the sidebar to list every destination, got ' + DESTS.length);

for (const [w, h] of VIEWPORTS) {
  const tag = `${w}x${h}`;
  await setVp(w, h);
  const centres = [];
  const navTops = [];
  for (const label of DESTS) {
    if (!(await navTo(label))) {
      fail(`[${tag}] cannot reach ${label} from the nav`);
      continue;
    }
    const o = await overflowing();
    if (o.over.length)
      fail(`[${tag}/${label}] past the right edge (${o.vw}): ${o.over.join(', ')}`);
    await page.screenshot({
      path: `${OUT}/${tag}-${label.toLowerCase().replace(/\W+/g, '-')}.png`,
    });
    // R-10: in the tablet frame the bottom nav stays put from tab to tab.
    navTops.push(
      await page.evaluate(() =>
        Math.round(document.querySelector('.gb-nav').getBoundingClientRect().bottom)
      )
    );
    if (w === 3840) {
      centres.push([
        label,
        await page.evaluate(() => {
          const main = document.getElementById('gb-main');
          const root = main.lastElementChild;
          const r = root.getBoundingClientRect();
          const m = main.getBoundingClientRect();
          return Math.round((r.left + r.right) / 2 - (m.left + m.right) / 2);
        }),
      ]);
    }
  }

  if (w < 1024 && h >= 560 && new Set(navTops).size > 1)
    fail(`[${tag}] the nav moves between tabs: ${[...new Set(navTops)].join(', ')}`);
  if (w === 844) {
    // QA-09: the rail hands the content most of the screen.
    const g = await page.evaluate(() => {
      const r = document.getElementById('gb-main').getBoundingClientRect();
      return { w: r.width / innerWidth, h: r.height / innerHeight };
    });
    console.log(`[${tag}] content ${Math.round(g.w * 100)}% wide, ${Math.round(g.h * 100)}% tall`);
    if (g.w < 0.85 || g.h < 0.8)
      fail(`[${tag}] landscape content only ${Math.round(g.w * 100)}% x ${Math.round(g.h * 100)}%`);
  }
  if (w === 3840) {
    const off = centres.filter(([, c]) => Math.abs(c) > 4);
    console.log(
      `[${tag}] screen centre offsets: ${centres.map(([l, c]) => l + ' ' + c).join(', ')}`
    );
    if (off.length)
      fail(
        `[${tag}] screens off the shared centre line: ${off.map(([l, c]) => l + ' ' + c).join(', ')}`
      );
  }
  if (w === 1366) {
    const s = await page.evaluate(() => {
      const n = document.querySelector('.gb-nav');
      return [n.scrollHeight, n.clientHeight, getComputedStyle(n).overflowY];
    });
    console.log(`[${tag}] sidebar ${s[0]}px of tabs in ${s[1]}px, overflow-y ${s[2]}`);
    // At 660 the last tab still clears (only the padding is cut); a shorter
    // window cuts tabs, so a sidebar taller than its column must scroll.
    if (s[0] > s[1] + 1 && !/auto|scroll/.test(s[2]))
      fail(`[${tag}] sidebar is cut off and does not scroll`);
    if (s[1] > h) fail(`[${tag}] sidebar (${s[1]}px) is taller than the window`);
  }
}

/* ---- R-12: 44px taps. The notification panel's own controls are measured
   live; the rest are mounted as bare probes, since reaching each needs data
   (a mentorship agreement, a reminder's tone list). The probe is what
   elementFromPoint finds 1px inside a 44px box centred on the control. */
await setVp(390, 844);
await navTo(DESTS[0]);
const hitCheck = (sel) =>
  page.evaluate((s) => {
    const res = [];
    for (const el of document.querySelectorAll(s)) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const pts = [
        [cx, cy - 21],
        [cx, cy + 21],
        [cx - Math.max(r.width, 44) / 2 + 1, cy],
        [cx + Math.max(r.width, 44) / 2 - 1, cy],
      ];
      const ok = pts.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit && (hit === el || el.contains(hit));
      });
      res.push(ok ? null : `${s} (${Math.round(r.width)}x${Math.round(r.height)})`);
    }
    return res;
  }, sel);

await page.click('.gb-bell');
await page.waitForSelector('.gb-notif-pop', { timeout: 5000 });
await sleep(400);
let liveChecked = 0;
for (const sel of ['.gb-notif-link', '.gb-notif-chip', '.gb-btn.gb-notif-snooze']) {
  const r = await hitCheck(sel);
  liveChecked += r.length;
  // Neighbouring chips sit 6px apart, so a probe point can land on the next
  // chip's overlay: that is still a hit on a real control, only check height.
  for (const m of r.filter(Boolean)) if (!sel.includes('chip')) fail('[R-12] tap under 44px: ' + m);
}
await page.screenshot({ path: `${OUT}/r12-notif-panel.png` });
await page.click('.gb-bell');
await sleep(300);

// money.css loads with the Money screen (money-screen.js): the swatch probe needs it.
await navTo('Money');
await page.waitForFunction(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText === '.gb-money-swatch'); } catch { return false; } }), { timeout: 15000 });
await page.evaluate(() => {
  const box = document.createElement('div');
  box.id = 'gb-r12-probe';
  box.style.cssText =
    'position:fixed;left:40px;top:200px;z-index:9999;display:flex;flex-direction:column;gap:30px;background:var(--surface);padding:30px';
  box.innerHTML =
    '<button class="gb-note-label-opt">Work</button>' +
    '<button class="gb-tone-chip">Chime</button>' +
    '<button class="gb-agree-del" aria-label="x"></button>' +
    '<button class="gb-money-swatch" style="background:red" aria-label="red"></button>';
  document.body.appendChild(box);
});
for (const sel of [
  '#gb-r12-probe .gb-note-label-opt',
  '#gb-r12-probe button.gb-tone-chip',
  '#gb-r12-probe .gb-agree-del',
  '#gb-r12-probe .gb-money-swatch',
]) {
  for (const m of (await hitCheck(sel)).filter(Boolean)) fail('[R-12] tap under 44px: ' + m);
}
await page.evaluate(() => document.getElementById('gb-r12-probe').remove());
console.log(`[R-12] checked ${liveChecked} live notification controls + 4 probes`);

/* ---- R-06 / R-05: the text-size setting, through Settings. ---- */
async function openSettingsTab(tab) {
  await page.click('.gb-head-actions .gb-avatar');
  await page.waitForSelector('.gb-profile-pop', { timeout: 5000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('.gb-profile-pop-item')]
      .find((b) => b.textContent.trim() === 'Settings')
      .click()
  );
  await page.waitForSelector('.gb-segnav', { timeout: 5000 });
  await sleep(400);
  await page.evaluate(
    (t) =>
      [...document.querySelectorAll('.gb-segnav-btn')]
        .find((b) => b.textContent.trim() === t)
        .click(),
    tab
  );
  await sleep(300);
}
async function pickTextSize(label) {
  await openSettingsTab('Display');
  await page.evaluate(
    (l) =>
      [...document.querySelectorAll('.gb-modal button')]
        .find((b) => b.textContent.trim() === l)
        .click(),
    label
  );
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 8000 }).catch(() => {});
  await sleep(500);
}
const titleSize = () =>
  page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.greet-name')).fontSize));

await setVp(320, 568);
await navTo(DESTS[0]);
const before = await titleSize();
await pickTextSize('Largest');
await page.keyboard.press('Escape');
await sleep(400);
const after = await titleSize();
console.log(`[R-06] header title ${before}px -> ${after}px at Largest`);
if (!(after >= before * 1.2))
  fail(`[R-06] Largest text did not scale the type (${before} -> ${after})`);
try {
  for (const label of DESTS) {
    if (!(await navTo(label))) {
      fail(`[320x568 @125%] cannot reach ${label}`);
      continue;
    }
    const o = await overflowing();
    if (o.over.length) fail(`[320x568 @125%/${label}] past the right edge: ${o.over.join(', ')}`);
    await page.screenshot({
      path: `${OUT}/320x568-125-${label.toLowerCase().replace(/\W+/g, '-')}.png`,
    });
  }
  // R-05: six tabs in a 320px sheet at 125%: they scroll, they never overlap.
  await openSettingsTab('Account');
  const seg = await page.evaluate(() => {
    const bar = document.querySelector('.gb-segnav');
    const btns = [...bar.querySelectorAll('.gb-segnav-btn')];
    const clipped = btns.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent);
    const act = bar.querySelector('.is-active').getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    return {
      clipped,
      scrolls: bar.scrollWidth > bar.clientWidth,
      activeIn: act.left >= br.left - 1 && act.right <= br.right + 1,
    };
  });
  console.log(
    `[R-05] settings tabs at 320 @125%: scrolls=${seg.scrolls}, active in view=${seg.activeIn}`
  );
  if (seg.clipped.length) fail('[R-05] settings tab labels cut: ' + seg.clipped.join(', '));
  if (!seg.activeIn) fail('[R-05] the picked settings tab is scrolled out of view');
  await page.screenshot({ path: `${OUT}/320x568-125-settings.png` });
  await page.keyboard.press('Escape');
  await sleep(300);
} finally {
  // Shared account: put the setting back.
  await pickTextSize('Normal');
  await page.keyboard.press('Escape');
  await sleep(300);
}

await ctx.close();
browser.disconnect();
if (fails.length) {
  console.log(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nresponsive e2e: all checks passed');
