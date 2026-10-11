/* Command palette + keyboard shortcuts, end to end, at 390 and 1280 wide.
   Ctrl+K -> search a seeded task -> Edit task; an action (theme there and back);
   a free sentence -> Quick add's preview (cancelled: nothing written); "/", "?"
   and "g h". Fails on any assertion, console error or HTTP 4xx/5xx.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)  GB_E2E_SHOTS (dir, optional)

   Restores the account's ui_prefs at the end (the theme toggle and the recent
   picks both write there). Attaches to a running Chrome; opens and closes its own tab. */
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

const browser = await puppeteer.connect({ browserURL: CDP });
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

const authed = (path, opts = {}) =>
  page.evaluate(
    async (path, opts) => {
      const token = window.CacheStorage.getItem('gb.token');
      const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      });
      return res.ok ? res.json().catch(() => null) : null;
    },
    path,
    opts
  );
const paletteOpen = () => page.$('.gb-modal-overlay:not(.is-closing) .gb-palette');
const dialogs = () => page.$$eval('[aria-modal="true"]', (els) => els.length);
async function closeAll() {
  for (let i = 0; i < 4 && (await dialogs()); i++) {
    await page.keyboard.press('Escape');
    await wait(300);
  }
  // The single-key shortcuts don't fire while a field has focus.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}
const shot = async (name, width) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });

let prefsBefore = null;
try {
  for (const width of [390, 1280]) {
    await page.setViewport(
      width === 390
        ? { width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { width, height: 800, deviceScaleFactor: 1 }
    );
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    if (await page.$('input[type=password]')) {
      await page.type('input[type=email]', EMAIL);
      await page.type('input[type=password]', PASSWORD);
      await page.evaluate(() =>
        [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
      );
      await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
    }
    await page.waitForSelector('.gb-head-search', { timeout: 20000 });
    await wait(1200);
    if (!prefsBefore) prefsBefore = ((await authed('/api/auth/me')) || {}).uiPrefs || {};
    const tasks = (await authed('/api/tasks')) || [];
    const task = tasks.find((t) => t.title && t.title.length > 3);
    check(!!task, `[${width}] the account has a task to search for`);

    const btn = await page.$eval('.gb-head-search', (b) => {
      const r = b.getBoundingClientRect();
      const before = getComputedStyle(b, '::before');
      return { label: b.getAttribute('aria-label'), title: b.title, w: r.width, hit: before.width };
    });
    check(btn.label === 'Search and commands', `[${width}] header button is labelled`);
    check(/(Ctrl|Cmd) K/.test(btn.title), `[${width}] tooltip carries the shortcut: ${btn.title}`);

    // Ctrl+K, then a task by its title -> Edit task.
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('.gb-palette-input', { timeout: 8000 });
    await wait(300);
    check(
      await page.evaluate(() => document.activeElement === document.querySelector('.gb-palette-input')),
      `[${width}] Ctrl+K opens the palette with the input focused`
    );
    const empty = await page.$$eval('.gb-palette-group-label', (els) => els.map((e) => e.textContent));
    check(empty.includes('Actions'), `[${width}] empty query shows actions (${empty.join(', ')})`);
    await shot('empty', width);
    if (task) {
      await page.type('.gb-palette-input', task.title);
      await wait(250);
      const aria = await page.evaluate(() => {
        const i = document.querySelector('.gb-palette-input');
        const act = document.getElementById(i.getAttribute('aria-activedescendant'));
        return {
          role: i.getAttribute('role'),
          activeSelected: act && act.getAttribute('aria-selected'),
          options: [...document.querySelectorAll('.gb-palette-opt')].map((o) => o.textContent),
        };
      });
      check(aria.role === 'combobox' && aria.activeSelected === 'true', `[${width}] combobox with an active option`);
      const idx = aria.options.findIndex((t) => t.startsWith(task.title));
      check(idx >= 0, `[${width}] task "${task.title}" is in the results`);
      await shot('search', width);
      // Down to it, Enter.
      for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await wait(600);
      const modal = await page.evaluate(() => ({
        title: document.querySelector('.gb-modal-title')?.textContent,
        value: document.querySelector('.gb-modal input[type=text]')?.value,
      }));
      check(modal.title === 'Edit task' && modal.value === task.title, `[${width}] Enter opened Edit task on it`);
      await shot('edit-task', width);
      await closeAll();
    }

    // An action: the theme, there and back.
    const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    for (let round = 0; round < 2; round++) {
      await page.click('.gb-head-search');
      await page.waitForSelector('.gb-palette-input');
      await page.type('.gb-palette-input', 'switch to');
      await wait(200);
      await page.keyboard.press('Enter');
      await wait(500);
      if (round === 0) {
        const mid = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        check(mid !== theme0, `[${width}] the theme action switched it (${theme0} -> ${mid})`);
        await shot('after-theme', width);
      }
    }
    const theme2 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    check(theme0 === theme2, `[${width}] theme toggled and back (${theme0} -> ${theme2})`);

    // A free sentence -> Quick add's preview; Escape cancels it, nothing written.
    const before = JSON.stringify(await authed('/api/water'));
    await page.click('.gb-head-search');
    await page.waitForSelector('.gb-palette-input');
    await page.type('.gb-palette-input', 'drank 300 ml water');
    await wait(200);
    const last = await page.$$eval('.gb-palette-opt', (o) => o[o.length - 1].textContent);
    check(last === 'Add with Quick add: drank 300 ml water', `[${width}] last row hands it to Quick add`);
    await page.$$eval('.gb-palette-opt', (o) => o[o.length - 1].click());
    await page.waitForFunction(
      () => [...document.querySelectorAll('.gb-modal-title')].some((t) => t.textContent === 'Log these?'),
      { timeout: 20000 }
    );
    await wait(400);
    check(!(await paletteOpen()), `[${width}] Quick add preview replaced the palette`);
    await shot('quickadd-preview', width);
    await closeAll();
    await wait(400);
    const after = JSON.stringify(await authed('/api/water'));
    check(before === after, `[${width}] cancelling the preview wrote nothing`);

    // "/" opens it, "?" opens the help sheet, "g h" goes home.
    await page.keyboard.press('/');
    await wait(400);
    check(!!(await paletteOpen()), `[${width}] "/" opens the palette`);
    await closeAll();
    await page.keyboard.press('?');
    await wait(400);
    const help = await page.$$eval('.gb-shortcut-row', (r) => r.length);
    check(help >= 9, `[${width}] "?" lists the shortcuts (${help} rows)`);
    await shot('help', width);
    await closeAll();
    await page.evaluate(() => (location.hash = '#/habits'));
    await wait(800);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await wait(600);
    check((await page.evaluate(() => location.hash)) === '#/home', `[${width}] "g h" goes Home`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!overflow, `[${width}] no horizontal overflow`);
  }
} catch (err) {
  if (SHOTS) await page.screenshot({ path: SHOTS + '/failure.png' }).catch(() => {});
  problems.push('threw: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
} finally {
  if (prefsBefore) await authed('/api/auth/ui-prefs', { method: 'PUT', body: JSON.stringify({ prefs: prefsBefore }) });
  await page.close();
  browser.disconnect();
}

if (problems.length) {
  console.error('\npalette e2e: ' + problems.length + ' problem(s)\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\npalette e2e: all passed');
