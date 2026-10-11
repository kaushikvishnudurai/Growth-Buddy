// Evidence for the hostile tester's client-side findings (docs/audit/hostile.md, HOS-*): each test
// fails before its fix.
import { test as base, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

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
test.use({ screenshot: 'off' });

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
const get = async (page, account, path) => (await page.request.get(path, auth(account.token))).json();
const send = (page, account, method, path, data) =>
  page.request.fetch(path, { method, ...auth(account.token), data: data ? JSON.stringify(data) : undefined });
const main = (page) => page.locator('#gb-main');
const shot = (page, id) =>
  test.info().project.name === 'desktop-chrome' &&
  page.screenshot({ path: `docs/evidence/hostile/${id}.jpg`, type: 'jpeg', quality: 70 });

async function boot(page, account, screen) {
  const me = await get(page, account, '/api/auth/me');
  await signInFast(page, { token: account.token, user: me });
  if (screen) await go(page, screen);
  await page.waitForTimeout(600);
}

// A human-speed double (or triple) tap at one point on screen: whatever is under the pointer
// each time gets the click, as on a phone.
async function tapsAt(page, locator, n, gap) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  for (let i = 0; i < n; i++) {
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    if (i < n - 1) await page.waitForTimeout(gap);
  }
}

const today = () => new Date().toLocaleDateString('en-CA');

test('HOS-4: a double tap on a reminder delete removes only that reminder', async ({ page, account }) => {
  for (const [text, time] of [['DBL a', '23:20'], ['DBL b', '23:30'], ['DBL c', '23:40']]) {
    await send(page, account, 'POST', '/api/reminders', { text, date: today(), time, repeat: 'none', tag: 'personal' });
  }
  await boot(page, account, 'calendar');
  const del = main(page).getByRole('button', { name: 'Delete reminder: DBL a' });
  await expect(del).toBeVisible();
  await tapsAt(page, del, 2, 200);
  await page.waitForTimeout(1200);
  const left = (await get(page, account, '/api/reminders')).map((r) => r.text);
  expect(left).not.toContain('DBL a');
  expect(left).toEqual(expect.arrayContaining(['DBL b', 'DBL c']));
  await shot(page, 'HOS-4');
});

test('HOS-4: Undo brings back every reminder deleted while it shows', async ({ page, account }) => {
  for (const [text, time] of [['UND a', '23:20'], ['UND b', '23:30']]) {
    await send(page, account, 'POST', '/api/reminders', { text, date: today(), time, repeat: 'none', tag: 'personal' });
  }
  await boot(page, account, 'calendar');
  await main(page).getByRole('button', { name: 'Delete reminder: UND a' }).click();
  await page.waitForTimeout(700);
  await main(page).getByRole('button', { name: 'Delete reminder: UND b' }).click();
  await page.getByRole('button', { name: 'Undo' }).last().click();
  await expect
    .poll(async () => (await get(page, account, '/api/reminders')).map((r) => r.text).sort().join())
    .toContain('UND a,UND b');
  await expect(main(page).getByText('UND a')).toBeVisible();
  await expect(main(page).getByText('UND b')).toBeVisible();
});

test('HOS-5: two quick taps on a Home task tick only that task', async ({ page, account }) => {
  await boot(page, account);
  const box = main(page).getByRole('button', { name: 'Mark as done: Book the dentist' });
  await expect(box).toBeVisible();
  await tapsAt(page, box, 3, 250);
  await page.waitForTimeout(1800);
  const tasks = Object.fromEntries((await get(page, account, '/api/tasks')).map((t) => [t.title, t.done]));
  expect(tasks).toMatchObject({ 'Book the dentist': true, 'Plan this week': false, 'Renew passport': false });
  // It still moves to the bottom, once it has settled.
  await expect(main(page).locator('.gb-tasks-list .gb-row').last()).toContainText('Book the dentist');
  await shot(page, 'HOS-5');
});

