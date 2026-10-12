/* =====================================================================
   Growth Buddy — functional audit e2e (docs/audit/functional.md)

   Reproduces the data-loss findings in a real browser and asserts them fixed:
     FN-02  sleep logged offline, and one answered 503 (Render waking), is
            queued, POSTed when the connection is back, and still there after
            a reload (it used to be wiped by the next load);
     FN-01  a Money document edit (a budget) made offline survives the
            back-online load and reaches the server;
     FN-03  a pref save PUTs only the key it changed;
     FN-07  a focus session linked to a deleted task is saved (was a 404);
     FN-11  a failed first Mentorship load says so, with Try again;
     QA-04  Buddy's read on a tapped day lands on screen at 390;
     QA-11  the first frame of a dialog already covers the page (no click-through).
   At 390x844 and 1280x800. Fails on any assertion, console error or 4xx/5xx,
   except the ones this script provokes itself (offline toggling and the 503s it
   injects), which are filtered by exact source.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)
     GB_E2E_SHOTS (screenshot dir, default assets/e2e/functional)

   Cleans up what it can through the API (budget, task). Two things have no
   delete endpoint: the two sleep entries (dated 58 and 57 days back, so they
   leave the 60-day window within days) and one 1-minute focus session.
   ===================================================================== */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || 'assets/e2e/functional';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const ok = (cond, msg) => {
  if (cond) console.log('ok   ' + msg);
  else {
    console.log('FAIL ' + msg);
    failures.push(msg);
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Poll for a condition: back-online replays wait on loadData's first wave.
const until = async (fn, ms = 25000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(500)) if (await fn()) return true;
  return false;
};

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so another tab on localhost signing out
// would otherwise sign this run out too.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
// A hidden tab runs no requestAnimationFrame, and the app scrolls and opens
// dialogs in one: in front of its own window, so the run sees what a user sees.
await page.bringToFront();
let offline = false; // this script's own offline window
const injected = new Set(); // URLs this script answered with a 503 itself
const problems = [];
if (process.env.GB_E2E_DEBUG) {
  await page.evaluateOnNewDocument(() => {
    addEventListener('online', () => console.log('EVT online'));
    addEventListener('offline', () => console.log('EVT offline'));
  });
  page.on('console', (m) => /EVT|CRITICAL/.test(m.text()) && console.log('DEBUG', m.text()));
}
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // Expected while WE took the page offline: the failed fetches, and the app's
  // own log of a save that is now queued.
  if (offline && /ERR_INTERNET_DISCONNECTED|Failed to fetch|CRITICAL: saveMoney failed|Load failed/.test(t)) return;
  if (/status of 503/.test(t) && injected.size) return; // our injected 503s
  // The AI budget (40 an hour) is per account, and this seeded account is shared by
  // every run: a 429 from Buddy's day read is the limiter working, shown in the card.
  if (/status of 429/.test(t) && aiLimited) return;
  problems.push('console: ' + t.slice(0, 200));
});
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
let aiLimited = false;
page.on('response', (r) => {
  if (r.status() < 400) return;
  if (r.status() === 429 && /\/api\/food\/diet-check/.test(r.url())) return void (aiLimited = true);
  if (r.status() === 503 && injected.has(r.url())) return;
  problems.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 140));
});
const posts = [];
page.on('request', (r) => {
  if (r.method() !== 'GET') posts.push({ method: r.method(), url: r.url(), body: r.postData() || '' });
  if (process.env.GB_E2E_DEBUG) console.log('DEBUG', new Date().toISOString().slice(11, 19), r.method(), r.url().slice(21, 90));
});

// 503 for the next matching request(s), then pass through again.
let fail503 = null; // (req) => boolean
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.isInterceptResolutionHandled()) return;
  if (fail503 && fail503(req)) {
    injected.add(req.url());
    return req.respond({ status: 503, contentType: 'application/json', body: '{"message":"Waking up"}' });
  }
  req.continue();
});

const goto = async (hash) => {
  await page.goto(BASE + '/#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gb-main', { timeout: 20000 });
  await wait(2500);
};
const api = (path, opts = {}) =>
  page.evaluate(
    async (path, opts) => {
      const tok = decodeURIComponent((document.cookie.match(/(?:^|; )gb\.token=([^;]+)/) || [])[1] || '');
      const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(opts.headers || {}) },
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch (_) {}
      return { status: res.status, etag: res.headers.get('ETag'), body };
    },
    path,
    opts
  );
