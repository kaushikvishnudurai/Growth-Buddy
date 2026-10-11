/* =====================================================================
   e2e: the short flows from the UX friction audit, in Money, Notes, Family,
   Buddy and Circle (feat/ov-ux-modules). Each flow is tapped through, its
   requests must answer 2xx, its result must be on screen, and its tap count is
   asserted. Run at 390 and 1280 wide; any console error or 4xx/5xx fails.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD       the seeded QA account
     GB_E2E_PARTNER                       owns the throwaway circle (same password)
     GB_E2E_SHOTS                         screenshot folder (optional)

   Shared account: what this creates is removed again (expenses deleted, budgets
   put back as they were, the circle left and deleted). Family and Buddy are
   driven over intercepted reads, so no AI call is made and the real household
   is untouched; the writes Buddy's chips make are real and undone.
   ===================================================================== */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const PARTNER = process.env.GB_E2E_PARTNER || 'qa.partner.1791708603856@example.com';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (ok, msg) => {
  if (!ok) failures.push(msg);
  console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();

/* ---- API, for setup and cleanup only ---- */
async function login(email, retry = true) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  // The local auth limiter is shared by every run; it clears within ~20 s.
  if (r.status === 429 && retry) {
    await sleep(21000);
    return login(email, false);
  }
  if (!r.ok) throw new Error('login ' + email + ': ' + r.status);
  return (await r.json()).token;
}
async function call(token, path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(opts.method + ' ' + path + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const text = await r.text();
  return { body: text ? JSON.parse(text) : null, etag: r.headers.get('ETag') };
}
const token = await login(EMAIL);
const moneyDoc = async () => (await call(token, '/api/money')).body;
/* Budgets as they were just before a step, put back after it. Only that window:
   the account is shared, and a snapshot from the start of the run would undo a
   budget another run set since. */
async function budgetsNow() {
  const d = await moneyDoc();
  return { budgets: d.budgets || {}, rollover: d.rollover || {} };
}
async function putBudgets(budgets, rollover) {
  const { body, etag } = await call(token, '/api/money');
  const doc = { ...body, budgets, rollover };
  for (const k of ['expenses', 'income', 'transfers', 'accounts']) delete doc[k];
  await call(token, '/api/money', { method: 'PUT', body: JSON.stringify(doc), headers: { 'If-Match': etag } });
}
const deleteTx = (ids) =>
  ids.length && call(token, '/api/money/tx', { method: 'POST', body: JSON.stringify({ upserts: [], deletes: ids }) });

const start = await moneyDoc();
const BUDGETS = start.budgets || {};
const NOTE = 'e2e ux modules';
// The offer is for the 5th expense this month in a tag with no budget, so the tag
// must have none yet: the account is shared, and other runs log Food.
const month = today.slice(0, 7);
const TAG = [
  ['education', 'Education'],
  ['entertainment', 'Entertainment'],
  ['transport', 'Transport'],
  ['shopping', 'Shopping'],
  ['food', 'Food'],
].find(([k]) => !(Number(BUDGETS[k]) > 0) && !start.expenses.some((e) => e.category === k && e.date.startsWith(month)));
if (!TAG) throw new Error('every tag has a budget or spending this month; nothing to offer a budget on');
const [TAG_KEY, TAG_LABEL] = TAG;
const mine = (doc) => doc.expenses.filter((e) => e.note === NOTE).map((e) => e.id);

/* ---- the page ---- */
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so another tab on localhost signing out
// would otherwise sign this run out too.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
// A shared, windowed Chrome throttles background tabs: timers and focus stall.
await page.bringToFront();
const fakes = new Map(); // "METHOD path" -> body to answer with
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = new URL(req.url());
  const fake = fakes.get(req.method() + ' ' + u.pathname);
  if (fake !== undefined) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(fake) });
  else req.continue();
});
const seen = []; // [{method, path, status}] of /api calls
page.on('console', (m) => m.type() === 'error' && failures.push('console: ' + m.text().slice(0, 200)));
page.on('pageerror', (e) => failures.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/')) seen.push({ method: r.request().method(), path: u.pathname, status: r.status() });
  if (r.status() >= 400) failures.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + u.pathname);
});
const answered = (method, re, from) =>
  seen.slice(from).find((s) => s.method === method && re.test(s.path) && s.status < 300);
