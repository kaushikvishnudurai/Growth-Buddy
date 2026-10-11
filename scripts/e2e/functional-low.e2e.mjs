/* Functional audit, low findings (FN-16 to FN-21), in a real browser.

   Each case forces the failing response with request interception and checks
   what the user is left looking at:
   - FN-16 a Money write the server answers 429 is "saved on this phone", not "not saved"
   - FN-17 a Quick add expense keeps its paise and books to the last-used account
   - FN-18 an older agreement save failing after a newer one landed rolls nothing back
   - FN-19 "Load older" failing in a circle feed keeps the posts already shown
   - FN-20 a chore reassign that fails puts the select back on the old assignee
   - FN-21 Undo on a deleted, ticked shopping item ticks the restored row, not an older twin

     node scripts/e2e/functional-low.e2e.mjs

   Env: GB_E2E_BASE (http://localhost:5173), GB_E2E_CDP (http://127.0.0.1:9222),
   GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account), GB_E2E_OUT (screenshots).
   Everything it creates on the shared account is removed again. */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const OUT = process.env.GB_E2E_OUT || 'assets/e2e/functional-low';
mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (ok, msg) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
  if (!ok) failures.push(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The API straight, for setup and cleanup (through the dev server's proxy).
// The local auth rate limit clears every 20 s: one wait and retry on a 429.
const signIn = () =>
  fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
let loginRes = await signIn();
if (loginRes.status === 429) {
  await sleep(21000);
  loginRes = await signIn();
}
const login = await loginRes.json();
const TOKEN = login.token;
if (!TOKEN) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
async function call(path, method = 'GET', body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'e2e-' + Math.random().toString(36).slice(2),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status);
  return r.status === 204 ? null : r.json();
}

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });

/* One page per viewport. `force` holds the interceptions of the step running:
   [{ match(req) -> bool, handle(req) }]. Errors a step forces are expected; any
   other console error or 4xx/5xx fails the run. */
