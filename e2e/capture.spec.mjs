// The daily capture loop (docs/audit/friction-capture.md): each test drives a capture flow, counts
// the taps it took, and checks what the server holds. The AI gateway sometimes answers and sometimes
// 401s, so every Quick add test passes on both paths: a clear single read by the model saves at once
// with an Undo toast; the plain-pattern fallback still shows its preview (one tap more). Outcomes
// are asserted, never the model's wording.
import { test, expect, signInFast } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const SHOTS = 'docs/evidence/capture/';
const keyOf = (d) => d.toLocaleDateString('en-CA');
const today = () => keyOf(new Date());
const tomorrow = () => keyOf(new Date(Date.now() + 864e5));

// The shared CDP Chrome is slow under several suites at once: a cold boot alone has taken 28 s.
test.describe.configure({ timeout: 180_000 });

const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });
// Not one still fading out: a model read closes the sheet at once, and the next tap can beat its 180 ms exit.
const dialog = (page) => page.locator('.gb-modal-overlay:not(.is-closing) > .gb-modal[role=dialog]');

async function get(page, account, path) {
  const r = await page.request.get(API + path, { headers: { Authorization: 'Bearer ' + account.token } });
  expect(r.status(), path).toBe(200);
  return r.json();
}
async function post(page, account, path, data) {
  const r = await page.request.post(API + path, { headers: { Authorization: 'Bearer ' + account.token }, data });
  expect(r.status(), path).toBeLessThan(300);
  return r.json().catch(() => null);
}

/* Header + (1 tap), type into the box that already has the focus (0 taps), Enter (1 tap); then
   "Log it" on the preview if this read went through it (1 tap). Returns {taps, fallback}. */
async function quickAdd(page, text, inspect) {
  const parsed = page.waitForResponse((r) => r.url().includes('/api/quick-add'));
  await page.getByRole('button', { name: 'Quick add' }).click();
  const box = dialog(page).getByLabel('Quick log in your own words');
  await expect(box).toBeFocused(); // FRC-4: no tap to reach it
  await box.pressSequentially(text, { delay: 5 });
  await box.press('Enter');
  const res = await (await parsed).json();
  const fallback = !res || res.configured === false || !!res.unavailable;
  test.info().annotations.push({ type: 'quick-add path', description: (fallback ? 'fallback' : 'model') + ': ' + text });
  let taps = 2;
  const preview = dialog(page).filter({ hasText: /Log (this|these)/ });
  if (fallback || (res.intents || []).length !== 1) {
    await expect(preview).toBeVisible();
    if (inspect) await inspect(preview);
    await preview.getByRole('button', { name: /^Log (it|them)$/ }).click();
    taps++;
  } else if (inspect) await inspect(page.locator('.gb-toast').last());
  await expect(preview).toHaveCount(0);
  return { taps, fallback, res };
}
// Tasks' own + Add: Home's order is the user's, and a young account's puts Habits first.
const addTask = (page) =>
  page.locator('#gb-main .gb-sectiontitle', { has: page.getByRole('heading', { name: 'Tasks', exact: true }) }).getByRole('button', { name: '+ Add' });
const toast = (page, re) => page.locator('.gb-toast').filter({ hasText: re });
// The toast after a Quick add: what it was (one model read) or where it went (the preview).
const undoToast = (page) => page.locator('.gb-toast').filter({ has: page.getByRole('button', { name: 'Undo' }) });

test('quick add: "need to buy milk" is a task in 2 taps (3 on the fallback), and Undo removes it', async ({ page, account }) => {
  await boot(page, account);
  const { taps, fallback } = await quickAdd(page, 'need to buy milk');
  expect(taps).toBeLessThanOrEqual(fallback ? 3 : 2); // before: 4 taps, 3 screens
  const t = undoToast(page);
  await expect(t).toBeVisible();
  await page.screenshot({ path: SHOTS + 'FRC-4.jpg', quality: 70 });
  await expect.poll(async () => (await get(page, account, '/api/tasks')).filter((t) => /milk/i.test(t.title)).length).toBe(1);
  await t.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await get(page, account, '/api/tasks')).filter((t) => /milk/i.test(t.title)).length).toBe(0);
});

test('quick add: a read without the assistant keeps its preview (3 taps), then Undo', async ({ page, account }) => {
  // Whatever the gateway does today, answer as the plain-pattern fallback does.
  await page.route('**/api/quick-add', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, configured: true, unavailable: true } });
  });
  await boot(page, account);
  const { taps, fallback } = await quickAdd(page, 'need to buy bread');
  expect([fallback, taps]).toEqual([true, 3]);
  await expect(undoToast(page)).toBeVisible();
  await expect.poll(async () => (await get(page, account, '/api/tasks')).filter((t) => /bread/i.test(t.title)).length).toBe(1);
  await undoToast(page).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await get(page, account, '/api/tasks')).filter((t) => /bread/i.test(t.title)).length).toBe(0);
});

