// I-03 command palette: Ctrl/Cmd+K, "/", the header's search button; go-to, item search,
// Quick add fall-through, g-then-letter, the "?" sheet, recent picks kept in ui_prefs.
import { test, expect, signInFast } from './fixtures.mjs';

const SHOTS = 'docs/evidence/palette/';
const shot = (page, name) => page.screenshot({ path: SHOTS + name + '.jpg', type: 'jpeg', quality: 70 });
const palette = (page) => page.getByRole('dialog', { name: 'Search and commands' });
const input = (page) => palette(page).getByRole('combobox');
const API = process.env.GB_E2E_API || 'http://localhost:8590';
const apiGet = (request, token, path) =>
  request.get(API + path, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json());

test.describe('keyboard', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name === 'mobile', 'a desktop path; the phone has the header button'));

  test('Ctrl+K and "/" open it focused; Escape closes and focus returns', async ({ page, account }) => {
    await signInFast(page, account);
    const habitsTab = page.locator('.gb-nav-wrap button, .gb-nav-wrap a').first();
    await habitsTab.focus();
    await page.keyboard.press('Control+K');
    await expect(palette(page)).toBeVisible();
    await expect(input(page)).toBeFocused();
    await expect(palette(page)).toHaveAttribute('aria-modal', 'true');
    await expect(input(page)).toHaveAttribute('aria-controls', /gb-palette-list/);
    await shot(page, 'open-empty');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await expect(habitsTab).toBeFocused();

    await page.keyboard.press('/');
    await expect(input(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    // Ctrl+K works from inside a text field too; "/" there is just a character.
    await page.locator('.gb-quickadd-row .gb-input').first().focus();
    await page.keyboard.press('/');
    await expect(palette(page)).toBeHidden();
    await page.keyboard.press('Control+K');
    await expect(input(page)).toBeFocused();
  });

  test('"mon" + Enter goes to Money, and the pick is remembered on the server', async ({ page, account, request }) => {
    await signInFast(page, account);
    await page.keyboard.press('Control+K');
    await input(page).fill('mon');
    const first = palette(page).getByRole('option').first();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toContainText('Money');
    await expect(first.locator('mark')).toHaveText('Mon');
    await shot(page, 'go-money');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/money$/);
    await expect(palette(page)).toBeHidden();

    // Recent: on the server (ui_prefs.paletteRecent), and first on the next open.
    await expect
      .poll(async () => ((await apiGet(request, account.token, '/api/auth/me')).uiPrefs || {}).paletteRecent)
      .toEqual(['screen:money']);
    await page.keyboard.press('Control+K');
    const recent = palette(page).getByRole('group', { name: 'Recent' });
    await expect(recent.getByRole('option')).toHaveText(['Money']);
  });

  test('finds a seeded note by a word in its title and opens it', async ({ page, account }) => {
    await signInFast(page, account);
    await page.keyboard.press('Control+K');
    await input(page).fill('trip');
    const opt = palette(page).getByRole('group', { name: 'Notes' }).getByRole('option').first();
    await expect(opt).toHaveText('Ideas for the trip');
    await expect(opt.locator('mark')).toHaveText('trip');
    // Arrows and Tab move the selection; the note is the only match, so it stays put.
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowUp');
    await expect(opt).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'find-note');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/notes$/);
    await expect(page.locator('.gb-note-modal')).toBeVisible();
    await expect(page.locator('.gb-note-modal')).toContainText(/Pack light/);
  });

  test('free text falls through to Quick add and creates a task', async ({ page, account, request }) => {
    await signInFast(page, account);
    await page.keyboard.press('Control+K');
    await input(page).fill('need to buy oat milk');
    const qa = palette(page).getByRole('option').first();
    await expect(qa).toHaveText(/Log with Quick add/);
    await expect(qa).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'quick-add-row');
    await page.keyboard.press('Enter');
    const preview = page.getByRole('dialog', { name: /Log this/ });
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview).toContainText(/buy oat milk/i);
    await shot(page, 'quick-add-preview');
    await preview.getByRole('button', { name: 'Log it' }).click();
    await expect
      // The assistant keeps "need to"; the no-AI fallback drops it. Either is the task.
      .poll(async () => (await apiGet(request, account.token, '/api/tasks')).some((t) => /buy oat milk/i.test(t.title)))
      .toBe(true);
  });

  test('a reminder, the theme and a Settings pane, each in one line', async ({ page, account }) => {
    await signInFast(page, account);
    await page.keyboard.press('Control+K');
    await input(page).fill('call mom');
    await expect(palette(page).getByRole('option').first()).toHaveText(/Call mom.*Repeats/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/calendar$/);
    await expect(page.locator('#gb-main')).toContainText('Call mom');

    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.keyboard.press('Control+K');
    await input(page).fill(theme === 'dark' ? 'light mode' : 'dark mode');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme);

    await page.keyboard.press('Control+K');
    await input(page).fill('alerts');
    await expect(palette(page).getByRole('option').first()).toHaveText('Settings: Alerts');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog').first()).toContainText('Notify me about');
  });

  test('"g c" goes to Calendar and "?" lists the shortcuts', async ({ page, account }) => {
    await signInFast(page, account);
    await page.locator('#gb-main').focus();
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/#\/calendar$/);
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(page).toHaveURL(/#\/home$/);

    await page.keyboard.press('Shift+?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Go to Calendar');
    await expect(sheet).toContainText('Go to Money');
    await shot(page, 'shortcuts');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
});

test('the header search button opens it (phone and desktop)', async ({ page, account }, info) => {
  await signInFast(page, account);
  const btn = page.getByRole('button', { name: 'Search and commands' });
  await btn.click();
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await input(page).fill('dentist');
  await expect(palette(page).getByRole('group', { name: 'Tasks' })).toContainText('Book the dentist');
  await shot(page, 'header-button-' + info.project.name);
  await palette(page).getByRole('option', { name: /Book the dentist/ }).click();
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole('dialog').first()).toBeVisible(); // Edit task
  // No horizontal overflow from the extra header button.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
