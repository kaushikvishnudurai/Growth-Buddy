// Safety net for Money flows that work today: each test drives the real UI, then checks what the
// user sees after a reload and what the server holds (GET /api/money with the account's token).
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The seeder sets the timezone after verify, so its `user` still says UTC and the app would open
// a "Switch timezone?" dialog over the screen. Boot with the zone the server already has.
const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });

async function money(page, account) {
  const r = await page.request.get(API + '/api/money', { headers: { Authorization: 'Bearer ' + account.token } });
  expect(r.status()).toBe(200);
  return r.json();
}

const dialog = (page) => page.locator('.gb-modal[role=dialog]');
// A dialog moves focus onto its first field a beat after it opens (gb-kit focusSoon). Typing
// before that lands the next field's text in the wrong input, so wait for it.
const settled = (field) => expect(field).toBeFocused();

async function openMoney(page, account, tab) {
  await boot(page, account);
  await go(page, 'money');
  if (tab) await page.locator('.gb-money-tab', { hasText: tab }).click();
}

async function addExpense(page, amount, note) {
  await page.locator('#gb-main').getByRole('button', { name: 'Add expense', exact: true }).first().click();
  const d = dialog(page);
  await settled(d.getByLabel(/^Amount/));
  await d.getByLabel(/^Amount/).fill(String(amount));
  await d.getByLabel('Note (optional)').fill(note);
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toHaveCount(0);
}

test('expense: add, edit amount, delete; totals, reload and the ledger agree', async ({ page, account }) => {
  await openMoney(page, account);
  await addExpense(page, 240, 'Team lunch');

  // Exactly one ledger row on the server.
  await expect.poll(async () => (await money(page, account)).expenses.filter((e) => e.note === 'Team lunch').length).toBe(1);
  const row = (await money(page, account)).expenses.find((e) => e.note === 'Team lunch');
  expect(Number(row.amount)).toBe(240);

  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible();
  await go(page, 'money');
  await expect(page.locator('#gb-main').getByText('₹240').first()).toBeVisible();
  await page.locator('.gb-money-tab', { hasText: 'Spending' }).click();
  const edit = page.getByRole('button', { name: 'Edit Team lunch, ₹240' });
  await expect(edit).toBeVisible();

  // Edit the amount: same row, new amount.
  await edit.click();
  await settled(dialog(page).getByLabel(/^Amount/));
  await dialog(page).getByLabel(/^Amount/).fill('310');
  await dialog(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Team lunch, ₹310' })).toBeVisible();
  await expect
    .poll(async () => (await money(page, account)).expenses.filter((e) => e.note === 'Team lunch').map((e) => Number(e.amount)))
    .toEqual([310]);
  expect((await money(page, account)).expenses.find((e) => e.note === 'Team lunch').id).toBe(row.id);

  // Delete it from the row.
  await page.locator('.gb-money-exp-row', { hasText: 'Team lunch' }).getByRole('button', { name: /^Delete Team lunch/ }).click();
  await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Edit Team lunch/ })).toHaveCount(0);
  await expect.poll(async () => (await money(page, account)).expenses.filter((e) => e.note === 'Team lunch').length).toBe(0);

  await page.reload();
  await go(page, 'money');
  await page.locator('.gb-money-tab', { hasText: 'Spending' }).click();
  await expect(page.locator('.gb-money-exp-row', { hasText: 'Team lunch' })).toHaveCount(0);
});

test('income: add salary, it shows on Income and in the ledger', async ({ page, account }) => {
  await openMoney(page, account, 'Income');
  await page.locator('#gb-main').getByRole('button', { name: 'Add income' }).first().click();
  const d = dialog(page);
  await settled(d.getByLabel(/^Amount/));
  await d.getByLabel(/^Amount/).fill('800');
  await d.getByLabel('Note (optional)').fill('Freelance gig');
  await d.getByRole('button', { name: 'Add income', exact: true }).click();
  await expect(d).toHaveCount(0);

  await expect.poll(async () => (await money(page, account)).income.filter((i) => i.label === 'Freelance gig').map((i) => Number(i.amount))).toEqual([800]);
  await page.reload();
  await go(page, 'money');
  await page.locator('.gb-money-tab', { hasText: 'Income' }).click();
  await expect(page.locator('#gb-main').getByText('Freelance gig')).toBeVisible();
  await expect(page.locator('#gb-main').getByText('₹800 came in')).toBeVisible();
});

