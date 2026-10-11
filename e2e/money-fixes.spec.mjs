// Money overhaul fixes: each test fails on the code before its fix. Screenshots go to
// docs/evidence/money/<ID>.jpg.
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8591';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');
const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });
const shot = (page, id) =>
  page.screenshot({ path: `docs/evidence/money/${id}.jpg`, type: 'jpeg', quality: 70 });

async function postTx(page, account, upserts) {
  const r = await page.request.post(API + '/api/money/tx', {
    headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
    data: { upserts, deletes: [] },
  });
  expect(r.status()).toBeLessThan(300);
}

// Header, Last night, Ledger, then the sentence: the first class of each child of .gb-health.
const healthOrder = (page) =>
  page.locator('.gb-health').evaluate((n) => [...n.children].map((c) => c.classList[0]));
const ORDER = ['gb-health-top', 'gb-card', 'gb-card', 'gb-health-hero'];

test('Health: the summary sentence closes the screen, after the ledger', async ({ page, account }) => {
  for (const [type, value] of [['weight', 71.5], ['steps', 8200]]) {
    const r = await page.request.post(API + '/api/health/readings', {
      headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
      data: { type, value, day: today() },
    });
    expect(r.status()).toBeLessThan(300);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, account);
  await go(page, 'health');
  const hero = page.locator('.gb-health > .gb-health-hero');
  await expect(hero).toContainText('Slept 7h 30m'); // the count-up has finished
  await expect(page.locator('.gb-health-top')).toContainText('Typed in by you');
  await expect(page.locator('.gb-health-top').getByRole('button', { name: /Log a reading/ })).toBeVisible();
  expect(await healthOrder(page)).toEqual(ORDER);
  await shot(page, 'health-insights-last-top');
  await hero.scrollIntoViewIfNeeded();
  await shot(page, 'health-insights-last');
});

test('Health, empty account: same order, the header still shows', async ({ page, emptyAccount }) => {
  await boot(page, emptyAccount);
  await go(page, 'health');
  await expect(page.locator('.gb-health > .gb-health-hero')).toContainText('Nothing logged for today yet');
  await expect(page.locator('.gb-health-top')).toContainText('Typed in by you');
  expect(await healthOrder(page)).toEqual(ORDER);
});

test.describe('CNT-2', () => {
  // The aborted GET is the point of the test.
  test.use({ allowed: ['/api/money'] });
  test('a failed Money load says so with Retry, not the first-run screen', async ({ page, account }) => {
    await postTx(page, account, [
      { kind: 'expense', id: 'e2e-cnt2', amount: 240, category: 'food', note: 'Team lunch', date: today() },
    ]);
    const block = (route) => (route.request().method() === 'GET' ? route.abort('aborted') : route.continue());
    await page.route('**/api/money', block);
    await boot(page, account);
    await go(page, 'money');
    const main = page.locator('#gb-main');
    await expect(main.getByText('That didn’t go through')).toBeVisible();
    await expect(main.getByText(/Let's start small/)).toHaveCount(0);
    await shot(page, 'CNT-2');
    await page.unroute('**/api/money', block);
    await main.getByRole('button', { name: 'Try again' }).click();
    await expect(main.getByText('₹240').first()).toBeVisible();
  });
});

const dialog = (page) => page.locator('.gb-modal[role=dialog]');
const moneyDoc = async (page, account) =>
  (await page.request.get(API + '/api/money', { headers: { Authorization: 'Bearer ' + account.token } })).json();
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};
async function openMoney(page, account, tab) {
  await boot(page, account);
  await go(page, 'money');
  if (tab) await page.locator('.gb-money-tab', { hasText: tab }).click();
}

test('EXM-1: an expense can only be dated up to today', async ({ page, account }) => {
  await openMoney(page, account);
  await page.locator('#gb-main').getByRole('button', { name: 'Add expense', exact: true }).first().click();
  const d = dialog(page);
  await expect(d.getByLabel(/^Amount/)).toBeFocused();
  await d.getByLabel(/^Amount/).fill('500');
  await d.getByLabel('Note (optional)').fill('Concert tickets');
  const date = d.locator('input[type=date]');
  await expect(date).toHaveAttribute('max', today());
  await date.fill(addDays(1));
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d.locator('.gb-field-error')).toHaveText('Pick a day up to today.');
  await shot(page, 'EXM-1');
  expect((await moneyDoc(page, account)).expenses.filter((e) => e.note === 'Concert tickets')).toEqual([]);
});

test('EXM-2: Delete in the edit dialog deletes at once, and Undo brings it back', async ({ page, account }) => {
  await postTx(page, account, [{ kind: 'expense', id: 'e2e-lunch', amount: 240, category: 'food', note: 'Lunch', date: today() }]);
  await openMoney(page, account, 'Spending');
  await page.getByRole('button', { name: /^Edit Lunch, / }).click();
  await dialog(page).getByRole('button', { name: 'Delete expense' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit Lunch, / })).toHaveCount(0);
  await expect.poll(async () => (await moneyDoc(page, account)).expenses.some((e) => e.id === 'e2e-lunch')).toBe(false);
  await shot(page, 'EXM-2');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Edit Lunch, / })).toBeVisible();
  await expect.poll(async () => (await moneyDoc(page, account)).expenses.some((e) => e.id === 'e2e-lunch')).toBe(true);
});