const clickText = (sel, re) =>
  page.evaluate(
    (sel, src) => {
      const re = new RegExp(src, 'i');
      const el = [...document.querySelectorAll(sel)].find((b) => re.test(b.textContent || ''));
      if (el) el.click();
      return !!el;
    },
    sel,
    re.source
  );
const shot = (name) => page.screenshot({ path: SHOTS + '/' + name + '.png' });
const dayAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/* Sign in */
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await wait(2500);
for (let attempt = 0; attempt < 2 && (await page.$('input[type=email]')); attempt++) {
  if (attempt) await wait(21000); // the local auth rate limit clears every 20 s
  await page.$eval('input[type=email]', (el) => (el.value = ''));
  await page.type('input[type=email]', EMAIL);
  await page.$eval('input[type=password]', (el) => (el.value = ''));
  await page.type('input[type=password]', PASSWORD);
  const login = page.waitForResponse((r) => /\/api\/auth\/login$/.test(r.url()), { timeout: 20000 });
  await clickText('button', /sign in/);
  const res = await login;
  if (res.status() === 429) {
    problems.pop(); // the one 429 we retry is not a fault
    continue;
  }
  await page.waitForSelector('#gb-main', { timeout: 20000 });
  await wait(3000);
}
ok(await page.evaluate(() => document.visibilityState === 'visible'), 'page is visible (rAF runs)');
const me = await api('/api/auth/me');
ok(me.status === 200, 'signed in');
const uid = me.body.id;

/* Sleep through the Home dialog, for a given date. */
// No navigation in here: a page.goto while offline (even to the same #hash)
// fires a spurious 'online' event with the emulated network still down.
async function logSleep(date, quality, note) {
  ok(await clickText('.gb-wellness-tile', /sleep/), 'sleep tile on Home');
  await page.waitForSelector('.gb-modal input[type=date]');
  await page.$eval('.gb-modal input[type=date]', (el, v) => (el.value = v), date);
  await clickText('.gb-modal button', new RegExp('^' + quality + '$'));
  await page.$eval('.gb-modal textarea', (el, v) => (el.value = v), note);
  await clickText('.gb-modal button', /^Save sleep$/);
  await wait(1500);
}
const cachedWellness = () =>
  page.evaluate(async (uid) => {
    const c = await caches.open('gb-store-v2');
    const r = await c.match('https://gb-store/' + encodeURIComponent('gb.wellness.' + uid));
    return r ? JSON.parse(await r.text()) : null;
  }, uid);

/* ---- FN-02: offline sleep ---- */
{
  const D = dayAgo(58);
  await goto('home');
  offline = true;
  await page.setOfflineMode(true);
  const note = 'e2e offline ' + Date.now();
  await logSleep(D, 'Great', note);
  // No screenshot while offline: in this harness one can fire a spurious 'online'
  // event with the emulated network still down.
  const toast = await page.evaluate(() => document.body.innerText);
  ok(/will sync/i.test(toast), 'FN-02 offline sleep says it will sync');
  posts.length = 0;
  await page.setOfflineMode(false); // back online: loadData, then the outbox flush
  const sent = await until(() => posts.some((p) => /\/api\/daily-logs\/sleep$/.test(p.url) && p.body.includes(note)));
  ok(sent, 'FN-02 queued sleep POSTed when back online');
  const landed = await until(async () => ((await api('/api/daily-logs?days=60')).body.sleepByDate[D] || {}).note === note);
  offline = false;
  ok(landed, 'FN-02 the server has the offline night');
  await shot('fn02-sleep-synced-390');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(5000);
  const w = await cachedWellness();
  ok(!!(w && w.sleepByDate && w.sleepByDate[D]), 'FN-02 still there after a reload');
}

/* ---- FN-02: a 503 while the server wakes ---- */
{
  const D = dayAgo(57);
  await goto('home');
  fail503 = (req) => req.method() === 'POST' && /\/api\/daily-logs\/sleep$/.test(req.url());
  const note = 'e2e 503 ' + Date.now();
  await logSleep(D, 'Good', note);
  fail503 = null;
  const text = await page.evaluate(() => document.body.innerText);
  ok(/will sync/i.test(text), 'FN-02 a 503 queues the night instead of dropping it');
  // The online event is what replays the outbox; a reload does it on boot too.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(6000);
  const logs = await api('/api/daily-logs?days=60');
  ok((logs.body.sleepByDate[D] || {}).note === note, 'FN-02 the 503 night reached the server on the next load');
  const w = await cachedWellness();
  ok(!!(w && w.sleepByDate && w.sleepByDate[D]), 'FN-02 and is on the phone');
  injected.clear();
}

