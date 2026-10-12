// First-run paths (docs/audit/new-user.md): the parent's way to Family, the checklist's task and
// notification steps, the habit list under the finger, toasts on navigation. Each test fails on the
// code before its fix. No UI sign-ups: a fresh API account (`emptyAccount`) stands in for a new one.
import { mkdirSync } from 'node:fs';
import { test, expect, signInFast, go, showDay } from './fixtures.mjs';

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
    // iOS Safari outside an installed web app has no Notification at all (mobile-webkit).
    if (!('Notification' in window)) return;
    Object.defineProperty(Notification, 'permission', { get: () => 'denied', configurable: true });
    Notification.requestPermission = async () => 'denied';
  });

test.setTimeout(120_000);

test('NEW-3/4/10/13: a parent goes from the Family tab to a member and today\'s meals, and Home links back', async ({ page, emptyAccount }, info) => {
  // Main's first run has no Family pack: the parent starts from the Family tab.
  await boot(page, emptyAccount, { setupDone: true });
  let taps = 0;
  const tap = async (loc) => {
    taps++;
    await loc.click();
  };
  await go(page, 'family');
  await tap(page.getByRole('button', { name: 'Add your first member' }));
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
  console.log(`[first-run-paths ${info.project.name}] parent: ${taps} taps from the Family tab to today's meal plan`);
  expect(taps).toBeLessThanOrEqual(7);

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
  // No Notification there, so the app rightly never says "blocked" (pushSupported() is false).
  test.skip(info.project.name === 'mobile-webkit', 'no web push on iOS Safari');
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
  await showDay(page);
  const rows = page.locator('#gb-main .gb-tl-row.is-habit');
  await expect(rows.first().locator('.gb-tl-title')).toHaveText('Read 20 pages');
  await rows.first().locator('.gb-check').click();
  await expect(rows.first()).toHaveClass(/is-done/);
  // Past the optimistic render and the server's answer (both re-render Home), inside the hold.
  await page.waitForTimeout(2000);
  await expect(rows.first().locator('.gb-tl-title')).toHaveText('Read 20 pages');
  await expect(rows.first()).toHaveClass(/is-done/);
  await shot(page, 'NEW-9', info);
});

test('NEW-15: a toast from one screen does not follow to the next', async ({ page, emptyAccount }, info) => {
  // The toast comes from the notification step, which iOS Safari never offers.
  test.skip(info.project.name === 'mobile-webkit', 'no web push on iOS Safari');
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
