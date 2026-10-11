// Safety net for the app shell: sign-in, sign-out, theme. Pins flows that work today so a later
// fix cannot break them silently. One account per test.
import { test as base, expect, signIn, signInFast } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

// Concurrent sign-ups can deadlock on email_verification_tokens and 500 (see the safety-net
// report); retry the seed so that backend bug does not read as a failure of these flows.
const test = base.extend({
  account: async ({}, use) => {
    let acct;
    for (let i = 0; !acct; i++) {
      try {
        acct = await seedAccount();
      } catch (e) {
        if (i >= 3 || !/signup 500/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
      }
    }
    await use(acct);
  },
});

// The suite attaches to a shared Chrome: a screenshot captures every page in it (other suites'
// too), which costs seconds per test. The trace still records each failure.
test.use({ screenshot: 'off' });

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });

// signInFast with the server's current user: the seeder's `user` predates its timezone PUT, and a
// stale UTC session makes the app offer a timezone switch on top of whatever the test opens.
async function boot(page, account) {
  const me = await (await page.request.get('/api/auth/me', auth(account.token))).json();
  await signInFast(page, { token: account.token, user: me });
  // Boot fires a burst of loads that each repaint the shell; let it settle before clicking.
  await page.waitForLoadState('networkidle');
}

// A repaint during boot closes the open account menu (the popover is detached and not rebuilt), so
// open it and pick the item as one retried step.
async function accountMenu(page, item) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Account' }).click({ timeout: 5000 });
    await page.getByRole('button', { name: item, exact: true }).click({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
}

// The only test that uses the real form: the login route is rate limited per IP.
// The backend trusts X-Forwarded-For here (as the seeder does), so a forwarded address of its own
// keeps this test out of the per-IP bucket other suites spend from localhost.
test('signs in through the form and stays signed in after a reload', async ({ page, account }) => {
  const ip = () => Math.floor(Math.random() * 250);
  await page.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${ip()}.${ip()}.${ip()}` });
  await signIn(page, account);
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
});

test('logs out to the sign-in form and revokes the session', async ({ page, account }) => {
  await boot(page, account);
  await accountMenu(page, 'Log out');
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('input[type=email]').first()).toBeVisible();
  await expect(page.locator('#gb-main')).toHaveCount(0);
  // The logout POST is fire-and-forget; give it a moment to land.
  await expect
    .poll(async () => (await page.request.get('/api/auth/me', auth(account.token))).status())
    .toBe(401);
});

// The shared Chrome's prefers-color-scheme flips under a run (seen in a data-theme trace: the
// app's followSystemTheme listener firing mid-test), and the Display tab only saves a pick that
// differs from the theme on screen. So: Light then Dark, retried until the server holds "dark".
test('theme choice persists across a reload and on the server', async ({ page, account }) => {
  await boot(page, account);
  const html = page.locator('html');
  await accountMenu(page, 'Settings');
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  await dlg.getByRole('tab', { name: 'Display' }).click();
  const serverTheme = async () => {
    const me = await (await page.request.get('/api/auth/me', auth(account.token))).json();
    return me.uiPrefs && me.uiPrefs.theme;
  };
  await expect(async () => {
    await dlg.getByRole('radio', { name: 'Light', exact: true }).click();
    await dlg.getByRole('radio', { name: 'Dark', exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark', { timeout: 1000 });
    await expect.poll(serverTheme, { timeout: 3000 }).toBe('dark');
  }).toPass({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // A system flip after the pick no longer moves it.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
});
