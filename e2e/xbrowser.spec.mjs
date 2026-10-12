// Cross-browser fixes (docs/audit/cross-device.md, XD-*).
import { test, expect, signInFast, go } from './fixtures.mjs';

const SHOTS = 'docs/evidence/xbrowser/';

// XD-2: at tablet width the frame was as tall as the screen's content, so the bottom nav moved
// between tabs and Notes was a short card in the middle of the page.
test('XD-2: at 768x1024 the frame and the bottom nav stay put across tabs', async ({ page, account }, info) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await signInFast(page, account);
  const box = () =>
    page.evaluate(() => {
      const r = document.querySelector('.gb-app').getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height) };
    });
  await go(page, 'home');
  const home = await box();
  await go(page, 'notes');
  await page.waitForTimeout(600);
  const notes = await box();
  const tag = process.env.XD2_TAG || 'after';
  if (['tablet-chrome', 'desktop-webkit'].includes(info.project.name))
    await page.screenshot({ path: `${SHOTS}XD-2-${tag}-${info.project.name}.jpg`, quality: 70 });
  expect(notes).toEqual(home);
  expect(home.height).toBeGreaterThan(800);
});

// XD-3 (offline sign-out revoke retry) is gone: main's sign-out seam won the merge.
