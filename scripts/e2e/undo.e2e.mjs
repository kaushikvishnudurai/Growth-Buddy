/* Undo instead of "Are you sure?" (app.js deferDelete + undo-queue.js).
   For a task, a habit and a water entry, at 390 and 1280 wide: delete it, it is
   gone and no DELETE has gone out; Undo puts it back in the same place and still
   nothing is sent; delete again and wait out the window, the DELETE lands
   (200/204) and the item stays gone after a reload. A delete whose item is
   already gone on the server (404) stays gone, with no error. Zero console
   errors and no other 4xx/5xx.

     node scripts/e2e/undo.e2e.mjs
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
const WINDOW_MS = 6000;

const failures = [];
const problems = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so another tab on localhost signing out
// would otherwise sign this one out too.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
/* Chrome throttles, then freezes, a background tab, and the shared CDP Chrome
   has other agents' tabs in front: keep this one live and in front. */
const cdp = await page.createCDPSession();
const front = async () => {
  await page.bringToFront();
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
};
const deletes = []; // { url, status }
/* The CDP Chrome is shared: another tab coming to the front hides this one, and
   a hidden page sends its pending deletes at once (by design). Pin it visible so
   the window under test is the toast's, not the tab switcher's. */
await page.evaluateOnNewDocument(() => {
  Object.defineProperty(document, 'hidden', { get: () => false });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
});
let expect404 = ''; // a path whose 404 a check provokes on purpose
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (expect404 && /status of 404/.test(m.text())) return;
  problems.push('console: ' + m.text().slice(0, 200));
});
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  const req = r.request();
  if (req.method() === 'DELETE') deletes.push({ url: r.url(), status: r.status() });
  if (r.status() === 404 && expect404 && r.url().includes(expect404)) return;
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${req.method()} ${r.url().slice(0, 140)}`);
});
// A DELETE that never got an answer still went out.
page.on('request', (req) => {
  if (req.method() === 'DELETE') deletes.push({ url: req.url(), status: 0 });
});
const deletesTo = (frag) => deletes.filter((d) => d.url.includes(frag));

async function shot(name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

// Click the first visible button whose text or aria-label matches.
async function clickButton(re, scope = 'body') {
  const ok = await page.evaluate(
    (src, flags, scope) => {
      const re = new RegExp(src, flags);
      const b = [...document.querySelectorAll(scope + ' button')].find(
        (x) => x.offsetParent !== null && (re.test(x.getAttribute('aria-label') || '') || re.test((x.textContent || '').trim()))
      );
      if (b) b.click();
      return !!b;
    },
    re.source,
    re.flags,
    scope
  );
  if (!ok) throw new Error('no button ' + re);
}
// Typed in one go: a boot-time repaint landing mid-typing kept only the first letters.
const fill = (sel, text) =>
  page.$eval(sel, (el, t) => {
    el.focus();
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);
const clickUndo = async () => {
  // The Undo one: a new habit's "Remind you at ...?" toast can still be on the stack.
  await page.waitForFunction(() => [...document.querySelectorAll('.gb-toast-action')].some((b) => b.textContent.trim() === 'Undo'));
  // Keyboard reachable: focus it and press Enter, as a keyboard user would.
  await page.evaluate(() => [...document.querySelectorAll('.gb-toast-action')].reverse().find((b) => b.textContent.trim() === 'Undo').focus());
  await page.keyboard.press('Enter');
};
// Off the toast stack so its hold-on-hover/focus doesn't pause the window
// (a focused Undo holds its delete for as long as it keeps focus, by design).
const moveAway = async () => {
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
};

async function signIn() {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    const login = () => page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 30000 });
    let res = login();
    await clickButton(/^sign in$/i);
    // The local auth rate limit is cleared every 20 s: one 429 is a wait, not a failure.
    if ((await res).status() === 429) {
      problems.splice(problems.findIndex((p) => p.includes('429')), 1);
      await wait(21000);
      res = login();
      await clickButton(/^sign in$/i);
      await res;
    }
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
  }
  await wait(1200);
}
async function goTo(screen) {
  await front();
  await page.goto(`${BASE}/#${screen}`, { waitUntil: 'networkidle2' });
  await wait(900);
}

/* One item's whole round. `list()` returns the item keys in screen order,
   `del()` deletes it from the UI, `key` is the item. */
