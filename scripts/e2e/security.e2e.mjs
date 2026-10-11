/* Security fixes, end to end (feat/ov-sec): what users see still works, and
   what the fixes refuse is refused.

   API (node fetch, so an expected 400 is not counted as a page failure):
     - push subscribe with an http, internal or non-push-service endpoint -> 400
     - a "_" people search matches nobody; a 1-char Family search asks nothing
     - a stranger's email in search results carries no domain
     - with GB_E2E_BACKEND_LOG (the backend's log file, for the OTP): a throwaway
       second account is invited to the QA account's family; until it accepts the
       family sees no DOB / height / weight / gender; after accepting, it does.
       Cleaned up at the end (member removed, throwaway scheduled for deletion).
     - then the throwaway, as a family owner, invites QA, removes, re-invites:
       the 4th invite to the same person in a day is 429 (SEC-12)
   Page, at 390 and 1280: Circle "Find someone" finds people with masked emails,
   Family shows the pending invite, a Circle invite link asks before joining
   ("Not now" joins nothing), and notes' sanitize() drops a protocol-relative
   href. Zero console errors and no 4xx/5xx in the page. The page runs in its
   own browser context: cookies are per host, so other tabs on localhost would
   otherwise share (and rewrite) this one's session.

     GB_E2E_BASE (http://localhost:5173)  GB_E2E_CDP (http://127.0.0.1:9222)
     GB_E2E_EMAIL / GB_E2E_PASSWORD (the seeded QA account)  GB_E2E_SHOTS (dir, optional)
     GB_E2E_BACKEND_LOG (optional; without it the accept half is skipped) */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.GB_E2E_BASE || 'http://localhost:5173';
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9222';
const EMAIL = process.env.GB_E2E_EMAIL || 'qa.audit.1791564039@example.com';
const PASSWORD = process.env.GB_E2E_PASSWORD || 'QaTest#2026pw';
const SHOTS = process.env.GB_E2E_SHOTS || '';
const BACKEND_LOG = process.env.GB_E2E_BACKEND_LOG || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const problems = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(ok, what) {
  console.log((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) problems.push(what);
}

async function call(token, path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}
const post = (token, path, body) =>
  call(token, path, { method: 'POST', body: JSON.stringify(body || {}) });

let login = await post(null, '/api/auth/login', { email: EMAIL, password: PASSWORD });
if (login.status === 429) {
  // The shared local auth limiter; it is cleared often on the test box.
  await wait(21000);
  login = await post(null, '/api/auth/login', { email: EMAIL, password: PASSWORD });
}
check(login.status === 200 && login.body && login.body.token, 'QA account signs in over the API');
const qa = login.body && login.body.token;
if (!qa) {
  console.log('cannot continue without a session (' + login.status + ')');
  process.exit(1);
}

/* ---- push: only real push services ---- */
for (const endpoint of [
  'http://fcm.googleapis.com/fcm/send/x',
  'https://169.254.169.254/latest/meta-data',
  'https://app:8080/api/auth/me',
  'https://fcm.googleapis.com.evil.example/x',
]) {
  const r = await post(qa, '/api/push/subscribe', { endpoint, p256dh: 'k', auth: 'a' });
  check(r.status === 400, `push subscribe refuses ${endpoint} (${r.status})`);
}

/* ---- people search ---- */
const wild = await call(qa, '/api/users/search?q=_');
check(
  wild.status === 200 && Array.isArray(wild.body) && wild.body.length === 0,
  '"_" matches nobody in Circle search'
);
const one = await call(qa, '/api/family/search?q=a');
check(
  one.status === 200 && Array.isArray(one.body) && one.body.length === 0,
  'a 1-char Family search returns nothing'
);
const browse = await call(qa, '/api/users/browse');
check(browse.status === 200 && Array.isArray(browse.body), 'Circle browse still answers');
const masked = (browse.body || []).filter((p) => p.relationship === 'none' && p.email);
check(
  masked.every((p) => !p.email.includes('@')),
  `strangers' emails carry no domain (${masked
    .slice(0, 3)
    .map((p) => p.email)
    .join(', ')})`
);

/* ---- family invite: no profile before consent ---- */
let other = null; // { token, id, name }
let memberId = null;
if (BACKEND_LOG) {
  const stamp = Date.now();
  const email = `sec.e2e.${stamp}@example.com`;
  const name = 'Sec Throwaway ' + String(stamp).slice(-4);
  const pw = 'SecE2e#' + stamp;
  const su = await post(null, '/api/auth/signup', { email, password: pw, displayName: name });
  check(su.status < 300, `throwaway signup (${su.status})`);
  let otp = null;
  for (let i = 0; i < 20 && !otp; i++) {
    await wait(500);
    const m = readFileSync(BACKEND_LOG, 'utf8').match(
      new RegExp(
        'Sent email to ' +
          email.replace(/\./g, '\\.') +
          ' \\(subject: Your Growth Buddy code: (\\d{6})\\)'
      )
    );
    otp = m && m[1];
  }
  check(!!otp, 'OTP found in the backend log');
  const v = otp ? await post(null, '/api/auth/verify', { email, otp }) : { status: 0 };
  check(v.status === 200 && v.body.token, 'throwaway verifies');
  if (v.status === 200) {
    const token = v.body.token;
    const me = await call(token, '/api/auth/me');
    other = { token, id: me.body.id, name, pw };
    const prof = await call(token, '/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: name,
        dob: '1991-04-02',
        heightCm: 170,
        weightKg: 64,
        gender: 'male',
      }),
    });
    check(prof.status === 200, 'throwaway sets a profile');

    const found = await call(qa, '/api/family/search?q=' + other.id);
    check(
      (found.body || []).some((u) => u.id === other.id),
      'Family search finds an exact id'
    );
    const link = await post(qa, '/api/family/members/link', { userId: other.id });
    check(link.status === 200, `QA invites the throwaway (${link.status})`);
    const row = ((link.body && link.body.members) || []).find((m) => m.linkedUserId === other.id);
    memberId = row && row.id;
    check(!!row && row.status === 'invited', 'the invite row is there, status invited');
    check(
      !!row &&
        row.dob == null &&
        row.heightCm == null &&
        row.weightKg == null &&
        row.gender == null,
      'before accepting, the family sees no DOB / height / weight / gender'
    );
  }
} else {
  console.log('skip family accept half (set GB_E2E_BACKEND_LOG)');
}

