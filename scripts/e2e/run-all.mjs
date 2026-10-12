/* Runs every scripts/e2e/*.e2e.mjs in turn and fails if any does.

   Each script drives the real app in a Chrome attached over CDP (puppeteer.launch()
   dies here with an empty stderr; attaching works) and exits non-zero on a failed
   assertion, a console error or a 4xx/5xx. Needs: `npm run dev` (or a preview) at
   GB_E2E_BASE, a backend behind it, a seeded verified account in GB_E2E_EMAIL /
   GB_E2E_PASSWORD, and Chrome with --remote-debugging-port at GB_E2E_CDP.

   Sequential on purpose: the scripts share one account, and two at once would see
   each other's rows. `node scripts/e2e/run-all.mjs [name-filter]`. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.e2e.mjs') && f.includes(filter))
  .sort();

const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit', env: process.env });
  results.push({ f, ok: r.status === 0, s: ((Date.now() - t0) / 1000).toFixed(1) });
}

for (const r of results) console.log((r.ok ? 'pass ' : 'FAIL ') + r.f + ' (' + r.s + 's)');
const failed = results.filter((r) => !r.ok).length;
console.log(results.length - failed + '/' + results.length + ' e2e scripts passed');
process.exit(failed || !results.length ? 1 : 0);
