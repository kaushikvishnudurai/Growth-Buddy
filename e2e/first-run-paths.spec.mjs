// First-run paths (docs/audit/new-user.md): the parent's way to Family, the plan sheet's copy, the
// checklist's task and notification steps, the habit list under the finger, toasts on navigation.
// Each test fails on the code before its fix. No UI sign-ups: a fresh API account (`emptyAccount`)
// boots into the same first-run sheet a real sign-up lands on.
import { mkdirSync } from 'node:fs';
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const EV = 'docs/evidence/first-run-paths/';
mkdirSync(EV, { recursive: true });

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

async function boot(page, account, { setupDone = false } = {}) {
  if (setupDone) {
    const r = await call(account.token, '/api/auth/ui-prefs', 'PUT', { prefs: { ...account.user.uiPrefs, setupDone: true } });
    account.user.uiPrefs = r.uiPrefs;
  }
  const host = new URL(process.env.GB_E2E_BASE || 'http://localhost:5591').hostname;
  await page.context().addCookies([{ name: 'gb.theme', value: 'light', domain: host, path: '/' }]);
  await signInFast(page, account);
}

async function shot(page, id, info) {
  if (info.project.name !== 'mobile-chrome') return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: EV + id + '.jpg', type: 'jpeg', quality: 60 });
}

// A browser that has refused notifications (headless Chrome answers the prompt with "denied").
const denyNotifications = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true });
    Notification.requestPermission = async () => 'denied';
  });

test.setTimeout(120_000);

test('NEW-6: the plan sheet title, subtitle and Start follow the selection', async ({ page, emptyAccount }, info) => {
  await boot(page, emptyAccount);
  const sheet = page.locator('.gb-setup-modal');
  const title = sheet.locator('.gb-modal-title');
  const sub = sheet.locator('.gb-modal-sub');
  const start = sheet.getByRole('button', { name: 'Start with this plan' });
  await expect(title).toHaveText('Your plan is ready', { timeout: 20_000 });
  await sheet.getByRole('button', { name: 'Balanced day' }).click();
  await expect(title).not.toHaveText('Your plan is ready');
  await expect(sub).not.toContainText(/balanced day/i);
  await expect(start).toBeDisabled();
  await shot(page, 'NEW-6', info);
  await sheet.getByRole('button', { name: 'Save money' }).click();
  await expect(title).toHaveText('Your plan is ready');
  await expect(sub).toContainText('Save money');
  await expect(sub).not.toContainText(/balanced day/i);
  await expect(start).toBeEnabled();
});

