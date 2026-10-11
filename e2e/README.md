# E2E suite

Playwright, attached to a running stack. One fresh seeded account per test (`account` fixture), and a
`guard` fixture on every test that fails it on any console error, page error, HTTP 4xx/5xx or failed
request. Push a substring onto `allowed` to accept one you expect.

Stack (the overhaul's ports):

1. MySQL with a database loaded from `tableCreationQueries.sql` (strip the `USE` line).
2. Backend with mail to the log and `--growthbuddy.trust-proxy=true` (the seeder varies `X-Forwarded-For`
   to stay under the auth rate limit).
3. `API_PROXY_TARGET=http://localhost:8590 npx vite --port 5591`
4. `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9591 --user-data-dir=<tmp>`

Run: `GB_BACKEND_LOG=<backend2.log> npx playwright test` (env: `GB_E2E_BASE`, `GB_E2E_CDP`, `GB_E2E_WORKERS`).
That runs the two Chrome projects, `desktop-chrome` (1280x800) and `mobile-chrome` (Pixel 7).

Cross-browser: `GB_E2E_ALL=1` adds `tablet-chrome` (iPad gen 7), `desktop-firefox`, `desktop-webkit` and
`mobile-webkit` (iPhone 14). Playwright can't launch a browser from inside the test runner here (the
child is killed with EPERM), but it can from a shell, so:

1. `npx playwright install firefox webkit` (once; works through the corporate proxy).
2. `e2e/servers.sh start` launches a Firefox server on :9611 and a WebKit server on :9612 (override with
   `GB_E2E_FF_PORT` / `GB_E2E_WK_PORT`) and writes their endpoints + pid to `e2e/.servers.json`
   (`GB_E2E_SERVERS` to move it). Idempotent; `e2e/servers.sh stop` ends them.
3. `GB_E2E_ALL=1 GB_BACKEND_LOG=<backend log> npx playwright test e2e/smoke.spec.mjs`

The `engine` option on each project picks the path in the `browser` fixture: `chrome` attaches over CDP,
`firefox`/`webkit` connect to those servers. Chrome projects need only the CDP Chrome, not the servers.
The shared CDP Chrome slows down badly when several sessions use it (60 s timeouts on screenshot/fill);
`GB_E2E_CHROME=server` points the Chrome projects at servers.sh's own Chromium on :9613 instead.
Fixtures: `signIn` (the real form), `signInFast` (boot cookies), `go(page, 'money')`.
`node e2e/seed.mjs` prints a seeded account for manual use.
