/* PWA, link previews and crawler files, against a PRODUCTION build: the
   manifest, the service worker and the %GB_SITE_URL% rewrites only exist in
   one. Run:
     npm run build
     API_PROXY_TARGET=http://localhost:8080 npx vite preview --port 4184 --strictPort
     node scripts/e2e/pwa.e2e.mjs
   Env: GB_E2E_BASE (default http://localhost:4184), GB_E2E_CDP
   (http://127.0.0.1:9223), GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded account).

   Checks: manifest fields, og/twitter/canonical tags, robots.txt and
   sitemap.xml, the og image is a real 1200x630 PNG, a share-target URL opens
   Quick add's preview with the shared words (and writes nothing), each manifest
   shortcut routes, and no console error or 4xx/5xx on the way. The water
   shortcut logs a real glass; it is deleted again before the script ends. */
import puppeteer from 'puppeteer-core';

const BASE = (process.env.GB_E2E_BASE || 'http://localhost:4184').replace(/\/$/, '');
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';

const failures = [];
const check = (ok, what) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- Files: plain HTTP, no browser ---- */
async function get(path) {
  const res = await fetch(BASE + path);
  return { res, type: res.headers.get('content-type') || '', body: Buffer.from(await res.arrayBuffer()) };
}

const man = await get('/manifest.webmanifest');
check(man.res.status === 200, 'manifest served');
const m = JSON.parse(man.body.toString('utf8'));
check(m.id === '/', 'manifest id');
check(Array.isArray(m.categories) && m.categories.includes('productivity'), 'manifest categories');
check(m.orientation === 'any', "manifest orientation 'any'");
const shortcutUrls = (m.shortcuts || []).map((s) => s.url);
check(
  ['water', 'task', 'focus', 'quickadd'].every((id) => shortcutUrls.includes('/?shortcut=' + id)),
  'manifest shortcuts: water, task, focus, quickadd'
);
const forms = (m.screenshots || []).map((s) => s.form_factor).sort().join(',');
check(forms === 'narrow,wide', 'manifest screenshots narrow + wide');
for (const s of m.screenshots || []) {
  const r = await get('/' + s.src);
  check(r.res.status === 200 && r.type.startsWith('image/'), 'screenshot served: ' + s.src);
}
const st = m.share_target || {};
check(
  st.method === 'GET' && st.params && st.params.text === 'text' && st.params.title === 'title' && st.params.url === 'url',
  'manifest share_target GET title/text/url'
);

const html = (await get('/')).body.toString('utf8');
const meta = (attr, name) =>
  (html.match(new RegExp('<meta\\s+' + attr + '="' + name + '"\\s+content="([^"]*)"')) || [])[1] || '';
for (const p of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image']) {
  check(!!meta('property', p), 'index.html ' + p);
}
check(meta('name', 'twitter:card') === 'summary_large_image', 'index.html twitter:card');
check(/^https:\/\/[^%]+\/og-image\.png$/.test(meta('property', 'og:image')), 'og:image is absolute, placeholder replaced');
check(/<link rel="canonical" href="https:\/\/[^%"]+\/"/.test(html), 'index.html canonical');
check(/<script src="\/global-shim\.js" defer>/.test(html), 'global-shim.js is deferred');

const og = await get('/og-image.png');
check(
  og.res.status === 200 && og.type === 'image/png' && og.body.readUInt32BE(16) === 1200 && og.body.readUInt32BE(20) === 630,
  'og-image.png is a 1200x630 PNG'
);
const privacy = (await get('/privacy.html')).body.toString('utf8');
check(/rel="canonical" href="https:\/\/[^%"]+\/privacy\.html"/.test(privacy), 'privacy.html canonical');
check(/property="og:image" content="https:\/\/[^%"]+"/.test(privacy), 'privacy.html og:image');
check(/name="description"/.test(privacy), 'privacy.html description');

const robots = await get('/robots.txt');
const rt = robots.body.toString('utf8');
check(robots.res.status === 200 && /Disallow: \/api\//.test(rt) && /Allow: \/privacy\.html/.test(rt) && /Sitemap: https:/.test(rt), 'robots.txt');
const sm = await get('/sitemap.xml');
const smt = sm.body.toString('utf8');
check(sm.res.status === 200 && /<loc>https:[^<]+\/<\/loc>/.test(smt) && /<loc>[^<]+\/privacy\.html<\/loc>/.test(smt), 'sitemap.xml');
check((await get('/favicon.ico')).res.status === 200, 'favicon.ico');

/* ---- The app ---- */
// Its own browser context: cookies are per host, not per port, so a tab of
// another run on localhost would otherwise share (and sign out) this session.
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push('console: ' + msg.text().slice(0, 200));
});
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 140));
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const shot = async (name) => {
  if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};
const appReady = () =>
  page.waitForFunction(() => document.querySelector('#gb-main') && !document.querySelector('.gb-boot-quote'), {
    timeout: 20000,
  });
const textOf = (sel) => page.$eval(sel, (el) => el.textContent || '').catch(() => '');
// The sheet on top: the newest overlay that isn't on its way out.
const topSheet = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('.gb-modal-overlay:not(.is-closing)')];
    return all.length ? all[all.length - 1].textContent || '' : '';
  });
const closeTopOverlay = async () => {
  await page.keyboard.press('Escape');
  await sleep(400);
};

