// The app shell: sign-out teardown, overlays, the back stack, the outbox, theme on auth screens.
import { test, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const EV = 'docs/evidence/shell/';
// The shared Chrome only paints the tab in front: a background tab's screenshot never returns.
const shot = async (page, id) => {
  await page.bringToFront();
  await page.screenshot({ path: EV + id + '.jpg', type: 'jpeg', quality: 60, timeout: 20_000 });
};

// Every key in the app's Cache API store (cache-storage.js).
const storeKeys = (page) =>
  page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('gb-store')) continue;
      const c = await caches.open(name);
      for (const r of await c.keys()) out.push(decodeURIComponent(new URL(r.url).pathname.slice(1)));
    }
    return out;
  });

// Run one at a time (GB_E2E_WORKERS=1): input and paint only reach the tab in front.
test.beforeEach(({ page }) => page.bringToFront());

async function openSettings(page, tab) {
  await page.locator('.gb-avatar').click();
  await page.locator('.gb-profile-pop-item', { hasText: 'Settings' }).click();
  await page.locator('.gb-modal--settings').waitFor();
  if (tab) await page.locator('.gb-modal--settings [role=tab]', { hasText: tab }).first().click();
}

test('CRS-1: signing out from Settings closes Settings', async ({ page, account }) => {
  await signInFast(page, account);
  await openSettings(page, 'Account');
  await page.locator('.gb-modal--settings').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await expect(page.locator('.gb-modal-overlay.is-open')).toHaveCount(0);
  await expect(page.getByText(account.user.email)).toHaveCount(0);
  await shot(page, 'CRS-1');
});

test('CRS-2: logging out during wave 2 writes no guest keys and no "session ended"', async ({ page, account }) => {
  await page.route('**/api/money', async (route) => {
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ response: res });
  });
  await signInFast(page, account);
  await page.locator('.gb-avatar').click();
  await page.locator('.gb-profile-pop-item', { hasText: 'Log out' }).click();
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await page.waitForTimeout(4500);
  expect((await storeKeys(page)).filter((k) => k.endsWith('.guest'))).toEqual([]);
  await expect(page.getByText('Your session ended')).toHaveCount(0);
  await shot(page, 'CRS-2');
});

test('CRS-3: deleting the account clears the account from the device', async ({ page, account }) => {
  await signInFast(page, account);
  await page.waitForTimeout(1500); // wave 2 has cached money, wellness, trends
  expect((await storeKeys(page)).some((k) => k.includes('.' + account.user.id))).toBe(true);
  await openSettings(page, 'Account');
  await page.getByRole('button', { name: /Delete (my )?account/i }).first().click();
  await page.locator('.gb-modal input[type=password]').last().fill(account.password);
  await page.locator('.gb-btn--danger', { hasText: 'Delete my account' }).click();
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await page.waitForTimeout(500);
  expect((await storeKeys(page)).filter((k) => k.includes('.' + account.user.id))).toEqual([]);
  await shot(page, 'CRS-3');
});

test('SEC-4: a 401 clears the offline API cache', async ({ page, account, allowed }) => {
  allowed.push('/api/', 'status of 401');
  await signInFast(page, account);
  await page.evaluate(async () => {
    const c = await caches.open('gb-api-get');
    await c.put('/api/auth/export', new Response('{"secret":1}'));
  });
  // Revoke the session server-side, as "sign out other devices" does.
  await page.evaluate((t) => fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }), account.token);
  await go(page, 'calendar');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('input[type=email]').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => caches.has('gb-api-get'))).toBe(false);
});

test('CNT-1: Settings > Alerts shows the keep-read picker, not [object Object]', async ({ page, account }) => {
  await signInFast(page, account);
  await openSettings(page, 'Alerts');
  await expect(page.locator('.gb-modal--settings')).not.toContainText('[object Object]');
  await page.getByText('30 days').first().scrollIntoViewIfNeeded();
  await expect(page.getByText('30 days').first()).toBeVisible();
  await shot(page, 'CNT-1');
});

test('FRU-9: a system theme flip keeps what was typed on sign-up', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const email = page.locator('input[type=email]').first();
  await email.fill('someone@example.com');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(email).toHaveValue('someone@example.com');
  await shot(page, 'FRU-9');
});