test('quick add: an expense lands in the account the expense dialog defaults to (FRC-3), Undo takes it out', async ({ page, account }) => {
  await boot(page, account);
  const before = await get(page, account, '/api/money');
  const cash = (before.accounts || []).find((a) => a.kind === 'cash');
  expect(cash, 'the server seeds Cash').toBeTruthy();
  const { fallback } = await quickAdd(page, 'spent 250 on lunch');
  const t = undoToast(page);
  await expect(t).toBeVisible();
  if (!fallback) await expect(t).toContainText('Cash');
  await page.screenshot({ path: SHOTS + 'FRC-3.jpg', quality: 70 });
  await expect.poll(async () => (await get(page, account, '/api/money')).expenses.filter((e) => Number(e.amount) === 250).length).toBe(1);
  const m = await get(page, account, '/api/money');
  const row = m.expenses.find((e) => Number(e.amount) === 250);
  expect(row.accountId).toBe(cash.id); // the dialog's default (fixed on main; kept as a guard)
  await t.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await get(page, account, '/api/money')).expenses.filter((e) => Number(e.amount) === 250).length).toBe(0);
});

test('quick add: income lands in the income dialog\'s default account (FRC-3)', async ({ page, account }) => {
  await boot(page, account);
  const bank = ((await get(page, account, '/api/money')).accounts || []).find((a) => a.kind === 'bank');
  await quickAdd(page, 'got salary 50000');
  await expect.poll(async () => (await get(page, account, '/api/money')).income.filter((e) => Number(e.amount) === 50000).length).toBe(1);
  const row = (await get(page, account, '/api/money')).income.find((e) => Number(e.amount) === 50000);
  expect(row.accountId).toBe(bank.id);
});

test('quick add: "slept 7h, feeling good" merges into the logged night and mood (FRC-2)', async ({ page, account }) => {
  // Seeded today: 23:00 to 06:30 good; mood good, high energy, calm.
  await boot(page, account);
  // The preview (or, for a lone model read, the toast) says what changes.
  await quickAdd(page, 'slept 7h, feeling good', async (where) => {
    await expect(where).toContainText('replaces');
    await page.screenshot({ path: SHOTS + 'FRC-2.jpg', quality: 70 });
  });
  await expect
    .poll(async () => {
      const d = await get(page, account, '/api/daily-logs');
      const s = (d.sleepByDate || {})[today()] || {};
      return String(s.bedtime).slice(0, 5) + '-' + String(s.wakeTime).slice(0, 5) + '-' + s.quality;
    })
    .toBe('23:30-06:30-good'); // before: 00:00-07:00, quality from the parser
  const d = await get(page, account, '/api/daily-logs');
  const mood = (d.moodByDate || {})[today()];
  expect([mood.energy, mood.stress]).toEqual(['high', 'calm']); // the sentence named neither
});

test('quick add: a reminder at an hour already gone becomes tomorrow, one toast, Undo deletes it (EXS-5)', async ({ page, account }) => {
  const late = new Date();
  late.setHours(21, 30, 0, 0);
  await page.clock.install({ time: late });
  await boot(page, account);
  await quickAdd(page, 'remind me at 9pm to call the plumber');
  const t = undoToast(page);
  await expect(t).toBeVisible();
  await expect(page.locator('.gb-toast.is-error')).toHaveCount(0);
  await page.screenshot({ path: SHOTS + 'EXS-5.jpg', quality: 70 });
  await expect
    .poll(async () => (await get(page, account, '/api/reminders')).filter((r) => /plumber/i.test(r.text)).map((r) => r.date))
    .toEqual([tomorrow()]);
  await t.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await get(page, account, '/api/reminders')).filter((r) => /plumber/i.test(r.text)).length).toBe(0);
});

test('quick add: a weekly reminder is one line (2 taps on a model read)', async ({ page, account }) => {
  await boot(page, account);
  const { taps, fallback } = await quickAdd(page, 'remind me every monday at 9am to water plants');
  expect(taps).toBeLessThanOrEqual(fallback ? 3 : 2); // before: 6 taps, 2 swipes in Calendar
  await expect
    .poll(async () => (await get(page, account, '/api/reminders')).filter((r) => /water plants/i.test(r.text)).map((r) => r.repeat))
    .toEqual(['weekly']);
});

test('quick add: a note is one line; the Note row opens the composer focused (FRC-5)', async ({ page, account }) => {
  await boot(page, account);
  const { taps, fallback } = await quickAdd(page, 'note: gift idea for Ravi, a book on birds');
  expect(taps).toBeLessThanOrEqual(fallback ? 3 : 2); // before: 4 taps, 3 screens
  await expect
    .poll(async () => (await get(page, account, '/api/notes')).filter((n) => /book on birds/i.test(n.body || '')).length)
    .toBe(1);
  // The Note row: Notes with the composer already open and focused.
  await page.getByRole('button', { name: 'Quick add' }).click();
  await dialog(page).getByRole('button', { name: /^Note/ }).click();
  await expect(page.locator('.gb-note-composer.is-open')).toBeVisible();
  await expect(page.locator('.gb-note-composer [contenteditable="true"]').first()).toBeFocused();
  await page.screenshot({ path: SHOTS + 'FRC-5-note.jpg', quality: 70 });
});

