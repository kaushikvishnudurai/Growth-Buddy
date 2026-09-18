/* =====================================================================
   Growth Buddy — UI audit

   Walks every screen at a phone and a desktop viewport, writes a
   screenshot of each, and fails on the two faults that are invisible in
   code review but obvious to a user: content spilling past the viewport,
   and errors on the console.

   Needs the app running (npm run dev) and a Chrome you already have:

     node scripts/ui-audit.mjs <email> <password> [outDir]

   puppeteer.launch() has been unreliable here — it exits with an empty
   stderr while the same binary runs fine by hand — so this attaches to a
   Chrome you start yourself:

     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
       --headless=new --disable-gpu --remote-debugging-port=9222 \
       --user-data-dir=/tmp/gb-audit about:blank &
   ===================================================================== */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_AUDIT_BASE || 'http://localhost:5173';
const DEVTOOLS = process.env.GB_AUDIT_CDP || 'http://127.0.0.1:9222';
const [EMAIL, PASSWORD, OUT_ARG] = process.argv.slice(2);
const OUT = OUT_ARG || 'assets/ui-audit';

const SCREENS = (process.env.GB_AUDIT_SCREENS ||
  'home,habits,food,goals,calendar,mentor,circle,family,money,report,focus').split(',');

const VIEWPORTS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

if (!EMAIL || !PASSWORD) {
  console.error('usage: node scripts/ui-audit.mjs <email> <password> [outDir]');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.connect({ browserURL: DEVTOOLS });
const problems = [];

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console: ${m.text().slice(0, 180)}`);
  });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${String(e).slice(0, 180)}`));

  await page.goto(BASE, { waitUntil: 'networkidle2' });

  // Sign in through the form. A token cookie alone is not enough — state.user is
  // read at module init, so the app stays on the auth screen without a session.
  // The second viewport reuses the same browser and is already signed in.
  const needsLogin = await page.$('input[type=email]');
  if (needsLogin) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find((b) => /sign in/i.test(b.textContent || ''))
        ?.click();
    });
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
      timeout: 20000,
    });
    await new Promise((r) => setTimeout(r, 1500));
  }

  for (const screen of SCREENS) {
    await page.goto(`${BASE}/#${screen}`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));

    const audit = await page.evaluate((vw) => {
      const over = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > vw + 1 || r.left < -1) {
          const cls = (el.className || '').toString().split(' ')[0];
          over.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`);
        }
      }
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        overflow: [...new Set(over)].slice(0, 6),
      };
    }, vp.width);

    if (audit.scrollW > audit.clientW + 1) {
      problems.push(
        `[${name}/${screen}] horizontal overflow: ${audit.scrollW} > ${audit.clientW}` +
          (audit.overflow.length ? ` — ${audit.overflow.join(', ')}` : '')
      );
    }
    await page.screenshot({ path: `${OUT}/${screen}-${name}.png` });
  }
  await page.close();
}

/* =====================================================================
   Phase 2: the dialogs.

   The screen walk above never opens one, and dialogs are where the app's
   overlay contract lives. Every one of them shares a single shell now
   (`openOverlay` in gb-kit.js), so this opens one per module and checks
   what that shell promises: it animates in, it carries a shadow, it can
   scroll, focus lands inside it, and Escape closes it. A dialog that
   snapped open with no shadow is exactly what shipped for months.

   Then the two header panels, whose offsets are derived from the header
   rather than guessed — their right edge must sit on the action row that
   owns the bell and the avatar, at every width.
   ===================================================================== */

const dlg = await browser.newPage();
dlg.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[dialogs] console: ${m.text().slice(0, 180)}`);
});
dlg.on('pageerror', (e) => problems.push(`[dialogs] pageerror: ${String(e).slice(0, 180)}`));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

await dlg.setViewport(VIEWPORTS.mobile);
await dlg.goto(BASE, { waitUntil: 'networkidle2' });
if (await dlg.$('input[type=email]')) {
  await dlg.type('input[type=email]', EMAIL);
  await dlg.type('input[type=password]', PASSWORD);
  await dlg.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find((b) => /sign in/i.test(b.textContent || ''))
      ?.click()
  );
  await dlg.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
  await pause(1500);
}

/** Click the first visible control whose label matches. */
const clickText = (re) =>
  dlg.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button, [role=button]')].find(
      (b) => rx.test((b.textContent || b.getAttribute('aria-label') || '').trim()) && b.offsetParent
    );
    if (!el) return false;
    el.click();
    return true;
  }, re.source);