test('A11-1: a re-render keeps the open bell panel drawn', async ({ page, account, context }) => {
  await signInFast(page, account);
  await page.locator('.gb-bell').click();
  await expect(page.locator('#gb-notif-slot > *')).toHaveCount(1);
  // Offline then online: handleOnline reloads data and render()s the screen.
  await context.setOffline(true);
  await page.waitForTimeout(200);
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  await expect(page.locator('.gb-bell')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#gb-notif-slot > *')).toHaveCount(1);
  await shot(page, 'A11-1');
});

test('RSP-4: back closes the bell and account panels, not the screen', async ({ page, account }) => {
  await signInFast(page, account);
  await go(page, 'calendar');
  const hash = new URL(page.url()).hash;
  for (const [trigger, slot] of [['.gb-bell', '#gb-notif-slot'], ['.gb-avatar', '#gb-profile-slot']]) {
    await page.locator(trigger).click();
    await expect(page.locator(slot + ' > *')).toHaveCount(1);
    await page.waitForTimeout(50);
    await page.goBack();
    await expect(page.locator(slot + ' > *')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(hash);
  }
  const more = page.locator('.gb-nav-tab--more');
  if (await more.isVisible()) {
    await more.click();
    await expect(page.locator('.gb-more-sheet')).toBeVisible();
    await page.waitForTimeout(50);
    await page.goBack();
    await expect(page.locator('.gb-more-sheet')).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe(hash);
  }
  await shot(page, 'RSP-4');
});

async function addTaskThroughSheet(page, title) {
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.locator('.gb-modal').getByText('Task', { exact: true }).first().click();
  await page.locator('.gb-modal input[placeholder^="e.g. Finish"]').fill(title);
  await page.locator('.gb-modal').getByRole('button', { name: 'Add task' }).click();
}

test('RSP-6 + RSP-7: a write queued with no response retries on resume, under one toast', async ({ page, account, allowed }) => {
  allowed.push('/api/tasks', 'net::ERR_FAILED', 'Failed to load resource');
  await signInFast(page, account);
  // The server is unreachable but the browser still says online: no 'online' event will come.
  await page.route('**/api/tasks', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.fallback()));
  await addTaskThroughSheet(page, 'Queued while unreachable');
  await expect(page.locator('.gb-toast-msg', { hasText: 'Saved on this phone' })).toBeVisible();
  await expect(page.locator('.gb-toast-msg')).toHaveCount(1);
  await shot(page, 'RSP-7');
  await page.unroute('**/api/tasks');
  const posted = page.waitForRequest((r) => r.url().endsWith('/api/tasks') && r.method() === 'POST', { timeout: 10_000 });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await posted;
  await expect.poll(() => storeKeys(page).then((k) => k.some((x) => x.startsWith('gb.outbox.'))), { timeout: 10_000 }).toBe(false);
  await shot(page, 'RSP-6');
});

const apiAs = (page, token, path) =>
  page.evaluate(
    async ([t, p]) => (await fetch(p, { headers: { Authorization: 'Bearer ' + t } })).json(),
    [token, path]
  );

test('OFF-1: a task whose request is still out when the page reloads is sent after it', async ({ page, account, allowed }) => {
  allowed.push('/api/tasks');
  await signInFast(page, account);
  // The request never answers: the page unloads with it in flight.
  await page.route('**/api/tasks', (route) => (route.request().method() === 'POST' ? undefined : route.fallback()));
  await addTaskThroughSheet(page, 'Sent from the grave');
  await page.waitForTimeout(400);
  await page.unroute('**/api/tasks');
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible();
  await expect
    .poll(async () => (await apiAs(page, account.token, '/api/tasks')).some((t) => t.title === 'Sent from the grave'), { timeout: 15_000 })
    .toBe(true);
  await shot(page, 'OFF-1');
});

test('OFF-3: logging out with a queued change asks first', async ({ page, account, allowed }) => {
  allowed.push('/api/tasks', 'net::ERR_FAILED', 'Failed to load resource');
  await signInFast(page, account);
  await page.route('**/api/tasks', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.fallback()));
  await addTaskThroughSheet(page, 'Not synced');
  await expect(page.locator('.gb-toast-msg', { hasText: 'Saved on this phone' })).toBeVisible();
  await page.locator('.gb-avatar').click();
  await page.locator('.gb-profile-pop-item', { hasText: 'Log out' }).click();
  await expect(page.locator('.gb-modal-title', { hasText: '1 change not synced yet' })).toBeVisible();
  await shot(page, 'OFF-3');
  await page.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(page.locator('.gb-avatar')).toBeVisible();
  await expect(page.locator('input[type=email]')).toHaveCount(0);
});