test('task: "Call plumber tomorrow 5pm" sets the due time from the title, removable chip (FRC-11)', async ({ page, account }) => {
  await boot(page, account);
  let taps = 0;
  await addTask(page).click();
  taps++;
  const d = dialog(page);
  const title = d.locator('input[type=text]').first();
  await expect(title).toBeFocused();
  await title.pressSequentially('Call plumber tomorrow 5pm', { delay: 5 });
  const chip = d.locator('.gb-when-chip');
  await expect(chip).toContainText('Tomorrow, 5:00');
  await page.screenshot({ path: SHOTS + 'FRC-11.jpg', quality: 70 });
  const created = page.waitForRequest((r) => r.url().endsWith('/api/tasks') && r.method() === 'POST');
  await title.press('Enter');
  taps++;
  const body = JSON.parse((await created).postData());
  expect(body.title).toBe('Call plumber');
  const due = new Date(body.dueAt);
  expect([keyOf(due), due.getHours(), due.getMinutes()]).toEqual([tomorrow(), 17, 0]);
  expect(taps).toBeLessThanOrEqual(2); // before: 7 taps (3 + about 4 in the date-time picker)

  // The chip's x keeps the words as the title and leaves no due time.
  await addTask(page).click();
  await expect(title).toBeFocused();
  await title.pressSequentially('Plan offsite friday', { delay: 5 });
  await chip.click();
  await expect(chip).toHaveCount(0);
  const second = page.waitForRequest((r) => r.url().endsWith('/api/tasks') && r.method() === 'POST');
  await title.press('Enter');
  const b2 = JSON.parse((await second).postData());
  expect([b2.title, b2.dueAt]).toEqual(['Plan offsite friday', null]);
});

test('sleep + mood: one mood tap also logs the night Home is asking about (FRC-9)', async ({ page, emptyAccount: account }) => {
  // Six nights and four check-ins, nothing today; an overdue task takes Home's "one thing" card,
  // so the check-in card asks both questions itself.
  const base = new Date();
  await post(page, account, '/api/tasks', { title: 'Old thing', priority: 'High', dueAt: new Date(Date.now() - 2 * 864e5).toISOString() });
  for (let i = 1; i <= 6; i++) {
    const date = keyOf(new Date(base.getTime() - i * 864e5));
    await post(page, account, '/api/daily-logs/sleep', { date, bedtime: i % 2 ? '23:15' : '23:30', wakeTime: '06:45', quality: 'good' });
    if (i <= 4) await post(page, account, '/api/daily-logs/mood', { date, mood: 'okay', energy: 'medium', stress: 'calm' });
  }
  await page.request.put(API + '/api/auth/ui-prefs', {
    headers: { Authorization: 'Bearer ' + account.token },
    data: { prefs: { ...(account.user.uiPrefs || {}), setupDone: true } },
  });
  const morning = new Date();
  morning.setHours(8, 0, 0, 0);
  await page.clock.install({ time: morning });
  await boot(page, { ...account, user: { ...account.user, uiPrefs: { ...(account.user.uiPrefs || {}), setupDone: true } } });
  const ask = page.locator('.gb-wellness-quick');
  await expect(ask).toContainText('Slept');
  await ask.getByRole('group', { name: 'How are you feeling?' }).getByRole('button', { name: 'Good' }).click(); // the 1 tap
  await expect
    .poll(async () => {
      const d = await get(page, account, '/api/daily-logs');
      const s = (d.sleepByDate || {})[today()];
      const m = (d.moodByDate || {})[today()];
      return s && m ? [String(s.wakeTime).slice(0, 5), m.mood] : null;
    })
    .toEqual(['06:45', 'good']); // before: 2 taps (Yes, then the mood)
  await expect(toast(page, /last night/i).getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.screenshot({ path: SHOTS + 'FRC-9.jpg', quality: 70 });
});

test('plan my day after 21:00 plans tomorrow and lists no reminder already gone (FRC-8)', async ({ page, account }) => {
  // Seeded: "Team standup" 09:30 on weekdays and "Call mom" 19:00 daily; three open tasks.
  const late = new Date();
  late.setHours(23, 30, 0, 0);
  await page.clock.install({ time: late });
  await boot(page, account);
  await page.locator('#gb-main').getByRole('button', { name: 'Plan my day' }).first().click();
  const d = dialog(page);
  await expect(d).toContainText('Tomorrow plan');
  await expect(d).toContainText('Call mom'); // tomorrow's 19:00, not today's gone one
  await page.screenshot({ path: SHOTS + 'FRC-8.jpg', quality: 70 });
  await d.getByRole('button', { name: 'Add to tomorrow' }).click(); // before: "Looks good", nothing written
  await expect(d).toHaveCount(0);
  await expect
    .poll(async () => (await get(page, account, '/api/reminders')).filter((r) => /^Focus: /.test(r.text)).map((r) => r.date))
    .toContainEqual(tomorrow());
});
