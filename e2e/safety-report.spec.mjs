// Safety net for the Report screen: seeded numbers, the trend period switch, and Insights.
// Pins what works today so a later fix cannot break it silently. One account per test.
import { test, expect, signInFast, go } from './fixtures.mjs';

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });
const json = (token, data) => ({ headers: { Authorization: 'Bearer ' + token }, data });

// setupDone skips the first-run sheet. The theme is pinned because the shared headless Chrome
// flips prefers-color-scheme, and with no picked theme every flip re-renders the screen.
async function boot(page, account) {
  await page.request.put('/api/auth/ui-prefs', json(account.token, { prefs: { theme: 'light', setupDone: true } }));
  const me = await (await page.request.get('/api/auth/me', auth(account.token))).json();
  await signInFast(page, { token: account.token, user: me });
}

const dayAgo = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA');

test('report: loads the seeded day', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'report');
  const main = page.locator('#gb-main');
  await expect(main.getByRole('heading', { name: 'Today' })).toBeVisible();
  // Seed: 3 open tasks, 1 of 2 habits, 500 ml water, 220 kcal, a 1-day run streak.
  await expect(main.getByText('0/3', { exact: true })).toBeVisible();
  await expect(main.getByText('1/2', { exact: true })).toBeVisible();
  await expect(main.getByText('500 of 2000 ml')).toBeVisible();
  await expect(main.getByText('220', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Morning run')).toBeVisible();
  for (const h of ['Insights', 'Trends', 'Daily score', 'Water', 'Calories', 'Year in pixels']) {
    await expect(main.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
});

test('report: the trend period switch moves between 7, 30, 90 days and a year', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'report');
  const periods = ['7 days', '30 days', '90 days', '1 year'];
  const btn = (name) => page.getByRole('button', { name, exact: true });
  await expect(btn('7 days')).toHaveAttribute('aria-pressed', 'true');
  for (const p of [...periods.slice(1), '7 days']) {
    await btn(p).click();
    await expect(btn(p)).toHaveAttribute('aria-pressed', 'true');
    for (const other of periods.filter((x) => x !== p)) await expect(btn(other)).toHaveAttribute('aria-pressed', 'false');
    // The charts are still drawn for the new range.
    await expect(page.getByRole('heading', { name: 'Daily score', exact: true })).toBeVisible();
    await expect(page.getByText(/avg over 1 day/).first()).toBeVisible();
  }
});

test('report: insights render once two weeks of sleep and mood are logged', async ({ page, account }) => {
  // Short nights go with low moods, long nights with great ones: a pattern Insights should name.
  for (let i = 1; i <= 14; i++) {
    const long = i % 2 === 0;
    const date = dayAgo(i);
    const s = await page.request.post('/api/daily-logs/sleep', json(account.token, { date, bedtime: long ? '22:30' : '01:30', wakeTime: long ? '07:00' : '06:00', quality: long ? 'great' : 'low' }));
    const m = await page.request.post('/api/daily-logs/mood', json(account.token, { date, mood: long ? 'great' : 'low', energy: long ? 'high' : 'low', stress: long ? 'calm' : 'high' }));
    expect(s.status(), 'sleep ' + date).toBeLessThan(300);
    expect(m.status(), 'mood ' + date).toBeLessThan(300);
  }
  await boot(page, account);
  await go(page, 'report');
  const rows = page.locator('.gb-insight-row');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.gb-insight-empty')).toHaveCount(0);
  await expect(page.locator('.gb-insight-skel')).toHaveCount(0);
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(rows.nth(i).locator('.gb-insight-title')).toHaveText(/\w{3,}/);
    await expect(rows.nth(i).locator('.gb-insight-text')).toHaveText(/\w{3,}/);
  }
  await expect(page.locator('.gb-insight-text').filter({ hasText: /sleep/i }).first()).toBeVisible();
});
