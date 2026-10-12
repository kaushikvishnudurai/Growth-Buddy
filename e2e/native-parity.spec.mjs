// Web-vs-app parity (docs/audit/responsive-parity.md RSP-1, RSP-2), run in a browser posing as the
// Capacitor app: window.Capacitor answers isNativePlatform() true and its bridge
// (`nativePromise`, what native.js nativePlugin falls back to) records every plugin call.
import { test, expect, signInFast } from './fixtures.mjs';

// Seeding an account takes most of the default minute on this stack.
test.setTimeout(180_000);
// Offline, the trends snapshot POST fails and logs it; that is the write path, not under test.
test.use({ allowed: ['recordTrendsToday snapshot failed'] });

// Before any app script: the fake bridge. Filesystem.writeFile and Share.share succeed unless
// window.__fsFail is set; every other plugin answers UNIMPLEMENTED, as a missing one does on a phone.
function fakeCapacitor() {
  window.__calls = [];
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {},
    nativeCallback: () => 'cb',
    nativePromise(plugin, method, opts) {
      window.__calls.push({ plugin, method, opts });
      if (plugin === 'Filesystem' && method === 'writeFile') {
        return window.__fsFail
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve({ uri: 'file:///data/cache/' + opts.path });
      }
      if (plugin === 'Share' && method === 'share') return Promise.resolve({});
      return Promise.reject(new Error(plugin + '.' + method + ' is not implemented'));
    },
  };
}

const exportCalls = (page) =>
  page.evaluate(() => window.__calls.filter((c) => c.plugin === 'Filesystem' || c.plugin === 'Share'));

async function openAccountSettings(page) {
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
  // A render() during boot rebuilds the header with its panel slot empty while
  // profileOpen stays true (separate bug), so re-click until the panel is up.
  const avatar = page.locator('.gb-head .gb-avatar').first();
  const settings = page.locator('.gb-profile-pop-item', { hasText: 'Settings' });
  await expect(async () => {
    if (!(await settings.isVisible())) await avatar.click();
    await expect(settings).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await settings.click();
  await page.getByRole('tab', { name: 'Account' }).click();
}

test('an export in the app goes to the share sheet, and a failure says so', async ({ page, account }) => {
  await page.addInitScript(fakeCapacitor);
  await signInFast(page, account);
  await openAccountSettings(page);
  const download = page.getByRole('button', { name: 'Download my data' }).last();

  await download.click();
  await expect.poll(async () => (await exportCalls(page)).length).toBe(2);
  const [write, share] = await exportCalls(page);
  expect(write.method).toBe('writeFile');
  expect(write.opts.directory).toBe('CACHE');
  expect(write.opts.path).toMatch(/^growth-buddy-export-\d{4}-\d{2}-\d{2}\.json$/);
  const json = JSON.parse(Buffer.from(write.opts.data, 'base64').toString('utf8'));
  expect(json).toBeTruthy();
  expect(share).toMatchObject({ plugin: 'Share', method: 'share', opts: { files: ['file:///data/cache/' + write.opts.path] } });
  // The sheet is the feedback; "downloading" would be a claim about a download that never ran.
  await expect(page.getByText('Your data is downloading.')).toHaveCount(0);

  await page.evaluate(() => ((window.__fsFail = true), (window.__calls = [])));
  await download.click();
  await expect(page.locator('.gb-toast-msg', { hasText: "Saving files isn't available in the app yet." })).toBeVisible();
  await expect(page.getByText('Your data is downloading.')).toHaveCount(0);
  expect((await exportCalls(page)).map((c) => c.plugin)).toEqual(['Filesystem']);
});

test('offline cold start in the app shows saved data, not the crash card', async ({ page, account }, info) => {
  // Ephemeral WebKit sessions (Playwright's default context, Safari Private Browsing) drop Cache API
  // entries on reload, and the runner cannot give WebKit a persistent one: docs/audit/cross-device.md XD-3.
  test.skip(info.project.use.engine === 'webkit', 'ephemeral WebKit sessions lose Cache API data on reload (XD-3)');
  await page.addInitScript(fakeCapacitor);
  await signInFast(page, account);
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
  // Let the last mirrored GETs reach the Cache API before the reload.
  await page.waitForTimeout(1500);

  await page.route('**/api/**', (r) => r.abort('aborted'));
  await page.route('**/ws/**', (r) => r.abort('aborted'));
  await page.reload();
  await expect(page.locator('#gb-main')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Book the dentist').first()).toBeVisible();
  await expect(page.locator('.gb-crash')).toHaveCount(0);
  await expect(page.locator('.gb-offline-banner')).toContainText('showing your last saved data');
});
