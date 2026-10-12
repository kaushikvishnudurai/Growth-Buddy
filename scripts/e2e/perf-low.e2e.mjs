/* The low-severity performance fixes, end to end:
   - the three first-paint fonts are preloaded with crossorigin and fetched once each
     (a preload without crossorigin is fetched twice and never used);
   - Goals renders every goal's recent actions from GET /api/goals alone: no
     per-goal /actions request (the server batches them, GoalService.list);
   - Achievements still opens now that it is a lazy chunk;
   - no console error and no 4xx/5xx, at 390 and 1280.
   Creates two goals with actions through the API and deletes them at the end.

     GB_E2E_BASE=http://localhost:5196 GB_E2E_CDP=http://127.0.0.1:9223 node scripts/e2e/perf-low.e2e.mjs */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5196';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The local login limiter answers 429 for a while after other runs' failures. */
async function login() {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.status !== 429) {
      if (!res.ok) throw new Error('login ' + res.status);
      return (await res.json()).token;
    }
    await sleep(21000);
  }
  throw new Error('login kept answering 429');
}

const token = await login();
const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(method + ' ' + path + ' ' + res.status);
  return res.status === 204 ? null : res.json();
};

const made = [];
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const ctx = await browser.createBrowserContext();
try {
  const a = await api('POST', '/api/goals', { title: 'Perf e2e goal A', horizon: 'short_term' });
  const b = await api('POST', '/api/goals', { title: 'Perf e2e goal B', horizon: 'short_term' });
  made.push(a.id, b.id);
  // created_at is whole seconds, so actions posted in the same second tie on it.
  for (const note of ['A first', 'A second', 'A third', 'A fourth']) {
    await api('POST', '/api/goals/' + a.id + '/actions', { note });
    await sleep(1100);
  }
  await api('POST', '/api/goals/' + b.id + '/actions', { note: 'B only' });

  const page = await ctx.newPage();
  const problems = [];
  const fontFetches = new Map();
  let actionRequests = 0;
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text().slice(0, 200));
    if (/preload/i.test(m.text())) problems.push('preload warning: ' + m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('request', (r) => {
    const u = r.url();
    if (/\.woff2(\?|$)/.test(u)) fontFetches.set(u, (fontFetches.get(u) || 0) + 1);
    if (/\/api\/goals\/[^/]+\/actions/.test(u)) actionRequests++;
  });
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url().slice(0, 140));
  });

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.type('input[type=email]', EMAIL);
  await page.type('input[type=password]', PASSWORD);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((x) => /sign in/i.test(x.textContent || ''))?.click()
  );
  await page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 30000 });
  await page.waitForSelector('.gb-scroll', { timeout: 20000 });

  // Fonts: a fresh load, so every face is fetched from the network once.
  fontFetches.clear();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.gb-scroll', { timeout: 20000 });
  const preloads = await page.$$eval('link[rel=preload][as=font]', (ls) =>
    ls.map((l) => ({ href: l.href, cors: l.crossOrigin, type: l.type }))
  );
  check(preloads.length === 3, 'three fonts preloaded (found ' + preloads.length + ')');
  check(preloads.every((p) => p.cors === 'anonymous' && p.type === 'font/woff2'), 'each preload is crossorigin woff2');
  for (const p of preloads) {
    const n = fontFetches.get(p.href) || 0;
    check(n === 1, 'preloaded ' + p.href.split('/').pop() + ' fetched once (' + n + ')');
  }
  const used = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight);
  });
  // The variable face (one file for every weight) reports its range, "400 800".
  check(used.some((f) => /Hanken/.test(f) && / 400( 800)?$/.test(f)), 'Hanken 400 in use');
  check(used.some((f) => /Bricolage/.test(f) && / 800$/.test(f)), 'Bricolage 800 in use');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });

  for (const [w, hgt] of [
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewport({ width: w, height: hgt });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/home-${w}.png` });

    actionRequests = 0;
    await page.goto(BASE + '/#/goals', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /Perf e2e goal A/.test(document.querySelector('.gb-scroll')?.textContent || ''), {
      timeout: 20000,
    });
    await sleep(500);
    const text = await page.$eval('.gb-scroll', (el) => el.textContent || '');
    check(/A fourth/.test(text) && /A second/.test(text) && !/A first/.test(text), `${w}: goal A shows its newest 3 actions`);
    check(/B only/.test(text), `${w}: goal B shows its action`);
    check(actionRequests === 0, `${w}: goals list made no per-goal /actions request (${actionRequests})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/goals-${w}.png` });

    await page.goto(BASE + '/#/achievements', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.gb-ach-tile', { timeout: 20000 });
    check(true, `${w}: achievements (lazy) rendered`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!over, `${w}: no horizontal overflow`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/achievements-${w}.png` });
  }

  check(problems.length === 0, 'no console errors or failed requests' + (problems.length ? ':\n  ' + problems.join('\n  ') : ''));
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  for (const id of made) await api('DELETE', '/api/goals/' + id).catch(() => {});
  await ctx.close();
  await browser.disconnect();
}

if (failures.length) {
  console.error(failures.length + ' failed');
  process.exit(1);
}
console.log('perf-low e2e: all passed');