async function waitAnswered(method, re, from, ms = 8000) {
  for (let t = 0; t < ms; t += 100) {
    const hit = answered(method, re, from);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}

let taps = 0;
/* Tap the first visible element matching `sel` whose text matches `re`. */
async function tap(sel, re) {
  const handle = await page.waitForFunction(
    (s, src) => {
      const rx = src ? new RegExp(src, 'i') : null;
      return [...document.querySelectorAll(s)].find(
        (e) => e.offsetParent !== null && !e.disabled && (!rx || rx.test(e.textContent || ''))
      );
    },
    { timeout: 8000 },
    sel,
    re ? re.source : null
  ).catch(async (err) => {
    await shot('fail-tap');
    throw new Error('no ' + sel + ' ' + (re || '') + ' to tap: ' + err.message);
  });
  await handle.asElement().click();
  taps++;
  await sleep(250);
}
const visible = (sel, re) =>
  page.evaluate(
    (s, src) =>
      [...document.querySelectorAll(s)].some(
        (e) => e.offsetParent !== null && (!src || new RegExp(src, 'i').test(e.textContent || ''))
      ),
    sel,
    re ? re.source : null
  );
async function waitVisible(sel, re, ms = 8000) {
  for (let t = 0; t < ms; t += 100) {
    if (await visible(sel, re)) return true;
    await sleep(100);
  }
  return false;
}
let loads = 0;
async function go(hash) {
  // A fresh load every time (the query changes): a hash-only goto keeps the old state.
  await page.goto(BASE + '/?e2e=' + ++loads + '#' + hash, { waitUntil: 'networkidle2' });
  await sleep(900);
}
async function shot(name) {
  if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' });
}
async function typeInto(sel, text) {
  await page.waitForSelector(sel, { visible: true });
  await page.$eval(sel, (e) => (e.value = ''));
  await page.type(sel, text);
}

await page.goto(BASE, { waitUntil: 'networkidle2' });
if (await page.$('input[type=password]')) {
  await page.type('input[type=email]', EMAIL);
  await page.type('input[type=password]', PASSWORD);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
  );
  await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
  await sleep(1500);
}

const partnerToken = await login(PARTNER).catch(() => null);
let circleId = null;

