// Safety net for the planning flows: Home ticks and score, tasks, habits, Calendar reminders, Notes,
// Goals. Each test owns a fresh seeded account and checks the outcome after a reload and, where
// cheap, on the API.
import { test as base, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

// Concurrent sign-ups can deadlock on email_verification_tokens and 500 (see the safety-net
// report); retry the seed so that backend bug does not read as a failure of these flows.
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

// The suite attaches to a shared Chrome: a screenshot captures every page in it (other suites'
// too), which costs seconds per test. The trace still records each failure.
test.use({ screenshot: 'off' });

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });
const api = async (page, account, path) => (await page.request.get(path, auth(account.token))).json();
const today = () => new Date().toLocaleDateString('en-CA');

// signInFast with the server's current user (the seeder's `user` predates its timezone PUT, and a
// stale UTC session opens a timezone offer over the screen), then let the boot loads settle.
async function boot(page, account, screen) {
  const me = await api(page, account, '/api/auth/me');
  await signInFast(page, { token: account.token, user: me });
  if (screen) await go(page, screen);
  await settle(page);
}

async function reload(page, screen) {
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  if (screen) await go(page, screen);
  await settle(page);
}

// A screen repaints as each of its loads lands, and a click on the old paint is lost. Wait until
// #gb-main has gone 600 ms without a DOM change (or 8 s pass).
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

const main = (page) => page.locator('#gb-main');

/* ---------------- Home ---------------- */

test('Home: ticking a task updates the count and score, unticking restores them', async ({ page, account }) => {
  await boot(page, account);
  const m = main(page);
  // "0/1 tasks": the denominator is what is due today, so read it rather than pin it.
  const tally = async () => {
    const t = await m.getByText(/\d+\/\d+ tasks/).first().textContent();
    const [, done, total] = t.match(/(\d+)\/(\d+) tasks/);
    return { done: Number(done), total: Number(total) };
  };
  const scoreText = async () => (await m.getByText(/^\d+%$/).first().textContent()).trim();
  const start = await tally();
  const before = await scoreText();
  const doneOnServer = async () => (await api(page, account, '/api/tasks')).find((t) => t.title === 'Book the dentist').done;
  await m.getByRole('button', { name: 'Mark as done: Book the dentist' }).click();
  await expect.poll(async () => (await tally()).done).toBe(start.done + 1);
  await expect.poll(scoreText).not.toBe(before);
  await expect.poll(doneOnServer).toBe(true);
  await reload(page);
  await expect.poll(async () => (await tally()).done).toBe(start.done + 1);
  await m.getByRole('button', { name: 'Mark as not done: Book the dentist' }).click();
  await expect.poll(tally).toEqual(start);
  await expect.poll(scoreText).toBe(before);
  await expect.poll(doneOnServer).toBe(false);
});

test('Home: ticking a habit counts it and survives a reload', async ({ page, account }) => {
  await boot(page, account);
  const m = main(page);
  await expect(m.getByText('1/2 habits')).toBeVisible();
  await m.getByRole('button', { name: 'Mark as done: Read 20 pages' }).click();
  await expect(m.getByRole('button', { name: 'Mark as not done: Read 20 pages' })).toHaveAttribute('aria-pressed', 'true');
  await expect(m.getByText('2/2 habits')).toBeVisible();
  await reload(page);
  await expect(m.getByText('2/2 habits')).toBeVisible();
  await expect(m.getByRole('button', { name: 'Mark as not done: Read 20 pages' })).toBeVisible();
});

/* ---------------- Tasks ---------------- */

