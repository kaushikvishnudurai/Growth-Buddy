/* =====================================================================
   Growth Buddy — accessibility e2e

   No axe-core: Chrome's own accessibility tree (CDP Accessibility.getFullAXTree)
   is what a screen reader reads, so names are asserted on that. Checks, at 390
   and 1280 wide:
     - <html lang> is 'en' (only the English catalog ships; i18n.js pageLang)
     - every visible control on Home, Money, Calendar, Notes, Family, Circle,
       each Settings tab and every dialog ui-audit opens has a non-empty name
     - heading levels never skip (one h1, then h2, h3 ...)
     - both tab bars follow ArrowRight/ArrowLeft/Home/End (gb-kit rovingGroup)
     - the bell's name carries the unread count shown on its badge
     - a keyboard-only pass (Tab through Home, Settings, Money; Shift+Tab back
       up Money under its sticky tab bar) never lands focus under a sticky bar
     - zero console errors, zero HTTP 4xx/5xx

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9223)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)
     GB_E2E_SHOTS (screenshot dir; none when unset)
   ===================================================================== */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const SCREENS = ['home', 'money', 'calendar', 'notes', 'family', 'circle'];
const VIEWPORTS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
};
// Roles a user operates; each must have a name.
const CONTROL_ROLES = new Set([
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'slider',
  'spinbutton',
  'link',
  'menuitem',
  'listbox',
  'ComboBoxSelect',
  'ComboBoxMenuButton',
]);

const problems = [];
const fail = (msg) => problems.push(msg);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
// Its own context: cookies are per host, so a tab of another run on localhost
// signing out would otherwise sign this one out mid-pass.
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
const cdp = await page.createCDPSession();
let where = 'boot';
page.on('console', (m) => {
  if (m.type() === 'error') fail(`[${where}] console: ${m.text().slice(0, 200)}`);
});
page.on('dialog', (d) => {
  // beforeunload is the app guarding a draft; accept it or the reload hangs.
  if (d.type() === 'beforeunload') return d.accept().catch(() => {});
  fail(`[${where}] native ${d.type()} dialog: ${d.message().slice(0, 120)}`);
  d.dismiss().catch(() => {});
});
const log = (...a) => process.env.GB_E2E_VERBOSE && console.log('..', where, ...a);
page.on('pageerror', (e) => fail(`[${where}] pageerror: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  if (r.status() >= 400)
    fail(`[${where}] HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});