async function round(label, { screen, key, list, del, frag }) {
  await front();
  const before = await list();
  const at = before.indexOf(key);
  check(at >= 0, `${label}: on screen before the delete`);
  const sent0 = deletesTo(frag).length;

  await del();
  await waitFor((k) => !window.__gbList().includes(k), key);
  check(true, `${label}: gone at once`);
  check(deletesTo(frag).length === sent0, `${label}: no DELETE sent yet`);
  await shot(`${label}-deleted`);

  await clickUndo();
  await waitFor((k) => window.__gbList().includes(k), key);
  await moveAway();
  const after = await list();
  check(after.indexOf(key) === at, `${label}: back in the same place (${at} -> ${after.indexOf(key)})`);
  await wait(WINDOW_MS + 1500);
  check(deletesTo(frag).length === sent0, `${label}: Undo sent no DELETE, even after the window`);
  check((await list()).includes(key), `${label}: still there after the window`);
  await shot(`${label}-undone`);

  await front();
  await del();
  await waitFor((k) => !window.__gbList().includes(k), key);
  await moveAway();
  await wait(WINDOW_MS + 2500);
  const sent = deletesTo(frag).filter((d) => d.status);
  const last = sent[sent.length - 1];
  check(sent.length === 1 && (last.status === 200 || last.status === 204), `${label}: DELETE landed after the window (${last && last.status})`);
  await reload();
  check(!(await list()).includes(key), `${label}: stays gone after reload`);
}

async function serverTaskIds() {
  const tok = (await page.cookies()).find((c) => c.name === 'gb.token');
  return page.evaluate(
    (t) => fetch('/api/tasks', { headers: { Authorization: 'Bearer ' + decodeURIComponent(t) } }).then((r) => r.json()).then((l) => l.map((x) => x.id)),
    tok ? tok.value : ''
  );
}

// A real reload (a goto to the same #hash is not one: no pagehide, no fresh lists).
async function reload() {
  await front();
  await page.reload({ waitUntil: 'networkidle2' });
  await wait(1200);
  await installList();
}

// The current screen's item list lives in window.__gbList, so waitForFunction can read it.
let listSrc = '';
async function installList(src) {
  if (src) listSrc = src;
  await page.evaluate((s) => (window.__gbList = new Function('return (' + s + ')()')), listSrc);
}
const readList = () => page.evaluate(() => window.__gbList());