test('Tasks: add, edit and delete from Home', async ({ page, account }) => {
  await boot(page, account);
  const m = main(page);
  await m.getByRole('button', { name: '+ Add' }).first().click();
  let dlg = page.getByRole('dialog', { name: 'New task' });
  await dlg.getByRole('textbox', { name: 'Title' }).fill('Water the plants');
  await dlg.getByRole('radio', { name: 'High' }).click();
  await dlg.getByRole('button', { name: 'Add task' }).click();
  await expect(dlg).toBeHidden();
  await expect(m.getByText('Water the plants')).toBeVisible();
  const created = (await api(page, account, '/api/tasks')).find((t) => t.title === 'Water the plants');
  expect(created && created.priority).toBe('High');

  await m.getByRole('button', { name: 'Edit Water the plants' }).click();
  dlg = page.getByRole('dialog', { name: 'Edit task' });
  await dlg.getByRole('textbox', { name: 'Title' }).fill('Water the balcony plants');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toBeHidden();
  await reload(page);
  await expect(m.getByText('Water the balcony plants')).toBeVisible();

  await m.getByRole('button', { name: 'Edit Water the balcony plants' }).click();
  await page.getByRole('dialog', { name: 'Edit task' }).getByRole('button', { name: 'Delete task' }).click();
  await page.getByRole('dialog', { name: 'Delete “Water the balcony plants”?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(m.getByText('Water the balcony plants')).toHaveCount(0);
  await expect
    .poll(async () => (await api(page, account, '/api/tasks')).some((t) => t.id === created.id))
    .toBe(false);
  await reload(page);
  await expect(m.getByText('Water the balcony plants')).toHaveCount(0);
});

/* ---------------- Habits ---------------- */

test('Habits: add, rename and delete', async ({ page, account }) => {
  await boot(page, account, 'habits');
  const m = main(page);
  await m.getByRole('button', { name: 'Add', exact: true }).click();
  let dlg = page.getByRole('dialog', { name: 'New habit' });
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Stretch');
  await dlg.getByRole('button', { name: 'Add habit' }).click();
  await expect(dlg).toBeHidden();
  await expect(m.getByRole('button', { name: 'Edit habit: Stretch' })).toBeVisible();
  const created = (await api(page, account, '/api/habits')).find((x) => x.name === 'Stretch');
  expect(created).toBeTruthy();

  await m.getByRole('button', { name: 'Edit habit: Stretch' }).click();
  dlg = page.getByRole('dialog', { name: 'Edit habit' });
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Stretch 10 min');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toBeHidden();
  await reload(page);
  await expect(m.getByRole('button', { name: 'Edit habit: Stretch 10 min' })).toBeVisible();

  await m.getByRole('button', { name: 'Edit habit: Stretch 10 min' }).click();
  await page.getByRole('dialog', { name: 'Edit habit' }).getByRole('button', { name: 'Delete habit' }).click();
  await page.getByRole('dialog', { name: 'Delete “Stretch 10 min”?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(m.getByRole('button', { name: 'Edit habit: Stretch 10 min' })).toHaveCount(0);
  await expect
    .poll(async () => (await api(page, account, '/api/habits')).some((x) => x.id === created.id))
    .toBe(false);
});

/* ---------------- Calendar reminders ---------------- */

// No time: a timed one-off has to be later than now, which a run near midnight cannot promise.
async function addReminder(page, { text, repeat }) {
  const m = main(page);
  await m.getByRole('textbox', { name: 'Reminder text' }).fill(text);
  if (repeat) await m.getByRole('radiogroup', { name: 'Repeat' }).getByRole('radio', { name: repeat }).click();
  await m.getByRole('button', { name: 'Add reminder' }).click();
  await expect(m.getByRole('button', { name: 'Edit reminder: ' + text })).toBeVisible();
}
const reminderNamed = async (page, account, text) =>
  (await api(page, account, '/api/reminders')).find((r) => r.text === text);

test('Calendar: a one-off reminder is created, edited and marked done', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Pick up the parcel' });
  const r = await reminderNamed(page, account, 'Pick up the parcel');
  expect(r).toBeTruthy();
  expect(r.date).toBe(today());
  expect(r.repeat || 'none').toMatch(/none|once/);

  await m.getByRole('button', { name: 'Edit reminder: Pick up the parcel' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit reminder' });
  await dlg.getByRole('textbox', { name: 'Reminder text' }).fill('Pick up the parcel at the desk');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toBeHidden();
  await expect(m.getByRole('button', { name: 'Edit reminder: Pick up the parcel at the desk' })).toBeVisible();

  await m.getByRole('checkbox', { name: 'Mark done: Pick up the parcel at the desk' }).click();
  await expect(m.getByRole('checkbox', { name: /Pick up the parcel at the desk/ })).toBeChecked();
  await reload(page, 'calendar');
  await expect(m.getByRole('checkbox', { name: /Pick up the parcel at the desk/ })).toBeChecked();
});

test('Calendar: a daily reminder repeats, and deleting one day keeps the series', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Take vitamins', repeat: 'Daily' });
  const r = await reminderNamed(page, account, 'Take vitamins');
  expect(r && r.repeat).toBe('daily');

  await m.getByRole('button', { name: 'Delete reminder: Take vitamins' }).click();
  await page.getByRole('dialog', { name: 'Delete recurring reminder' }).getByRole('button', { name: /^Only this day/ }).click();
  await expect(m.getByRole('button', { name: 'Edit reminder: Take vitamins' })).toHaveCount(0);
  // The series stays.
  expect(await reminderNamed(page, account, 'Take vitamins')).toBeTruthy();
  await reload(page, 'calendar');
  await expect(m.getByRole('button', { name: 'Edit reminder: Take vitamins' })).toHaveCount(0);
  // Tomorrow still has it.
  const tomorrow = new Date(Date.now() + 864e5);
  const label = tomorrow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  await m.getByRole('button', { name: new RegExp('^' + label + '\\b') }).first().click();
  await expect(m.getByRole('button', { name: 'Edit reminder: Take vitamins' })).toBeVisible();
});

test('Calendar: deleting the whole series removes a daily reminder', async ({ page, account }) => {
  await boot(page, account, 'calendar');
  const m = main(page);
  await addReminder(page, { text: 'Water the garden', repeat: 'Daily' });
  await m.getByRole('button', { name: 'Delete reminder: Water the garden' }).click();
  await page.getByRole('dialog', { name: 'Delete recurring reminder' }).getByRole('button', { name: /^Delete this series/ }).click();
  await expect(m.getByRole('button', { name: 'Edit reminder: Water the garden' })).toHaveCount(0);
  await expect.poll(async () => !!(await reminderNamed(page, account, 'Water the garden'))).toBe(false);
  await reload(page, 'calendar');
  await expect(m.getByText('Water the garden')).toHaveCount(0);
});

/* ---------------- Notes ---------------- */

async function newNote(page, title, body) {
  const m = main(page);
  await m.getByRole('button', { name: 'Jot something down…' }).click();
  await expect(m.getByRole('textbox', { name: 'Note title' })).toBeVisible();
  await m.getByRole('textbox', { name: 'Note title' }).fill(title);
  const area = m.locator('.gb-note-composer [contenteditable="true"]');
  await area.click();
  await page.keyboard.type(body);
  await m.getByRole('button', { name: 'Save note' }).click();
  await expect(m.getByRole('heading', { name: title })).toBeVisible();
}
// A plain <article> opened through its stretched "Open <title>" button (A11-8).
const card = (page, title) => main(page).locator('.gb-note-card').filter({ has: page.getByRole('heading', { name: title }) });

test('Notes: create, edit, and the edit survives a reload', async ({ page, account }) => {
  await boot(page, account, 'notes');
  await newNote(page, 'Grocery list', 'Rice and dal');
  await card(page, 'Grocery list').click();
  const dlg = page.getByRole('dialog', { name: 'Note' });
  const area = dlg.getByRole('textbox', { name: 'Write something…' });
  await area.click();
  await page.keyboard.press('End');
  await page.keyboard.type(', and curd');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
  await reload(page, 'notes');
  await expect(card(page, 'Grocery list')).toContainText('Rice and dal, and curd');
  const n = (await api(page, account, '/api/notes')).find((x) => x.title === 'Grocery list');
  expect(n && n.body).toContain('Rice and dal, and curd');
});

test('Notes: pin moves a note to the top and persists', async ({ page, account }) => {
  await boot(page, account, 'notes');
  const m = main(page);
  await newNote(page, 'Newest note', 'Written last');
  // The newest note is first; pinning the older one lifts it above.
  const titles = () => m.locator('.gb-notes h3').allTextContents();
  await expect.poll(async () => (await titles())[0]).toBe('Newest note');
  await card(page, 'Ideas for the trip').getByRole('button', { name: 'Pin this note' }).click();
  await expect.poll(async () => (await titles())[0]).toBe('Ideas for the trip');
  await reload(page, 'notes');
  await expect.poll(async () => (await titles())[0]).toBe('Ideas for the trip');
  const n = (await api(page, account, '/api/notes')).find((x) => x.title === 'Ideas for the trip');
  expect(n.pinned).toBe(true);
});

test('Notes: archive, then trash and restore', async ({ page, account }) => {
  await boot(page, account, 'notes');
  const m = main(page);
  await newNote(page, 'Old receipts', 'File them');

  // Archive: leaves the main list, shows under Archived.
  await card(page, 'Old receipts').click();
  await page.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Archive note' }).click();
  await expect(m.getByRole('heading', { name: 'Old receipts' })).toHaveCount(0);
  await m.getByRole('button', { name: /^Archived/ }).click();
  await expect(m.getByRole('heading', { name: 'Old receipts' })).toBeVisible();
  expect((await api(page, account, '/api/notes?archived=true')).some((x) => x.title === 'Old receipts')).toBe(true);

  // Trash the seeded note from the main list, then restore it.
  await m.getByRole('button', { name: /^Notes/ }).first().click();
  await card(page, 'Ideas for the trip').click();
  // No confirm: it only goes to the Trash, and the toast offers Undo.
  await page.getByRole('dialog', { name: 'Note' }).getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('.gb-toast').filter({ hasText: 'Note deleted.' }).getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(m.getByRole('heading', { name: 'Ideas for the trip' })).toHaveCount(0);
  await reload(page, 'notes');
  await expect(m.getByRole('heading', { name: 'Ideas for the trip' })).toHaveCount(0);
  await m.getByRole('button', { name: /^Trash/ }).click();
  await expect(m.getByRole('heading', { name: 'Ideas for the trip' })).toBeVisible();
  expect((await api(page, account, '/api/notes/trash')).some((x) => x.title === 'Ideas for the trip')).toBe(true);
  await m.getByRole('button', { name: /^Restore/ }).first().click();
  await m.getByRole('button', { name: /^Notes/ }).first().click();
  await expect(m.getByRole('heading', { name: 'Ideas for the trip' })).toBeVisible();
  await expect
    .poll(async () => (await api(page, account, '/api/notes')).some((x) => x.title === 'Ideas for the trip'))
    .toBe(true);
});

/* ---------------- Goals ---------------- */

test('Goals: create, add and tick a milestone, delete', async ({ page, account }) => {
  await boot(page, account, 'goals');
  const m = main(page);
  await m.getByRole('button', { name: 'New goal' }).click();
  const dlg = page.getByRole('dialog', { name: 'New goal' });
  await dlg.getByRole('textbox', { name: 'Goal' }).fill('Learn to swim');
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  await expect(dlg).toBeHidden();
  const goal = m.locator('.gb-goal-card').filter({ has: page.getByRole('button', { name: 'Edit goal: Learn to swim' }) }).last();
  await expect(goal).toBeVisible();

  await goal.getByRole('textbox', { name: 'New milestone' }).fill('Float for 30 seconds');
  await goal.getByRole('button', { name: 'Add milestone' }).click();
  const ms = goal.getByRole('checkbox', { name: /Float for 30 seconds/ });
  await expect(ms).toBeVisible();
  await ms.click();
  await expect(ms).toBeChecked();
  await reload(page, 'goals');
  await expect(goal.getByRole('checkbox', { name: /Float for 30 seconds/ })).toBeChecked();

  // Undo instead of a confirm (EXP-5): the DELETE goes when the toast does.
  await goal.getByRole('button', { name: 'Delete goal' }).click();
  await expect(page.locator('.gb-toast').filter({ hasText: 'Goal deleted.' }).getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(m.getByRole('button', { name: 'Edit goal: Learn to swim' })).toHaveCount(0);
  await expect
    .poll(async () => (await api(page, account, '/api/goals')).some((s) => (s.goals || []).some((g) => g.title === 'Learn to swim')), { timeout: 12_000 })
    .toBe(false);
  await reload(page, 'goals');
  await expect(m.getByText('Learn to swim')).toHaveCount(0);
});