async function shot(name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Unnamed controls inside `scopeSel` (the whole page by default), by the AX tree. */
async function unnamedControls(scopeSel) {
  // Tag the scope's controls in the DOM, then match AX nodes back by backendDOMNodeId.
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const doc = await cdp.send('DOM.getDocument', { depth: 0 });
  let inScope = null;
  if (scopeSel) {
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: scopeSel,
    });
    if (!nodeId) return [`scope ${scopeSel} not found`];
    const { node } = await cdp.send('DOM.describeNode', { nodeId, depth: -1 });
    inScope = new Set();
    const walk = (n) => {
      inScope.add(n.backendNodeId);
      (n.children || []).forEach(walk);
      (n.shadowRoots || []).forEach(walk);
    };
    walk(node);
  }
  const bad = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role && n.role.value;
    if (!CONTROL_ROLES.has(role)) continue;
    if (inScope && !inScope.has(n.backendDOMNodeId)) continue;
    const name = ((n.name && n.name.value) || '').trim();
    if (name) continue;
    const desc = await describe(n.backendDOMNodeId);
    if (desc) bad.push(`${role}: ${desc}`);
  }
  return bad;
}
/** The element's markup when it is actually rendered, else null. */
async function describe(backendNodeId) {
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
    const { result } = await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        if (!this.getClientRects || !this.getClientRects().length) return null;
        if (getComputedStyle(this).visibility === 'hidden') return null;
        return this.outerHTML.slice(0, 160);
      }`,
    });
    return result.value;
  } catch {
    return null;
  }
}

/** Visible heading levels in document order inside `scopeSel`; reports skips. */
async function headingSkips(scopeSel, label) {
  const levels = await page.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return [];
    return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')]
      .filter((el) => el.getClientRects().length && !el.closest('[aria-hidden=true]'))
      .map((el) => ({
        level: Number(el.getAttribute('aria-level')) || Number(el.tagName.slice(1)) || 2,
        text: (el.textContent || '').trim().slice(0, 40),
      }));
  }, scopeSel || null);
  const out = [];
  let prev = scopeSel ? levels[0] && levels[0].level - 1 : 0;
  for (const h of levels) {
    if (h.level > prev + 1) out.push(`${label}: h${h.level} "${h.text}" after h${prev}`);
    prev = h.level;
  }
  if (!scopeSel && levels.filter((h) => h.level === 1).length !== 1)
    out.push(`${label}: ${levels.filter((h) => h.level === 1).length} h1s`);
  return { out, levels };
}

async function signIn() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type=email], #gb-main', { timeout: 30000 });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    // The local auth rate limit answers 429 now and then; one retry after it clears.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = page.waitForResponse((r) => r.url().includes('/api/auth/login'), {
        timeout: 20000,
      });
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find((b) => /sign in/i.test(b.textContent || ''))
          ?.click()
      );
      if ((await res).status() !== 429) break;
      problems.pop(); // the 429 the response hook just logged
      await pause(21000);
    }
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
      timeout: 20000,
    });
    await pause(1500);
  }
}

async function go(screen) {
  if (process.env.GB_E2E_VERBOSE) console.log('..', where, screen);
  // A hash change, not page.goto: goto's same-document navigation raced the
  // history.back() a closing sheet queues and never settled.
  await page.evaluate((sc) => (location.hash = sc), screen);
  await page.waitForSelector('#gb-main', { timeout: 30000 });
  await pause(1500);
}

const clickText = (re, scope) =>
  page.evaluate(
    (src, sc) => {
      const rx = new RegExp(src, 'i');
      const root = (sc && document.querySelector(sc)) || document;
      const el = [...root.querySelectorAll('button, [role=button], [role=tab]')].find(
        (b) =>
          rx.test((b.textContent || b.getAttribute('aria-label') || '').trim()) &&
          b.getClientRects().length
      );
      if (!el) return false;
      el.click();
      return true;
    },
    re.source,
    scope || null
  );

async function openSettings() {
  // el.click(), not page.click(): a trusted mouse event stalled here after a long Tab pass.
  await page.evaluate(() => document.querySelector('.gb-avatar').click());
  await pause(400);
  if (!(await clickText(/^settings$/i, '.gb-profile-pop'))) return false;
  await page.waitForSelector('.gb-modal [role=tablist]', { timeout: 5000 });
  await pause(500);
  return true;
}
async function closeDialogs() {
  for (let i = 0; i < 3 && (await page.$('.gb-modal-overlay')); i++) {
    await page.keyboard.press('Escape');
    await pause(450);
  }
}

/** Arrow/Home/End on a tablist: focus moves and selection follows. */
async function checkTablist(sel, label) {
  const state = () =>
    page.evaluate((s) => {
      const tabs = [...document.querySelectorAll(s + ' [role=tab]')];
      return {
        n: tabs.length,
        selected: tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'),
        focused: tabs.indexOf(document.activeElement),
        stops: tabs.filter((t) => t.tabIndex === 0).length,
        controls: tabs.every(
          (t) =>
            t.getAttribute('aria-selected') !== 'true' ||
            document.getElementById(t.getAttribute('aria-controls'))
        ),
        labelled: [...document.querySelectorAll('[role=tabpanel]')]
          .filter((p) => p.getClientRects().length)
          .every((p) => {
            const t = document.getElementById(p.getAttribute('aria-labelledby'));
            return t && t.getAttribute('aria-selected') === 'true';
          }),
      };
    }, sel);
  await page.evaluate(
    (s) => document.querySelector(s + ' [role=tab][aria-selected=true]').focus(),
    sel
  );
  let st = await state();
  if (st.stops !== 1) fail(`${label}: ${st.stops} Tab stops in the tablist, want 1`);
  if (!st.controls) fail(`${label}: selected tab's aria-controls names no element`);
  if (!st.labelled) fail(`${label}: visible tabpanel not labelled by the selected tab`);
  const start = st.selected;
  const expect = async (key, want) => {
    await page.keyboard.press(key);
    await pause(350);
    st = await state();
    if (st.selected !== want || st.focused !== want)
      fail(`${label}: ${key} -> selected ${st.selected}, focused ${st.focused}, want ${want}`);
  };
  await expect('ArrowRight', (start + 1) % st.n);
  await expect('ArrowLeft', start);
  await expect('End', st.n - 1);
  await expect('Home', 0);
}

/** Tab (or Shift+Tab) `n` times; every focused control must be visible and on top. */
async function keyboardPass(label, n, shift) {
  const hidden = [];
  for (let i = 0; i < n; i++) {
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    if (shift) await page.keyboard.up('Shift');
    await pause(120);
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return null; // sr-only or a 0-size sentinel
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
      const what = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${name}"`;
      if (b.bottom <= 0 || b.top >= window.innerHeight) return what + ' off-screen';
      // Every sticky/fixed bar that is not the focused control's own container
      // (a control inside the bar, or inside a fixed dialog, is not under it).
      for (const bar of document.querySelectorAll('body *')) {
        const pos = getComputedStyle(bar).position;
        if (pos !== 'sticky' && pos !== 'fixed') continue;
        if (bar.contains(el) || el.contains(bar)) continue;
        const r = bar.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || getComputedStyle(bar).visibility === 'hidden') continue;
        const ox = Math.min(b.right, r.right) - Math.max(b.left, r.left);
        const oy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
        // Fixed layers that only paint above when open (toasts, sheets) are
        // skipped by being empty; a real overlap is more than a hairline.
        if (ox > 2 && oy > 2)
          return `${what} under ${bar.tagName.toLowerCase()}.${String(bar.className).split(' ')[0]} (${Math.round(oy)}px)`;
      }
      return null;
    });
    if (r) hidden.push(r);
  }
  if (hidden.length)
    fail(
      `${label}: focus obscured ${hidden.length}x: ${[...new Set(hidden)].slice(0, 4).join(' | ')}`
    );
}