test('budget: set a Food budget, spend against it, see its status', async ({ page, account }) => {
  await openMoney(page, account);
  await page.getByRole('button', { name: 'Set budgets' }).click();
  const d = dialog(page);
  await settled(d);
  await d.locator('.gb-money-budget-field', { hasText: 'Food' }).locator('input[type=number]').fill('1000');
  await d.getByRole('button', { name: 'Save budgets' }).click();
  await expect(d).toHaveCount(0);

  // A Food expense: pick the tag by hand so the guess can't change the outcome.
  await page.locator('#gb-main').getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await settled(d.getByLabel(/^Amount/));
  await d.getByLabel(/^Amount/).fill('250');
  await d.getByLabel('Note (optional)').fill('Groceries run');
  await d.locator('.gb-money-tagchip', { hasText: 'Food' }).click();
  await d.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(d).toHaveCount(0);

  await expect.poll(async () => (await money(page, account)).budgets).toMatchObject({ food: 1000 });
  await page.reload();
  await go(page, 'money');
  const card = page.locator('.gb-money-bcard', { hasText: 'Food' });
  await expect(card.locator('.gb-money-bcard-pct')).toHaveText('25%');
  await expect(card).toContainText('₹250 of ₹1,000');
  await expect(card).toContainText('₹750 left');
});

test('bill: add a subscription due today and mark it paid', async ({ page, account }) => {
  const today = new Date();
  const month = today.toLocaleDateString('en-CA').slice(0, 7);
  await openMoney(page, account, 'Spending');
  await page.getByRole('button', { name: 'Add subscription' }).click();
  const d = dialog(page);
  await settled(d.getByPlaceholder('e.g. Netflix'));
  await d.getByPlaceholder('e.g. Netflix').fill('Streamly');
  await d.getByPlaceholder('e.g. 199').fill('199');
  await d.getByPlaceholder('Due day (1–31)').fill(String(today.getDate()));
  await d.getByRole('button', { name: 'Add subscription', exact: true }).click();
  await expect(d).toHaveCount(0);

  const due = page.locator('.gb-money-coach', { hasText: 'Streamly due today' });
  await expect(due).toBeVisible();
  await due.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(due).toHaveCount(0);

  await expect
    .poll(async () => {
      const m = await money(page, account);
      const sub = m.subscriptions.find((s) => s.name === 'Streamly');
      return [sub && sub.paidFor, m.expenses.filter((e) => sub && e.id === 'sub-' + sub.id + '-' + month).length];
    })
    .toEqual([month, 1]);

  await page.reload();
  await go(page, 'money');
  await page.locator('.gb-money-tab', { hasText: 'Spending' }).click();
  await expect(page.locator('.gb-money-coach', { hasText: 'Streamly due' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Streamly, ₹199' })).toBeVisible();
});

test('transfer: moving money between accounts moves both balances', async ({ page, account }) => {
  await openMoney(page, account);
  await page.locator('#gb-main').getByRole('button', { name: 'Move money' }).first().click();
  const d = dialog(page);
  // Defaults: from Bank, to Cash.
  await settled(d.getByPlaceholder('e.g. 2000'));
  await d.getByPlaceholder('e.g. 2000').fill('600');
  await d.getByRole('button', { name: 'Move money', exact: true }).click();
  await expect(d).toHaveCount(0);

  const bal = async () => {
    const m = await money(page, account);
    const by = Object.fromEntries(m.accounts.map((a) => [a.name, Number(a.balance)]));
    return [by.Cash, by.Bank, m.transfers.length];
  };
  await expect.poll(bal).toEqual([600, -600, 1]);
  await page.reload();
  await go(page, 'money');
  await expect(page.getByRole('button', { name: 'Cash, ₹600. Edit' })).toBeVisible();
});
