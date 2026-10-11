// Shared test fixtures: a fresh seeded account per test, signed in through the real UI, and a
// guard that fails the test on any console error or any HTTP 4xx/5xx (the evidence gate).
import { test as base, expect, chromium, firefox, webkit } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { seedAccount } from './seed.mjs';

export const test = base.extend({
  // Playwright can't launch a browser under this machine's sandbox (the child is killed with
  // EPERM), so the suite attaches to browsers started outside it: Chrome over CDP (started by
  // hand with --remote-debugging-port), Firefox and WebKit over the servers e2e/servers.sh starts.
  // Each test still gets its own context, i.e. its own cookies and storage.
  engine: ['chrome', { option: true, scope: 'worker' }],
  browser: [
    async ({ engine }, use) => {
      // GB_E2E_CHROME=server: use servers.sh's own Chromium instead of the shared (often busy) CDP Chrome.
      if (engine === 'chrome' && process.env.GB_E2E_CHROME !== 'server') return use(await chromium.connectOverCDP(process.env.GB_E2E_CDP || 'http://localhost:9591'));
      const file = process.env.GB_E2E_SERVERS || new URL('./.servers.json', import.meta.url).pathname;
      if (!existsSync(file)) throw new Error(`no ${engine} server: run e2e/servers.sh start`);
      const b = await { chrome: chromium, firefox, webkit }[engine].connect(JSON.parse(readFileSync(file, 'utf8'))[engine === 'chrome' ? 'chromium' : engine]);
      await use(b);
      await b.close();
    },
    { scope: 'worker' },
  ],
  // Errors a test expects (e.g. a deliberate 400) can be pushed here to be ignored.
  allowed: async ({}, use) => use([]),
  guard: [
    async ({ page, allowed }, use) => {
      const problems = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !allowed.some((a) => m.text().includes(a))) problems.push('console: ' + m.text());
      });
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
      page.on('response', (r) => {
        const u = r.url();
        if (r.status() >= 400 && !allowed.some((a) => u.includes(a))) problems.push(`http ${r.status()} ${r.request().method()} ${u}`);
      });
      page.on('requestfailed', (r) => {
        const err = r.failure() && r.failure().errorText;
        // Aborts are navigation/cancel noise, not failures.
        if (err && !/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(err)) problems.push(`failed ${r.method()} ${r.url()} ${err}`);
      });
      await use(problems);
      expect(problems, 'console errors / failed requests').toEqual([]);
    },
    { auto: true },
  ],
  account: async ({}, use) => use(await seedAccount()),
  emptyAccount: async ({}, use) => use(await seedAccount({ seed: false })),
});

export { expect };

export async function signIn(page, { email, password }) {
  await page.goto('/');
  await page.locator('input[type=email]').first().fill(email);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('input[type=password]').first().press('Enter');
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
}

// Signs in without the form (the login route is rate limited per IP): the app boots from the
// same two cookies a real sign-in writes (cache-storage.js cookieEligible).
export async function signInFast(page, { token, user }) {
  const u = { ...user };
  delete u.token;
  const url = new URL(page.context()._options?.baseURL || process.env.GB_E2E_BASE || 'http://localhost:5591');
  await page.context().addCookies([
    { name: 'gb.token', value: encodeURIComponent(token), domain: url.hostname, path: '/' },
    { name: 'gb.session', value: encodeURIComponent(JSON.stringify(u)), domain: url.hostname, path: '/' },
  ]);
  await page.goto('/');
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
}

export async function go(page, screen) {
  await page.evaluate((s) => (location.hash = '#' + s), screen);
  await page.waitForTimeout(400);
}