// The dialogs ui-audit opens, same triggers.
const DIALOGS = [
  ['quick add', 'home', () => clickText(/^quick add$/i)],
  ['add food', 'food', () => clickText(/log food|add food/i)],
  ['custom water', 'food', () => clickText(/^custom/i)],
  ['new goal', 'goals', () => clickText(/new goal|add goal/i)],
  ['add expense', 'money', () => clickText(/add expense/i)],
  ['custom focus minutes', 'focus', () => clickText(/^custom/i)],
  ['find someone', 'circle', () => clickText(/find someone|find people/i)],
  [
    'note sheet',
    'notes',
    () =>
      page.evaluate(() => {
        const card = [...document.querySelectorAll('.gb-note-card')].find((el) => el.offsetParent);
        if (!card) return false;
        card.click();
        return true;
      }),
  ],
];

try {
  await signIn();
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewport(vp);
    // An isMobile switch reloads the page; wait for the app to come back.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#gb-main', { timeout: 30000 });
    for (const screen of SCREENS) {
      where = `${vpName}/${screen}`;
      await go(screen);
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== 'en') fail(`[${where}] html lang is "${lang}", want "en"`);
      (await unnamedControls()).forEach((b) => fail(`[${where}] unnamed ${b}`));
      (await headingSkips(null, `[${where}]`)).out.forEach(fail);
      await shot(`${screen}-${vpName}`);
    }

    // Bell: the count on the badge is in the name.
    where = `${vpName}/bell`;
    await go('home');
    const bell = await page.evaluate(() => {
      const b = document.querySelector('.gb-bell');
      const badge = b && b.querySelector('.gb-bell-badge');
      return b && { label: b.getAttribute('aria-label'), count: badge ? badge.textContent : '' };
    });
    if (!bell) fail(`[${where}] no bell`);
    else if (
      bell.count ? !bell.label.includes(bell.count + ' unread') : bell.label !== 'Notifications'
    )
      fail(`[${where}] bell named "${bell.label}" with badge "${bell.count}"`);

    // Keyboard-only pass on Home: start at the top of the document.
    where = `${vpName}/home-keys`;
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await keyboardPass(`[${where}]`, 40);

    // Settings: every tab's names and headings, the tablist keyboard, then a Tab pass.
    where = `${vpName}/settings`;
    await go('home');
    if (!(await openSettings())) fail(`[${where}] could not open Settings`);
    else {
      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll('.gb-modal [role=tab]')].map((t) => t.id)
      );
      for (const id of tabs) {
        log('tab', id);
        await page.evaluate((i) => document.getElementById(i).click(), id);
        await pause(350);
        (await unnamedControls('.gb-modal')).forEach((b) => fail(`[${where}/${id}] unnamed ${b}`));
        (await headingSkips('.gb-modal', `[${where}/${id}]`)).out.forEach(fail);
        await shot(`settings-${id.replace(/^gb-seg\d+-tab-/, '')}-${vpName}`);
      }
      log('tablist keys');
      await checkTablist('.gb-modal [role=tablist]', `[${where}] tablist`);
      await page.evaluate(() =>
        document.querySelector('.gb-modal [role=tab][aria-selected=true]').focus()
      );
      await keyboardPass(`[${where}-keys]`, 30);
      await closeDialogs();
    }

    // Money: its tab bar, and focus walking back up under the sticky bar.
    where = `${vpName}/money-keys`;
    await go('money');
    await checkTablist('.gb-money-tabs', `[${where}] tablist`);
    await page.evaluate(() => document.querySelector('.gb-money-tab').click());
    await pause(400);
    await keyboardPass(`[${where}] forward`, 35);
    await keyboardPass(`[${where}] back`, 30, true);

    // Dialogs: names and heading order inside each.
    for (const [label, screen, open] of DIALOGS) {
      where = `${vpName}/dialog ${label}`;
      await go(screen);
      if (!(await open())) {
        fail(`[${where}] could not open`);
        continue;
      }
      // A note sheet opens after GET /api/notes/:id (the list copy has no photos):
      // wait for the sheet itself, then its entrance.
      await page.waitForSelector('.gb-modal-overlay', { timeout: 10000 }).catch(() => {});
      await pause(650);
      (await unnamedControls('.gb-modal-overlay')).forEach((b) => fail(`[${where}] unnamed ${b}`));
      (await headingSkips('.gb-modal-overlay', `[${where}]`)).out.forEach(fail);
      await shot(`dialog-${label.replace(/\s+/g, '-')}-${vpName}`);
      await closeDialogs();
    }
  }
} finally {
  // A crashed run must not leave its page holding Chrome's connections to the app.
  await ctx.close().catch(() => {});
  await browser.disconnect();
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`a11y.e2e: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(
  `a11y.e2e: ${SCREENS.length} screens, Settings, money tabs, ${DIALOGS.length} dialogs x 2 viewports clean`
);