async function runAt(width, height) {
  await page.setViewport({ width, height });
  const tag = String(width);
  const stamp = Date.now().toString(36);

  // ---- Task ----
  await goTo('home');
  const title = 'Undo e2e task ' + stamp;
  await clickButton(/^quick add$/i);
  await page.waitForSelector('.gb-modal-opt', { visible: true });
  await clickButton(/^Task/, '.gb-modal-opts');
  await page.waitForSelector('input[placeholder="e.g. Finish the design review"]', { visible: true });
  await fill('input[placeholder="e.g. Finish the design review"]', title);
  const made = page.waitForResponse((r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST', { timeout: 20000 });
  await clickButton(/^add task$/i);
  await made;
  await waitFor((t) => [...document.querySelectorAll('[data-task-id] .title')].some((x) => x.textContent === t), title);
  await wait(600);
  const taskId = await page.evaluate(
    (t) => [...document.querySelectorAll('[data-task-id]')].find((r) => r.querySelector('.title')?.textContent === t)?.dataset.taskId,
    title
  );
  await installList(`() => [...document.querySelectorAll('[data-task-id]')].map((r) => r.dataset.taskId)`);
  await round(`task-${tag}`, {
    screen: 'home',
    key: taskId,
    list: readList,
    frag: '/api/tasks/',
    del: async () => {
      await clickButton(new RegExp('^Edit ' + title + '$'));
      await page.waitForSelector('.gb-modal .gb-btn--danger', { visible: true });
      await clickButton(/^delete task$/i, '.gb-modal');
    },
  });

  // ---- Leaving the page sends what is pending (pagehide flush) ----
  await goTo('home');
  const title2 = title + ' b';
  await clickButton(/^quick add$/i);
  await page.waitForSelector('.gb-modal-opt', { visible: true });
  await clickButton(/^Task/, '.gb-modal-opts');
  await page.waitForSelector('input[placeholder="e.g. Finish the design review"]', { visible: true });
  await fill('input[placeholder="e.g. Finish the design review"]', title2);
  const made2 = page.waitForResponse((r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST', { timeout: 20000 });
  await clickButton(/^add task$/i);
  const id2 = (await (await made2).json()).id;
  await waitFor((k) => window.__gbList().includes(k), id2);
  const n2 = deletesTo(id2).length;
  check((await serverTaskIds()).includes(id2), `flush-${tag}: on the server before the delete`);
  await clickButton(new RegExp('^Edit ' + title2 + '$'));
  await page.waitForSelector('.gb-modal .gb-btn--danger', { visible: true });
  await clickButton(/^delete task$/i, '.gb-modal');
  await waitFor((k) => !window.__gbList().includes(k), id2);
  check(deletesTo(id2).length === n2, `flush-${tag}: nothing sent before the page goes`);
  await reload();
  // A keepalive request sent from pagehide outlives the page and reports no
  // events to it, so ask the server itself.
  check(!(await serverTaskIds()).includes(id2), `flush-${tag}: the page going sent the DELETE (gone on the server)`);
  check(!(await readList()).includes(id2), `flush-${tag}: gone after the reload`);

  // ---- Already gone when the window ends (a one-tap Undo of its create got there first) ----
  await goTo('home');
  const title3 = title + ' c';
  await clickButton(/^quick add$/i);
  await page.waitForSelector('.gb-modal-opt', { visible: true });
  await clickButton(/^Task/, '.gb-modal-opts');
  await page.waitForSelector('input[placeholder="e.g. Finish the design review"]', { visible: true });
  await fill('input[placeholder="e.g. Finish the design review"]', title3);
  const made3 = page.waitForResponse((r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST', { timeout: 20000 });
  await clickButton(/^add task$/i);
  const id3 = (await (await made3).json()).id;
  await waitFor((k) => window.__gbList().includes(k), id3);
  await clickButton(new RegExp('^Edit ' + title3 + '$'));
  await page.waitForSelector('.gb-modal .gb-btn--danger', { visible: true });
  await clickButton(/^delete task$/i, '.gb-modal');
  await waitFor((k) => !window.__gbList().includes(k), id3);
  const tok = (await page.cookies()).find((c) => c.name === 'gb.token');
  await page.evaluate(
    (id, t) => fetch('/api/tasks/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + decodeURIComponent(t) } }),
    id3,
    tok ? tok.value : ''
  );
  expect404 = '/api/tasks/' + id3; // the deferred DELETE's answer, which is the point here
  await moveAway();
  await wait(WINDOW_MS + 2500);
  expect404 = '';
  check(deletesTo(id3).some((d) => d.status === 404), `gone-${tag}: the deferred DELETE was answered 404`);
  check(!(await readList()).includes(id3), `gone-${tag}: a 404 is done, not a restored ghost row`);
  check(!(await page.evaluate(() => /Could not delete/.test(document.body.innerText))), `gone-${tag}: no error toast`);

  // ---- Habit ----
  const name = 'Undo e2e habit ' + stamp;
  await goTo('habits');
  await clickButton(/^quick add$/i);
  await page.waitForSelector('.gb-modal-opt', { visible: true });
  await clickButton(/^Habit/, '.gb-modal-opts');
  await page.waitForSelector('input[placeholder="e.g. Meditate"]', { visible: true });
  await fill('input[placeholder="e.g. Meditate"]', name);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/habits') && r.request().method() === 'POST');
  await clickButton(/^add habit$/i);
  await created;
  await goTo('habits');
  const habitList = `() => [...document.querySelectorAll('.gb-row-open')].map((b) => (b.textContent || '').trim()).filter(Boolean).map((t) => t.includes(${JSON.stringify(name)}) ? ${JSON.stringify(name)} : t)`;
  await installList(habitList);
  await waitFor((n) => window.__gbList().includes(n), name);
  await round(`habit-${tag}`, {
    screen: 'habits',
    key: name,
    list: readList,
    frag: '/api/habits/',
    del: async () => {
      await page.evaluate((n) => [...document.querySelectorAll('.gb-row-open')].find((b) => b.textContent.includes(n)).click(), name);
      // A quiet text button now (habit-dialogs.js restyles the danger bar), found by its label.
      await waitFor(() => [...document.querySelectorAll('.gb-modal button')].some((b) => /^delete habit$/i.test(b.textContent.trim()) && b.offsetParent));
      await clickButton(/^delete habit$/i, '.gb-modal');
    },
  });

  // ---- Water entry (the Food & water screen) ----
  await goTo('food');
  const waterIds = () => page.evaluate(() => [...document.querySelectorAll('[data-water-id]')].map((r) => r.dataset.waterId));
  const posted = page.waitForResponse((r) => r.url().includes('/api/water/entries') && r.request().method() === 'POST');
  await clickButton(/^\+250 ml, add water$/i); // a11y: the name starts with the visible text
  await posted;
  await wait(800);
  const ids = await waterIds();
  const entryId = ids.find((id) => !id.startsWith('pending-'));
  check(!!entryId, `water-${tag}: the new entry is on the card`);
  await installList(`() => [...document.querySelectorAll('[data-water-id]')].map((r) => r.dataset.waterId)`);
  await round(`water-${tag}`, {
    screen: 'food',
    key: entryId,
    list: readList,
    frag: '/api/water/entries/',
    del: () => page.click(`[data-water-id="${entryId}"] button[aria-label="Delete water entry"]`),
  });
}

try {
  await signIn();
  await runAt(390, 844);
  deletes.length = 0;
  await runAt(1280, 800);
} catch (err) {
  failures.push('crashed: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' ') : err));
  await shot('crash');
} finally {
  await ctx.close();
  await browser.disconnect();
}

for (const f of failures) if (f.startsWith('crashed')) console.log('FAIL ' + f);
for (const p of problems) console.log('PROBLEM ' + p);
const bad = failures.length + problems.length;
console.log(bad ? `undo e2e: ${failures.length} failed, ${problems.length} problems` : 'undo e2e: ok');
process.exit(bad ? 1 : 0);
