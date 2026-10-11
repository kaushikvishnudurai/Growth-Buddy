// First run, through the real UI: a new visitor signs up, verifies, accepts the ready-made plan and
// ticks a habit. Asserts the flow (FRU-1..4, 6..8, 10, FRS-1..5) and its time and input budget, and
// screenshots each step to docs/evidence/onboard/. One real sign-up per project: the signup route
// allows 10 per IP per 5 minutes, and every UI sign-up comes from the same proxy address.
import { mkdirSync } from 'node:fs';
import { test, expect, signIn, go } from './fixtures.mjs';
import { seedAccount, otpFor } from './seed.mjs';

const OUT = 'docs/evidence/onboard/';
mkdirSync(OUT, { recursive: true });
const API = process.env.GB_API || 'http://localhost:8590';

async function shot(page, name) {
  await page.waitForTimeout(350); // let the sheet / toast finish rising
  await page.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 70 });
}

async function waitOtp(email) {
  for (let i = 0; i < 60; i++) {
    const code = otpFor(email);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('no code in the backend log for ' + email);
}

test.use({ timezoneId: 'Asia/Kolkata' });
test.setTimeout(120_000);
// The shared Chrome flips prefers-color-scheme every second or so (other sessions emulate it, and a
// context's colorScheme does not hold), and until FRU-9 (the shell's) lands each flip re-renders the
// auth form empty under the test's typing. Pin the app's view of the scheme to light.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      /prefers-color-scheme/.test(q)
        ? { matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : real(q);
  });
});

