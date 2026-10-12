// Social fixes (Circle, Family, Report): each test fails on the code before its fix.
import { test, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const EV = 'docs/evidence/social/';

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

// The shared CDP Chrome flips prefers-color-scheme now and then, and app.js answers a
// system theme change with a full render() that rebuilds Circle and Family (FRS-19).
// A picked theme switches that listener off, so a test sees only its own repaints.
async function signInPinned(page, account) {
  const r = await call(account.token, '/api/auth/ui-prefs', 'PUT', { prefs: { ...account.user.uiPrefs, theme: 'light' } });
  account.user.uiPrefs = r.uiPrefs;
  await signInFast(page, account);
}

async function shot(page, id) {
  await page.screenshot({ path: EV + id + '.jpg', type: 'jpeg', quality: 60 });
}

test('SEC-2: an invite link asks before joining', async ({ page, account }, info) => {
  const owner = await seedAccount();
  const name = 'Morning Walkers ' + Date.now();
  const c = await call(owner.token, '/api/circles', 'POST', { name, goal: 'Walk 30 minutes', visibility: 'public' });

  await signInPinned(page, account);
  await go(page, 'circle?circle=' + c.id);
  // Main's join confirm: the link alone joins no one.
  const dialog = page.getByRole('alertdialog', { name: 'Join this circle?' });
  await expect(dialog).toBeVisible();
  // Nothing has happened yet: the link alone joins no one.
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(false);
  if (info.project.name.startsWith('mobile')) await shot(page, 'SEC-2');

  await dialog.getByRole('button', { name: 'Join circle' }).click();
  await expect(page.locator('[data-circle-id="' + c.id + '"]')).toBeVisible();
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(true);
  // Main's link confirm has no goal checkbox (FRS-11 stays on Browse / code joins).
  await expect(page.locator('.gb-toast-msg', { hasText: 'You joined ' + name + '.' })).toBeVisible();
});

test('SEC-2: Cancel on the join sheet leaves the user out', async ({ page, account }) => {
  const owner = await seedAccount();
  const c = await call(owner.token, '/api/circles', 'POST', { name: 'Quiet ' + Date.now(), visibility: 'public' });
  await signInPinned(page, account);
  await go(page, 'circle?circle=' + c.id);
  const dialog = page.getByRole('alertdialog', { name: 'Join this circle?' });
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  expect((await call(account.token, '/api/circles/mine')).some((x) => x.id === c.id)).toBe(false);
});

test('CRM-5: a reply sent while replies load stays, and Delete can be undone', async ({ page, account }, info) => {
  const c = await call(account.token, '/api/circles', 'POST', { name: 'Replies ' + Date.now(), visibility: 'public' });
  await call(account.token, '/api/circles/' + c.id + '/posts', 'POST', { body: 'First post' });

  // Hold the first replies GET until a reply has been sent.
  let release;
  const held = new Promise((r) => (release = r));
  let holding = true;
  await page.route('**/comments', async (route) => {
    if (route.request().method() === 'GET' && holding) {
      holding = false;
      const res = await route.fetch(); // fetched before the reply exists
      await held;
      return route.fulfill({ response: res });
    }
    return route.continue();
  });
  const deletes = [];
  page.on('request', (r) => r.method() === 'DELETE' && r.url().includes('/comments/') && deletes.push(r.url()));

  await signInPinned(page, account);
  await go(page, 'circle');
  await page.getByRole('button', { name: 'Replies (0)' }).click();
  const field = page.getByLabel('Write a reply');
  await field.fill('Sent early');
  await field.press('Enter');
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();
  release();
  await page.waitForTimeout(600);
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete reply' }).click();
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toHaveCount(0);
  if (info.project.name.startsWith('mobile')) await shot(page, 'CRM-5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.gb-circle-reply', { hasText: 'Sent early' })).toBeVisible();
  await page.waitForTimeout(6500);
  expect(deletes).toEqual([]);
});