test('NEW-3/4/10/13: a parent goes from the plan sheet to a member and today\'s meals, and Home links back', async ({ page, emptyAccount }, info) => {
  await boot(page, emptyAccount);
  let taps = 0;
  const tap = async (loc) => {
    taps++;
    await loc.click();
  };
  const sheet = page.locator('.gb-setup-modal');
  await expect(sheet.getByText('Your plan is ready')).toBeVisible({ timeout: 20_000 });
  // NEW-3: a pack for the parent, and Start leads to Family's Add member form.
  await tap(sheet.getByRole('button', { name: 'Balanced day' }));
  await tap(sheet.getByRole('button', { name: 'Family meals' }));
  await expect(sheet.locator('.gb-qa-row', { hasText: 'Family' })).toBeVisible();
  await shot(page, 'NEW-3-sheet', info);
  await tap(sheet.getByRole('button', { name: 'Start with this plan' }));
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Add family member' })).toBeVisible({ timeout: 15_000 });
  await shot(page, 'NEW-3', info);

  // NEW-10: nothing preselected; gender follows the relationship until it is picked by hand.
  const panel = page.locator('.gb-family-panel');
  const rel = panel.locator('select').nth(0);
  const gender = panel.locator('select').nth(1);
  await expect(rel).toHaveValue('');
  await expect(gender).toHaveValue('');
  await rel.selectOption('mother');
  await expect(gender).toHaveValue('Female');
  await rel.selectOption('');
  taps++; // the name field's focus
  await panel.getByPlaceholder('e.g. Amma').fill('Anu');
  taps += 2; // the select and its option
  await rel.selectOption('child');
  await expect(gender).toHaveValue('');
  await shot(page, 'NEW-10', info);
  await tap(panel.getByRole('button', { name: 'Add member', exact: true }));

  // NEW-4: the next step is offered, and the tab says what it holds.
  await expect(page.getByRole('heading', { name: 'Family members' })).toBeVisible();
  const anu = page.locator('.gb-family-card', { hasText: 'Anu' });
  await expect(anu).toContainText('Child');
  await expect(anu).not.toContainText('Female');
  await expect(page.getByRole('button', { name: /^Meals today/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0);
  const next = page.getByRole('button', { name: 'Plan today’s meals' });
  await expect(next).toBeVisible();
  await shot(page, 'NEW-4', info);
  await tap(next);

  // NEW-13: diet asked once with a visible default; no child among the cooks.
  await expect(page.getByRole('heading', { name: "Today's meal plan" })).toBeVisible();
  const diet = page.getByRole('combobox', { name: 'Food preference' });
  await expect(diet).toHaveValue('Vegetarian');
  await diet.scrollIntoViewIfNeeded();
  await shot(page, 'NEW-13', info);
  await tap(page.getByRole('button', { name: 'Make a meal plan' }));
  const meals = page.getByRole('list', { name: 'Meals, in order' });
  await expect(meals).toBeVisible({ timeout: 60_000 });
  const cook = page.getByRole('combobox', { name: /^Who cooks/ }).first();
  await expect(cook.locator('option', { hasText: 'Anu' })).toHaveCount(0);
  expect(await cook.locator('option').count()).toBeGreaterThan(1); // "Who cooks?" + the parent
  await expect(diet).toHaveCount(0);
  const fam = await call(emptyAccount.token, '/api/family');
  expect(fam.members.map((m) => m.profile && m.profile.dietPreference)).toEqual(fam.members.map(() => 'Vegetarian'));
  await shot(page, 'NEW-13-plan', info);
  console.log(`[first-run-paths ${info.project.name}] parent: ${taps} taps from the plan sheet to today's meal plan`);
  expect(taps).toBeLessThanOrEqual(9);

  // NEW-3: Home now has a way back to the meals.
  await go(page, 'home');
  const card = page.locator('.gb-home-family');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await shot(page, 'NEW-3-home', info);
  await card.getByRole('button', { name: /Meals today/ }).click();
  await expect(page.getByRole('heading', { name: "Today's meal plan" })).toBeVisible({ timeout: 15_000 });
});

test('NEW-5: "Add a task for today" opens with Due on today', async ({ page, emptyAccount }, info) => {
  await boot(page, emptyAccount, { setupDone: true });
  await page.getByRole('button', { name: /Add a task for today/ }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));
  await expect(dialog.locator('input[type=datetime-local]')).toHaveValue(new RegExp('^' + today + 'T'));
  await dialog.getByPlaceholder('e.g. Finish the design review').fill('Call the bank');
  await expect(dialog.locator('input[type=datetime-local]')).toHaveValue(new RegExp('^' + today + 'T'));
  await shot(page, 'NEW-5', info);
  await dialog.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(async () => {
    const tasks = await call(emptyAccount.token, '/api/tasks');
    const t = tasks.find((x) => x.title === 'Call the bank');
    return t && t.dueAt ? new Date(t.dueAt).toLocaleDateString('en-CA') : null;
  }).toBe(today);
});

test('NEW-8: a refused notification prompt does not tick "Get reminded on time"', async ({ page, emptyAccount }, info) => {
  await denyNotifications(page);
  await boot(page, emptyAccount, { setupDone: true });
  const card = page.locator('.gb-onboard');
  await expect(card).toBeVisible();
  await expect(card.getByText('Notifications are blocked')).toBeVisible();
  await expect(card.getByText(/browser’s settings/)).toBeVisible();
  await expect(page.locator('.gb-onboard-title')).not.toContainText(/^1 of/);
  await shot(page, 'NEW-8', info);
});

test('NEW-9: a ticked habit keeps its row for a moment', async ({ page, account }, info) => {
  await boot(page, account);
  const rows = page.locator('.gb-habit-strip .gb-habit-line');
  await expect(rows.first().locator('.name')).toHaveText('Read 20 pages');
  await rows.first().locator('.gb-check').click();
  await expect(rows.first()).toHaveClass(/is-done/);
  // Past the optimistic render and the server's answer (both re-render Home), inside the hold.
  await page.waitForTimeout(2000);
  await expect(rows.first().locator('.name')).toHaveText('Read 20 pages');
  await expect(rows.first()).toHaveClass(/is-done/);
  await shot(page, 'NEW-9', info);
});

test('NEW-15: a toast from one screen does not follow to the next', async ({ page, emptyAccount }, info) => {
  await denyNotifications(page);
  await boot(page, emptyAccount, { setupDone: true });
  await page.locator('.gb-onboard').getByRole('button', { name: /Notifications are blocked|Get reminded on time/ }).click();
  const msg = page.locator('.gb-toast-msg');
  await expect(msg).toHaveCount(1);
  await page.waitForTimeout(1300);
  await go(page, 'habits');
  // Before the fix this error toast stood for ~8 s; gone means it went with the screen.
  await expect(msg).toHaveCount(0, { timeout: 2000 });
  await shot(page, 'NEW-15', info);
});
