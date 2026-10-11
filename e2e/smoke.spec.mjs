import { test, expect, signIn, signInFast, go } from './fixtures.mjs';

test('signs in and reaches Home with seeded data', async ({ page, account }) => {
  await signIn(page, account);
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
});

for (const screen of ['calendar', 'money', 'notes', 'goals', 'report', 'focus', 'food', 'family', 'circle', 'health', 'mentor']) {
  test(`opens ${screen} without errors`, async ({ page, account }, info) => {
    await signInFast(page, account);
    await go(page, screen);
    await page.waitForTimeout(800);
    await page.screenshot({ path: info.outputPath(`${screen}.png`) });
  });
}