/* ---- FN-01: a Money document edit made offline ---- */
{
  const before = await api('/api/money');
  const keepBudgets = before.body.budgets || {};
  await goto('money');
  // The screen is a lazy chunk: it must be here before the connection goes.
  // "Set budgets" (health card) with none set, the Monthly budgets card's "Edit" with some.
  const budgetsBtn = () =>
    [...document.querySelectorAll('button')].find((b) => /^Set budgets$/.test(b.textContent.trim())) ||
    [...document.querySelectorAll('.gb-sectiontitle')].find((t) => /Monthly budgets/.test(t.textContent))?.querySelector('button');
  await page.waitForFunction(budgetsBtn, { timeout: 20000 }).catch(() => {});
  offline = true;
  await page.setOfflineMode(true);
  const opened = await page.evaluate((src) => {
    const b = new Function('return (' + src + ')()')();
    if (b) b.click();
    return !!b;
  }, budgetsBtn.toString());
  ok(opened, 'FN-01 budgets dialog opens offline');
  await page.waitForSelector('.gb-money-budget-field input[type=number]', { timeout: 5000 });
  const amount = 4000 + (Date.now() % 997); // fresh each run: a leftover can't pass the checks
  const key = await page.evaluate((amount) => {
    const f = document.querySelector('.gb-money-budget-field');
    const inp = f.querySelector('input[type=number]');
    inp.value = String(amount);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return f.querySelector('.gb-money-budget-field-label').textContent;
  }, amount);
  await clickText('.gb-modal button, .gb-money-modal button, button', /^Save budgets$/);
  await wait(1500);
  posts.length = 0;
  await page.setOfflineMode(false);
  const put = await until(() => posts.some((p) => p.method === 'PUT' && /\/api\/money$/.test(p.url) && p.body.includes(String(amount))));
  await wait(1500);
  offline = false;
  ok(put, 'FN-01 the offline budget is PUT once back online');
  const after = await api('/api/money');
  const vals = Object.values(after.body.budgets || {});
  ok(vals.includes(amount), 'FN-01 the server has the offline budget (' + key + ')');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(5000);
  const again = await api('/api/money');
  ok(Object.values(again.body.budgets || {}).includes(amount), 'FN-01 still there after a reload');
  await shot('fn01-money-after-reload-390');
  // Clean up: the budgets as they were, through the same versioned PUT the app uses.
  const doc = { ...again.body, budgets: keepBudgets };
  for (const k of ['expenses', 'income', 'transfers', 'accounts']) delete doc[k];
  const pendingDoc = await page.evaluate(async (uid) => {
    const c = await caches.open('gb-store-v2');
    const r = await c.match('https://gb-store/' + encodeURIComponent('gb.money.' + uid + '.docPending'));
    return r ? r.text() : null;
  }, uid);
  ok(!pendingDoc, 'FN-01 nothing left pending once the server has it' + (pendingDoc ? ': ' + pendingDoc : ''));
  const restore = await api('/api/money', { method: 'PUT', body: JSON.stringify(doc), headers: { 'If-Match': again.etag } });
  ok(restore.status < 300, 'FN-01 cleanup: budgets restored');
  // The tab still holds the edited copy; a reload adopts the restored one, and
  // nothing may re-send the old budget.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await wait(6000);
  const held = await api('/api/money');
  ok(JSON.stringify(held.body.budgets || {}) === JSON.stringify(keepBudgets), 'FN-01 cleanup holds after a reload');
}

