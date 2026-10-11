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

test('Health: the summary sentence closes the screen, after the ledger', async ({ page, account }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, account);
  await go(page, 'health');
  const hero = page.locator('.gb-health > .gb-health-hero');
  await expect(hero).toContainText('Slept 7h 30m'); // the count-up has finished
  expect(await page.locator('.gb-health > :last-child').evaluate((n) => n.classList.contains('gb-health-hero'))).toBe(true);
  await hero.scrollIntoViewIfNeeded();
  await shot(page, 'health-insights-last');
});
