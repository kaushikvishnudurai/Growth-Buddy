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

await browser.disconnect();

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ui-audit: ${SCREENS.length} screens x 2 viewports clean → ${OUT}`);
