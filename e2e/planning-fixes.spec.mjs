// Evidence for the planning fixes (Calendar, Notes, Goals): each test fails before its fix.
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

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });
const api = async (page, account, path) => (await page.request.get(path, auth(account.token))).json();
// /api/goals answers sections by horizon.
const goals = async (page, account) => (await api(page, account, '/api/goals')).flatMap((s) => s.goals || []);
const main = (page) => page.locator('#gb-main');
const shot = (page, id) =>
  test.info().project.name === 'desktop' &&
  page.screenshot({ path: `docs/evidence/planning/${id}.jpg`, type: 'jpeg', quality: 70 });

async function boot(page, account, screen) {
  const me = await api(page, account, '/api/auth/me');
  await signInFast(page, { token: account.token, user: me });
  if (screen) await go(page, screen);
  await settle(page);
}

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        const root = document.getElementById('gb-main') || document.body;
        let t = setTimeout(finish, 600);
        const cap = setTimeout(finish, 8000);
        const mo = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(finish, 600);
        });
        mo.observe(root, { childList: true, subtree: true });
        function finish() {
          mo.disconnect();
          clearTimeout(t);
          clearTimeout(cap);
          done();
        }
      })
  );
}

async function newGoal(page, title) {
  await main(page).getByRole('button', { name: 'New goal' }).click();
  const dlg = page.getByRole('dialog', { name: 'New goal' });
  await dlg.getByRole('textbox', { name: 'Goal' }).fill(title);
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  await expect(dlg).toBeHidden();
}

/* ---------------- Goals ---------------- */

