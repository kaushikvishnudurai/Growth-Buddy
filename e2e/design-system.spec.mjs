// Design-system evidence gate: in light and dark, the themed pills read at 4.5:1, text fields
// keep a focus outline, buttons render in the app's fonts (not Arial), the reminder tick and
// header buttons have a 44px hit area on a 390px phone, and the Edit habit dialog prints no
// stray "null". Also writes screenshots to docs/evidence/design-system/.
//
// The theme is set with the gb.theme cookie, not prefers-color-scheme emulation: the shared
// Chrome's colour scheme changes under other sessions, and the app follows it until a pick.
// GB_SHOT=before only takes the screenshots (for a run against the unchanged code).
import { test, expect, signInFast, go } from './fixtures.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SHOT = process.env.GB_SHOT || 'after';
const strict = SHOT !== 'before';
const EVIDENCE = path.join(import.meta.dirname, '..', 'docs', 'evidence', 'design-system');
mkdirSync(EVIDENCE, { recursive: true });

async function withTheme(page, account, theme) {
  const url = new URL(process.env.GB_E2E_BASE || 'http://localhost:5591');
  await page.context().addCookies([{ name: 'gb.theme', value: theme, domain: url.hostname, path: '/' }]);
  await signInFast(page, account);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function shot(page, name, info) {
  if (info.project.name !== 'mobile') return;
  await page.screenshot({ path: path.join(EVIDENCE, `${name}-${SHOT}.jpg`), type: 'jpeg', quality: 60 });
}

// WCAG ratio of an element's text over its background, compositing translucent fills (the
// dark theme's -soft tints) over the first opaque ancestor.
function contrastOf(els) {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  };
  const over = (f, b) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  return els.map((el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg && bg[3] > 0) layers.push(bg);
      if (bg && bg[3] === 1) break;
    }
    let bg = [255, 255, 255, 1];
    for (const l of layers.reverse()) bg = over(l, bg);
    let fg = parse(getComputedStyle(el).color);
    if (fg[3] < 1) fg = over(fg, bg);
    const [a, b] = [lum(fg), lum(bg)];
    return { text: el.textContent.trim(), ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) };
  });
}

for (const theme of ['light', 'dark']) {
  test.describe(`design system, ${theme}`, () => {
    test('priority, horizon and tag pills read at 4.5:1', async ({ page, account }, info) => {
      await withTheme(page, account, theme);
      await expect(page.getByText('Book the dentist').first()).toBeVisible();
      const pills = page.locator('.gb-row .gb-pill').filter({ hasText: /^(High|Medium)$/ });
      await expect(pills.first()).toBeVisible();
      const home = await pills.evaluateAll(contrastOf);
      await pills.first().scrollIntoViewIfNeeded();
      await shot(page, `home-pills-${theme}`, info);

      await go(page, 'goals');
      const horizon = page.locator('.gb-goals .gb-pill').filter({ hasText: 'Short term' });
      await expect(horizon.first()).toBeVisible();
      const goals = await horizon.evaluateAll(contrastOf);
      await shot(page, `goals-${theme}`, info);

      await go(page, 'calendar');
      const tags = page.locator('.gb-tag-pill');
      await expect(tags.first()).toBeVisible();
      const cal = await tags.evaluateAll(contrastOf);
      await tags.first().scrollIntoViewIfNeeded();
      await shot(page, `calendar-tags-${theme}`, info);

      const all = [...home, ...goals, ...cal];
      info.annotations.push({ type: 'contrast', description: JSON.stringify(all) });
      if (strict) for (const p of all) expect(p.ratio, `${p.text} pill contrast`).toBeGreaterThanOrEqual(4.5);
    });

    test('text fields keep a visible focus outline', async ({ page, account }) => {
      await withTheme(page, account, theme);
      await go(page, 'notes');
      const input = page.locator('input.gb-input:visible').first();
      await input.focus();
      const o = await input.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      if (strict) {
        expect(o.style).not.toBe('none');
        expect(o.width).toBeGreaterThanOrEqual(2);
      }
    });

    test('buttons render in the app fonts, not Arial', async ({ page, account }) => {
      await withTheme(page, account, theme);
      for (const screen of ['home', 'report']) {
        await go(page, screen);
        const bad = await page.locator('button:visible').evaluateAll((els) =>
          els
            .map((el) => [el.className, getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '').trim()])
            .filter(([, f]) => !/Hanken Grotesk|Bricolage Grotesque|Space Mono/.test(f))
        );
        if (strict) expect(bad, `${screen}: buttons outside the app fonts`).toEqual([]);
      }
    });

    test('Edit habit prints no "null"', async ({ page, account }, info) => {
      await withTheme(page, account, theme);
      await go(page, 'habits');
      await page.locator('.gb-row-open').filter({ hasText: 'Morning run' }).first().click();
      const dlg = page.locator('.gb-modal[role=dialog]');
      await expect(dlg).toBeVisible();
      await expect(dlg.locator('.gb-hh-stats')).toBeVisible();
      await page.waitForTimeout(300);
      await shot(page, `edit-habit-${theme}`, info);
      if (strict) expect(await dlg.textContent()).not.toMatch(/\bnull\b/);
    });
  });
}

test('tap targets on a 390px phone are at least 44px', async ({ page, account }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone width only');
  await page.setViewportSize({ width: 390, height: 844 });
  await withTheme(page, account, 'light');
  // The hit area includes the ::before/::after overlay: probe the point 21px out from the
  // centre in each direction, which a 44px target must still own.
  const probe = (sel) =>
    page.locator(sel).evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const pts = [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]];
          const miss = pts.filter(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return !(hit && (hit === el || el.contains(hit)));
          });
          return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height), miss: miss.length };
        })
    );
  const header = await probe('.gb-head .gb-iconbtn');
  await go(page, 'calendar');
  const ticks = await probe('.gb-rem-check');
  await shot(page, 'calendar-390', info);
  expect(ticks.length).toBeGreaterThan(0);
  info.annotations.push({ type: 'targets', description: JSON.stringify({ header, ticks }) });
  if (strict) for (const t of [...header, ...ticks]) expect(t.miss, `${t.cls} ${t.w}x${t.h}`).toBe(0);
});
