/* Imports, end to end, at 390 and 1280 wide.

   Money: paste a 3-row CSV (one row a duplicate of an expense already there),
   check the preview's counts, import, see the 2 new expenses in the list and
   the POST /api/money/tx succeed. Calendar: upload a 2-event .ics through the
   file input, add both, see them on the day. Everything it made is deleted
   again (the account is shared). Fails on any assertion, console error or
   HTTP 4xx/5xx.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)  GB_E2E_SHOTS (dir, optional)

   Attaches to a running Chrome; works in its own browser context and closes it. */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const problems = [];
let step = 'start';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) problems.push(what);
}

// The shared Chrome is busy; an isolated context keeps this run's cookies (gb.token /
// gb.session are per host, not per port) away from every other tab on localhost.
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
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
      if (!res.ok) return { failed: res.status };
      return res.status === 204 ? {} : res.json().catch(() => ({}));
    },
    path,
    opts
  );
// After the sheet's open transition, so the shot shows it, not half of it.
const shot = async (name, width) => SHOTS && (await wait(350), page.screenshot({ path: `${SHOTS}/${name}-${width}.png` }));
const clickText = (sel, re) =>
  page.evaluate(
    (sel, src) => {
      const b = [...document.querySelectorAll(sel)].find((x) => new RegExp(src).test(x.textContent || ''));
      if (b) b.click();
      return !!b;
    },
    sel,
    re.source
  );
const sheetText = () => page.$eval('.gb-import-modal', (el) => el.textContent).catch(() => '');
const sheetGone = () => page.waitForFunction(() => !document.querySelector('.gb-modal-overlay:not(.is-closing) .gb-import-modal'), { timeout: 30000 });

const tmp = mkdtempSync(join(tmpdir(), 'gb-import-e2e-'));
const made = { tx: [], reminders: [] };

