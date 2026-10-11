// Food and Water fixes: the Log food sheet on a phone with a full "had before" list, one-tap
// re-logging, saving without waiting on the estimate, the water log's "Show all" (EXM-8), Home's
// +250 ml pill (FRC-6) and field errors under the field (EXM-20).
import { test, expect, signInFast, go } from './fixtures.mjs';

// The seeder's backend: the account and these calls must reach the same build.
const API = process.env.GB_API || 'http://localhost:8590';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Date().toLocaleDateString('en-CA');
const shot = (page, id) => page.screenshot({ path: `docs/evidence/food/${id}.jpg`, type: 'jpeg', quality: 60 });

const boot = (page, account) => signInFast(page, { ...account, user: { ...account.user, timezone: tz } });
const dialog = (page) => page.locator('.gb-modal[role=dialog]');
const main = (page) => page.locator('#gb-main');

async function call(page, account, path, body, method = body ? 'POST' : 'GET') {
  const r = await page.request.fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
  });
  expect(r.status(), path).toBeLessThan(300);
  return r.status() === 204 ? null : r.json();
}

const FOODS = [
  ['Masala dosa', 180, 320],
  ['Chicken biryani', 300, 540],
  ['Paneer butter masala', 200, 420],
  ['Curd rice', 250, 280],
  ['Vegetable upma', 200, 250],
  ['Chapati with dal', 220, 330],
  ['Banana smoothie', 300, 210],
  ['Grilled chicken salad', 250, 300],
  ['Poha', 180, 240],
];
// Nine distinct foods (eight come back as recent) and three of them starred: a full list.
async function seedFoods(page, account) {
  let last;
  // A second apart, so "the 8 latest" is the same list every run.
  const t0 = Date.now() - FOODS.length * 1000;
  for (const [i, [foodName, quantityGrams, kcal]] of FOODS.entries())
    last = await call(page, account, '/api/food/entries/manual', {
      foodName,
      quantityGrams,
      mealType: 'home',
      kcal,
      loggedAt: new Date(t0 + i * 1000).toISOString(),
    });
  for (const n of ['Masala dosa', 'Curd rice', 'Poha'])
    await call(page, account, '/api/food/favourites', { entryId: last.entries.find((e) => e.foodName === n).id });
}

async function openLogFood(page) {
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('textbox', { name: 'Food', exact: true })).toBeFocused();
  // Both chip lists have answered.
  await expect(d.getByRole('button', { name: /^Log Grilled chicken salad again/ })).toHaveCount(1);
  await expect(d.getByRole('button', { name: /^Log Curd rice again/ })).toHaveCount(1);
  return d;
}

const inView = async (page, loc, bottom) => {
  const b = await loc.boundingBox();
  const vh = bottom ?? page.viewportSize().height;
  expect(b, 'element has a box').not.toBeNull();
  expect(b.y, 'top on screen').toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, 'bottom on screen (' + vh + ')').toBeLessThanOrEqual(vh);
};

for (const [w, hgt] of [
  [390, 844],
  [360, 740],
]) {
  test(`log food at ${w}x${hgt}: the field is on screen and focused, the list is one row`, async ({ page, account }) => {
    await page.setViewportSize({ width: w, height: hgt });
    await seedFoods(page, account);
    await boot(page, account);
    await go(page, 'food');
    const d = await openLogFood(page);
    const name = d.getByRole('textbox', { name: 'Food', exact: true });
    await inView(page, name);
    await inView(page, d.getByLabel('Calories (optional)'));
    await inView(page, d.getByRole('button', { name: 'Add food' }));
    // One line however many foods: every chip shares the first one's top.
    const tops = await d.locator('.gb-food-recent-chip').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops.length).toBeGreaterThanOrEqual(8); // 3 starred + the 8 latest, starred ones merged
    expect(new Set(tops).size).toBe(1);
    await shot(page, `after-dialog-${w}`);

    // Typing filters the row instead of being pushed under it.
    await name.pressSequentially('dosa');
    await expect(d.locator('.gb-food-recent-chip')).toHaveCount(1);
    await expect(d.locator('.gb-food-recent-chip')).toHaveText('Masala dosa');
    await inView(page, name);
  });
}