/* ---- FN-03: a pref save sends only its own key ---- */
{
  await goto('home');
  // Settings is a dialog: avatar (next to the bell) > Settings > Display.
  // The bell's name carries its count ("Notifications, 3 unread").
  await page.evaluate(() => document.querySelector('.gb-bell').nextElementSibling.click());
  await wait(500);
  await clickText('.gb-profile-pop-item', /^Settings$/);
  await wait(800);
  await clickText('.gb-modal button, .gb-modal [role=tab]', /^Display$/);
  await wait(500);
  const flip = () =>
    page.evaluate(() => {
      const opts = [...document.querySelectorAll('.gb-modal button')].filter((b) => /^(Light|Dark)$/.test(b.textContent.trim()));
      const other = opts.find((b) => b.getAttribute('aria-pressed') !== 'true' && b.getAttribute('aria-checked') !== 'true');
      if (other) other.click();
      return opts.length;
    });
  posts.length = 0;
  ok((await flip()) === 2, 'FN-03 theme control found in Settings > Display');
  ok(await until(() => posts.some((p) => /\/api\/auth\/ui-prefs$/.test(p.url)), 5000), 'FN-03 theme saved');
  const put = posts.find((p) => /\/api\/auth\/ui-prefs$/.test(p.url));
  const keys = put ? Object.keys(JSON.parse(put.body).prefs || {}) : [];
  ok(keys.length === 1 && keys[0] === 'theme', 'FN-03 ui-prefs PUT carries only the changed key: ' + keys.join(','));
  await shot('fn03-settings-display-390');
  posts.length = 0;
  await flip(); // put the theme back
  await until(() => posts.some((p) => /\/api\/auth\/ui-prefs$/.test(p.url)), 5000);
  await page.keyboard.press('Escape');
  await wait(600);
}

/* ---- FN-07: focus on a task that was then deleted ---- */
{
  const t = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'e2e focus link ' + Date.now() }) });
  ok(t.status < 300 && t.body && t.body.id, 'FN-07 made a task');
  await api('/api/tasks/' + t.body.id, { method: 'DELETE' });
  const s = await api('/api/focus/sessions', {
    method: 'POST',
    body: JSON.stringify({ mode: 'focus', durationSec: 60, taskId: t.body.id }),
  });
  ok(s.status === 200, 'FN-07 a session linked to a deleted task is saved, not 404 (' + s.status + ')');
}

/* ---- QA-04: Buddy's read on a tapped day is on screen ---- */
{
  await goto('summary');
  await page.waitForSelector('.gb-food-week-col', { timeout: 15000 });
  await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.gb-food-week-col')].filter((c) => c.offsetParent);
    cols[cols.length - 1].click();
  });
  await wait(6000); // the read is a POST; the card is revealed again when it lands
  const box = await page.evaluate(() => {
    const r = document.querySelector('.gb-summary-buddy').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: innerHeight };
  });
  ok(box.top >= 0 && box.top < box.h - 80, "QA-04 Buddy's read is in view at 390 (top " + Math.round(box.top) + ')');
  await shot('qa04-summary-day-390');
}

/* ---- QA-11 + FN-11 at both widths ---- */
for (const [label, vp] of [
  ['390', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['1280', { width: 1280, height: 800, deviceScaleFactor: 1 }],
]) {
  await page.setViewport(vp);
  await goto('home');
  // QA-11: in the very task that opens a dialog, the overlay already covers the
  // page, so a click in its first frame hits the backdrop, never the page.
  const first = await page.evaluate(() => {
    const tile = [...document.querySelectorAll('.gb-wellness-tile')][0];
    tile.scrollIntoView({ block: 'center' });
    const r = tile.getBoundingClientRect();
    tile.click();
    const hit = document.elementFromPoint(r.left + 5, r.top + 5);
    return !!(hit && hit.closest('.gb-modal-overlay'));
  });
  ok(first, 'QA-11 first frame of a dialog covers the page @' + label);
  await page.keyboard.press('Escape');
  await wait(600);
  await shot('home-' + label);

  // FN-11: the first Mentorship load fails.
  fail503 = (req) => /\/api\/mentorship\/requests\/(outgoing|incoming)/.test(req.url());
  await goto('circle');
  const txt = await page.evaluate(() => document.body.innerText);
  ok(/Could not load your mentors/.test(txt) && !/No mentors or mentees yet/.test(txt), 'FN-11 failed first load says so @' + label);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.gb-empty')].find((e) => /Could not load your mentors/.test(e.textContent));
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await wait(400);
  await shot('fn11-circle-error-' + label);
  fail503 = null;
  await clickText('button', /^Try again$/);
  await wait(2500);
  const txt2 = await page.evaluate(() => document.body.innerText);
  ok(!/Could not load your mentors/.test(txt2), 'FN-11 Try again loads @' + label);
  await shot('fn11-circle-retry-' + label);
  injected.clear();
  await goto('money');
  await shot('money-' + label);
}

await ctx.close();
browser.disconnect();
for (const p of problems) failures.push(p);
if (problems.length) console.log(problems.map((p) => 'FAIL ' + p).join('\n'));
if (failures.length) {
  console.log('\n' + failures.length + ' failed');
  process.exit(1);
}
console.log('\nfunctional e2e: all passed');
