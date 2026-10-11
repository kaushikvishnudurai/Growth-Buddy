#!/usr/bin/env node
/* Bundle budget: run after `npm run build`. Fails when
     - the boot entry chunk (the assets/index-*.js that dist/index.html loads), or
     - the service worker's whole precache (every url in dist/sw.js's manifest)
   grows past its budget. CI runs it right after the build.

   Budgets are the sizes measured on 2026-10-10 (build 73) plus 5%:
     boot   548,878 B raw (169.4 kB gzip)  -> 576,322 B
     precache 35 unique files, 1,259,045 B -> 1,321,998 B
   Boot lowered after the money split (money-core.js / money-home.js, ScreenMoney
   lazy): 447,141 B raw (137.8 kB gzip) -> 469,498 B. Precache left: the split
   moves bytes between chunks, it doesn't remove them.
   Raised 2026-10-11 (build 78) for the low-input round: Quick add as the one
   command box, notification actions, Home one-tap cards and nudges, Circle
   replies/cheers/invites, the bank feed's settings, one-tap expense + scan.
   main was already over (boot 470,661 B). Measured boot 495,155 B -> 519,913 B,
   precache 1,403,472 B -> 1,473,646 B. day-plan.js and starter-packs.js were
   moved out to on-tap imports first.
   Build 95 went over both (boot 554,860 B, precache 1,515,681 B) and was brought
   back under WITHOUT raising them: terser instead of esbuild's minifier, Home's
   Outlook (outlook.js + insights.js) loaded beside wave 1 instead of in boot,
   activeDates split out of review.js, sockjs-client removed, and the install-only
   manifest icons and the standalone privacy.html left out of the precache.
   Measured after the design merge (build 96): boot 507,307 B (97.6%), precache
   1,471,982 B (99.9%). The precache has no headroom left: the next lever is the
   fonts (ten static faces, 164 kB), not this number.
   (Workbox prints "41 entries": the icons are listed twice, once by the glob
   and once by includeAssets/manifest; they are fetched and stored once.)
   Raw bytes, not gzip: deterministic and what the precache actually stores.

   Over budget on purpose (a new feature that has to live in the boot chunk)?
   Raise the number here in the same change and say why in the commit — the
   point is that growth is a decision, not something noticed months later. */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BOOT_BUDGET = 519_913;
const PRECACHE_BUDGET = 1_473_646;

const dist = process.argv[2] || 'dist';
const fail = (msg) => {
  console.error('bundle-budget: ' + msg);
  process.exitCode = 1;
};
if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'sw.js'))) {
  console.error(`bundle-budget: no build in ${dist}/ (run npm run build first)`);
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const m = html.match(/<script[^>]*type="module"[^>]*src="\/?(assets\/index-[^"]+\.js)"/);
if (!m) {
  console.error('bundle-budget: dist/index.html loads no assets/index-*.js entry');
  process.exit(1);
}
const bootBuf = readFileSync(join(dist, m[1]));
const boot = bootBuf.length;
const bootGz = gzipSync(bootBuf).length;

const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
const urls = [...new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((x) => x[1]))];
if (!urls.length) {
  console.error('bundle-budget: found no precache manifest in dist/sw.js');
  process.exit(1);
}
let precache = 0;
for (const u of urls) {
  const p = join(dist, u.replace(/^\//, ''));
  if (!existsSync(p)) {
    fail(`precache lists ${u} but dist/ has no such file`);
    continue;
  }
  precache += statSync(p).size;
}

const pct = (n, b) => ((n / b) * 100).toFixed(1) + '%';
console.log(
  `boot chunk ${m[1]}: ${boot} B (gzip ${bootGz} B), budget ${BOOT_BUDGET} B (${pct(boot, BOOT_BUDGET)})`
);
console.log(
  `precache ${urls.length} entries: ${precache} B, budget ${PRECACHE_BUDGET} B (${pct(precache, PRECACHE_BUDGET)})`
);
if (boot > BOOT_BUDGET) fail(`boot chunk is ${boot - BOOT_BUDGET} B over budget`);
if (precache > PRECACHE_BUDGET) fail(`precache is ${precache - PRECACHE_BUDGET} B over budget`);