test('OFF-2: a glass queued by one account does not show on the next', async ({ page, account, allowed }) => {
  allowed.push('/api/water/entries', 'net::ERR_FAILED', 'Failed to load resource');
  const other = await seedAccount();
  await signInFast(page, account);
  await go(page, 'food');
  await page.route('**/api/water/entries', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Add 250 millilitres of water' }).first().click();
  await expect(page.locator('.gb-toast-msg', { hasText: 'Saved on this phone' })).toBeVisible();
  await page.locator('.gb-avatar').click();
  await page.locator('.gb-profile-pop-item', { hasText: 'Log out' }).click();
  await page.getByRole('button', { name: 'Sign out anyway' }).click();
  await page.unroute('**/api/water/entries');
  // The next person signs in on the same tab: no reload between the two.
  const snap = page.waitForRequest((r) => r.url().includes('/api/daily-logs/snapshot'), { timeout: 20_000 });
  await page.locator('input[type=email]').first().fill(other.email);
  await page.locator('input[type=password]').first().fill(other.password);
  await page.locator('input[type=password]').first().press('Enter');
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  const sent = JSON.parse((await snap).postData());
  const theirs = await apiAs(page, other.token, '/api/water');
  expect(sent.waterMl).toBe(theirs.consumedMl);
  await shot(page, 'OFF-2');
});

test('OFF-7: a sign-out made offline is revoked on the next boot', async ({ page, account, allowed }) => {
  // The last check's own /me is meant to 401.
  allowed.push('/api/auth/logout', '/api/auth/me', 'net::ERR_FAILED', 'Failed to load resource');
  await signInFast(page, account);
  await page.route('**/api/auth/logout', (route) => route.abort('failed'));
  await page.locator('.gb-avatar').click();
  await page.locator('.gb-profile-pop-item', { hasText: 'Log out' }).click();
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await expect.poll(() => storeKeys(page).then((k) => k.includes('gb.revoke.pending'))).toBe(true);
  await page.unroute('**/api/auth/logout');
  await page.reload();
  await expect.poll(() => storeKeys(page).then((k) => k.includes('gb.revoke.pending')), { timeout: 10_000 }).toBe(false);
  const me = await page.evaluate((t) => fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.status), account.token);
  expect(me).toBe(401);
});

test('OFF-6: a screen never loaded, opened offline, says so instead of reloading', async ({ page, account, context, allowed }) => {
  allowed.push('Screen failed to load', 'Failed to fetch', 'ERR_INTERNET_DISCONNECTED', 'goals.js', 'logomark.svg');
  await signInFast(page, account);
  await context.setOffline(true);
  await go(page, 'goals');
  await expect(page.getByText('This screen needs a connection the first time')).toBeVisible();
  await shot(page, 'OFF-6');
  await context.setOffline(false);
  await expect(page.getByText('This screen needs a connection the first time')).toHaveCount(0, { timeout: 15_000 });
  expect(new URL(page.url()).hash).toBe('#goals');
});

test('OFF-9: renaming a task with no connection queues it, then sends it', async ({ page, account, allowed }) => {
  allowed.push('/api/tasks/', 'net::ERR_FAILED', 'Failed to load resource');
  await signInFast(page, account);
  await page.route('**/api/tasks/*', (route) => (route.request().method() === 'PUT' ? route.abort('failed') : route.fallback()));
  await page.getByRole('button', { name: 'Edit Book the dentist' }).first().click();
  const title = page.locator('.gb-modal input[placeholder^="e.g. Finish"]');
  await title.fill('Book the dentist for Friday');
  await page.locator('.gb-modal').getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.gb-toast-msg', { hasText: 'Saved on this phone' })).toBeVisible();
  await expect(page.locator('.gb-modal-overlay.is-open')).toHaveCount(0);
  await expect(page.getByText('Book the dentist for Friday').first()).toBeVisible();
  await shot(page, 'OFF-9');
  await page.unroute('**/api/tasks/*');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(async () => (await apiAs(page, account.token, '/api/tasks')).some((t) => t.title === 'Book the dentist for Friday'), { timeout: 10_000 })
    .toBe(true);
});