/* ---- the page ---- */
const browser = await puppeteer.connect({ browserURL: CDP, protocolTimeout: 120000 });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
page.on(
  'console',
  (m) => m.type() === 'error' && problems.push('console: ' + m.text().slice(0, 200))
);
page.on('pageerror', (e) => problems.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', (r) => {
  if (r.status() >= 400)
    problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`);
});
const joinCalls = [];
page.on(
  'request',
  (r) =>
    /\/api\/circles\/[^/]+\/join|\/api\/circles\/join-code/.test(r.url()) && joinCalls.push(r.url())
);
const shot = async (name, width) =>
  SHOTS && page.screenshot({ path: `${SHOTS}/${name}-${width}.png` });
const dialogs = () => page.$$eval('[aria-modal="true"]', (els) => els.length);
async function closeAll() {
  for (let i = 0; i < 4 && (await dialogs()); i++) {
    await page.keyboard.press('Escape');
    await wait(300);
  }
}

try {
  for (const width of [390, 1280]) {
    await page.setViewport(
      width === 390
        ? { width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
        : { width, height: 800, deviceScaleFactor: 1 }
    );
    await page.goto(BASE + '/#/home', { waitUntil: 'networkidle2' });
    if (await page.$('input[type=password]')) {
      await page.type('input[type=email]', EMAIL);
      await page.type('input[type=password]', PASSWORD);
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find((b) => /sign in/i.test(b.textContent || ''))
          ?.click()
      );
      await page.waitForFunction(() => !document.querySelector('input[type=password]'), {
        timeout: 20000,
      });
    }
    await wait(1000);

    // Notes: a protocol-relative link loses its href; a same-app path keeps it.
    const hrefs = await page.evaluate(async () => {
      const { sanitize } = await import('/scripts/notes.js');
      const box = document.createElement('div');
      box.innerHTML = sanitize(
        '<a href="//evil.example/x">a</a><a href="/\\evil.example">b</a><a href="/#/notes">c</a><a href="https://ok.example">d</a>'
      );
      return [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    });
    check(
      hrefs[0] == null &&
        hrefs[1] == null &&
        hrefs[2] === '/#/notes' &&
        hrefs[3] === 'https://ok.example',
      `[${width}] notes drop //host and /\\host links, keep /path and https (${JSON.stringify(hrefs)})`
    );

    // Circle: Find someone -> a name search -> masked emails.
    await page.evaluate(() => (location.hash = '#/circle'));
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some((b) =>
          /Find someone/.test(b.textContent || '')
        ),
      { timeout: 20000 }
    );
    await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .find((b) => /Find someone/.test(b.textContent || ''))
        .click()
    );
    await page.waitForSelector('.gb-search-modal input', { timeout: 8000 });
    // A mentor or mentee you have an active link with is not a stranger: the
    // server shows them in full by design (UserController.toPublic).
    const linked = new Set();
    const onSearch = async (r) => {
      if (!/\/api\/users\/search/.test(r.url()) || r.status() !== 200) return;
      for (const u of await r.json().catch(() => []))
        if (u.mentorLink === 'active' || u.menteeLink === 'active') linked.add(u.email);
    };
    page.on('response', onSearch);
    await page.type('.gb-search-modal input', 'qa');
    await page.waitForFunction(
      () => document.querySelectorAll('.gb-search-modal .gb-person-row').length > 0,
      {
        timeout: 10000,
      }
    );
    await wait(900); // the debounced server search lands
    const subs = await page.$$eval('.gb-search-modal .gb-person-row .sub', (els) =>
      els.map((e) => e.textContent)
    );
    check(subs.length > 0, `[${width}] Circle search lists people (${subs.length})`);
    page.off('response', onSearch);
    const strangers = subs.filter((t) => /@/.test(t) && ![...linked].some((e) => t.includes(e)));
    check(
      strangers.length === 0,
      `[${width}] no stranger's email domain on screen (${strangers.slice(0, 2).join(' | ') || subs.slice(0, 2).join(' | ')})`
    );
    await shot('circle-search', width);
    await closeAll();

    // A Circle invite link asks first; "Not now" joins nothing.
    const before = joinCalls.length;
    await page.evaluate(() => (location.hash = '#/home'));
    await wait(500);
    await page.evaluate(
      () => (location.hash = '#/circle?circle=00000000-0000-0000-0000-0000000000aa')
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="alertdialog"]')].some((d) =>
          /Join this circle\?/.test(d.textContent)
        ),
      { timeout: 20000 }
    );
    await shot('circle-join-confirm', width);
    await page.evaluate(() =>
      [...document.querySelectorAll('[role="alertdialog"] button')]
        .find((b) => /Not now/.test(b.textContent))
        .click()
    );
    await wait(800);
    check(joinCalls.length === before, `[${width}] "Not now" sent no join request`);
    check(
      (await page.evaluate(() => location.hash)) === '#/circle',
      `[${width}] the link's query was dropped`
    );

    // Family shows the pending invite.
    await page.evaluate(() => (location.hash = '#/family'));
    await wait(2500);
    if (other) {
      const txt = await page.evaluate(() => document.querySelector('#gb-main')?.textContent || '');
      check(txt.includes(other.name), `[${width}] Family lists the pending invite`);
    }
    await shot('family', width);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    );
    check(!overflow, `[${width}] no horizontal overflow`);
  }

  /* ---- accept: now the profile joins ---- */
  if (other && memberId) {
    const inv = await call(other.token, '/api/family/invites');
    check(
      (inv.body || []).some((i) => i.memberId === memberId || i.id === memberId),
      'the throwaway sees the invite'
    );
    const acc = await post(other.token, `/api/family/invites/${memberId}/accept`);
    check(acc.status === 200, `the throwaway accepts (${acc.status})`);
    const fam = await call(qa, '/api/family');
    const row = ((fam.body && fam.body.members) || []).find((m) => m.id === memberId);
    check(
      !!row &&
        row.status === 'mapped' &&
        row.dob === '1991-04-02' &&
        row.heightCm === 170 &&
        row.weightKg === 64,
      'after accepting, their profile is in the family'
    );
    const removed = await call(qa, '/api/family/members/' + memberId, { method: 'DELETE' });
    check(removed.status === 200, 'QA removes the throwaway again');
    memberId = null;

    // Invite spam: the throwaway, now an owner of its own, loops invite / remove on QA.
    const qaId = (await call(qa, '/api/auth/me')).body.id;
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const r = await post(other.token, '/api/family/members/link', { userId: qaId });
      codes.push(r.status);
      const row2 = r.status === 200 && r.body.members.find((m) => m.linkedUserId === qaId);
      if (row2) await call(other.token, '/api/family/members/' + row2.id, { method: 'DELETE' });
    }
    check(
      codes.slice(0, 3).every((c) => c === 200) && codes[3] === 429,
      `the 4th family invite to one person in a day is refused (${codes.join(', ')})`
    );
  }
} catch (err) {
  if (SHOTS) await page.screenshot({ path: SHOTS + '/failure.png' }).catch(() => {});
  problems.push(
    'threw: ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err)
  );
} finally {
  await ctx.close();
  if (memberId) {
    const del = await call(qa, '/api/family/members/' + memberId, { method: 'DELETE' });
    check(del.status < 300, `cleanup: member removed (${del.status})`);
  }
  if (other) {
    const gone = await post(other.token, '/api/auth/delete-account', { password: other.pw });
    check(gone.status < 300, `cleanup: throwaway scheduled for deletion (${gone.status})`);
  }
  await browser.disconnect();
}

if (problems.length) {
  console.log('\n' + problems.length + ' problem(s):\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nall good');