async function checkDialog(label, screen, open) {
  if (screen) {
    await dlg.goto(`${BASE}/#${screen}`, { waitUntil: 'networkidle2' });
    await pause(900);
  }
  if (!(await open())) {
    problems.push(`[dialogs] ${label}: no way to open it — the audit can't see this one any more`);
    return;
  }
  await pause(650);

  const st = await dlg.evaluate(() => {
    const overlay = document.querySelector('.gb-modal-overlay');
    if (!overlay) return null;
    const sheet = overlay.querySelector('.gb-modal') || overlay;
    const cs = getComputedStyle(sheet);
    const r = sheet.getBoundingClientRect();
    return {
      open: overlay.classList.contains('is-open'),
      modal: sheet.getAttribute('aria-modal'),
      duration: cs.transitionDuration,
      shadow: cs.boxShadow,
      overflowY: cs.overflowY,
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      vw: window.innerWidth,
      vh: window.innerHeight,
      focusInside: sheet.contains(document.activeElement),
    };
  });

  if (!st) {
    problems.push(`[dialogs] ${label}: nothing opened`);
    return;
  }
  if (!st.open) problems.push(`[dialogs] ${label}: overlay never got .is-open`);
  if (st.modal !== 'true') problems.push(`[dialogs] ${label}: aria-modal=${st.modal} — outside a11y.js`);
  if (st.duration === '0s') problems.push(`[dialogs] ${label}: no transition, it snaps open`);
  if (st.shadow === 'none') problems.push(`[dialogs] ${label}: no shadow, it doesn't lift off the page`);
  if (st.overflowY !== 'auto') problems.push(`[dialogs] ${label}: overflow-y is ${st.overflowY} — content can clip`);
  if (!st.focusInside) problems.push(`[dialogs] ${label}: focus never entered it`);
  if (st.right > st.vw + 1) problems.push(`[dialogs] ${label}: spills past the right edge`);
  if (st.bottom > st.vh + 1) problems.push(`[dialogs] ${label}: taller than the viewport`);

  await dlg.keyboard.press('Escape');
  await pause(450);
  if (await dlg.$('.gb-modal-overlay')) {
    problems.push(`[dialogs] ${label}: Escape did not close it`);
    await dlg.evaluate(() => document.querySelector('.gb-modal-overlay')?.remove());
  }
}

// One per module that builds dialogs. A seeded account is needed for the ones
// that hang off a row (a note, a reminder) — see the audit recipe.
await checkDialog('quick add', 'home', () => clickText(/^quick add$/i));
await checkDialog('add food', 'food', () => clickText(/log food|add food/i));
await checkDialog('custom water', 'food', () => clickText(/^custom/i));
await checkDialog('new goal', 'goals', () => clickText(/new goal|add goal/i));
await checkDialog('add expense', 'money', () => clickText(/add expense/i));
await checkDialog('custom focus minutes', 'focus', () => clickText(/^custom/i));
await checkDialog('find someone', 'circle', () => clickText(/find someone|find people/i));
await checkDialog('note sheet', 'notes', () =>
  dlg.evaluate(() => {
    const card = [...document.querySelectorAll('[aria-label]')].find(
      (el) => el.offsetParent && /note/i.test(el.getAttribute('aria-label') || '') && el.closest('[class*=note]')
    );
    if (!card) return false;
    card.click();
    return true;
  })
);
await checkDialog('delete recurring reminder', 'calendar', () =>
  dlg.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role=button]')].find(
      (b) => /delete|remove/i.test(b.getAttribute('aria-label') || '') && b.offsetParent
    );
    if (!el) return false;
    el.click();
    return true;
  })
);

for (const panel of [
  { name: 'notification panel', trigger: '.gb-bell', pop: '.gb-notif-pop' },
  { name: 'profile panel', trigger: '.gb-avatar', pop: '.gb-profile-pop' },
]) {
  for (const width of [360, 1440]) {
    await dlg.setViewport({ ...VIEWPORTS.mobile, width, isMobile: width < 1024 });
    await dlg.goto(`${BASE}/#home`, { waitUntil: 'networkidle2' });
    await pause(900);
    const opened = await dlg.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) return false;
      b.click();
      return true;
    }, panel.trigger);
    if (!opened) {
      problems.push(`[dialogs] ${panel.name} @ ${width}px: no trigger`);
      continue;
    }
    await pause(500);
    const geo = await dlg.evaluate((sel) => {
      const pop = document.querySelector(sel);
      const row = document.querySelector('.gb-head-actions');
      const head = document.querySelector('.gb-head');
      if (!pop || !row || !head) return null;
      const p = pop.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const h = head.getBoundingClientRect();
      return {
        rightGap: Math.round(p.right - r.right),
        belowHeader: p.top >= h.bottom - 1,
        onScreen: p.left >= -1 && p.right <= window.innerWidth + 1,
      };
    }, panel.pop);
    if (!geo) {
      problems.push(`[dialogs] ${panel.name} @ ${width}px: did not open`);
      continue;
    }
    if (Math.abs(geo.rightGap) > 1)
      problems.push(`[dialogs] ${panel.name} @ ${width}px: right edge off the bell by ${geo.rightGap}px`);
    if (!geo.belowHeader) problems.push(`[dialogs] ${panel.name} @ ${width}px: overlaps the header`);
    if (!geo.onScreen) problems.push(`[dialogs] ${panel.name} @ ${width}px: spills off screen`);
    await dlg.evaluate(() => document.body.click());
    await pause(250);
  }
}
await dlg.close();

await browser.disconnect();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `ui-audit: ${SCREENS.length} screens x 2 viewports + 9 dialogs + 2 header panels clean → ${OUT}`
);
