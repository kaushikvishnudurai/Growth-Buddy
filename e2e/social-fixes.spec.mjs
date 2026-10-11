// Social fixes (Circle, Family, Report): each test fails on the code before its fix.
import { test, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const EV = 'docs/evidence/social/';

async function call(token, path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (r.status >= 300) throw new Error(method + ' ' + path + ' ' + r.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}

// The shared CDP Chrome flips prefers-color-scheme now and then, and app.js answers a
// system theme change with a full render() that rebuilds Circle and Family (FRS-19).
// A picked theme switches that listener off, so a test sees only its own repaints.
async function signInPinned(page, account) {
  const r = await call(account.token, '/api/auth/ui-prefs', 'PUT', { prefs: { ...account.user.uiPrefs, theme: 'light' } });
  account.user.uiPrefs = r.uiPrefs;
  await signInFast(page, account);
}

async function shot(page, id) {
  await page.screenshot({ path: EV + id + '.jpg', type: 'jpeg', quality: 60 });
}

test('SEC-2 / FRS-11: an invite link asks before joining, and offers the shared goal', async ({ page, account }, info) => {
  const owner = await seedAccount();
  const name = 'Morning Walkers ' + Date.now();
  const c = await call(owner.token, '/api/circles', 'POST', { name, goal: 'Walk 30 minutes', visibility: 'public' });

  await signInPinned(page, account);
  await go(page, 'circle?circle=' + c.id);
  const dialog = page.getByRole('dialog', { name: 'Join ' + name + '?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('checked in today');
  // Nothing has happened yet: the link alone joins no one.
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(false);
  if (info.project.name === 'mobile') await shot(page, 'SEC-2');

  await dialog.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.locator('[data-circle-id="' + c.id + '"]')).toBeVisible();
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(true);
});

test('SEC-2: Cancel on the join sheet leaves the user out', async ({ page, account }) => {
  const owner = await seedAccount();
  const c = await call(owner.token, '/api/circles', 'POST', { name: 'Quiet ' + Date.now(), visibility: 'public' });
  await signInPinned(page, account);
  await go(page, 'circle?circle=' + c.id);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(false);
});

test('CRM-5: a reply sent while replies load stays, and Delete can be undone', async ({ page, account }, info) => {
  const c = await call(account.token, '/api/circles', 'POST', { name: 'Replies ' + Date.now(), visibility: 'public' });
  await call(account.token, '/api/circles/' + c.id + '/posts', 'POST', { body: 'First post' });

  // Hold the first replies GET until a reply has been sent.
  let release;
  const held = new Promise((r) => (release = r));
  let holding = true;
  await page.route('**/comments', async (route) => {
    if (route.request().method() === 'GET' && holding) {
      holding = false;
      const res = await route.fetch(); // fetched before the reply exists
      await held;
      return route.fulfill({ response: res });
    }
    return route.continue();
  });
  const deletes = [];
  page.on('request', (r) => r.method() === 'DELETE' && r.url().includes('/comments/') && deletes.push(r.url()));

  await signInPinned(page, account);
  await go(page, 'circle');
  await page.getByRole('button', { name: 'Replies (0)' }).click();
  const field = page.getByLabel('Write a reply');
  await field.fill('Sent early');
  await field.press('Enter');
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();
  release();
  await page.waitForTimeout(600);
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete reply' }).click();
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toHaveCount(0);
  if (info.project.name === 'mobile') await shot(page, 'CRM-5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();
  await page.waitForTimeout(6500);
  expect(deletes).toEqual([]);
});