try {
  for (const width of [390, 1280]) {
    await page.setViewport(
      width === 390
        ? { width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { width, height: 800, deviceScaleFactor: 1 }
    );
    step = 'open home @' + width;
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    if (await page.$('input[type=password]')) {
      await page.type('input[type=email]', EMAIL);
      await page.type('input[type=password]', PASSWORD);
      await page.evaluate(() =>
        [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
      );
      // The local auth rate limit is cleared every 20s: a 429 waits once and retries.
      const signedIn = await page
        .waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 })
        .then(() => true, () => false);
      if (!signedIn) {
        await wait(21000);
        await page.evaluate(() =>
          [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
        );
        await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
      }
    }
    await wait(1200);

    const run = 'E2E import ' + width + ' ' + Date.now().toString(36);
    const { tomorrow, dmy } = await page.evaluate(() => {
      const k = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const t = new Date();
      const n = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      return { today: k(t), tomorrow: k(n), dmy: k(t).split('-').reverse().join('/') };
    });

    /* ---- Money: CSV by paste ---- */
    step = 'Money: CSV by paste @' + width;
    // The duplicate is a row repeated in the file: one already in Money would need
    // a reload to be seen, and a reload tears down the app's sockets mid-handshake
    // (console errors that are not the import's). csv-import.test.mjs covers that kind.
    await page.goto(BASE + '/#/money', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.gb-money-tab', { timeout: 20000 });
    await clickText('.gb-money-tab', /Spending/);
    await page.waitForSelector('.gb-money-import', { timeout: 10000 });
    await page.click('.gb-money-import');
    await page.waitForSelector('#gb-import-paste', { timeout: 10000 });
    await shot('csv-source', width);
    const csv = ['Date,Description,Amount', `${dmy},${run} chai,"₹20.00"`, `${dmy},"${run} bus, office",45`, `${dmy},${run} chai,20`].join('\n');
    await page.$eval('#gb-import-paste', (el, v) => (el.value = v), csv);
    await clickText('.gb-import-primary', /Preview/);
    await page.waitForSelector('.gb-import-cols', { timeout: 10000 });
    const summary = await page.$eval('.gb-import-summary', (el) => el.textContent);
    check(/3 rows found\. 2 transactions to import, 1 duplicate left out\./.test(summary), `[${width}] preview counts: ${summary}`);
    const primary = await page.$eval('.gb-import-primary', (el) => el.textContent);
    check(primary === 'Import 2 transactions', `[${width}] primary says ${primary}`);
    check(!/\bnull\b|undefined|NaN/.test(await sheetText()), `[${width}] no "null", "undefined" or "NaN" in the preview`);
    const dupTicked = await page.$$eval('.gb-import-row input', (els) => els.map((e) => e.checked));
    check(JSON.stringify(dupTicked) === '[true,true,false]', `[${width}] the duplicate is unticked (${dupTicked})`);
    await shot('csv-preview', width);
    const txPost = page.waitForResponse((r) => r.url().includes('/api/money/tx') && r.request().method() === 'POST', { timeout: 20000 });
    await page.click('.gb-import-primary');
    const res = await txPost;
    const body = await res.json().catch(() => ({}));
    check(res.ok() && !(body.rejected || []).length, `[${width}] POST /api/money/tx ${res.status()}, nothing rejected`);
    await sheetGone();
    await wait(600);
    const listText = await page.$eval('.gb-money-exp-list', (el) => el.textContent).catch(() => '');
    check(listText.includes(run + ' chai') && listText.includes(run + ' bus, office'), `[${width}] both imported expenses are in the list`);
    await shot('csv-done', width);
    const server = await authed('/api/money');
    const mine = (server.expenses || []).filter((e) => String(e.note || '').startsWith(run));
    check(mine.length === 2, `[${width}] the server has the 2 imported, not the duplicate (${mine.length})`);
    const amounts = mine.map((e) => Number(e.amount)).sort((a, b) => a - b);
    check(JSON.stringify(amounts) === '[20,45]', `[${width}] amounts read right (${amounts})`);
    for (const e of mine) if (!made.tx.includes(e.id)) made.tx.push(e.id);

    /* ---- Calendar: .ics by file input ---- */
    step = 'Calendar: .ics by file input @' + width;
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//E2E//EN',
      'BEGIN:VEVENT',
      'UID:one-' + run.replace(/\W/g, '') + '@e2e',
      'SUMMARY:' + run + ' dentist',
      'DTSTART:' + tomorrow.replace(/-/g, '') + 'T090000',
      'DTEND:' + tomorrow.replace(/-/g, '') + 'T093000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:two-' + run.replace(/\W/g, '') + '@e2e',
      'SUMMARY:' + run + ' yoga',
      'DTSTART:' + tomorrow.replace(/-/g, '') + 'T180000',
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const file = join(tmp, 'calendar-' + width + '.ics');
    writeFileSync(file, ics);
    await page.goto(BASE + '/#/calendar', { waitUntil: 'networkidle2' });
    await page.waitForSelector('.gb-cal-import', { timeout: 20000 });
    await page.click('.gb-cal-import');
    const input = await page.waitForSelector('.gb-import-modal input[type=file]', { timeout: 10000 });
    await shot('ics-source', width);
    await input.uploadFile(file);
    await page.waitForFunction(() => /reminders? to add/.test(document.querySelector('.gb-import-summary')?.textContent || ''), { timeout: 10000 });
    const icsSummary = await page.$eval('.gb-import-summary', (el) => el.textContent);
    check(/^2 events in the file\. 2 reminders to add\.$/.test(icsSummary), `[${width}] ics preview: ${icsSummary}`);
    check(/Weekly · 4 times/.test(await sheetText()), `[${width}] the repeat is shown`);
    check(!/\bnull\b|undefined/.test(await sheetText()), `[${width}] no "null" or "undefined" in the sheet`);
    await shot('ics-preview', width);
    await page.click('.gb-import-primary');
    await sheetGone();
    await wait(800);
    const rems = await authed('/api/reminders');
    const mineR = (Array.isArray(rems) ? rems : []).filter((r) => String(r.text).startsWith(run));
    for (const r of mineR) made.reminders.push(r.id);
    const yoga = mineR.find((r) => r.text.endsWith('yoga'));
    check(mineR.length === 2, `[${width}] the server has both reminders (${mineR.length})`);
    check(!!yoga && yoga.repeat === 'weekly' && yoga.repeatCount === 4 && yoga.notifyBefore === 15, `[${width}] the series kept its rule and alert`);
    await page.click(`[data-day-key="${tomorrow}"]`);
    await wait(600);
    const dayText = await page.$$eval('.gb-rem-text', (els) => els.map((e) => e.textContent).join('|'));
    check(dayText.includes(run + ' dentist') && dayText.includes(run + ' yoga'), `[${width}] both are on tomorrow in the calendar`);
    await shot('ics-done', width);

    /* ---- Clean up what this width made ---- */
    step = 'Clean up what this width made @' + width;
    const del = await authed('/api/money/tx', { method: 'POST', body: JSON.stringify({ upserts: [], deletes: made.tx }) });
    check(!del.failed, `[${width}] deleted the ${made.tx.length} test transactions`);
    made.tx = [];
    for (const id of made.reminders) {
      const d = await authed('/api/reminders/' + id + '?scope=all', { method: 'DELETE' });
      check(!d.failed, `[${width}] deleted reminder ${id}`);
    }
    made.reminders = [];
    step = 'open home @' + width;
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    await wait(800);
  }
} catch (err) {
  problems.push('threw at ' + step + ': ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err));
} finally {
  // Whatever an assertion left behind.
  if (made.tx.length) await authed('/api/money/tx', { method: 'POST', body: JSON.stringify({ upserts: [], deletes: made.tx }) }).catch(() => {});
  for (const id of made.reminders) await authed('/api/reminders/' + id + '?scope=all', { method: 'DELETE' }).catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
  await ctx.close();
  browser.disconnect();
}

if (problems.length) {
  console.error('\n' + problems.length + ' problem(s):\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nimport e2e: all checks passed');