test('EXP-1: editing a goal saves the new title', async ({ page, account }) => {
  await boot(page, account, 'goals');
  const m = main(page);
  await newGoal(page, 'Learn to swim');
  await m.getByRole('button', { name: 'Edit goal: Learn to swim' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit goal' });
  await dlg.getByRole('textbox', { name: 'Goal' }).fill('Swim one kilometre');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toBeHidden();
  await expect(m.getByRole('button', { name: 'Edit goal: Swim one kilometre' })).toBeVisible();
  await expect
    .poll(async () => (await goals(page, account)).some((g) => g.title === 'Swim one kilometre'))
    .toBe(true);
  await shot(page, 'EXP-1');
});

test('EXP-8: goal form errors show under the field', async ({ page, account }) => {
  await boot(page, account, 'goals');
  await main(page).getByRole('button', { name: 'New goal' }).click();
  const dlg = page.getByRole('dialog', { name: 'New goal' });
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  const title = dlg.getByRole('textbox', { name: 'Goal' });
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(dlg.locator('.gb-field-error')).toHaveText('Give the goal a name first.');
  await title.fill('Cut sugar');
  await expect(dlg.locator('.gb-field-error')).toHaveCount(0);
  await dlg.getByRole('spinbutton', { name: 'Track daily for how many days' }).fill('5000');
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  await expect(dlg.locator('.gb-affix + .gb-field-error')).toHaveText(/1 to 1000/);
  await shot(page, 'EXP-8');
});

test('EXP-9: a completed goal keeps only Reopen, and Reopen brings the controls back', async ({ page, account }) => {
  await boot(page, account, 'goals');
  const m = main(page);
  const card = m.locator('.gb-goal-card').filter({ has: page.getByRole('button', { name: 'Edit goal: Run a 10K' }) });
  await card.getByRole('textbox', { name: 'New milestone' }).fill('Run 5K');
  await card.getByRole('button', { name: 'Add milestone' }).click();
  await expect(card.getByRole('checkbox', { name: /Run 5K/ })).toBeVisible();
  await card.getByRole('button', { name: 'Mark done' }).click();
  // A finished goal celebrates (and may unlock an achievement after it): one Nice! each.
  const nice = page.locator('.gb-celebrate').getByRole('button', { name: 'Nice!' });
  for (let i = 0; i < 3; i++) {
    if (!(await nice.waitFor({ timeout: 2500 }).then(() => true, () => false))) break;
    await nice.click();
    await page.waitForTimeout(400);
  }
  await m.getByText(/^Completed \(1\)/).click();
  await expect(card.getByRole('button', { name: 'Reopen' })).toBeVisible();
  for (const name of ['Log action', 'Track days', 'Add a task', 'Add milestone', 'Edit milestone: Run 5K'])
    await expect(card.getByRole('button', { name })).toHaveCount(0);
  await expect(card.getByRole('checkbox', { name: /Run 5K/ })).toBeDisabled();
  await shot(page, 'EXP-9');
  await card.getByRole('button', { name: 'Reopen' }).click();
  await expect(card.getByRole('button', { name: 'Log action' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add milestone' })).toBeVisible();
});

test('CNT-3: a failed Goals load says so and retries in place', async ({ page, account }) => {
  let fail = true;
  await page.route('**/api/goals', (r) => (fail && r.request().method() === 'GET' ? r.abort('aborted') : r.continue()));
  await boot(page, account, 'goals');
  const m = main(page);
  await expect(m.getByText('Could not load your goals.')).toBeVisible();
  await shot(page, 'CNT-3');
  fail = false;
  await m.getByRole('button', { name: 'Try again' }).click();
  await expect(m.getByRole('button', { name: 'Edit goal: Run a 10K' })).toBeVisible();
  await expect(m.getByText('Could not load your goals.')).toHaveCount(0);
});

/* ---------------- Calendar ---------------- */

async function addReminder(page, { text, repeat }) {
  const m = main(page);
  await m.getByRole('textbox', { name: 'Reminder text' }).fill(text);
  if (repeat) await m.getByRole('radiogroup', { name: 'Repeat' }).getByRole('radio', { name: repeat }).click();
  await m.getByRole('button', { name: 'Add reminder' }).click();
  await expect(m.getByRole('button', { name: 'Edit reminder: ' + text })).toBeVisible();
}
const dayButton = (page, offset) => {
  const label = new Date(Date.now() + offset * 864e5).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return main(page).getByRole('button', { name: new RegExp('^' + label + '\\b') }).first();
};

test('EXP-4: after "Only past days", the new first day offers no past-days delete', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Stretch', repeat: 'Daily' });
  // Today is the first day: no past to delete.
  await m.getByRole('button', { name: 'Delete reminder: Stretch' }).click();
  let dlg = page.getByRole('dialog', { name: 'Delete recurring reminder' });
  await expect(dlg.getByRole('button', { name: /^Only past days/ })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  // Two days on, drop the days before: that day becomes the series' first.
  await dayButton(page, 2).click();
  await m.getByRole('button', { name: 'Delete reminder: Stretch' }).click();
  await dlg.getByRole('button', { name: /^Only past days/ }).click();
  await expect.poll(async () => (await api(page, account, '/api/reminders')).find((r) => r.text === 'Stretch')?.from).toBeTruthy();
  await settle(page);
  await m.getByRole('button', { name: 'Delete reminder: Stretch' }).click();
  dlg = page.getByRole('dialog', { name: 'Delete recurring reminder' });
  await expect(dlg.getByRole('button', { name: /^Only this day/ })).toBeVisible();
  await expect(dlg.getByRole('button', { name: /^Only past days/ })).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: /^This & all future/ })).toHaveCount(0);
  await shot(page, 'EXP-4');
});

test('EXP-5: deleting a goal offers Undo instead of a confirm', async ({ page, account }) => {
  await boot(page, account, 'goals');
  const m = main(page);
  const edit = m.getByRole('button', { name: 'Edit goal: Run a 10K' });
  const card = m.locator('.gb-goal-card').filter({ has: page.getByRole('button', { name: 'Edit goal: Run a 10K' }) });
  await card.getByRole('button', { name: 'Delete goal' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(edit).toHaveCount(0);
  await shot(page, 'EXP-5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(edit).toBeVisible();
  // Undone inside the window: the DELETE never went.
  await page.waitForTimeout(6500);
  expect((await goals(page, account)).some((g) => g.title === 'Run a 10K')).toBe(true);
  // Without Undo it goes for good.
  await card.getByRole('button', { name: 'Delete goal' }).click();
  await expect(edit).toHaveCount(0);
  await expect.poll(async () => (await goals(page, account)).some((g) => g.title === 'Run a 10K'), { timeout: 12_000 }).toBe(false);
});

test('EXP-5: a one-off reminder still ahead deletes on one tap, with Undo', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Call the bank' });
  await m.getByRole('button', { name: 'Delete reminder: Call the bank' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(m.getByRole('button', { name: 'Edit reminder: Call the bank' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(m.getByRole('button', { name: 'Edit reminder: Call the bank' })).toBeVisible();
  await expect.poll(async () => (await api(page, account, '/api/reminders')).some((r) => r.text === 'Call the bank')).toBe(true);
});

test('EXP-3: the done tick sits inside its circle', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Water plants' });
  const check = m.getByRole('checkbox', { name: 'Mark done: Water plants' });
  await check.click();
  await expect(m.getByRole('checkbox', { name: /Water plants/ })).toBeChecked();
  const off = await m.locator('.gb-rem-check.is-on').first().evaluate((b) => {
    const r = b.getBoundingClientRect();
    const i = b.firstElementChild.getBoundingClientRect();
    return Math.max(Math.abs(r.x + r.width / 2 - (i.x + i.width / 2)), Math.abs(r.y + r.height / 2 - (i.y + i.height / 2)));
  });
  expect(off).toBeLessThan(2);
  if (test.info().project.name === 'desktop')
    await m.locator('.gb-rem-row').filter({ hasText: 'Water plants' }).screenshot({ path: 'docs/evidence/planning/EXP-3.jpg', type: 'jpeg', quality: 80 });
});

/* ---------------- Notes ---------------- */

test('EXP-2 + CNT-16: a repaint mid-typing keeps the caret, and Notes fetches once', async ({ page, account }) => {
  const gets = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'GET' && /^\/api\/notes(\/counts|\/draft)?$/.test(u.pathname)) gets.push(u.pathname);
  });
  await boot(page, account);
  gets.length = 0;
  await go(page, 'notes');
  await settle(page);
  const m = main(page);
  await m.getByRole('button', { name: 'Jot something down…' }).click();
  const area = m.locator('.gb-note-composer [contenteditable="true"]');
  await area.click();
  await page.keyboard.type('alpha');
  // A system theme flip re-renders the whole app (followSystemTheme -> render()).
  for (const scheme of ['dark', 'light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
  }
  await page.keyboard.type(' beta');
  await expect(area).toHaveText('alpha beta');
  await shot(page, 'EXP-2');
  const count = (p) => gets.filter((x) => x === p).length;
  expect([count('/api/notes'), count('/api/notes/counts'), count('/api/notes/draft')]).toEqual([1, 1, 1]);
});

test('A11-8: a note card is read as a note, opened by its own button, with Pin beside it', async ({ page, account }) => {
  await boot(page, account, 'notes');
  const m = main(page);
  const card = m.locator('.gb-note-card').filter({ has: page.getByRole('heading', { name: 'Ideas for the trip' }) });
  await expect(card).not.toHaveAttribute('role', 'button');
  await expect(card).not.toHaveAttribute('tabindex', /.*/);
  const open = card.getByRole('button', { name: 'Open Ideas for the trip' });
  await expect(open).toHaveAccessibleDescription(/\S/);
  // No control inside another: the pin is the open button's sibling.
  expect(await card.locator('button button, [role=button] button').count()).toBe(0);
  await expect(card.getByRole('button', { name: 'Pin this note' })).toBeVisible();
  // Keyboard: Tab reaches it, Enter opens the note.
  await open.focus();
  if (test.info().project.name === 'desktop')
    await card.screenshot({ path: 'docs/evidence/planning/A11-8.jpg', type: 'jpeg', quality: 80 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Note' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Note' })).toHaveCount(0);
  // A pointer tap anywhere on the card still opens it.
  await card.click({ position: { x: 60, y: 60 } });
  await expect(page.getByRole('dialog', { name: 'Note' })).toBeVisible();
});

test('OFF-10: offline before Notes ever loaded says so, and a note made then is not a "saved copy"', async ({ page, account }) => {
  // No network for notes: a failure with no status, which Notes reads as offline.
  await page.route('**/api/notes**', (r) => r.abort('aborted'));
  await boot(page, account, 'notes');
  const m = main(page);
  await expect(m.getByText(/notes haven't been saved to this device yet/)).toBeVisible();
  // A note written now waits in the outbox; it must not become this device's copy.
  await m.getByRole('button', { name: 'Jot something down…' }).click();
  await m.getByRole('textbox', { name: 'Note title' }).fill('Written offline');
  await m.getByRole('button', { name: 'Save note' }).click();
  await expect(m.getByRole('heading', { name: 'Written offline' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  await go(page, 'notes');
  await settle(page);
  await expect(m.getByText('Offline — showing saved copy, editing disabled')).toBeHidden();
  await expect(m.getByText(/notes haven't been saved to this device yet/)).toBeVisible();
  await shot(page, 'OFF-10');
});
