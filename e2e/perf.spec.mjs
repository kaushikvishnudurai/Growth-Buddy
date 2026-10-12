// Performance fixes (docs/audit/performance.md, PRF-*). Each test fails on the code before its fix.
import { test, expect, signInFast } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const shot = (page, id) =>
  page.screenshot({ path: `docs/evidence/perf/${id}.jpg`, type: 'jpeg', quality: 70 });

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

  const badge = page.locator('.gb-bell .gb-bell-badge');
  const before = (await badge.count()) ? Number(await badge.textContent()) : 0;
  const other = await seedAccount({ seed: false });
  const circle = await call('/api/circles', account.token, 'POST', { name: 'Perf circle ' + Date.now() });
  await call(`/api/circles/${circle.id}/join`, other.token);
  await call(`/api/circles/${circle.id}/members/${account.user.id}/cheer`, other.token);
  await expect(badge).toHaveText(String(before + 1), { timeout: 15_000 });
  if (info.project.name.startsWith('mobile')) await shot(page, 'PRF-1');
});

// PRF-2 (static sign-up shell in index.html) is gone: main's sign-in landing won the merge.

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
  await expect(page.locator('.gb-mini-cal-day').locator('visible=true').first()).toBeVisible();
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