test('EXM-7: deleting a bill payment makes the bill due again', async ({ page, account }) => {
  await openMoney(page, account, 'Spending');
  await page.locator('#gb-main').getByRole('button', { name: 'Add subscription' }).click();
  const d = dialog(page);
  await expect(d.getByPlaceholder('e.g. Netflix')).toBeFocused();
  await d.getByPlaceholder('e.g. Netflix').fill('Gym');
  await d.getByPlaceholder('e.g. 199').fill('1200');
  await d.getByPlaceholder('Due day (1–31)').fill(String(new Date().getDate()));
  await d.getByRole('button', { name: 'Add subscription' }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark as paid' }).first().click();
  await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
  const paid = page.locator('.gb-money-exp-row', { hasText: 'Gym' }).getByRole('button', { name: 'Delete expense' });
  await paid.click();
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(1);
  await shot(page, 'EXM-7');
  await expect.poll(async () => ((await moneyDoc(page, account)).subscriptions[0] || {}).paidFor || null).toBe(null);
});

test('EXM-9: an income entry opens for editing from its row', async ({ page, account }) => {
  await postTx(page, account, [{ kind: 'income', id: 'e2e-sal', amount: 50000, source: 'salary', label: 'Salary', date: today() }]);
  await openMoney(page, account, 'Income');
  await page.getByRole('button', { name: /^Edit Salary, / }).click();
  const amt = dialog(page).getByRole('spinbutton').first();
  await expect(amt).toHaveValue('50000');
  await amt.fill('52000');
  await dialog(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: /^Edit Salary, .*52,000/ })).toBeVisible();
  await shot(page, 'EXM-9');
  await expect
    .poll(async () => (await moneyDoc(page, account)).income.map((i) => [i.id, Number(i.amount)]))
    .toEqual([['e2e-sal', 52000]]);
});

// Friction targets (docs/audit/friction-capture.md), counted as the user's own inputs.
test('Flow: income on payday is 1 tap ("Salary arrived?")', async ({ page, account }) => {
  const day = Math.min(new Date().getDate(), 28);
  const monthAgo = (k) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - k);
    d.setDate(day);
    return d.toLocaleDateString('en-CA');
  };
  await postTx(page, account, [1, 2].map((k) => ({ kind: 'income', id: 'e2e-sal' + k, amount: 50000, source: 'salary', label: 'Salary', date: monthAgo(k) })));
  await boot(page, account);
  let taps = 0;
  const nudge = page.locator('.gb-nudge[aria-label=Salary]');
  await expect(nudge).toContainText('arrived?');
  await nudge.getByRole('button', { name: 'Add', exact: true }).click();
  taps++;
  await expect(nudge).toHaveCount(0);
  await shot(page, 'FRC-16');
  expect(taps).toBe(1);
  await expect
    .poll(async () => (await moneyDoc(page, account)).income.filter((i) => i.date === today()).map((i) => Number(i.amount)))
    .toEqual([50000]);
});

test('Flow: an expense from Home is 2 taps and 1 field; a usual one is 1 tap', async ({ page, account }) => {
  // Coffee at this time on each of the last 4 days: repeatExpense offers it.
  await postTx(page, account, [1, 2, 3, 4].map((k) => ({
    kind: 'expense', id: 'e2e-cof' + k, amount: 120, category: 'food', note: 'Coffee', date: addDays(-k), createdAt: Date.now() - k * 864e5,
  })));
  await boot(page, account);
  let taps = 0;
  let fields = 0;
  await page.locator('.gb-money-mini').getByRole('button', { name: 'Add expense' }).click();
  taps++;
  const amt = dialog(page).getByLabel(/^Amount/);
  await expect(amt).toBeFocused();
  await amt.fill('250');
  fields++;
  await amt.press('Enter');
  taps++;
  await expect(dialog(page)).toHaveCount(0);
  expect([taps, fields]).toEqual([2, 1]);
  await expect
    .poll(async () => (await moneyDoc(page, account)).expenses.filter((e) => e.date === today()).map((e) => Number(e.amount)))
    .toEqual([250]);

  const usual = page.locator('.gb-nudge[aria-label="Usual expense"]');
  await expect(usual).toContainText('Coffee');
  await usual.getByRole('button', { name: 'Add', exact: true }).click(); // the one tap
  await expect
    .poll(async () => (await moneyDoc(page, account)).expenses.filter((e) => e.date === today()).map((e) => Number(e.amount)).sort())
    .toEqual([120, 250]);
});