test('HOS-3: two quick milestone edits on a slow link: the newest lands last', async ({ page, account }) => {
  await boot(page, account, 'goals');
  let first = true;
  await page.route('**/api/goals/*/progress', async (route) => {
    if (route.request().method() === 'PUT' && first) {
      first = false;
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });
  const input = main(page).getByRole('textbox', { name: 'New milestone' }).first();
  await input.fill('Race one');
  await input.press('Enter');
  await page.waitForTimeout(300);
  const again = main(page).getByRole('textbox', { name: 'New milestone' }).first();
  await again.fill('Race two');
  await again.press('Enter');
  await page.waitForTimeout(3500);
  const goal = (await get(page, account, '/api/goals')).flatMap((s) => s.goals || []).find((g) => g.title === 'Run a 10K');
  const titles = ((goal.progress || {}).milestones || []).map((m) => m.title);
  expect(titles).toEqual(['Race one', 'Race two']);
  await shot(page, 'HOS-3');
});

test.describe('HOS-2 (client half)', () => {
  test.use({ allowed: async ({}, use) => use(['/progress', 'status of 409']) });
  test('a milestone added on another device survives this tab adding one', async ({ page, account }) => {
    await boot(page, account, 'goals');
    const goal = (await get(page, account, '/api/goals')).flatMap((s) => s.goals || []).find((g) => g.title === 'Run a 10K');
    // The other device saves first (no If-Match: an unchecked write).
    await send(page, account, 'PUT', `/api/goals/${goal.id}/progress`, {
      milestones: [{ id: 'other', title: 'Tab two milestone', done: false }],
    });
    const input = main(page).getByRole('textbox', { name: 'New milestone' }).first();
    await input.fill('Tab one milestone');
    await input.press('Enter');
    await expect
      .poll(async () => {
        const g = (await get(page, account, '/api/goals')).flatMap((s) => s.goals || []).find((x) => x.id === goal.id);
        return ((g.progress || {}).milestones || []).map((m) => m.title).sort().join();
      })
      .toBe('Tab one milestone,Tab two milestone');
    await expect(main(page).getByText('Tab two milestone')).toBeVisible();
    await shot(page, 'HOS-2');
  });
});

test('HOS-6: back after a minute away, Home shows ticks made elsewhere; a tick sends done', async ({ page, account }) => {
  await boot(page, account);
  const tasks = await get(page, account, '/api/tasks');
  const plan = tasks.find((t) => t.title === 'Plan this week');
  await send(page, account, 'PATCH', `/api/tasks/${plan.id}/toggle`, { done: true });
  // Hidden for over a minute, then visible again.
  await page.evaluate(() => {
    const real = Date.now.bind(Date);
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = () => real() + 61_000;
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(main(page).getByRole('button', { name: 'Mark as not done: Plan this week' })).toBeVisible();
  const req = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/toggle'));
  await main(page).getByRole('button', { name: 'Mark as done: Renew passport' }).click();
  expect(JSON.parse((await req).postData() || '{}')).toEqual({ done: true });
  await shot(page, 'HOS-6');
});

test.describe('HOS-8', () => {
  test.use({ allowed: async ({}, use) => use(['/api/tasks/', 'status of 404']) });
  test('a task deleted on another device leaves on tick, without a retry', async ({ page, account }) => {
    await boot(page, account);
    const passport = (await get(page, account, '/api/tasks')).find((t) => t.title === 'Renew passport');
    await send(page, account, 'DELETE', `/api/tasks/${passport.id}`);
    await main(page).getByRole('button', { name: 'Mark as done: Renew passport' }).click();
    await expect(page.locator('#gb-toast-slot').getByText('That task was deleted on another device.')).toBeVisible();
    await expect(main(page).getByText('Renew passport')).toHaveCount(0);
    await shot(page, 'HOS-8');
  });
});

test('HOS-7: an expense dated before 1900 is refused under the field', async ({ page, account }) => {
  await boot(page, account, 'money');
  let posted = false;
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/money')) posted = true;
  });
  await page.getByRole('button', { name: /Add expense/ }).first().click();
  const dlg = page.getByRole('dialog').last();
  await dlg.getByRole('spinbutton').first().fill('77');
  const date = dlg.locator('input[type=date]');
  expect(await date.getAttribute('min')).toBe('1900-01-01');
  await date.fill('0001-01-01');
  await dlg.getByRole('button', { name: /^(Add|Save)/ }).last().click();
  await expect(dlg.getByText('Pick a day in 1900 or later.')).toBeVisible();
  expect(posted).toBe(false);
  await shot(page, 'HOS-7');
});

test('HOS-9: a task title of only zero-width characters is refused', async ({ page, account }) => {
  await boot(page, account);
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/tasks$/.test(r.url())) posted = true;
  });
  await main(page).locator('.gb-sectiontitle', { hasText: /^Tasks/ }).getByRole('button', { name: '+ Add' }).click();
  const dlg = page.getByRole('dialog', { name: 'New task' });
  await dlg.getByRole('textbox').first().fill('\u200b\u200b\u200b');
  await dlg.getByRole('button', { name: 'Add task' }).click();
  await expect(dlg.getByText('Give the task a title.')).toBeVisible();
  expect(posted).toBe(false);
  await shot(page, 'HOS-9');
});
