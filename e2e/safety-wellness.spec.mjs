// Safety net for Food, Water, Health and the Focus timer: drive the real UI, then check the
// screen after a reload and what the server holds (page.request with the account's token).
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8591';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');

// The seeder sets the timezone after verify, so its `user` still says UTC and the app would open
// a "Switch timezone?" dialog over the screen. Boot with the zone the server already has.
const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });

async function api(page, account, path) {
  const r = await page.request.get(API + path, { headers: { Authorization: 'Bearer ' + account.token } });
  expect(r.status(), path).toBe(200);
  return r.json();
}

const dialog = (page) => page.locator('.gb-modal[role=dialog]');
// A dialog moves focus onto its first field a beat after it opens. Typing before that can land
// text in the wrong input, so wait for it.
const settled = (field) => expect(field).toBeFocused();
const main = (page) => page.locator('#gb-main');

async function reloadTo(page, screen) {
  await page.reload();
  await expect(main(page)).toBeVisible();
  await go(page, screen);
}

test('food: log a meal with typed kcal, the day total moves, delete it', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'food');
  // The seeded day: Idli, 220 kcal.
  const total = main(page).locator('.gb-food-total');
  await expect(total).toHaveText(/^220\s*kcal$/);

  await main(page).getByRole('button', { name: 'Log food' }).click();
  const d = dialog(page);
  await settled(d.getByRole('textbox', { name: 'Food', exact: true }));
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('Masala oats');
  await d.getByLabel('Calories (optional)').fill('310');
  await d.getByRole('button', { name: 'Add food' }).click();
  await expect(d).toHaveCount(0);
  await expect(total).toHaveText(/^530\s*kcal$/);

  const food = () => api(page, account, '/api/food?date=' + today());
  await expect.poll(async () => (await food()).totalCalories).toBe(530);
  expect((await food()).entries.filter((e) => e.foodName === 'Masala oats')).toHaveLength(1);

  await reloadTo(page, 'food');
  await expect(main(page).getByRole('button', { name: /^Edit Masala oats/ })).toBeVisible();
  await expect(total).toHaveText(/^530\s*kcal$/);

  await main(page)
    .locator('*:has(> .gb-food-row-edit[aria-label^="Edit Masala oats"])')
    .getByRole('button', { name: 'Delete food entry' })
    .click();
  await dialog(page).filter({ hasText: 'Delete this food entry?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(main(page).getByRole('button', { name: /^Edit Masala oats/ })).toHaveCount(0);
  await expect(total).toHaveText(/^220\s*kcal$/);
  await expect.poll(async () => (await food()).totalCalories).toBe(220);
});

test('water: add a glass, the total moves, removing it undoes that', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'food');
  const big = main(page).locator('.gb-water-big');
  // Seeded 500 ml.
  await expect(big).toHaveText(/^500\s*ml$/);
  await main(page).getByRole('button', { name: 'Add 250 millilitres of water' }).click();
  await expect(big).toHaveText(/^750\s*ml$/);

  const water = () => api(page, account, '/api/water?date=' + today());
  await expect.poll(async () => (await water()).consumedMl).toBe(750);

  await reloadTo(page, 'food');
  await expect(big).toHaveText(/^750\s*ml$/);

  // Undo the glass: the newest entry is listed first.
  await expect(main(page).getByRole('button', { name: 'Delete water entry' })).toHaveCount(2);
  await main(page).getByRole('button', { name: 'Delete water entry' }).first().click();
  await dialog(page).filter({ hasText: 'Delete this water entry?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(big).toHaveText(/^500\s*ml$/);
  await expect.poll(async () => (await water()).consumedMl).toBe(500);
  await reloadTo(page, 'food');
  await expect(big).toHaveText(/^500\s*ml$/);
});

test('health: log a weight, it shows in the ledger, delete it', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'health');
  await main(page).getByRole('button', { name: 'Log a reading' }).click();
  const d = dialog(page);
  await settled(d.locator('select'));
  await d.locator('select').selectOption('weight');
  await d.getByLabel('Value').fill('71.6');
  await d.getByRole('button', { name: 'Save reading' }).click();
  await expect(d).toHaveCount(0);

  const readings = async () => (await api(page, account, '/api/health/readings?days=90')).filter((r) => r.type === 'weight');
  await expect.poll(async () => (await readings()).map((r) => Number(r.value))).toEqual([71.6]);

  await reloadTo(page, 'health');
  const row = main(page).locator('button[aria-label*="Weight"]').filter({ hasText: '71.6' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await dialog(page).getByRole('button', { name: /^Delete 71\.6 kg/ }).click();
  await page.getByRole('alertdialog', { name: 'Delete this reading?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await readings()).length).toBe(0);

  await reloadTo(page, 'health');
  await expect(main(page).getByText('71.6')).toHaveCount(0);
});

test('focus: start and stop posts nothing; a finished sprint posts one session', async ({ page, account }) => {
  await page.clock.install();
  await boot(page, account);
  await go(page, 'focus');
  const start = main(page).getByRole('button', { name: 'Start', exact: true });

  // Start, then stop it early: no session is recorded.
  await start.click();
  await expect(main(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Pause' }).click();
  await main(page).getByRole('button', { name: 'Reset timer' }).click();
  await expect(start).toBeVisible();
  const sessions = () => api(page, account, '/api/focus/sessions?days=1');
  expect(await sessions()).toHaveLength(0);

  // A full 25-minute sprint, with the clock run forward.
  await start.click();
  await expect(main(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/focus/sessions'));
  await page.clock.runFor('25:02');
  const req = await posted;
  expect(req.postDataJSON()).toMatchObject({ mode: 'focus', durationSec: 1500 });
  await expect.poll(async () => (await sessions()).length).toBe(1);
  expect((await sessions())[0].durationSec).toBe(1500);
});