// The phone keyboard shrinks the visual viewport, not the layout one; openOverlay pins the sheet
// to it. Headless Chrome has no keyboard, so the visual viewport is stood in for.
test('the keyboard leaves the Food field and Add food on screen', async ({ page, account }) => {
  await page.addInitScript(() => {
    const et = new EventTarget();
    const vv = {
      get height() {
        return window.__kb ? window.innerHeight - window.__kb : window.innerHeight;
      },
      get width() {
        return window.innerWidth;
      },
      offsetTop: 0,
      offsetLeft: 0,
      scale: 1,
      addEventListener: et.addEventListener.bind(et),
      removeEventListener: et.removeEventListener.bind(et),
    };
    window.__kbOpen = (px) => {
      window.__kb = px;
      et.dispatchEvent(new Event('resize'));
    };
    Object.defineProperty(window, 'visualViewport', { get: () => vv });
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await seedFoods(page, account);
  await boot(page, account);
  await go(page, 'food');
  const d = await openLogFood(page);
  await page.evaluate(() => window.__kbOpen(320)); // a typical Android keyboard
  await page.waitForTimeout(400);
  const visible = 740 - 320;
  await inView(page, d.getByRole('textbox', { name: 'Food', exact: true }), visible);
  await inView(page, d.getByRole('button', { name: 'Add food' }), visible);
  // The next field, once tapped, is brought up too.
  await d.getByLabel(/^Amount in/).focus();
  await page.waitForTimeout(400);
  await inView(page, d.getByLabel(/^Amount in/), visible);
  await inView(page, d.getByRole('button', { name: 'Add food' }), visible);
  await shot(page, 'after-keyboard-360');
});

test('a food had before is one tap to log, with its own portion and kcal', async ({ page, account }) => {
  await seedFoods(page, account);
  await boot(page, account);
  await go(page, 'food');
  const d = await openLogFood(page);
  const posts = [];
  page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/food/entries') && posts.push(r));
  await d.getByRole('button', { name: /^Log Curd rice again/ }).click();
  await expect(d).toHaveCount(0);
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].url()).toMatch(/\/api\/food\/entries\/manual$/);
  expect(posts[0].postDataJSON()).toMatchObject({ foodName: 'Curd rice', quantityGrams: 250, kcal: 280 });
  const day = () => call(page, account, '/api/food?date=' + today());
  await expect.poll(async () => (await day()).entries.filter((e) => e.foodName === 'Curd rice').length).toBe(2);
});

test('a typed food had before starts on its last portion and saves without an estimate', async ({ page, account }) => {
  await seedFoods(page, account);
  await boot(page, account);
  await go(page, 'food');
  const d = await openLogFood(page);
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('poha');
  await d.getByRole('textbox', { name: 'Food', exact: true }).press('Tab');
  await expect(d.getByLabel('Amount in grams')).toHaveValue('180');
  await expect(d.getByLabel('Calories (optional)')).toHaveValue('240');
  // The kcal follows the grams until it is typed over.
  await d.getByLabel('Amount in grams').fill('270');
  await expect(d.getByLabel('Calories (optional)')).toHaveValue('360');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/food/entries'));
  await d.getByRole('button', { name: 'Add food' }).click();
  expect((await posted).url()).toMatch(/\/manual$/);
  await expect(d).toHaveCount(0);
});

test('a food counted by the piece is remembered by the piece', async ({ page, account }) => {
  await call(page, account, '/api/food/entries/manual', { foodName: 'Plain dosa', pieces: 2, mealType: 'home', kcal: 240 });
  await boot(page, account);
  await go(page, 'food');
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('textbox', { name: 'Food', exact: true })).toBeFocused();
  await expect(d.getByRole('button', { name: /^Log Plain dosa again/ })).toHaveCount(1);
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('Plain dosa');
  await d.getByRole('textbox', { name: 'Food', exact: true }).press('Tab');
  await expect(d.getByLabel('Amount in pieces')).toHaveValue('2');
  await expect(d.getByLabel('Calories (optional)')).toHaveValue('240');
  await d.getByLabel('Amount in pieces').fill('3');
  await expect(d.getByLabel('Calories (optional)')).toHaveValue('360');
  // And the chip re-logs it as two pieces.
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('');
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/food/entries'));
  await d.getByRole('button', { name: /^Log Plain dosa again/ }).click();
  expect((await posted).postDataJSON()).toMatchObject({ foodName: 'Plain dosa', pieces: 2, kcal: 240 });
});

