/* UI lows (audit UI-14..23), end to end at 390 and 1280 wide:
   - a toast raised under the celebration is on top of its scrim, and its
     button is the element under the pointer (z-index scale, UI-17);
   - the WhatsApp switch (Settings > Profile) and the water switch
     (Settings > Alerts) render the one .gb-switch (UI-15);
   - a disabled premium primary has no glow and no press offset (UI-16);
   - the avatar menu's Sign out is --danger (UI-14).
   Fails on any assertion, console error or HTTP 4xx/5xx. Writes nothing to the server.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)  GB_E2E_SHOTS (dir, optional) */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const problems = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) problems.push(what);
}

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so a tab sharing localhost with other
// runs would share (and could clobber) their gb.token / gb.session.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on(
  'console',
  (m) => m.type() === 'error' && problems.push('console: ' + m.text().slice(0, 200))
);
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  // A 429 on sign-in is the shared rate limit, retried below, not a fault.
  if (r.status() === 429 && r.url().includes('/api/auth/login')) return;
  if (r.status() >= 400)
    problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

// The QA account isn't WhatsApp-verified, so the Profile pane would build no
// switch. This context's signed-in session (the app's CacheStorage shim,
// gb.session) is marked verified; the context is thrown away at the end.
let patched = false;
const patchSession = () =>
  page.evaluate(() => {
    const u = JSON.parse(window.CacheStorage.getItem('gb.session') || '{}');
    window.CacheStorage.setItem(
      'gb.session',
      JSON.stringify({
        ...u,
        whatsappVerified: true,
        whatsappNumber: u.whatsappNumber || '+15550100',
      })
    );
  });

const shot = async (name, width) =>
  SHOTS && page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });
const closeDialogs = async () => {
  for (let i = 0; i < 4 && (await page.$('[aria-modal="true"]')); i++) {
    await page.keyboard.press('Escape');
    await wait(400);
  }
};
const switchLook = (sel) =>
  page.$eval(sel, (el) => {
    const cs = getComputedStyle(el);
    const knob = el.querySelector('.gb-switch-knob');
    return {
      cls: el.className,
      w: cs.width,
      h: cs.height,
      radius: cs.borderTopLeftRadius,
      dur: cs.transitionDuration,
      knob: !!knob,
      knobW: knob && getComputedStyle(knob).width,
    };
  });

