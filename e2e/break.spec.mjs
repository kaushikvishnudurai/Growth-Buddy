// I-08 "Take a break": a rough patch costs one tap, not a freeze token a day.
// Needs the stack from fixtures.mjs plus the backend's database (mysql CLI, GB_E2E_DB) to give the
// habit a past: the API refuses a check-in before a habit's creation day, so a habit made today
// can never have the streak a break is for.
import { execFileSync } from 'node:child_process';
import { test, expect, signInFast } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const API = process.env.GB_API || 'http://localhost:8590';
const DB = process.env.GB_E2E_DB || 'gb_ov1011';
const SHOTS = 'docs/evidence/break/';

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
};
const hhmm = (d) => d.toTimeString().slice(0, 5);

async function call(token, path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status >= 300) throw new Error(`${method} ${path} ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/* A daily habit done 4, 3 and 2 days ago, missed yesterday: a 3-day streak at risk.
   Its reminder time is a minute ago, so the next scheduler tick (5 min catch-up) owes it. */
async function habitAtRisk(token, name) {
  const at = hhmm(new Date(Date.now() - 60_000));
  const hb = await call(token, '/api/habits', 'POST', { name, icon: 'leaf', domain: 'habit', cadence: 'daily', reminderTime: at });
  execFileSync('mysql', ['-uroot', DB, '-e', `UPDATE habits SET created_at = NOW() - INTERVAL 10 DAY WHERE id = '${hb.id}'`]);
  for (const n of [-4, -3, -2]) await call(token, `/api/habits/${hb.id}/checkin`, 'POST', { date: day(n), done: true });
  return hb;
}

const habitById = async (token, id) => (await call(token, '/api/habits')).find((x) => x.id === id);
const reminded = async (token, id) =>
  (await call(token, '/api/notifications')).some((n) => n.kind === 'habit_reminder' && n.relatedId === id);

test('a 3-day break in one tap holds the streak, quiets habit reminders, ends in one tap', async ({ page, account }, info) => {
  test.setTimeout(240_000);
  const shot = (name) =>
    page.screenshot({ path: SHOTS + name + '-' + info.project.name + '.jpg', type: 'jpeg', quality: 70 });
  const hb = await habitAtRisk(account.token, 'Stretch');
  // Control: the same habit on an account with no break, so the wait below is long enough to matter.
  const control = await seedAccount({ tag: 'e2e-ctl' });
  const ctl = await habitAtRisk(control.token, 'Stretch');

  // Before: the streak survives only by a freeze, one token per missed day.
  const before = await habitById(account.token, hb.id);
  expect(before.atRisk).toBe(true);
  expect(before.riskStreak).toBe(3);
  const tokens = before.freezeTokens;

  await signInFast(page, account);
  const offer = page.locator('.gb-break-card');
  await expect(offer).toContainText('Take a break');
  await offer.scrollIntoViewIfNeeded();
  await shot('1-offer');

  // Tap 1 of at most 2: three days, starting yesterday so the miss is covered.
  await offer.getByRole('button', { name: '3 days' }).click();
  await expect(page.locator('.gb-break-card')).toContainText('On a break');
  await expect(page.locator('.gb-break-card')).toContainText('Until');
  await page.waitForTimeout(600);
  await shot('2-on-break');

  // The missed day is held by the break: streak intact, no token spent, not at risk.
  const held = await habitById(account.token, hb.id);
  expect(held.streak).toBe(3);
  expect(held.atRisk).toBe(false);
  expect(held.freezeTokens).toBe(tokens);
  expect(held.dueToday).toBe(false);

  // No habit reminder in the bell, while the control account gets its one.
  await expect.poll(() => reminded(control.token, ctl.id), { timeout: 150_000, intervals: [5_000] }).toBe(true);
  expect(await reminded(account.token, hb.id)).toBe(false);

  // End early: one tap, then the calm comeback line with the streak kept.
  await page.locator('.gb-break-card').getByRole('button', { name: 'End now' }).click();
  const back = page.locator('.gb-break-card');
  await expect(back).toContainText('Back on it');
  await expect(back).toContainText('Your streaks are intact.');
  await expect(back.getByRole('button', { name: /^Mark .+ done$/ })).toBeVisible();
  await page.waitForTimeout(600);
  await shot('3-back-on-it');
  const after = await habitById(account.token, hb.id);
  expect(after.streak).toBe(3);
  expect(after.dueToday).toBe(true);
});
