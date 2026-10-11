// Money on a new account's first day (docs/audit/new-user.md, NEW-*): each test fails on the code
// before its fix. Screenshots go to docs/evidence/money-day-one/<ID>.jpg.
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');
const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });
const shot = (page, id) =>
  page.screenshot({ path: `docs/evidence/money-day-one/${id}.jpg`, type: 'jpeg', quality: 70 });
const dialog = (page) => page.locator('.gb-modal[role=dialog]');
const call = async (page, account, path, method = 'GET', data) => {
  const r = await page.request.fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
    data,
  });
  expect(r.status()).toBeLessThan(300);
  return r.json().catch(() => null);
};
// The audit's first expense: "spent 250 on lunch", booked to Cash as Home's Log it does.
async function firstLunch(page, account) {
  const cash = (await call(page, account, '/api/money')).accounts.find((a) => a.kind === 'cash');
  await call(page, account, '/api/money/tx', 'POST', {
    upserts: [{ kind: 'expense', id: 'e2e-lunch', amount: 250, category: 'food', note: 'Lunch', date: today(), accountId: cash && cash.id }],
    deletes: [],
  });
}
// The persona has passed the plan sheet already: setupDone, or it opens over Money and takes the clicks.
async function openMoney(page, account) {
  await page.setViewportSize({ width: 390, height: 844 });
  const { uiPrefs } = await call(page, account, '/api/auth/ui-prefs', 'PUT', { prefs: { theme: 'light', setupDone: true } });
  await boot(page, { ...account, user: { ...account.user, uiPrefs } });
  await go(page, 'money');
}

test('NEW-1: one lunch is not a month: no one-tap budget from a day of history', async ({ page, emptyAccount }) => {
  await firstLunch(page, emptyAccount);
  await openMoney(page, emptyAccount);
  const card = page.locator('.gb-money-card', { hasText: 'Monthly budgets' });
  await expect(card).toContainText('A gentle limit per tag');
  await expect(card.getByRole('button', { name: 'Use these' })).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'NEW-1');
});

test('NEW-2: the first expense does not say money is missing', async ({ page, emptyAccount }) => {
  await firstLunch(page, emptyAccount);
  await openMoney(page, emptyAccount);
  const card = page.locator('.gb-money-card', { hasText: 'Where your money is' });
  await expect(card).toContainText('How much is in each right now?');
  await expect(card).not.toContainText("isn't logged");
  await expect(card).not.toContainText('−');
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'NEW-2');
});

test('NEW-11: the statement prints what was spent without a minus sign', async ({ page, emptyAccount }) => {
  await firstLunch(page, emptyAccount);
  await openMoney(page, emptyAccount);
  await page.locator('#gb-main').getByRole('button', { name: /^Set (up|budgets)$/ }).first().click();
  await dialog(page).getByLabel('Food monthly budget').fill('6000');
  await dialog(page).getByRole('button', { name: /^Save/ }).click();
  await expect(dialog(page)).toHaveCount(0);
  const spent = page.locator('.gb-money-slip-line', { hasText: 'Spent so far' });
  await expect(spent).toContainText('250');
  await expect(spent).not.toContainText('−');
  await shot(page, 'NEW-11');
});

test('NEW-12: the health card asks for a savings goal, not "a goal"', async ({ page, emptyAccount }) => {
  await firstLunch(page, emptyAccount);
  await openMoney(page, emptyAccount);
  const health = page.locator('.gb-money-card', { hasText: 'Goal progress' });
  await expect(health).toContainText('Start a savings goal to score this');
  await expect(health).not.toContainText('Create a goal to score this');
  await expect(health.getByRole('button', { name: 'Start a savings goal' })).toBeVisible();
  await health.scrollIntoViewIfNeeded();
  await shot(page, 'NEW-12');
});

test('NEW-7: logging an expense ticks the "Log every expense" habit', async ({ page, emptyAccount }) => {
  const hb = await call(page, emptyAccount, '/api/habits', 'POST', { name: 'Log every expense', icon: 'notebook-pen', domain: 'habit', cadence: 'daily' });
  await firstLunch(page, emptyAccount); // so Money opens on its Overview, not the first-run screen
  await openMoney(page, emptyAccount);
  await page.locator('#gb-main').getByRole('button', { name: 'Add expense', exact: true }).first().click();
  const d = dialog(page);
  await expect(d.getByLabel(/^Amount/)).toBeFocused();
  await d.getByLabel(/^Amount/).fill('120');
  await d.getByLabel('Note (optional)').fill('Coffee');
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.gb-toast-msg', { hasText: 'Log every expense ticked' })).toBeVisible();
  await expect
    .poll(async () => (await call(page, emptyAccount, '/api/habits')).find((x) => x.id === hb.id).doneToday)
    .toBe(true);
  await shot(page, 'NEW-7');
});