try {
  for (const width of [390, 1280]) {
    await page.setViewport(
      width === 390
        ? { width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { width, height: 800, deviceScaleFactor: 1 }
    );
    await page.bringToFront();
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    // The local auth rate limit is cleared every 20 s: one retry after a 429.
    for (let attempt = 0; attempt < 2 && (await page.$('input[type=password]')); attempt++) {
      if (attempt) await wait(21000);
      await page.$eval('input[type=email]', (el) => (el.value = ''));
      await page.$eval('input[type=password]', (el) => (el.value = ''));
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
      if (res.status() === 429) {
        continue;
      }
      await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
        timeout: 20000,
      });
    }
    await page.waitForSelector('.gb-head-actions', { timeout: 20000 });
    if (!patched) {
      patched = true;
      await patchSession();
      await wait(500); // the Cache API write is async
      await page.reload({ waitUntil: 'networkidle2' });
      await page.waitForSelector('.gb-head-actions', { timeout: 20000 });
    }
    await wait(1200);

    // ---- UI-17: toast over the celebration ----
    await page.evaluate(async () => {
      const { celebrate } = await import('/scripts/celebrate.js');
      const { toast } = await import('/scripts/toast.js');
      celebrate({ title: 'Layer check', desc: 'Toast stacking', icon: 'award' });
      toast.action('Layer check toast', 'Undo', () => {});
    });
    await page.waitForSelector('.gb-celebrate', { timeout: 5000 });
    await page.waitForSelector('.gb-toast-action', { timeout: 5000 });
    await wait(600);
    const hit = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.gb-toast-action')].find((b) =>
        /undo/i.test(b.textContent)
      );
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        onTop: !!top && btn.contains(top),
        toastZ: getComputedStyle(document.querySelector('.gb-toast-stack')).zIndex,
        celeZ: getComputedStyle(document.querySelector('.gb-celebrate')).zIndex,
      };
    });
    check(
      hit.onTop,
      `${width}: toast Undo is clickable above the celebration (toast z ${hit.toastZ}, celebrate z ${hit.celeZ})`
    );
    await shot('toast-over-celebrate', width);
    await page.evaluate(() => document.querySelector('.gb-celebrate')?.click());
    await page.evaluate(() => document.querySelector('.gb-toast-close')?.click());
    await wait(500);

    // ---- UI-14: Sign out colour ----
    await page.evaluate(() => document.querySelector('.gb-head-actions .gb-avatar').click());
    await page.waitForSelector('.gb-profile-pop-item.is-danger', { timeout: 5000 });
    const signOut = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--danger)';
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return {
        got: getComputedStyle(document.querySelector('.gb-profile-pop-item.is-danger')).color,
        want,
      };
    });
    check(signOut.got === signOut.want, `${width}: Sign out is --danger (${signOut.got})`);
    await shot('profile-menu', width);

    // ---- UI-15: both switches are .gb-switch ----
    await page.evaluate(() =>
      [...document.querySelectorAll('.gb-profile-pop-item')]
        .find((b) => /settings/i.test(b.textContent))
        ?.click()
    );
    await page.waitForSelector('.gb-segnav-btn', { timeout: 8000 });
    await wait(700);
    const waSel = '.gb-switch[aria-label="Enable WhatsApp reminders"]';
    const wa = (await page.$(waSel)) ? await switchLook(waSel) : null;
    check(
      !!wa && /\bgb-switch\b/.test(wa.cls) && /\bis-wa\b/.test(wa.cls) && wa.knob,
      `${width}: WhatsApp switch is .gb-switch.is-wa with the shared knob`
    );
    if (wa) {
      await page.$eval(waSel, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await wait(700);
      await shot('settings-profile-wa-switch', width);
    }
    await page.evaluate(() =>
      [...document.querySelectorAll('.gb-segnav-btn')]
        .find((b) => /alerts/i.test(b.textContent))
        ?.click()
    );
    await wait(600);
    const waterSel = '.gb-switch[aria-label="Remind me to drink water"]';
    const water = (await page.$(waterSel)) ? await switchLook(waterSel) : null;
    check(!!water, `${width}: water switch found`);
    if (wa && water) {
      const same = ['w', 'h', 'radius', 'dur', 'knobW'].every((k) => wa[k] === water[k]);
      check(
        same,
        `${width}: WhatsApp and water switches match (${JSON.stringify(wa)} vs ${JSON.stringify(water)})`
      );
    }
    await shot('settings-alerts', width);
    await closeDialogs();
    await wait(800);

    // ---- UI-16: premium disabled primary ----
    const prem = await page.evaluate(() => {
      const root = document.documentElement;
      const before = root.getAttribute('data-premium');
      root.setAttribute('data-premium', 'on');
      const b = document.createElement('button');
      b.className = 'gb-btn gb-btn--primary';
      b.textContent = 'Probe';
      b.disabled = true;
      document.body.appendChild(b);
      const off = getComputedStyle(b);
      const out = { shadow: off.boxShadow, transform: off.transform };
      b.disabled = false;
      out.enabledShadow = getComputedStyle(b).boxShadow;
      b.remove();
      if (before === null) root.removeAttribute('data-premium');
      else root.setAttribute('data-premium', before);
      return out;
    });
    check(prem.enabledShadow !== 'none', `${width}: premium primary glows when enabled`);
    check(
      prem.shadow === 'none' && (prem.transform === 'none' || prem.transform === ''),
      `${width}: premium disabled primary has no glow (${prem.shadow}, ${prem.transform})`
    );
  }
} finally {
  await ctx.close();
  browser.disconnect();
}

for (const p of problems.filter((p) => !/^(ok|FAIL) /.test(p))) console.log('PROBLEM ' + p);
if (problems.length) {
  console.log(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\nall good');
