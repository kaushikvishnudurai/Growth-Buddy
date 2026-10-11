// Evidence for the planning fixes (Calendar, Notes, Goals): each test fails before its fix.
import { test as base, expect, signInFast, go } from './fixtures.mjs';
import { seedAccount } from './seed.mjs';

const test = base.extend({
  account: async ({}, use) => {
    let acct;
    for (let i = 0; !acct; i++) {
      try {
        acct = await seedAccount();
      } catch (e) {
        if (i >= 3 || !/signup 500/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
      }
    }
    await use(acct);
  },
});
test.use({ screenshot: 'off' });

const auth = (token) => ({ headers: { Authorization: 'Bearer ' + token } });
const api = async (page, account, path) => (await page.request.get(path, auth(account.token))).json();
// /api/goals answers sections by horizon.
const goals = async (page, account) => (await api(page, account, '/api/goals')).flatMap((s) => s.goals || []);
const main = (page) => page.locator('#gb-main');
const shot = (page, id) =>
  test.info().project.name === 'desktop' &&
  page.screenshot({ path: `docs/evidence/planning/${id}.jpg`, type: 'jpeg', quality: 70 });

async function boot(page, account, screen) {
  const me = await api(page, account, '/api/auth/me');
  await signInFast(page, { token: account.token, user: me });
  if (screen) await go(page, screen);
  await settle(page);
}

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((done) => {
        const root = document.getElementById('gb-main') || document.body;
        let t = setTimeout(finish, 600);
        const cap = setTimeout(finish, 8000);
        const mo = new MutationObserver(() => {
          clearTimeout(t);
          t = setTimeout(finish, 600);
        });
        mo.observe(root, { childList: true, subtree: true });
        function finish() {
          mo.disconnect();
          clearTimeout(t);
          clearTimeout(cap);
          done();
        }
      })
  );
}

async function newGoal(page, title) {
  await main(page).getByRole('button', { name: 'New goal' }).click();
  const dlg = page.getByRole('dialog', { name: 'New goal' });
  await dlg.getByRole('textbox', { name: 'Goal' }).fill(title);
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  await expect(dlg).toBeHidden();
}

/* ---------------- Goals ---------------- */

test('EXP-1: editing a goal saves the new title', async ({ page, account }) => {
  await boot(page, account, 'goals');
  const m = main(page);
  await newGoal(page, 'Learn to swim');
  await m.getByRole('button', { name: 'Edit goal: Learn to swim' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit goal' });
  await dlg.getByRole('textbox', { name: 'Goal' }).fill('Swim one kilometre');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toBeHidden();
  await expect(m.getByRole('button', { name: 'Edit goal: Swim one kilometre' })).toBeVisible();
  await expect
    .poll(async () => (await goals(page, account)).some((g) => g.title === 'Swim one kilometre'))
    .toBe(true);
  await shot(page, 'EXP-1');
});

test('EXP-8: goal form errors show under the field', async ({ page, account }) => {
  await boot(page, account, 'goals');
  await main(page).getByRole('button', { name: 'New goal' }).click();
  const dlg = page.getByRole('dialog', { name: 'New goal' });
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  const title = dlg.getByRole('textbox', { name: 'Goal' });
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(dlg.locator('.gb-field-error')).toHaveText('Give the goal a name first.');
  await title.fill('Cut sugar');
  await expect(dlg.locator('.gb-field-error')).toHaveCount(0);
  await dlg.getByRole('spinbutton', { name: 'Track daily for how many days' }).fill('5000');
  await dlg.getByRole('button', { name: 'Save goal' }).click();
  await expect(dlg.locator('.gb-affix + .gb-field-error')).toHaveText(/1 to 1000/);
  await shot(page, 'EXP-8');
});