test('FRS-10: Add member opens on the form, reads the name, and adds another in place', async ({ page, account }, info) => {
  await signInPinned(page, account);
  await go(page, 'family');
  await page.getByRole('button', { name: /Add (your first )?member/ }).first().click();
  // No profile-or-invite chooser first: the form is the first step.
  const name = page.getByPlaceholder('e.g. Amma');
  await expect(name).toBeVisible();
  const rel = page.locator('.gb-family-panel select').first();
  await name.fill('Appa');
  await expect(rel).toHaveValue('father');
  await page.getByRole('button', { name: 'Save and add another' }).click();
  await expect(page.locator('.gb-toast-msg', { hasText: 'Added Appa.' })).toBeVisible();
  await expect(name).toHaveValue('');
  await name.fill('Akka');
  await expect(rel).toHaveValue('sister');
  if (info.project.name.startsWith('mobile')) await shot(page, 'FRS-10');
  await page.getByRole('button', { name: 'Add member', exact: true }).click();
  await expect(page.getByPlaceholder('e.g. Amma')).toHaveCount(0);
  const fam = await call(account.token, '/api/family');
  const got = fam.members.map((m) => m.name + ':' + m.relationship);
  expect(got).toEqual(expect.arrayContaining(['Appa:father', 'Akka:sister']));
});

test('FRS-18: a new circle starts with a sprint running and an Invite one tap away', async ({ page, account }, info) => {
  await signInPinned(page, account);
  await go(page, 'circle');
  await page.getByRole('button', { name: 'New circle' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New circle' });
  await dialog.getByPlaceholder('e.g. Morning Runners').fill('Sprinters');
  await expect(dialog.getByLabel(/Start a 7-day habit sprint today/)).toBeChecked();
  await dialog.getByRole('button', { name: 'Create' }).click();
  const card = page.locator('.gb-circle-card', { hasText: 'Sprinters' });
  await expect(card).toContainText('7-day habit sprint');
  await expect(page.getByRole('button', { name: 'Invite', exact: true })).toBeVisible();
  if (info.project.name.startsWith('mobile')) await shot(page, 'FRS-18');
  const mine = await call(account.token, '/api/circles/mine');
  const c = mine.find((x) => x.name === 'Sprinters');
  expect((await call(account.token, '/api/circles/' + c.id + '/challenges')).length).toBe(1);
});

test('FRS-12: the weekly review focus shows on Report and becomes a habit in one tap', async ({ page, account }, info) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // this Monday
  const weekStart = d.toLocaleDateString('en-CA');
  await call(account.token, '/api/weekly-review', 'PUT', { weekStart, wins: 'Ran twice', focus: 'Sleep by 11' });
  await signInPinned(page, account);
  await go(page, 'report');
  await expect(page.getByText('This week’s focus')).toBeVisible();
  await expect(page.getByText('Sleep by 11', { exact: true })).toBeVisible();
  if (info.project.name.startsWith('mobile')) await shot(page, 'FRS-12');
  await page.getByRole('button', { name: 'Make it a habit' }).click();
  await expect(page.locator('.gb-toast-msg', { hasText: 'Added “Sleep by 11” to your habits.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make it a habit' })).toHaveCount(0);
  expect((await call(account.token, '/api/habits')).map((x) => x.name)).toContain('Sleep by 11');
});

test('EXF-2: Report does not scroll sideways', async ({ page, account }) => {
  await signInPinned(page, account);
  await go(page, 'report');
  await expect(page.getByText('Trends').first()).toBeVisible();
  const [sw, cw] = await page.locator('#gb-main').evaluate((m) => [m.scrollWidth, m.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
});

test('EXF-6: Members shows a cheer already sent today as sent', async ({ page, account }) => {
  const other = await seedAccount();
  const c = await call(account.token, '/api/circles', 'POST', { name: 'Cheers ' + Date.now(), visibility: 'public' });
  await call(other.token, '/api/circles/' + c.id + '/join', 'POST');
  await call(account.token, '/api/circles/' + c.id + '/members/' + other.user.id + '/cheer', 'POST');
  await signInPinned(page, account);
  await go(page, 'circle');
  await page.locator('[data-circle-id="' + c.id + '"]').getByRole('button', { name: /^Options for / }).click();
  await page.getByRole('button', { name: 'Members' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: /^Cheered .+ today$/ })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: /^Cheer .+ on$/ })).toHaveCount(0);
});

test('EXF-13: Pantry Add with an empty name says what to do', async ({ page, account }) => {
  await call(account.token, '/api/family/members', 'POST', { name: 'Amma', relationship: 'mother' });
  await signInPinned(page, account);
  await go(page, 'family');
  await page.getByRole('button', { name: /Pantry/ }).first().click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.locator('.gb-toast-msg', { hasText: 'Type the item first.' })).toBeVisible();
});