test('a new visitor reaches a ticked habit from the plan in one decision', async ({ page }, info) => {
  const m = info.project.name === 'mobile';
  if (m) await page.setViewportSize({ width: 390, height: 844 });
  const p = m ? '' : 'd-';
  // The input budget, counted as the user would spend it: every tap (a field focus is a tap),
  // every field filled, every choice made.
  const n = { taps: 0, fields: 0, decisions: 0 };
  const tap = async (loc) => {
    n.taps++;
    await loc.click();
  };
  const fill = async (loc, text) => {
    n.taps++;
    n.fields++;
    await loc.fill(text);
  };

  await page.goto('/');
  // FRU-1: sign-up first, says what the app is for, sign-in is the secondary link.
  await expect(page.locator('h1')).toHaveText('Create your account');
  await expect(page.getByText('Habits, reminders, money and goals in one place')).toBeVisible();
  await expect(page.getByText('Have an account? Sign in')).toBeVisible();
  await expect(page.getByText('Welcome back')).toHaveCount(0);
  await shot(page, p + (m ? 'FRU-1' : '01-landing'));
  const t0 = Date.now();

  // FRU-6 / FRS-5: one password field (with its eye), Name marked optional.
  await expect(page.locator('input[type=password]')).toHaveCount(1);
  await expect(page.locator('.gb-pw-toggle')).toHaveCount(1);
  await expect(page.getByText('Name (optional)')).toBeVisible();
  await expect(page.getByText('Confirm password')).toHaveCount(0);

  const email = `onb.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;
  await fill(page.locator('input[type=email]'), email);
  await fill(page.locator('input[type=password]'), 'Onboard#2026pw');
  await shot(page, p + (m ? 'FRU-6' : '02-signup-filled'));
  await tap(page.getByRole('button', { name: 'Create account' }));

  await expect(page.locator('h1')).toHaveText('Verify your email');
  const code = await waitOtp(email);
  await shot(page, p + '03-verify');
  // FRS-4: a pasted message with the code in it submits on its own, no Verify tap.
  n.fields++; // the code box is focused on arrival (focusSoon), so no tap
  const tVerify = Date.now();
  await page.locator('.gb-otp-field').fill('Your Growth Buddy code is ' + code);

  // FRU-3 / FRU-4 / FRS-1 / FRS-2: one sheet, a finished plan already filled, no wizard steps.
  const sheet = page.locator('.gb-setup-modal');
  await expect(sheet.getByText('Your plan is ready')).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText(/Step \d of \d/)).toHaveCount(0);
  await expect(sheet.getByText(/timezone|notifications|Pick what you/i)).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Balanced day' })).toHaveAttribute('aria-pressed', 'true');
  const ticked = sheet.locator('.gb-qa-check:checked');
  expect(await ticked.count()).toBeGreaterThanOrEqual(4);
  // EXS-13: no second, differently counted setup behind the sheet.
  await expect(page.locator('.gb-onboard')).toHaveCount(0);
  await shot(page, p + (m ? 'FRU-3' : '04-plan'));
  n.decisions++;
  await tap(sheet.getByRole('button', { name: 'Start with this plan' }));

  // FRU-10: the toast says what was added, not "You're all set" over a checklist.
  await expect(page.locator('.gb-toast-msg', { hasText: 'Added 3 habits, 1 reminder and 1 goal.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You.re all set/)).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  // FRU-8 / FRS-3: no achievement overlay over the new plan.
  await page.waitForTimeout(1200);
  await expect(page.locator('.gb-celebrate')).toHaveCount(0);

  // FRU-2: the new habits lead Home, the first check on screen with no scroll; empty widgets
  // (score at 0%, daily brief, sleep and mood, tasks) are not rendered.
  // Quick add (main's, always first and not a widget) aside, the habits lead.
  const firstBlock = page.locator('.gb-dash .gb-dash-block:not(.gb-dash-qa)').first();
  await expect(firstBlock.locator('.gb-habit-strip')).toBeVisible();
  await expect(page.locator('.gb-score-card')).toHaveCount(0);
  await expect(page.locator('.gb-wellness-card')).toHaveCount(0);
  await expect(page.getByText("Today's tasks")).toHaveCount(0);
  const check = page.locator('.gb-habit-strip .gb-check').first();
  const box = await check.boundingBox();
  const vh = page.viewportSize().height;
  expect(box.y + box.height, 'first habit check is above the fold').toBeLessThan(vh - 70);
  expect(await page.locator('#gb-main').evaluate((el) => el.scrollTop)).toBe(0);
  // The checklist below it: a fixed denominator, with the next acts.
  const title = page.locator('.gb-onboard-title');
  const before = await title.textContent();
  const [, doneBefore, of] = before.match(/^(\d) of ([45]) done$/) || [];
  expect(of, before).toBeTruthy();
  await shot(page, p + (m ? 'FRU-2' : '05-home-plan'));
  if (m) await shot(page, 'FRU-8');

  await tap(check);
  await expect(page.locator('.gb-habit-strip .gb-check.is-done')).toHaveCount(1);
  const inApp = (Date.now() - tVerify) / 1000;
  const total = (Date.now() - t0) / 1000;
  // FRU-10: same denominator after the tick, one more step done.
  await expect(title).toHaveText(Number(doneBefore) + 1 + ' of ' + of + ' done');
  // FRU-7: one tick on day one is not a week to review.
  await expect(page.getByText('Your week is ready to review')).toHaveCount(0);
  await shot(page, p + (m ? 'FRU-7' : '06-habit-ticked'));
  if (m) await shot(page, 'FRU-10');

  // The budget (friction-setup "time to first value": 6 taps, 4 fields, 1 decision, ~26 s).
  console.log(`[onboarding ${info.project.name}] taps ${n.taps}, fields ${n.fields}, decisions ${n.decisions}, ` +
    `verify-to-tick ${inApp.toFixed(1)} s, landing-to-tick ${total.toFixed(1)} s (machine)`);
  expect(n.taps).toBeLessThanOrEqual(6);
  expect(n.fields).toBeLessThanOrEqual(4);
  expect(n.decisions).toBeLessThanOrEqual(1);
  expect(inApp, 'code accepted to first habit ticked').toBeLessThan(30);
});

test('a returning browser gets "Welcome back"; a zone mismatch is asked in words', async ({ page }, info) => {
  const m = info.project.name === 'mobile';
  if (m) await page.setViewportSize({ width: 390, height: 844 });
  const acct = await seedAccount({ tag: 'onbtz' });
  // The account says New York; this browser is in India.
  const res = await fetch(API + '/api/auth/timezone', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + acct.token },
    body: JSON.stringify({ timezone: 'America/New_York' }),
  });
  expect(res.status).toBe(200);
  // The real form: a sign-in is what runs the zone check (syncUserSession).
  await signIn(page, acct);

  // FRU-11: a city and the zone's name, never "Asia/Calcutta".
  const offer = page.locator('.gb-modal').filter({ hasText: /Switch to (Calcutta|Kolkata) time\?/ });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await expect(offer).toContainText('India Standard Time');
  await expect(offer).toContainText('New York');
  await expect(offer).not.toContainText('Asia/');
  await expect(offer).not.toContainText('America/');
  if (m) await shot(page, 'FRU-11');
  await offer.getByRole('button', { name: 'Keep New York time' }).click();
  await expect(offer).toHaveCount(0);

  // FRU-13: the freeze chip says what a freeze does.
  await go(page, 'habits');
  await expect(page.getByText(/covers a missed day/)).toBeVisible();
  if (m) await shot(page, 'FRU-13');

  // FRU-1: after a sign-out the same browser is greeted as returning, on sign-in.
  await page.locator('.gb-avatar').first().click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.locator('h1')).toHaveText('Welcome back', { timeout: 10_000 });
  await expect(page.locator('input[type=password]')).toHaveCount(1);
  if (m) await shot(page, 'FRU-1-returning');
});

test('sign-up says a short password once (EXS-11)', async ({ page }, info) => {
  const m = info.project.name === 'mobile';
  await page.goto('/');
  await page.locator('input[type=email]').fill('short.pw@example.com');
  await page.locator('input[type=password]').fill('short');
  await expect(page.getByText('Too short — 8 characters minimum.')).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
  await expect(page.getByText('Too short — 8 characters minimum.')).toHaveCount(0);
  if (m) await shot(page, 'EXS-11');
});
