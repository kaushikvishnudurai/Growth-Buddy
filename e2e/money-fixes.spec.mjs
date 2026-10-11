// Money overhaul fixes: each test fails on the code before its fix. Screenshots go to
// docs/evidence/money/<ID>.jpg.
import { test, expect, signInFast, go } from './fixtures.mjs';

const API = process.env.GB_API || 'http://localhost:8591';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');
const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });
const shot = (page, id) =>
  page.screenshot({ path: `docs/evidence/money/${id}.jpg`, type: 'jpeg', quality: 70 });

async function postTx(page, account, upserts) {
  const r = await page.request.post(API + '/api/money/tx', {
    headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
    data: { upserts, deletes: [] },
  });
  expect(r.status()).toBeLessThan(300);
}

// Header, Last night, Ledger, then the sentence: the first class of each child of .gb-health.
const healthOrder = (page) =>
  page.locator('.gb-health').evaluate((n) => [...n.children].map((c) => c.classList[0]));
const ORDER = ['gb-health-top', 'gb-card', 'gb-card', 'gb-health-hero'];

test('Health: the summary sentence closes the screen, after the ledger', async ({ page, account }) => {
  for (const [type, value] of [['weight', 71.5], ['steps', 8200]]) {
    const r = await page.request.post(API + '/api/health/readings', {
      headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
      data: { type, value, day: today() },
    });
    expect(r.status()).toBeLessThan(300);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, account);
  await go(page, 'health');
  const hero = page.locator('.gb-health > .gb-health-hero');
  await expect(hero).toContainText('Slept 7h 30m'); // the count-up has finished
  await expect(page.locator('.gb-health-top')).toContainText('Typed in by you');
  await expect(page.locator('.gb-health-top').getByRole('button', { name: /Log a reading/ })).toBeVisible();
  expect(await healthOrder(page)).toEqual(ORDER);
  await shot(page, 'health-insights-last-top');
  await hero.scrollIntoViewIfNeeded();
  await shot(page, 'health-insights-last');
});

test('Health, empty account: same order, the header still shows', async ({ page, emptyAccount }) => {
  await boot(page, emptyAccount);
  await go(page, 'health');
  await expect(page.locator('.gb-health > .gb-health-hero')).toContainText('Nothing logged for today yet');
  await expect(page.locator('.gb-health-top')).toContainText('Typed in by you');
  expect(await healthOrder(page)).toEqual(ORDER);
});