async function openPage(name, vp) {
  // Its own context: cookies are per host, so every tab on localhost shares the
  // session cookies with other runs; one signing out would end this one.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(vp);
  const ctx = { context, page, name, force: [], forced: new Set(), forcedReqs: new WeakSet(), allowConsole: [] };
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isInterceptResolutionHandled()) return;
    const f = ctx.force.find((x) => x.match(req));
    if (!f) return req.continue();
    ctx.forced.add(req.url()); // for the console's "Failed to load resource" line
    ctx.forcedReqs.add(req);
    f.handle(req);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const url = (m.location() && m.location().url) || '';
    if (/Failed to load resource/.test(text) && ctx.forced.has(url)) return;
    if (ctx.allowConsole.some((re) => re.test(text))) return;
    failures.push(`[${name}] console: ${text.slice(0, 200)}`);
  });
  page.on('pageerror', (e) => failures.push(`[${name}] pageerror: ${String(e).slice(0, 200)}`));
  page.on('response', (r) => {
    if (process.env.GB_E2E_DEBUG && /\/api\//.test(r.url())) console.log('  ', r.status(), r.request().method(), r.url());
    const limited = r.status() === 429 && r.url().endsWith('/api/auth/login'); // retried above
    if (r.status() >= 400 && !ctx.forcedReqs.has(r.request()) && !limited)
      failures.push(`[${name}] HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
  });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
    );
    const signedIn = () =>
      page
        .waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 })
        .then(() => true, () => false);
    if (!(await signedIn())) {
      await sleep(21000); // rate limited: the form stays up; try once more
      await page.evaluate(() =>
        [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
      );
      if (!(await signedIn())) throw new Error(`[${name}] sign-in failed`);
    }
    await sleep(1500);
  }
  return ctx;
}
const json = (status, body) => (req) =>
  req.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
const toasts = (page) =>
  page.$$eval('.gb-toast', (els) => els.map((e) => ({ cls: e.className, text: e.textContent })));
async function go(page, hash) {
  // A hash change alone keeps the screen's loaded data: reload for fresh state.
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2' });
  await page.reload({ waitUntil: 'networkidle2' });
  // Other pages share this Chrome: a background tab's rAF and timers stall.
  await page.bringToFront();
  await sleep(1200);
}
async function clickText(page, sel, re) {
  const ok = await page.evaluate(
    (sel, src) => {
      const el = [...document.querySelectorAll(sel)].find((b) => new RegExp(src).test(b.textContent || ''));
      if (el) el.click();
      return !!el;
    },
    sel,
    re.source
  );
  if (!ok) throw new Error(`no ${sel} matching ${re}`);
}

/* FN-16 + FN-17: one Quick add expense, its ledger write refused with a 429. */
async function quickAddExpense(ctx) {
  const { page, name } = ctx;
  const before = await call('/api/money');
  const lastId = before.settings && before.settings.lastAccountId;
  const note = 'e2e fn17 coffee ' + name;
  let sent = null;
  ctx.force = [
    {
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/quick-add'),
      handle: json(200, { configured: true, intents: [{ type: 'expense', amount: 49.5, note }] }),
    },
    {
      match: (r) => r.method() === 'POST' && r.url().endsWith('/api/money/tx'),
      handle: (r) => {
        sent = JSON.parse(r.postData() || '{}');
        json(429, { message: 'Too many requests.' })(r);
      },
    },
  ];
  ctx.allowConsole = [/CRITICAL: saveMoney failed/]; // persistMoney logs the forced 429
  await go(page, 'home');
  await page.click('button[aria-label="Quick add"]');
  await page.waitForSelector('input[aria-label="Quick log in your own words"]', { visible: true });
  await page.type('input[aria-label="Quick log in your own words"]', 'spent 49.50 on coffee');
  await clickText(page, 'button', /^Log it$/);
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => /^Log them$/.test(b.textContent.trim())),
    { timeout: 8000 }
  );
  await clickText(page, 'button', /^Log them$/);
  await page.waitForSelector('.gb-toast', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/fn16-queued-toast-${name}.png` });
  const ts = await toasts(page);
  check(
    ts.some((t) => /is-info/.test(t.cls) && /Saved on this phone/.test(t.text)),
    `[${name}] FN-16 a 429 on the ledger says "Saved on this phone"`
  );
  check(!ts.some((t) => /not saved/i.test(t.text)), `[${name}] FN-16 no "not saved" error`);
  const up = sent && (sent.upserts || []).find((u) => u.note === note);
  check(!!up && up.amount === 49.5, `[${name}] FN-17 amount kept its paise (sent ${up && up.amount})`);
  check(
    !!up && !!lastId && up.accountId === lastId,
    `[${name}] FN-17 booked to the last-used account (${up && up.accountId})`
  );
  // The queue replays on the next boot; then take the expense off the account.
  ctx.force = [];
  ctx.allowConsole = [];
  await go(page, 'home');
  let landed = null;
  for (let i = 0; i < 20 && !landed; i++) {
    await sleep(500);
    landed = ((await call('/api/money')).expenses || []).find((x) => x.note === note);
  }
  check(!!landed && landed.amount === 49.5, `[${name}] FN-16 the queued expense landed once the server took it`);
  if (landed) await call('/api/money/tx', 'POST', { upserts: [], deletes: [landed.id] });
}

/* FN-18: tick A, then B; A's save fails after B's landed. */
async function agreement(ctx) {
  const { page, name } = ctx;
  const link = (await call('/api/mentorship/requests/outgoing')).find((r) => r.status === 'accepted');
  if (!link) return check(false, `[${name}] FN-18 needs an accepted mentorship link`);
  const original = link.agreement || null;
  await call(`/api/mentorship/${link.id}/agreement`, 'PUT', { text: '[ ] e2e A\n[ ] e2e B' });
  try {
    let n = 0;
    ctx.force = [
      {
        match: (r) => r.method() === 'PUT' && r.url().endsWith(`/api/mentorship/${link.id}/agreement`) && n++ === 0,
        handle: (r) => setTimeout(() => json(500, {})(r), 1500),
      },
    ];
    await go(page, 'circle');
    const tick = (text) =>
      page.evaluate((text) => {
        const li = [...document.querySelectorAll('.gb-agree-item')].find(
          (x) => x.querySelector('.gb-agree-text').textContent === text
        );
        li.querySelector('.gb-check').scrollIntoView({ block: 'center' });
        li.querySelector('.gb-check').click();
      }, text);
    await page.waitForSelector('.gb-agree-item', { timeout: 10000 });
    await tick('e2e A');
    await sleep(700); // Check hands over after its 400ms pop: the first PUT is out
    await tick('e2e B');
    await sleep(2500);
    await page.screenshot({ path: `${OUT}/fn18-agreement-${name}.png` });
    const shown = await page.$$eval('.gb-agree-item', (els) =>
      els.map((e) => e.querySelector('.gb-agree-text').textContent + ':' + e.classList.contains('is-done'))
    );
    check(
      shown.includes('e2e A:true') && shown.includes('e2e B:true'),
      `[${name}] FN-18 both ticks still shown (${shown.join(', ')})`
    );
    const server = (await call('/api/mentorship/requests/outgoing')).find((r) => r.id === link.id);
    check(server.agreement === '[x] e2e A\n[x] e2e B', `[${name}] FN-18 server holds both ticks`);
    check(
      !(await toasts(page)).some((t) => /is-error/.test(t.cls)),
      `[${name}] FN-18 no error for the superseded save`
    );
  } finally {
    ctx.force = [];
    await call(`/api/mentorship/${link.id}/agreement`, 'PUT', { text: original });
  }
}

/* FN-19: a full first page of posts, then "Load older" fails. */
async function loadOlder(ctx) {
  const { page, name } = ctx;
  const circle = (await call('/api/circles/mine'))[0];
  if (!circle) return check(false, `[${name}] FN-19 needs a circle`);
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  const fake = Array.from({ length: 50 }, (_, i) => ({
    id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'),
    userId: 'e2e-other',
    authorName: 'E2E member',
    body: 'e2e post ' + i,
    createdAt: new Date(t0 - i * 60000).toISOString(),
    kudos: 0,
    reacted: false,
    comments: 0,
  }));
  const posts = `/api/circles/${circle.id}/posts`;
  ctx.force = [
    {
      match: (r) => r.method() === 'GET' && new URL(r.url()).pathname === posts && !r.url().includes('before='),
      handle: json(200, fake),
    },
    {
      match: (r) => r.method() === 'GET' && new URL(r.url()).pathname === posts && r.url().includes('before='),
      handle: json(500, {}),
    },
  ];
  await go(page, 'circle');
  await page.waitForFunction(() => document.querySelectorAll('.gb-circle-post').length >= 50, { timeout: 10000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Load older');
    b.scrollIntoView({ block: 'center' });
    b.click();
  });
  await page.waitForSelector('.gb-toast.is-error', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/fn19-load-older-${name}.png` });
  const n = await page.$$eval('.gb-circle-post', (els) => els.length);
  check(n === 50, `[${name}] FN-19 the 50 posts stay after "Load older" fails (${n})`);
  const older = await page.evaluate(
    () => !![...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Load older' && !x.hidden)
  );
  check(older, `[${name}] FN-19 "Load older" is still there to retry`);
  ctx.force = [];
}

/* FN-20 and FN-21, on the Family tab. */
async function family(ctx) {
  const { page, name } = ctx;
  const fam = await call('/api/family');
  const other = fam.members.find((m) => !m.isSelf);
  const title = 'e2e fn20 chore ' + name;
  const chores = await call('/api/family/chores', 'POST', { title, assigneeMemberId: null, dueDate: null, repeat: 'none' });
  const chore = chores.find((c) => c.title === title);
  const milk = 'e2e Milk ' + name;
  const made = [];
  try {
    // FN-20: the reassign PUT is refused.
    ctx.force = [
      {
        match: (r) => r.method() === 'PUT' && r.url().endsWith('/api/family/chores/' + chore.id),
        handle: json(403, { message: 'Only the family owner can do that.' }),
      },
    ];
    await go(page, 'family');
    await clickText(page, '.gb-family-sectiontab', /Chores/);
    await sleep(800);
    const sel = `select[aria-label="Assign ${title}"]`;
    await page.waitForSelector(sel, { timeout: 8000 });
    await page.$eval(sel, (s) => s.scrollIntoView({ block: 'center' }));
    await page.select(sel, other.id);
    await page.waitForFunction(() => document.querySelector('.gb-toast.is-error'), { timeout: 8000 });
    await sleep(300);
    await page.screenshot({ path: `${OUT}/fn20-reassign-${name}.png` });
    check((await page.$eval(sel, (s) => s.value)) === '', `[${name}] FN-20 the select is back on "Anyone"`);
    ctx.force = [];

    // FN-21: two unticked rows and a ticked one, all the same name.
    for (let i = 0; i < 3; i++) {
      const res = await call('/api/family/shopping', 'POST', { name: milk });
      made.push(res.items.find((x) => x.name === milk && !made.includes(x.id)).id);
      await sleep(20);
    }
    await call(`/api/family/shopping/${made[2]}/toggle`, 'POST', { checked: true });
    await go(page, 'family');
    await clickText(page, '.gb-family-sectiontab', /Shopping/);
    await sleep(800);
    await page.evaluate((milk) => {
      const row = [...document.querySelectorAll('.gb-family-shop-item.is-checked')].find(
        (r) => r.querySelector('.gb-family-card-name').textContent === milk
      );
      row.scrollIntoView({ block: 'center' });
      row.querySelector('button[aria-label="Remove"]').click();
    }, milk);
    await page.waitForSelector('.gb-toast-action', { timeout: 8000 });
    await clickText(page, '.gb-toast-action', /Undo/);
    let list = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      list = (await call('/api/family/shopping')).items.filter((x) => x.name === milk);
      if (list.length === 3 && list.some((x) => x.checked)) break;
    }
    await page.screenshot({ path: `${OUT}/fn21-shopping-undo-${name}.png` });
    const ticked = list.filter((x) => x.checked);
    check(
      list.length === 3 && ticked.length === 1 && !made.slice(0, 2).includes(ticked[0].id),
      `[${name}] FN-21 Undo ticked the restored row, the two older ones stay unticked`
    );
    list.forEach((x) => made.includes(x.id) || made.push(x.id));
  } finally {
    ctx.force = [];
    for (const id of made) await call('/api/family/shopping/' + id, 'DELETE').catch(() => {});
    if (chore) await call('/api/family/chores/' + chore.id, 'DELETE');
  }
}

const VIEWPORTS_ALL = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
const VIEWPORTS = Object.fromEntries(
  Object.entries(VIEWPORTS_ALL).filter(([k]) => !process.env.GB_E2E_VP || process.env.GB_E2E_VP === k)
);
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await openPage(name, vp);
  try {
    const only = (process.env.GB_E2E_ONLY || '').split(',').filter(Boolean);
    for (const step of [quickAddExpense, agreement, loadOlder, family]) {
      if (only.length && !only.includes(step.name)) continue;
      try {
        await step(ctx);
      } catch (e) {
        failures.push(`[${name}] ${step.name}: ${String(e && e.message).slice(0, 200)}`);
        await ctx.page.screenshot({ path: `${OUT}/error-${step.name}-${name}.png` }).catch(() => {});
      }
    }
  } finally {
    await ctx.context.close();
  }
}
// A step that failed midway may have left its Quick add expense behind.
const strays = ((await call('/api/money')).expenses || []).filter((x) => /^e2e fn17 coffee/.test(x.note || ''));
if (strays.length) await call('/api/money/tx', 'POST', { upserts: [], deletes: strays.map((x) => x.id) });
browser.disconnect();

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nfunctional-low.e2e: all passed');