async function open(path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle2' });
  await appReady();
  await sleep(900);
}

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
  // The local auth limiter can answer 429; it clears within 20 s, so one retry.
  for (let attempt = 0; attempt < 2 && (await page.$('input[type=email]')); attempt++) {
    if (attempt) await sleep(21000);
    await page.$eval('input[type=email]', (el) => (el.value = ''));
    await page.$eval('input[type=password]', (el) => (el.value = ''));
    await page.type('input[type=email]', EMAIL);
    await page.type('input[type=password]', PASSWORD);
    const login = page.waitForResponse((r) => r.url().includes('/api/auth/login'), { timeout: 20000 });
    await page.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => /sign in/i.test(b.textContent || ''))?.click()
    );
    const res = await login;
    if (res.status() === 429) {
      const i = problems.findIndex((p) => p.startsWith('HTTP 429'));
      if (i >= 0) problems.splice(i, 1); // the retry is the check, not the 429
      continue;
    }
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20000 });
  }
  check(!(await page.$('input[type=password]')), 'signed in');
  await appReady();
  await sleep(1200);
  await closeTopOverlay(); // a first-run or timezone offer, if any

  // Share target: the words land in Quick add's preview; nothing is written.
  const shared = 'spent 200 on lunch';
  // The assistant (or, without one, the server's own patterns) reads it first.
  // /api/quick-add is under the per-user AI limit, which the shared test account
  // can exhaust; a 429 there is the environment, so wait for it to clear, once.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(21000);
    const parsed = page.waitForResponse((r) => r.url().includes('/api/quick-add'), { timeout: 40000 });
    await open('/?text=' + encodeURIComponent(shared) + '&title=');
    const res = await parsed.catch(() => null);
    if (res && res.status() === 429) {
      for (let i = problems.length - 1; i >= 0; i--) if (/429/.test(problems[i])) problems.splice(i, 1);
      continue;
    }
    await page
      // One item reads "Log this?", more "Log these?" (runQuickAdd's preview).
      .waitForFunction(() => /Log th(is|ese)\?/.test(document.body.textContent || ''), { timeout: 40000 })
      .catch(() => {});
    break;
  }
  await sleep(400);
  const preview = await topSheet();
  check(/Log th(is|ese)\?/.test(preview), 'share opens the Quick add preview');
  check(/200/.test(preview) && /lunch/i.test(preview), 'the preview shows the shared words');
  check((await page.evaluate(() => location.search)) === '', 'the share query is taken off the address');
  await shot('share-preview');
  await closeTopOverlay();

  // Shortcuts.
  await open('/?shortcut=task');
  await sleep(400);
  check(/New task/.test(await topSheet()), 'shortcut=task opens New task');
  await shot('shortcut-task');
  await closeTopOverlay();

  await open('/?shortcut=quickadd');
  check(/What would you like to add\?/.test(await textOf('body')), 'shortcut=quickadd opens Quick add');
  await shot('shortcut-quickadd');
  await closeTopOverlay();

  await open('/?shortcut=focus');
  check((await page.evaluate(() => location.hash)) === '#/focus', 'shortcut=focus opens Focus');
  await page.waitForFunction(() => /Pause/.test(document.querySelector('.gb-focus')?.textContent || ''), { timeout: 5000 }).catch(() => {});
  check(/Pause/.test(await textOf('.gb-focus')), 'shortcut=focus starts the timer');
  await shot('shortcut-focus');
  await page.evaluate(() => document.querySelector('[aria-label="Reset timer"]')?.click());
  await sleep(300);

  const token = await page.evaluate(() => {
    const c = document.cookie.split('; ').find((p) => p.startsWith('gb.token='));
    return c ? decodeURIComponent(c.slice('gb.token='.length)) : '';
  });
  const waterApi = (path, opts = {}) =>
    page.evaluate(
      async (p, o, t) => {
        const r = await fetch(p, { ...o, headers: { Authorization: 'Bearer ' + t } });
        return r.ok ? r.json() : { status: r.status };
      },
      path,
      opts,
      token
    );
  const before = new Set(((await waterApi('/api/water')).entries || []).map((e) => e.id));
  await open('/?shortcut=water');
  await page.waitForFunction(() => /Logged 250 ml of water/.test(document.body.textContent || ''), { timeout: 8000 }).catch(() => {});
  check(/Logged 250 ml of water/.test(await textOf('body')), 'shortcut=water logs a glass');
  await shot('shortcut-water');
  const added = ((await waterApi('/api/water')).entries || []).filter((e) => !before.has(e.id));
  check(added.length === 1 && added[0].amountMl === 250, 'exactly one 250 ml entry was written');
  for (const e of added) await waterApi('/api/water/entries/' + e.id, { method: 'DELETE' });

  // A reload after a shortcut does not repeat it (the query is gone).
  await open('/');
  const after = ((await waterApi('/api/water')).entries || []).filter((e) => !before.has(e.id));
  check(after.length === 0, 'the test glass is cleaned up and a reload logs nothing');

  check(problems.length === 0, 'no console errors or failed requests' + (problems.length ? ':\n  ' + problems.join('\n  ') : ''));
} finally {
  await ctx.close();
  browser.disconnect();
}

if (failures.length) {
  console.error('\n' + failures.length + ' check(s) failed');
  process.exit(1);
}
console.log('\npwa e2e: all checks passed');
