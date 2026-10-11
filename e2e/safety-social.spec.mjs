// Safety net for the social side: Growth Circle, mentorship, Family, Buddy chat, the bell and
// Quick add. Pins flows that work today so a later fix cannot break them silently.
// Two-user flows open a second browser context for a second seeded account.
import { test, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });
const json = (token, data) => ({ headers: { Authorization: 'Bearer ' + token }, data });

// Boots signed in with the server's current user, past the first-run sheet. The theme is pinned
// because the shared headless Chrome flips prefers-color-scheme, and with no picked theme the app
// re-renders on every flip, which rebuilds Family / Circle and drops an open panel or composer.
async function boot(page, account, { name } = {}) {
  await page.request.put('/api/auth/ui-prefs', json(account.token, { prefs: { theme: 'light', setupDone: true } }));
  if (name) await page.request.put('/api/auth/profile', json(account.token, { displayName: name, timezone: account.user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }));
  const me = await (await page.request.get('/api/auth/me', auth(account.token))).json();
  await signInFast(page, { token: account.token, user: me });
  return me;
}

// A second signed-in page in its own context, held to the same evidence gate as the first.
async function secondPage(browser, info, guard, allowed) {
  const u = info.project.use;
  const ctx = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !allowed.some((a) => m.text().includes(a))) guard.push('page2 console: ' + m.text());
  });
  page.on('pageerror', (e) => guard.push('page2 pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !allowed.some((a) => r.url().includes(a))) guard.push(`page2 http ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return { page, ctx };
}

// The feed opens by itself after a create; otherwise it waits behind "Show posts".
async function showPosts(page) {
  const box = page.getByRole('textbox', { name: 'Write a post' });
  await expect(async () => {
    if (!(await box.isVisible())) await page.getByRole('button', { name: 'Show posts' }).click({ timeout: 2000 });
    await expect(box).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

test('circle: create private, post, kudos; a second account joins by code and sees the post', async ({ page, account, browser, guard, allowed }, info) => {
  const other = await seedAccount({ seed: false });
  await boot(page, account);
  await go(page, 'circle');
  await page.getByRole('button', { name: 'New circle' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New circle' });
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Dawn Club');
  await dlg.getByRole('checkbox').check();
  await dlg.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Dawn Club' })).toBeVisible();

  const mine = await (await page.request.get('/api/circles/mine', auth(account.token))).json();
  const circle = mine.find((c) => c.name === 'Dawn Club');
  expect(circle && circle.joinCode).toBeTruthy();
  // The options sheet shows the same code the server minted.
  await page.getByRole('button', { name: 'Options for Dawn Club' }).click();
  await expect(page.getByRole('dialog', { name: 'Dawn Club' }).getByText(circle.joinCode)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Dawn Club' })).toHaveCount(0);

  await showPosts(page);
  await page.getByRole('textbox', { name: 'Write a post' }).fill('Ran 5K at dawn');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByText('Ran 5K at dawn')).toBeVisible();
  await page.getByRole('button', { name: 'Give kudos (0 kudos)' }).click();
  await expect(page.getByRole('button', { name: 'Take back your kudos (1 kudos)' })).toBeVisible();
  const posts = await (await page.request.get(`/api/circles/${circle.id}/posts`, auth(account.token))).json();
  const list = Array.isArray(posts) ? posts : posts.posts || posts.items || [];
  expect(list.find((p) => (p.body || p.text || p.content) === 'Ran 5K at dawn')).toBeTruthy();

  const { page: p2, ctx } = await secondPage(browser, info, guard, allowed);
  try {
    await boot(p2, other);
    await go(p2, 'circle');
    await p2.getByRole('button', { name: 'Browse circles' }).click();
    await p2.getByRole('button', { name: 'Join a private circle with a code' }).click();
    const join = p2.getByRole('dialog', { name: 'Join with a code' });
    await join.getByRole('textbox', { name: 'Circle code' }).fill(circle.joinCode);
    await join.getByRole('button', { name: 'Join' }).click();
    await expect(join).toHaveCount(0);
    await expect(p2.getByRole('heading', { name: 'Dawn Club' })).toBeVisible();
    // The code form is stacked on Browse, which stays open after the join.
    const browse = p2.getByRole('dialog', { name: 'Browse circles' });
    if (await browse.isVisible()) await browse.getByRole('button', { name: 'Close' }).click();
    await expect(browse).toHaveCount(0);
    await showPosts(p2);
    await expect(p2.getByText('Ran 5K at dawn')).toBeVisible();
    // The joiner sees the owner's kudos count and has not given one.
    await expect(p2.getByRole('button', { name: 'Give kudos (1 kudos)' })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('mentorship: request, the other account accepts, chat lines reach both sides', async ({ page, account, browser, guard, allowed }, info) => {
  const mentor = await seedAccount({ seed: false });
  // Every seeded account is "Asha Rao"; a unique name makes search find exactly one person.
  const mentorName = 'Meera Iyer ' + Math.floor(Math.random() * 1e6);
  const { page: p2, ctx } = await secondPage(browser, info, guard, allowed);
  try {
    await boot(p2, mentor, { name: mentorName });
    const me = await boot(page, account);
    await go(page, 'circle');
    await page.getByRole('button', { name: 'Find someone' }).click();
    const find = page.getByRole('dialog', { name: 'Find people' });
    await find.getByRole('searchbox').fill(mentorName);
    const row = find.locator('.gb-person-row').filter({ hasText: mentorName });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Get mentored' }).click();
    const note = page.getByRole('dialog', { name: 'Add a short note' });
    await note.getByRole('textbox', { name: 'Note (optional)' }).fill('Help me keep my runs going');
    await note.getByRole('button', { name: 'Send invite' }).click();
    await expect(note).toHaveCount(0);
    await expect
      .poll(async () => (await (await page.request.get('/api/mentorship/requests/outgoing', auth(account.token))).json()).length)
      .toBe(1);

    // The mentor accepts from their Circle screen.
    await go(p2, 'circle');
    await p2.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect
      .poll(async () => {
        const out = await (await page.request.get('/api/mentorship/requests/outgoing', auth(account.token))).json();
        return out[0] && out[0].status;
      })
      .toBe('accepted');

    // The mentee writes first; the mentor opens the thread and sees it.
    await page.reload();
    await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
    await go(page, 'circle');
    await page.getByRole('button', { name: 'Message ' + mentorName }).click();
    await page.getByRole('textbox', { name: 'Write a message to ' + mentorName }).fill('Ran 3K today');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const menteeLog = page.getByRole('log', { name: 'Messages with ' + mentorName });
    await expect(menteeLog.locator('.gb-chat-msg.is-mine')).toHaveText(/Ran 3K today/);

    await p2.getByRole('button', { name: 'Message ' + me.displayName }).click();
    const mentorLog = p2.getByRole('log', { name: 'Messages with ' + me.displayName });
    await expect(mentorLog.locator('.gb-chat-msg:not(.is-mine)')).toHaveText(/Ran 3K today/);
    // A reply reaches the mentee's open sheet live, with no reload.
    await p2.getByRole('textbox', { name: 'Write a message to ' + me.displayName }).fill('Great, keep it up');
    await p2.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(menteeLog.locator('.gb-chat-msg:not(.is-mine)')).toHaveText(/Great, keep it up/, { timeout: 20_000 });
  } finally {
    await ctx.close();
  }
});

test('family: add an unmapped member, add a chore for them, tick it; the meal plan loads', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'family');
  await page.getByRole('button', { name: 'Add your first member' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Amma');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('heading', { name: 'Family members' })).toBeVisible();
  await expect(page.getByText('Not linked yet')).toBeVisible();
  const fam = await (await page.request.get('/api/family', auth(account.token))).json();
  const amma = (fam.members || []).find((m) => m.name === 'Amma' || m.displayName === 'Amma');
  expect(amma && amma.status).toBe('unmapped');

  await page.getByRole('button', { name: /^Chores/ }).click();
  await page.getByRole('textbox', { name: 'New chore' }).fill('Water the plants');
  await page.getByRole('group', { name: 'Assign to' }).getByRole('button', { name: 'Amma' }).click();
  await page.getByRole('button', { name: 'Add chore' }).click();
  const chore = page.getByRole('checkbox', { name: 'Water the plants' });
  await expect(chore).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Assign Water the plants' })).toHaveValue(/.+/);
  await expect(page.getByRole('combobox', { name: 'Assign Water the plants' }).locator('option:checked')).toHaveText('Amma');
  await chore.click();
  await expect(chore).toBeChecked();
  await expect
    .poll(async () => {
      const chores = await (await page.request.get('/api/family/chores', auth(account.token))).json();
      const c = (Array.isArray(chores) ? chores : chores.chores || []).find((x) => x.title === 'Water the plants');
      return c ? Boolean(c.done || c.doneAt || c.completedAt || c.lastDoneAt) : null;
    })
    .toBe(true);

  await page.getByRole('button', { name: 'Meals today', exact: true }).click();
  await page.getByRole('button', { name: 'Make a meal plan' }).click();
  const meals = page.getByRole('list', { name: 'Meals, in order' });
  await expect(meals).toBeVisible({ timeout: 30_000 });
  for (const meal of ['Breakfast', 'Lunch', 'Dinner']) await expect(meals.getByRole('heading', { name: meal })).toBeVisible();
  expect(await meals.getByRole('listitem').getByRole('button').count()).toBeGreaterThan(3);
});

test('buddy chat: sends a message and shows a reply', async ({ page, account, allowed }) => {
  // The stream route may fail over to the plain POST when the model is unreachable.
  allowed.push('/messages/stream');
  await boot(page, account);
  await go(page, 'mentor');
  await page.getByRole('textbox', { name: 'Message Buddy' }).fill('I want to sleep earlier');
  await page.getByRole('button', { name: 'Send' }).click();
  const log = page.getByRole('log', { name: 'Conversation with Buddy' });
  await expect(log.locator('.gb-msg-bubble.is-user')).toHaveText('I want to sleep earlier');
  const reply = log.locator('.gb-msg-bubble.is-bot').last();
  await expect(reply).toHaveText(/\w{3,}.*\w{3,}/, { timeout: 40_000 });
  await expect(page.locator('[aria-label="Buddy is typing"]')).toHaveCount(0, { timeout: 40_000 });
  await expect(page.getByRole('textbox', { name: 'Message Buddy' })).toHaveValue('');
});

test('notifications: the bell shows an unread card and mark all read clears it', async ({ page, emptyAccount }) => {
  const other = await seedAccount({ seed: false });
  const r = await page.request.post('/api/mentorship/requests', json(other.token, { toUserId: emptyAccount.user.id, direction: 'request' }));
  expect(r.status()).toBe(201);
  await expect
    .poll(async () => (await (await page.request.get('/api/notifications/unread-count', auth(emptyAccount.token))).json()).count)
    .toBeGreaterThan(0);

  await boot(page, emptyAccount);
  await page.getByRole('button', { name: 'Notifications' }).click();
  const mark = page.getByText('Mark all read', { exact: true });
  await expect(mark).toBeVisible();
  await mark.click();
  await expect(mark).toHaveCount(0);
  await expect
    .poll(async () => (await (await page.request.get('/api/notifications/unread-count', auth(emptyAccount.token))).json()).count)
    .toBe(0);
});

test('quick add: typed "add task buy milk" creates the task', async ({ page, account }) => {
  await boot(page, account);
  await page.getByRole('button', { name: 'Quick add' }).click();
  const qa = page.getByRole('dialog', { name: 'Quick add' });
  await qa.getByRole('textbox', { name: 'Quick log in your own words' }).fill('add task buy milk');
  await qa.getByRole('button', { name: 'Log it' }).click();
  // "Log this?" / "Log it" for one item, "Log these?" / "Log them" for several.
  const confirm = page.getByRole('dialog', { name: /^Log (this|these)\?$/ });
  await expect(confirm.getByRole('checkbox', { name: /New task: buy milk/i })).toBeChecked();
  await confirm.getByRole('button', { name: /^Log (it|them)$/ }).click();
  await expect(confirm).toHaveCount(0);
  await expect
    .poll(async () => {
      const tasks = await (await page.request.get('/api/tasks', auth(account.token))).json();
      return tasks.filter((t) => /^buy milk$/i.test(t.title)).length;
    })
    .toBe(1);
  await go(page, 'home');
  await expect(page.getByText(/^buy milk$/i).first()).toBeVisible();
});
