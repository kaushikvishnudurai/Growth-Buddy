// Performance fixes (docs/audit/performance.md, PRF-*). Each test fails on the code before its fix.
import { test, expect, signInFast } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const API = process.env.GB_API || 'http://localhost:8591';
const shot = (page, id) =>
  page.screenshot({ path: `docs/evidence/perf/${id}.jpg`, type: 'jpeg', quality: 70 });
// The boot module: /scripts/app.js on the dev server, assets/index-<hash>.js in a build.
const ENTRY = /\/(scripts\/app\.js|assets\/index-[\w-]+\.js)(\?.*)?$/;

async function call(path, token, method = 'POST', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  expect(r.status, `${method} ${path}`).toBeLessThan(300);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function holdEntry(page) {
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(ENTRY, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

test('PRF-1: a cheer from another account reaches the bell over a plain WebSocket', async ({ page, account }, info) => {
  const connected = new Promise((resolve) => {
    page.on('websocket', (ws) =>
      ws.on('framereceived', (f) => {
        if (String(f.payload).startsWith('CONNECTED')) resolve(ws.url());
      })
    );
  });
  const sockjsInfo = [];
  page.on('request', (r) => {
    if (/\/ws\/info/.test(r.url())) sockjsInfo.push(r.url());
  });
  await signInFast(page, account);
  // A raw STOMP frame on the socket at /ws itself: no SockJS framing (a["CONNECTED..."]), no session path.
  const url = await connected;
  expect(new URL(url).pathname).toBe('/ws');
  expect(sockjsInfo).toEqual([]);
  expect(await page.evaluate(() => 'global' in window)).toBe(false);

  const badge = page.locator('.gb-bell .gb-bell-badge');
  const before = (await badge.count()) ? Number(await badge.textContent()) : 0;
  const other = await seedAccount({ seed: false });
  const circle = await call('/api/circles', account.token, 'POST', { name: 'Perf circle ' + Date.now() });
  await call(`/api/circles/${circle.id}/join`, other.token);
  await call(`/api/circles/${circle.id}/members/${account.user.id}/cheer`, other.token);
  await expect(badge).toHaveText(String(before + 1), { timeout: 15_000 });
  if (info.project.name.startsWith('mobile')) await shot(page, 'PRF-1');
});

test('PRF-2: a first visit paints the sign-up card from index.html before the app module runs', async ({ page }, info) => {
  const release = await holdEntry(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('.gb-login-title')).toHaveText('Create your account');
  await expect(page.locator('main')).toHaveCount(1);
  if (info.project.name.startsWith('mobile')) await shot(page, 'PRF-2');
  const look = () =>
    page.evaluate(async () => {
      await document.fonts.ready; // a face swapping in between would move the text, not the swap
      document.activeElement.blur(); // the app focuses the email field; the card styles :focus-within
      const card = document.querySelector('.gb-login-card');
      const r = (sel) => {
        const b = (sel ? card.querySelector(sel) : card).getBoundingClientRect();
        return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
      };
      return { text: card.innerText, title: r('.gb-login-title'), button: r('.gb-login-btn'), card: r() };
    });
  const shell = await look();
  release();
  // The app's own card replaces the shell, once, without replaying its entrance.
  await expect(page.locator('[data-gb-shell]')).toHaveCount(0);
  await expect(page.locator('.gb-login-card')).toHaveCount(1);
  await expect(page.locator('.gb-login-card.gb-rise, .gb-garden.is-growing')).toHaveCount(0);
  await expect(page.locator('input[type=email]')).toBeEditable();
  await expect(page.locator('main')).toHaveCount(1);
  // Same words in the same places: the swap moves nothing (index.html is a copy of viewSignup).
  expect(await look()).toEqual(shell);
});

test('PRF-2: a signed-in load never shows the static sign-in shell', async ({ page, account }) => {
  const release = await holdEntry(page);
  const u = { ...account.user };
  delete u.token;
  const host = new URL(process.env.GB_E2E_BASE || 'http://localhost:5591').hostname;
  await page.context().addCookies([
    { name: 'gb.token', value: encodeURIComponent(account.token), domain: host, path: '/' },
    { name: 'gb.session', value: encodeURIComponent(JSON.stringify(u)), domain: host, path: '/' },
  ]);
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForTimeout(800);
  await expect(page.locator('.gb-login-title')).toBeHidden();
  release();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-gb-shell]')).toHaveCount(0);
});

test('PRF-2: a returning visitor (session, no token) never sees the sign-up shell before Sign in', async ({ page, account, allowed }) => {
  // No token: boot's calls answer 401 and the app lands on Sign in, which is the point.
  allowed.push('/api/', 'status of 401');
  const release = await holdEntry(page);
  const u = { ...account.user };
  delete u.token;
  const host = new URL(process.env.GB_E2E_BASE || 'http://localhost:5591').hostname;
  await page.context().addCookies([{ name: 'gb.session', value: encodeURIComponent(JSON.stringify(u)), domain: host, path: '/' }]);
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForTimeout(800);
  await expect(page.locator('.gb-login-title')).toBeHidden();
  release();
  await expect(page.locator('.gb-login-title')).toHaveText('Welcome back');
  await expect(page.locator('[data-gb-shell]')).toHaveCount(0);
});

test('PRF-6: wave 2 is already in flight when Home first renders', async ({ page, account }) => {
  // Records, at the moment /api/goals is requested, whether Home's section titles exist yet.
  await page.addInitScript(() => {
    const f = window.fetch;
    window.__goalsAfterHome = null;
    window.fetch = function (u, ...rest) {
      if (String(u).includes('/api/goals') && window.__goalsAfterHome === null) {
        window.__goalsAfterHome = !!document.querySelector('.gb-sectiontitle');
      }
      return f.call(this, u, ...rest);
    };
  });
  await signInFast(page, account);
  await expect.poll(() => page.evaluate(() => window.__goalsAfterHome)).toBe(false);
});

test('PRF-9: Home headings, avatar and mini-calendar names match what they show', async ({ page, account }, info) => {
  await signInFast(page, account);
  await expect(page.locator('.gb-mini-cal-day').first()).toBeVisible();
  const r = await page.evaluate(() => {
    const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const mismatched = [...document.querySelectorAll('.gb-avatar[aria-label], .gb-mini-cal-day')]
      .filter((b) => !(' ' + words(b.getAttribute('aria-label')) + ' ').includes(' ' + words(b.textContent) + ' '))
      .map((b) => b.getAttribute('aria-label') + ' / ' + b.textContent);
    const levels = [...document.querySelectorAll('#gb-main h1, #gb-main h2, #gb-main h3')]
      .filter((e) => e.checkVisibility())
      .map((e) => Number(e.getAttribute('aria-level') || e.tagName[1]));
    const jumps = levels.filter((l, i) => i > 0 && l > levels[i - 1] + 1);
    return { mismatched, levels, jumps };
  });
  expect(r.mismatched).toEqual([]);
  expect(r.jumps, 'heading levels ' + r.levels.join(',')).toEqual([]);
  if (info.project.name.startsWith('mobile')) await shot(page, 'PRF-9');
});