test('a new food closes the dialog at once; the estimate carries on behind it (FRC-10)', async ({ page, account }) => {
  await boot(page, account);
  await go(page, 'food');
  // The AI estimate, slowed to what FRC-10 measured.
  await page.route('**/api/food/entries', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('textbox', { name: 'Food', exact: true })).toBeFocused();
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('Lemon rice');
  const t0 = Date.now();
  await d.getByRole('button', { name: 'Add food' }).click();
  // The point is no ~11 s estimate wait; 3 s leaves room for a loaded machine.
  await expect(d).toHaveCount(0, { timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(main(page).getByRole('button', { name: /^Edit Lemon rice/ })).toBeVisible({ timeout: 20_000 });
  await shot(page, 'FRC-10');
});

test('a failed save keeps the food on a Retry toast', async ({ page, account, allowed }) => {
  allowed.push('/api/food/entries/manual', 'status of 503');
  await boot(page, account);
  await go(page, 'food');
  let fail = true;
  await page.route('**/api/food/entries/manual', (route) =>
    fail ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Service unavailable"}' }) : route.continue()
  );
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('textbox', { name: 'Food', exact: true })).toBeFocused();
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('Sambar rice');
  await d.getByLabel('Calories (optional)').fill('350');
  await d.getByRole('button', { name: 'Add food' }).click();
  await expect(d).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  fail = false;
  await retry.click();
  await expect(main(page).getByRole('button', { name: /^Edit Sambar rice/ })).toBeVisible();
});

test('an out-of-range amount is refused under the field, not in a toast (EXM-20)', async ({ page, account }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, account);
  await go(page, 'food');
  await main(page).getByRole('button', { name: 'Log food' }).first().click();
  const d = dialog(page);
  await expect(d.getByRole('textbox', { name: 'Food', exact: true })).toBeFocused();
  await d.getByRole('textbox', { name: 'Food', exact: true }).fill('Rice');
  await d.getByRole('radio', { name: 'g', exact: true }).click();
  await d.getByLabel('Amount in grams').fill('5000');
  await d.getByRole('button', { name: 'Add food' }).click();
  await expect(d.getByRole('alert')).toHaveText('Amount must be 10 to 2000 grams.');
  await expect(d.getByLabel('Amount in grams')).toHaveAttribute('aria-invalid', 'true');
  await expect(d.getByLabel('Amount in grams')).toBeFocused();
  await shot(page, 'EXM-20');
});

test('every drink today can be seen and deleted behind Show all (EXM-8)', async ({ page, account }) => {
  // The seed has 500 ml; four more makes five.
  for (const [amountMl, drinkType] of [
    [250, 'water'],
    [250, 'water'],
    [200, 'tea'],
    [300, 'water'],
  ])
    await call(page, account, '/api/water/entries', { amountMl, drinkType });
  await boot(page, account);
  await go(page, 'food');
  const rows = main(page).locator('.gb-water-log-row:visible').filter({ hasText: ' ml' });
  const card = main(page).locator('.gb-water-card, .gb-card').filter({ hasText: 'Water tracker' }).first();
  await expect(card.getByRole('button', { name: 'Delete water entry' })).toHaveCount(3);
  await card.getByRole('button', { name: 'Show all 5' }).click();
  await expect(card.getByRole('button', { name: 'Delete water entry' })).toHaveCount(5);
  await card.getByRole('button', { name: 'Show all 5' }).or(card.getByRole('button', { name: 'Show latest 3' })).first().scrollIntoViewIfNeeded();
  await shot(page, 'EXM-8');
  // The earliest one, the seeded 500 ml, now has its delete.
  await card.getByRole('button', { name: 'Delete water entry' }).last().click();
  await dialog(page).filter({ hasText: 'Delete this water entry?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(async () => (await call(page, account, '/api/water?date=' + today())).entries.length).toBe(4);
  // Still open after the repaint the delete causes.
  await expect(card.getByRole('button', { name: 'Delete water entry' })).toHaveCount(4);
  expect(await rows.count()).toBeGreaterThan(0);
});

test('Home water pill logs a glass in one tap, and Undo takes it back (FRC-6)', async ({ page, account }) => {
  // The pill is on the Daily brief, which the full Home carries. While the Getting started
  // checklist is up, Home shows only the widgets with data plus the checklist (onboard), so
  // this account is past it.
  const uiPrefs = { ...(account.user.uiPrefs || {}), onboardingDone: true };
  await call(page, account, '/api/auth/ui-prefs', { prefs: uiPrefs }, 'PUT');
  await boot(page, { ...account, user: { ...account.user, uiPrefs } });
  await go(page, 'home');
  const pill = main(page).getByRole('button', { name: /% water\. Add 250 ml$/ });
  await expect(pill).toHaveText(/25% water/);
  await pill.click();
  const water = async () => (await call(page, account, '/api/water?date=' + today())).consumedMl;
  await expect.poll(water).toBe(750);
  await expect(main(page).getByRole('button', { name: /% water\. Add 250 ml$/ })).toHaveText(/38% water/);
  await shot(page, 'FRC-6');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(water).toBe(500);
});