try {
  for (const [vpName, vp] of [
    ['390', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { width: 1280, height: 800, deviceScaleFactor: 1 }],
  ]) {
    await page.setViewport(vp);
    console.log('--- ' + vpName);

    /* Money, next-step 4: four Food expenses this month, the 5th logged in two
       taps offers a budget; one more tap sets it. */
    const seeded = [1, 2, 3, 4].map((i) => ({
      kind: 'expense',
      id: 'e2eux' + vpName + i + Date.now().toString(36),
      amount: 400,
      category: TAG_KEY,
      note: NOTE,
      date: today,
      createdAt: Date.now() - i * 1000,
    }));
    await call(token, '/api/money/tx', { method: 'POST', body: JSON.stringify({ upserts: seeded, deletes: [] }) });
    await go('money');
    taps = 0;
    let from = seen.length;
    await tap('button', /^\s*Add expense\s*$/);
    await typeInto('.gb-modal input[inputmode=decimal]', '150');
    await typeInto('.gb-modal input[placeholder^="e.g. Lunch"]', NOTE);
    await tap('.gb-modal button', /^\s*Add expense\s*$/);
    check(taps === 2, `[${vpName}] 5th ${TAG_LABEL} expense logged in 2 taps (got ${taps})`);
    check(!!(await waitAnswered('POST', /^\/api\/money\/tx$/, from)), `[${vpName}] expense POST /api/money/tx 2xx`);
    check(await waitVisible('.gb-toast', new RegExp('Set ' + TAG_LABEL + ' to about')), `[${vpName}] toast offers a ${TAG_LABEL} budget`);
    await shot('money-budget-offer-' + vpName);
    from = seen.length;
    let was = await budgetsNow();
    await tap('.gb-toast-action', /Set budget/);
    check(!!(await waitAnswered('PUT', /^\/api\/money$/, from)), `[${vpName}] budget PUT /api/money 2xx`);
    const afterOffer = await moneyDoc();
    check(Number(afterOffer.budgets[TAG_KEY]) > 0, `[${vpName}] ${TAG_LABEL} budget saved (${afterOffer.budgets[TAG_KEY]})`);
    await putBudgets(was.budgets, was.rollover);

    /* Money F04: Set budgets opens on suggestions from the last 30 days; Save
       alone sets them. */
    await go('money');
    taps = 0;
    was = await budgetsNow();
    // The health card's "Set budgets" when none are set, else the budgets card's Edit.
    await page.waitForSelector('.gb-money-health-head, .gb-sectiontitle', { timeout: 8000 });
    const opener = await page.evaluateHandle(
      () =>
        [...document.querySelectorAll('button')].find((b) => /^\s*Set budgets\s*$/.test(b.textContent)) ||
        [...document.querySelectorAll('.gb-sectiontitle')]
          .find((t) => /Monthly budgets/.test(t.textContent))
          ?.parentElement.querySelector('button')
    );
    await opener.asElement().click();
    taps++;
    await page.waitForSelector('.gb-money-budget-field', { visible: true, timeout: 8000 });
    const food = await page.evaluate((label) => {
      const row = [...document.querySelectorAll('.gb-money-budget-field')].find((r) =>
        (r.querySelector('.gb-money-budget-field-label')?.textContent || '').startsWith(label)
      );
      return row && { value: row.querySelector('input[type=number]').value, marked: !!row.querySelector('.gb-money-budget-suggested') };
    }, TAG_LABEL);
    check(!!food && Number(food.value) > 0 && food.marked, `[${vpName}] ${TAG_LABEL} prefilled and marked suggested (${food && food.value})`);
    await shot('money-set-budgets-' + vpName);
    from = seen.length;
    await tap('.gb-modal button', /^\s*Save budgets\s*$/);
    check(taps === 2, `[${vpName}] budgets set in 2 taps, 0 fields (got ${taps})`);
    check(!!(await waitAnswered('PUT', /^\/api\/money$/, from)), `[${vpName}] budgets PUT /api/money 2xx`);
    check(Number((await moneyDoc()).budgets[TAG_KEY]) === Number(food && food.value), `[${vpName}] suggested ${TAG_LABEL} budget saved`);
    await putBudgets(was.budgets, was.rollover);

    /* Money F11: a big buy offers Reflect on the toast; nothing opens by itself. */
    await go('money');
    taps = 0;
    from = seen.length;
    await tap('button', /^\s*Add expense\s*$/);
    await typeInto('.gb-modal input[inputmode=decimal]', '1500');
    await typeInto('.gb-modal input[placeholder^="e.g. Lunch"]', NOTE);
    await tap('.gb-modal button', /^\s*Add expense\s*$/);
    check(!!(await waitAnswered('POST', /^\/api\/money\/tx$/, from)), `[${vpName}] big expense saved`);
    await sleep(600);
    check(!(await visible('.gb-modal', /Quick reflection/)), `[${vpName}] no reflection sheet opened by itself`);
    check(await visible('.gb-toast-action', /Reflect/), `[${vpName}] toast carries Reflect`);
    check(taps === 2, `[${vpName}] big expense logged in 2 taps (got ${taps})`);
    await shot('money-reflect-toast-' + vpName);
    await tap('.gb-toast-action', /Reflect/);
    check(await waitVisible('.gb-modal', /Quick reflection/), `[${vpName}] Reflect opens the sheet`);
    await page.keyboard.press('Escape');
    await sleep(400);
    await deleteTx(mine(await moneyDoc()));

    /* Notes F09: + then Note lands in a focused composer. */
    await go('home');
    taps = 0;
    await tap('button[aria-label="Quick add"]');
    await tap('.gb-modal button', /Jot something down/);
    // Polled by hand: the screen change can swap the document under a waitForFunction.
    let focused = false;
    for (let t = 0; t < 80 && !focused; t++) {
      focused = await page
        .evaluate(() => {
          const c = document.querySelector('.gb-note-composer');
          return !!c && c.classList.contains('is-open') && c.contains(document.activeElement);
        })
        .catch(() => false);
      if (!focused) await sleep(100);
    }
    check(focused, `[${vpName}] Notes composer open and focused`);
    check(taps === 2, `[${vpName}] + Note to typing in 2 taps (got ${taps})`);
    await shot('notes-compose-' + vpName);

    /* Family F15 + F14: no household yet; "Plan meals for just me" lands on the
       planner, which names what the pantry will give it. Reads are faked (no
       new family, no AI); the POST's answer is the real household. */
    const realFamily = (await call(token, '/api/family')).body;
    const pantry = (await call(token, '/api/family/pantry')).body || [];
    fakes.set('GET /api/family', { familyId: null, ownerUserId: null, isOwner: false, members: [] });
    fakes.set('GET /api/family/meal-plan', null);
    fakes.set('POST /api/family/solo', realFamily);
    await go('family');
    taps = 0;
    from = seen.length;
    check(await waitVisible('button', /Plan meals for just me/), `[${vpName}] Family empty state offers "just me"`);
    await shot('family-empty-' + vpName);
    await tap('button', /Plan meals for just me/);
    check(taps === 1, `[${vpName}] solo planner in 1 tap (got ${taps})`);
    check(await waitVisible('h2', /Today's meal plan/), `[${vpName}] lands on Today's meal plan`);
    const stock = pantry.filter((p) => !p.expired);
    if (stock.length)
      check(await visible('.gb-family-empty-note', /Planning from your pantry/), `[${vpName}] planner names the pantry`);
    await shot('family-solo-plan-' + vpName);
    fakes.clear();

    /* Buddy F19: a task or habit chip saves on the tap with Undo; a reminder
       chip still opens its sheet. The thread read is faked to carry the chips. */
    const chat = (await call(token, '/api/mentor/chat')).body;
    const tag = vpName + Date.now().toString(36);
    const fakeThread = {
      threadId: chat.threadId,
      messages: [
        { id: 'e2e-u', role: 'user', content: 'Help me start', createdAt: new Date().toISOString(), actions: [] },
        {
          id: 'e2e-a',
          role: 'assistant',
          content: 'Here are three small steps.',
          createdAt: new Date().toISOString(),
          actions: [
            { type: 'task', title: 'E2E chip task ' + tag },
            { type: 'habit', title: 'E2E chip habit ' + tag },
            { type: 'reminder', title: 'E2E chip reminder ' + tag, time: '21:00' },
          ],
        },
      ],
    };
    // Both reads: a repaint (an Undo re-renders) reloads the open thread by id.
    fakes.set('GET /api/mentor/chat', fakeThread);
    fakes.set('GET /api/mentor/threads/' + chat.threadId + '/messages', fakeThread.messages);
    await go('mentor');
    for (const [label, kind, re] of [
      ['Add as task', 'task', /^\/api\/tasks$/],
      ['Make it a habit', 'habit', /^\/api\/habits$/],
    ]) {
      taps = 0;
      from = seen.length;
      await tap('.gb-msg-action', new RegExp(label));
      check(taps === 1, `[${vpName}] ${kind} chip: 1 tap`);
      check(!!(await waitAnswered('POST', re, from)), `[${vpName}] ${kind} chip POST 2xx`);
      check(await waitVisible('.gb-toast-action', /Undo/), `[${vpName}] ${kind} toast offers Undo`);
      if (kind === 'task') await shot('buddy-chip-undo-' + vpName);
      from = seen.length;
      await tap('.gb-toast-action', /Undo/);
      check(!!(await waitAnswered('DELETE', new RegExp(re.source.slice(0, -1) + '/'), from)), `[${vpName}] ${kind} Undo DELETE 2xx`);
    }
    await tap('.gb-msg-action', /Remind me/);
    check(await waitVisible('.gb-modal button', /Add reminder/), `[${vpName}] reminder chip still opens its sheet`);
    await page.keyboard.press('Escape');
    await sleep(300);
    fakes.clear();

    /* Circle, next-step 5: join from Browse, land on the card, start its first
       template in one tap. The circle is a throwaway the partner owns. */
    if (!partnerToken) {
      check(false, `[${vpName}] partner account ${PARTNER} could not sign in`);
    } else {
      const name = 'E2E join ' + tag;
      circleId = (await call(partnerToken, '/api/circles', { method: 'POST', body: JSON.stringify({ name, visibility: 'public' }) })).body.id;
      await go('circle');
      taps = 0;
      await tap('button[aria-label="Browse circles"]');
      from = seen.length;
      await page.waitForFunction((n) => [...document.querySelectorAll('.gb-browse-row')].some((r) => r.textContent.includes(n)), { timeout: 8000 }, name);
      const joinBtn = await page.evaluateHandle(
        (n) => [...document.querySelectorAll('.gb-browse-row')].find((r) => r.textContent.includes(n)).querySelector('button'),
        name
      );
      await joinBtn.asElement().click();
      taps++;
      check(!!(await waitAnswered('POST', /\/join$/, from)), `[${vpName}] join POST 2xx`);
      const sel = '[data-circle-id="' + circleId + '"] .gb-challenge-offer button';
      await page.waitForSelector(sel, { visible: true, timeout: 8000 }).catch(() => null);
      await sleep(1300); // the sheet's focus hand-back, then the smooth scroll
      const inView = await page.evaluate((id) => {
        const card = document.querySelector('[data-circle-id="' + id + '"]');
        if (!card) return false;
        const r = card.getBoundingClientRect();
        return r.top >= -2 && r.top < window.innerHeight * 0.6;
      }, circleId);
      check(inView, `[${vpName}] the joined card is scrolled into view`);
      check(!(await visible('.gb-modal', /Browse circles/)), `[${vpName}] Browse sheet closed on join`);
      await shot('circle-joined-' + vpName);
      from = seen.length;
      await tap(sel, /Start/);
      check(taps === 3, `[${vpName}] Browse to a running challenge in 3 taps (got ${taps})`);
      check(!!(await waitAnswered('POST', /\/challenges$/, from)), `[${vpName}] challenge POST 2xx`);
      check(
        await waitVisible('[data-circle-id="' + circleId + '"] .gb-challenge-title', /7-day habit sprint/),
        `[${vpName}] the challenge shows on the card`
      );
      await shot('circle-challenge-' + vpName);
      await call(token, '/api/circles/' + circleId + '/leave', { method: 'POST' });
      await call(partnerToken, '/api/circles/' + circleId, { method: 'DELETE' });
      circleId = null;
    }
  }

  /* Money F08: an account with no stored currency, on an en-GB phone in London,
     shows pounds. Read faked; nothing is saved. */
  const emptyDoc = { settings: { reflectThreshold: 1000 }, expenses: [], income: [], transfers: [], accounts: [], budgets: {} };
  fakes.set('GET /api/money', emptyDoc);
  await page.emulateTimezone('Europe/London');
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'language', { get: () => 'en-GB' }));
  await go('money');
  check(await waitVisible('#gb-main', /£/), 'no stored currency + en-GB device: Money shows £');
  await shot('money-currency-gb');
  fakes.clear();
  await go('money'); // the real document back in this browser's copy
} finally {
  await moneyDoc()
    .then((d) => deleteTx(mine(d)))
    .catch((e) => failures.push('cleanup expenses: ' + e.message));
  // A step that failed between setting the tag's budget and putting it back.
  await budgetsNow()
    .then(({ budgets, rollover }) => {
      if (!(Number(budgets[TAG_KEY]) > 0)) return;
      const rest = { ...budgets };
      delete rest[TAG_KEY];
      return putBudgets(rest, rollover);
    })
    .catch((e) => failures.push('cleanup budgets: ' + e.message));
  if (circleId) {
    await call(token, '/api/circles/' + circleId + '/leave', { method: 'POST' }).catch(() => {});
    if (partnerToken) await call(partnerToken, '/api/circles/' + circleId, { method: 'DELETE' }).catch(() => {});
  }
  await ctx.close();
  browser.disconnect();
}

const end = await moneyDoc();
check(!(Number((end.budgets || {})[TAG_KEY]) > 0), 'the ' + TAG_LABEL + ' budget this run set is gone again');
check(!end.expenses.some((e) => e.note === NOTE), 'test expenses removed');

if (failures.length) {
  console.error('\n' + failures.length + ' failure(s):\n' + failures.join('\n'));
  process.exit(1);
}
console.log('\nux-modules e2e: all passed');
