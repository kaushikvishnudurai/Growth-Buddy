/* Fewer taps on the core flows (docs/audit/ux-friction.md F05, F06, F07, F10,
   F12, F13, F16, F17, F18 and the Daily brief's sleep / mood chips). Each flow
   is driven the short way, counting every click and Enter, and asserted on what
   reached the server (2xx) and what is on screen. At 390 and 1280 wide. Every
   row it makes in the shared account is deleted again. Zero console errors and
   no 4xx/5xx. The finished focus sprint's POST is answered by GET
   /api/focus/stats so no fake 25 minutes lands in the account's stats.

     node scripts/e2e/ux-flows.e2e.mjs
   env: GB_E2E_BASE (http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9223),
        GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_SHOTS (screenshot dir, optional) */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';

const failures = [];
const problems = [];
const counts = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);

// Polled, not per animation frame: a tab behind another window gets no frames
// and a rAF-polled wait never looks again.
const wff = (fn, opts, ...args) => page.waitForFunction(fn, { polling: 100, ...opts }, ...args);
const visible = (sel, timeout = 8000) =>
  wff((sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; }, { timeout }, sel);
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so a shared one is every other agent's session too.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
// A background tab gets no animation frames, and the sheets open on one.
await page.bringToFront();
let auth = null;
const seen = []; // { method, url, status, body, json }
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
});
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('request', (req) => {
  const a = req.headers().authorization;
  if (a) auth = a;
});
page.on('response', async (r) => {
  const req = r.request();
  if (!r.url().includes('/api/')) return;
  const row = { method: req.method(), url: r.url(), status: r.status(), body: req.postData() || '', json: null };
  seen.push(row);
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${req.method()} ${r.url().slice(0, 140)}`);
  if (req.method() !== 'GET') row.json = await r.json().catch(() => null);
  row.done = true;
});
const sent = (method, re) => seen.filter((x) => x.method === method && re.test(new URL(x.url).pathname));
const waitSent = async (method, re, from, timeout = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const hit = sent(method, re).slice(from).find((x) => x.done);
    if (hit) return hit;
    if (Date.now() - t0 > timeout) return null;
    await wait(100);
  }
};
const ok2xx = (x) => !!x && x.status >= 200 && x.status < 300;

async function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

// Click the first visible button (in scope) whose text or aria-label matches. One tap.
let taps = 0;
async function tap(re, scope = 'body') {
  const found = await page.evaluate(
    (src, flags, scope) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll(scope + ' button')].find(
        (x) =>
          x.offsetParent !== null &&
          !x.disabled &&
          (re.test(x.getAttribute('aria-label') || '') || re.test((x.textContent || '').trim()))
      );
      if (b) {
        b.scrollIntoView({ block: 'center' });
        b.click();
      }
      return !!b;
    },
    re.source,
    re.flags,
    scope
  );
  if (!found) throw new Error('no button ' + re + ' in ' + scope);
  taps++;
}
async function enter() {
  await page.keyboard.press('Enter');
  taps++;
}
// Type into whatever has focus (the dialogs focus their first field).
async function typeFocused(text) {
  await wff(() => document.activeElement && document.activeElement.tagName === 'INPUT', { timeout: 5000 });
  await page.keyboard.type(text);
}
// Open, and past the sheet's own autofocus (60 ms), so typing lands in the field.
const sheetOpen = () => visible('.gb-modal-overlay .gb-modal-head', 8000).then(() => wait(250));
const noSheet = () =>
  wff(() => !document.querySelector('.gb-modal-overlay'), { timeout: 20000 }).catch(async (err) => {
    const open = await page.evaluate(() => [...document.querySelectorAll('.gb-modal')].map((m) => m.getAttribute('aria-label') + ': ' + m.textContent.slice(0, 80)));
    throw new Error('sheet still open: ' + JSON.stringify(open) + ' ' + err.message);
  });
async function tapToast(msgRe, labelRe) {
  await wff(
    (src) => [...document.querySelectorAll('.gb-toast')].some((t) => new RegExp(src).test(t.textContent || '')),
    { timeout: 15000 },
    msgRe.source
  );
  const done = await page.evaluate(
    (m, l) => {
      const t = [...document.querySelectorAll('.gb-toast')].find((x) => new RegExp(m).test(x.textContent || ''));
      const b = t && t.querySelector('.gb-toast-action');
      if (b && new RegExp(l).test(b.textContent || '')) {
        b.click();
        return true;
      }
      return false;
    },
    msgRe.source,
    labelRe.source
  );
  if (!done) throw new Error('no toast action ' + labelRe);
  taps++;
}
const record = (flow, width, before, after) => {
  counts.push({ flow, width, before, after, measured: taps });
  check(taps === after, `${flow} @${width}: ${taps} taps (audit: ${before} before, ${after} after)`);
};

async function apiCall(method, p, body) {
  return page.evaluate(
    async (method, p, body, auth) => {
      const r = await fetch(p, {
        method,
        headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    method,
    p,
    body || null,
    auth
  );
}
const cleanup = []; // [method, path]

async function signIn() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await wff(() => document.querySelector('input[type=email]') || document.querySelector('#gb-main'), { timeout: 20000 });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    // The local auth rate limit clears every 20 s: one 429 is a wait and a retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      const n = sent('POST', /\/api\/auth\/login$/).length;
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^sign in$/i.test(b.textContent.trim())).click());
      const res = await waitSent('POST', /\/api\/auth\/login$/, n, 30000);
      if (res && res.status === 429 && attempt === 0) {
        problems.splice(problems.findIndex((p) => /HTTP 429/.test(p)), 1);
        await wait(21000);
        continue;
      }
      break;
    }
    await wff(() => !document.querySelector('input[type=password]'), { timeout: 30000 });
  }
  await page.waitForSelector('#gb-main', { timeout: 20000 });
  await wait(1500);
}
async function goTo(screen) {
  await page.evaluate((s) => {
    location.hash = '#' + s;
  }, screen);
  await wait(900);
  await page.keyboard.press('Escape');
  await wait(200);
}

/* Tomorrow in the ACCOUNT's zone: "tomorrow" is read on the account's day (the
   app's todayKey), which differs from the device's for hours each night. */
let accountZone = '';
const tomorrowKey = () => {
  const day = (d) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: accountZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, dd] = day(new Date()).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + 1));
  return t.toISOString().slice(0, 10);
};

async function run(width, height) {
  await page.setViewport({ width, height });
  const tag = `${stamp}-${width}`;
  await goTo('home');

  // F12: a task due today. + Add, Today, title, Enter.
  const t1 = `E2E due ${tag}`;
  let n = sent('POST', /^\/api\/tasks$/).length;
  taps = 0;
  await tap(/^\+ Add$/, '.gb-dash');
  await sheetOpen();
  await tap(/^Today$/, '.gb-due-chips');
  await page.focus('.gb-modal-body input[type=text]');
  await page.keyboard.type(t1);
  await shot(`f12-due-chip-${width}`);
  await enter();
  let r = await waitSent('POST', /^\/api\/tasks$/, n);
  check(ok2xx(r), `F12 @${width}: POST /api/tasks ${r && r.status}`);
  const task1 = r && r.json;
  if (task1) cleanup.push(['DELETE', '/api/tasks/' + task1.id]);
  const due = task1 && task1.dueAt && new Date(task1.dueAt);
  check(!!due && due.toDateString() === new Date().toDateString() && due.getHours() === 23, `F12 @${width}: due end of today (${task1 && task1.dueAt})`);
  record('Add a task (due today)', width, 6, 3);
  await noSheet();
  await visible(`[data-task-id="${task1 && task1.id}"]`, 8000).then(
    () => check(true, `F12 @${width}: task row on Home`),
    () => check(false, `F12 @${width}: task row on Home`)
  );

  // F17: three tasks in one sheet. + Add, Add another, Add another, Enter.
  n = sent('POST', /^\/api\/tasks$/).length;
  taps = 0;
  await tap(/^\+ Add$/, '.gb-dash');
  await sheetOpen();
  for (let i = 1; i <= 3; i++) {
    await page.focus('.gb-modal-body input[type=text]');
    await page.keyboard.type(`E2E run ${i} ${tag}`);
    if (i < 3) {
      await tap(/^Add another$/, '.gb-modal-body');
      await wff(() => document.querySelector('.gb-modal-body input[type=text]').value === '', { timeout: 10000 });
      if (i === 1) await shot(`f17-add-another-${width}`);
    } else await enter();
  }
  await noSheet();
  await wait(500);
  const runs = sent('POST', /^\/api\/tasks$/).slice(n);
  check(runs.length === 3 && runs.every(ok2xx), `F17 @${width}: 3 POST /api/tasks, all 2xx (${runs.map((x) => x.status)})`);
  runs.forEach((x) => x.json && cleanup.push(['DELETE', '/api/tasks/' + x.json.id]));
  const listed = (await apiCall('GET', '/api/tasks')).json || [];
  const want = [1, 2, 3].map((i) => `E2E run ${i} ${tag}`);
  check(want.every((w) => listed.some((t) => t.title === w)), `F17 @${width}: all three tasks in /api/tasks (sent ${runs.map((x) => JSON.parse(x.body).title)})`);
  record('Add three tasks', width, 6, 4);

  // F06: the task row's timer button starts the clock. One tap.
  taps = 0;
  await tap(new RegExp('^Start focus on ' + t1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  await wff(() => /^#\/?focus/.test(location.hash), { timeout: 8000 });
  await wff(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent && /^Pause$/.test(b.textContent.trim())), { timeout: 8000 }).then(
    () => check(true, `F06 @${width}: Focus is running (Pause shown)`),
    () => check(false, `F06 @${width}: Focus is running (Pause shown)`)
  );
  record('Start focus on a task', width, 2, 1);
  await shot(`f06-running-${width}`);

  // F13: the sprint ends -> 'Mark "<task>" done?' -> one tap ticks it.
  await page.setRequestInterception(true);
  const onReq = (req) => {
    if (req.isInterceptResolutionHandled()) return;
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/focus/sessions') {
      req.continue({ method: 'GET', url: new URL('/api/focus/stats', req.url()).href, postData: '' });
    } else req.continue();
  };
  page.on('request', onReq);
  // One shifted clock read at a time until the tick sees the end.
  for (let i = 0; i < 40; i++) {
    const fired = await page.evaluate(() => [...document.querySelectorAll('.gb-toast')].some((t) => /Mark/.test(t.textContent)));
    if (fired) break;
    await page.evaluate(() => {
      const real = Date.now;
      Date.now = () => {
        Date.now = real;
        return real() + 26 * 60 * 1000;
      };
    });
    await wait(400);
  }
  taps = 0;
  n = sent('PATCH', /\/api\/tasks\/[^/]+\/toggle$/).length;
  await shot(`f13-mark-done-toast-${width}`);
  await tapToast(/Mark .*done\?/, /^Mark done$/);
  r = await waitSent('PATCH', /\/api\/tasks\/[^/]+\/toggle$/, n);
  check(ok2xx(r) && r.url.includes(task1 && task1.id) && r.json && r.json.done === true, `F13 @${width}: PATCH toggle ${r && r.status}, task done`);
  record('Finish the task a sprint was on', width, 2, 1);
  page.off('request', onReq);
  await page.setRequestInterception(false);

  // F16: goal saved -> "Add first task" -> the task is on that goal.
  await goTo('goals');
  n = sent('POST', /^\/api\/goals$/).length;
  const nt = sent('POST', /^\/api\/tasks$/).length;
  taps = 0;
  await tap(/^New goal$/);
  await sheetOpen();
  await typeFocused(`E2E goal ${tag}`);
  await tap(/^Save goal$/);
  r = await waitSent('POST', /^\/api\/goals$/, n);
  check(ok2xx(r), `F16 @${width}: POST /api/goals ${r && r.status}`);
  const goal = r && r.json;
  if (goal) cleanup.push(['DELETE', '/api/goals/' + goal.id]);
  await noSheet();
  await shot(`f16-goal-toast-${width}`);
  await tapToast(/Goal saved/, /^Add first task$/);
  await sheetOpen();
  await typeFocused(`E2E goal task ${tag}`);
  await enter();
  r = await waitSent('POST', /^\/api\/tasks$/, nt);
  check(ok2xx(r) && goal && JSON.parse(r.body).goalId === goal.id, `F16 @${width}: task POST ${r && r.status} carries the new goal`);
  if (r && r.json) cleanup.push(['DELETE', '/api/tasks/' + r.json.id]);
  record('Goal, then its first task', width, 4, 4);
  await noSheet();

  // F18: new habit with no reminder -> "Remind me" saves the suggested time.
  await goTo('home');
  n = sent('POST', /^\/api\/habits$/).length;
  taps = 0;
  await page.evaluate(() => {
    // SectionTitle's heading level follows the page outline (h2 by default).
    const head = [...document.querySelectorAll('.gb-sectiontitle > :is(h2, h3)')].find((x) => /Habit streaks/.test(x.textContent));
    head.parentElement.setAttribute('data-e2e', 'habits');
  });
  await tap(/^\+ Add$/, '[data-e2e=habits]');
  await sheetOpen();
  await typeFocused(`E2E habit ${tag}`);
  await enter();
  r = await waitSent('POST', /^\/api\/habits$/, n);
  check(ok2xx(r), `F18 @${width}: POST /api/habits ${r && r.status}`);
  const habit = r && r.json;
  if (habit) cleanup.push(['DELETE', '/api/habits/' + habit.id]);
  await noSheet();
  n = sent('PUT', /^\/api\/habits\/[^/]+$/).length;
  await shot(`f18-remind-toast-${width}`);
  await tapToast(/Remind you at/, /^Remind me$/);
  r = await waitSent('PUT', /^\/api\/habits\/[^/]+$/, n);
  check(ok2xx(r) && r.json && !!r.json.reminderTime, `F18 @${width}: PUT habit ${r && r.status}, reminder ${r && r.json && r.json.reminderTime}`);
  record('Habit with a reminder', width, 5, 3);

  // F07: the brief's water chip logs 250 ml. One tap.
  await goTo('home');
  const waterChip = await page.$('button.gb-coach-chip[aria-label="Log 250 ml of water"]');
  if (waterChip) {
    const before = ((await apiCall('GET', '/api/water')).json || {}).entries || [];
    n = sent('POST', /^\/api\/water\/entries$/).length;
    taps = 0;
    await tap(/^Log 250 ml of water$/, '.gb-coach-chiprow');
    r = await waitSent('POST', /^\/api\/water\/entries$/, n);
    check(ok2xx(r) && JSON.parse(r.body).amountMl === 250, `F07 @${width}: POST water 250 ml ${r && r.status}`);
    const added = ((r && r.json && r.json.entries) || []).filter((e) => !before.some((b) => b.id === e.id));
    added.forEach((e) => cleanup.push(['DELETE', '/api/water/entries/' + e.id]));
    check(added.length === 1, `F07 @${width}: one new water entry`);
    record('Log water', width, 3, 1);
    await shot(`f07-water-logged-${width}`);
  } else check(true, `F07 @${width}: skipped, water goal already met today`);

  // Next-step 7: Sleep / Mood chips open their dialogs. One tap each.
  for (const [label, title] of [
    ['Log last night’s sleep', /sleep/i],
    ['Log your mood', /mood|feel/i],
  ]) {
    await goTo('home');
    if (!(await page.$(`button.gb-coach-chip[aria-label="${label}"]`))) {
      check(true, `brief chip "${label}" @${width}: skipped, already logged today`);
      continue;
    }
    taps = 0;
    await tap(new RegExp('^' + label + '$'), '.gb-coach-chiprow');
    await sheetOpen();
    const t = await page.$eval('.gb-modal-overlay .gb-modal-head', (x) => x.textContent);
    check(title.test(t), `brief chip "${label}" @${width}: opens "${t.trim().slice(0, 40)}"`);
    record(`Brief chip: ${label}`, width, 2, 1);
    await page.keyboard.press('Escape');
    await noSheet();
  }

  // F10: a recent food chip logs at once; Undo deletes it.
  const seedName = `E2E toast ${tag}`;
  const seed = await apiCall('POST', '/api/food/entries/manual', {
    foodName: seedName,
    quantityGrams: 100,
    kcal: 120,
    mealType: 'home',
    mealSlot: 'snack',
    note: null,
  });
  check(seed.status >= 200 && seed.status < 300, `F10 @${width}: seed food ${seed.status}`);
  ((seed.json && seed.json.entries) || []).filter((e) => e.foodName === seedName).forEach((e) => cleanup.push(['DELETE', '/api/food/entries/' + e.id]));
  await goTo('food');
  n = sent('POST', /^\/api\/food\/entries\/manual$/).length;
  taps = 0;
  await tap(/^Log food$/, '#gb-main');
  await sheetOpen();
  await wff((name) => [...document.querySelectorAll('.gb-food-recent-chip')].some((b) => b.textContent.trim() === name), { timeout: 10000 }, seedName);
  await shot(`f10-chips-${width}`);
  await tap(new RegExp('^' + seedName + '$'), '.gb-food-recent');
  r = await waitSent('POST', /^\/api\/food\/entries\/manual$/, n);
  check(ok2xx(r) && JSON.parse(r.body).foodName === seedName && JSON.parse(r.body).kcal === 120, `F10 @${width}: chip POST ${r && r.status}`);
  const seedIds = ((seed.json && seed.json.entries) || []).map((e) => e.id);
  const logged = ((r && r.json && r.json.entries) || []).find((e) => e.foodName === seedName && !seedIds.includes(e.id));
  await noSheet();
  await visible(`[data-food-id="${logged && logged.id}"]`, 8000).then(
    () => check(true, `F10 @${width}: entry on the Food card`),
    () => check(false, `F10 @${width}: entry on the Food card`)
  );
  record('Log a meal (recent food), in Food', width, 3, 2);
  n = sent('DELETE', /^\/api\/food\/entries\/[^/]+$/).length;
  await tapToast(/^Logged /, /^Undo$/);
  r = await waitSent('DELETE', /^\/api\/food\/entries\/[^/]+$/, n);
  check(ok2xx(r) && logged && r.url.endsWith(logged.id), `F10 @${width}: Undo DELETE ${r && r.status}`);
  await wff((id) => !document.querySelector(`[data-food-id="${id}"]`), { timeout: 8000 }, logged && logged.id).then(
    () => check(true, `F10 @${width}: entry gone after Undo`),
    () => check(false, `F10 @${width}: entry gone after Undo`)
  );

  // F05: + -> Reminder -> words with a time -> Enter. The time is read from the words.
  accountZone = ((await apiCall('GET', '/api/auth/me')).json || {}).timezone || '';
  await goTo('home');
  n = sent('POST', /^\/api\/reminders$/).length;
  taps = 0;
  await tap(/^Quick add$/);
  await sheetOpen();
  await tap(/^Reminder/, '.gb-modal-opts');
  await wff(() => /New reminder/.test((document.querySelector('.gb-modal-overlay .gb-modal-title') || {}).textContent || ''), { timeout: 8000 });
  // The text field is focused by the sheet itself: no tap to get there.
  await wff(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Reminder text', { timeout: 5000 });
  await page.keyboard.type(`E2E call mom ${tag} tomorrow at 9pm`);
  await shot(`f05-reminder-sheet-${width}`);
  await enter();
  r = await waitSent('POST', /^\/api\/reminders$/, n, 30000);
  if (!r) {
    await shot(`f05-no-post-${width}`);
    console.log('quick-add calls:', JSON.stringify(sent('POST', /quick-add/).slice(-2).map((x) => [x.status, x.body, x.json])));
  }
  const rem = r && JSON.parse(r.body);
  check(ok2xx(r), `F05 @${width}: POST /api/reminders ${r && r.status}`);
  check(!!rem && rem.time === '21:00' && rem.date === tomorrowKey(), `F05 @${width}: time read from the words (${rem && rem.date} ${rem && rem.time})`);
  if (r && r.json) cleanup.push(['DELETE', '/api/reminders/' + r.json.id]);
  await noSheet();
  record('Add a reminder', width, 7, 3);
}

try {
  await signIn();
  await run(390, 844);
  await run(1280, 800);
} catch (err) {
  failures.push('crashed: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err));
  console.log('FAIL crashed:', err);
  await shot('crash');
} finally {
  // Undo done first (a task, then its goal), habits, water, food, reminders.
  for (const [m, p] of cleanup) {
    const res = await apiCall(m, p).catch(() => ({ status: 0 }));
    // 404: already gone (the Undo above, or a goal delete that took its task).
    if (!(res.status < 300 || res.status === 404)) failures.push(`cleanup ${m} ${p}: ${res.status}`);
  }
  console.log(`cleanup: ${cleanup.length} rows`);
  // Nothing of this run's left in the shared account.
  for (const p of ['/api/tasks', '/api/reminders', '/api/habits', '/api/goals']) {
    const res = await apiCall('GET', p).catch(() => ({ json: null }));
    const left = JSON.stringify(res.json || '').includes(stamp);
    check(!left, `cleanup: nothing of this run left in ${p}`);
  }
  await ctx.close();
  browser.disconnect();
}

console.log('\nTap counts (measured in-app; nav to the screen excluded for Focus/Food/Goals):');
counts.forEach((c) => console.log(`  ${c.flow} @${c.width}: before ${c.before}, after ${c.after}, measured ${c.measured}`));
// A 404 during cleanup is expected and not a page problem.
const real = problems.filter((p) => !/HTTP 404 DELETE/.test(p));
real.forEach((p) => console.log('PROBLEM ' + p));
if (failures.length || real.length) {
  console.log(`\n${failures.length} failed, ${real.length} problems`);
  process.exit(1);
}
console.log('\nall passed');
