// First run, through the real UI: the returning-browser greeting and timezone offer (FRU-13), and
// the sign-up password hint (EXS-11). The new-visitor journey is main's first run now, covered by
// scripts/e2e/onboarding.e2e.mjs. Screenshots go to docs/evidence/onboard/.
import { mkdirSync } from 'node:fs';
import { test, expect, signIn, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const OUT = 'docs/evidence/onboard/';
mkdirSync(OUT, { recursive: true });
const API = process.env.GB_API || 'http://localhost:8590';

async function shot(page, name) {
  await page.waitForTimeout(350); // let the sheet / toast finish rising
  await page.screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 70 });
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

test('a returning browser gets "Welcome back"; a zone mismatch is asked in words', async ({ page }, info) => {
  const m = info.project.name.startsWith('mobile');
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

  // The zone mismatch is asked once. Main's offer won the merge: it names the raw IANA zones
  // ("Switch to Asia/Kolkata?", "Keep America/New_York"), not our FRU-11 city wording.
  const offer = page.locator('.gb-modal').filter({ hasText: /Switch to .*(Calcutta|Kolkata).*\?/ });
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await expect(offer).toContainText('America/New_York');
  if (m) await shot(page, 'FRU-11');
  await offer.getByRole('button', { name: 'Keep America/New_York' }).click();
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
  const m = info.project.name.startsWith('mobile');
  await page.goto('/');
  // Main's landing is sign-in; sign-up is its "Create account" link.
  await page.locator('.gb-login-link', { hasText: 'Create account' }).click();
  await page.locator('input[type=email]').fill('short.pw@example.com');
  await page.locator('input[type=password]').fill('short');
  await expect(page.getByText('Too short — 8 characters minimum.')).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
  await expect(page.getByText('Too short — 8 characters minimum.')).toHaveCount(0);
  if (m) await shot(page, 'EXS-11');
});
