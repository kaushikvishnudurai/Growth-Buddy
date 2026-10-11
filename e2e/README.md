# E2E suite

Playwright, attached to a running stack. One fresh seeded account per test (`account` fixture), and a
`guard` fixture on every test that fails it on any console error, page error, HTTP 4xx/5xx or failed
request. Push a substring onto `allowed` to accept one you expect.

Stack (the overhaul's ports):

1. MySQL with a database loaded from `tableCreationQueries.sql` (strip the `USE` line).
2. Backend with mail to the log and `--growthbuddy.trust-proxy=true` (the seeder varies `X-Forwarded-For`
   to stay under the auth rate limit).
3. `API_PROXY_TARGET=http://localhost:8591 npx vite --port 5591`
4. `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9591 --user-data-dir=<tmp>`

Run: `GB_BACKEND_LOG=<backend log> npx playwright test` (env: `GB_E2E_BASE`, `GB_E2E_CDP`, `GB_E2E_WORKERS`).
Fixtures: `signIn` (the real form), `signInFast` (boot cookies), `go(page, 'money')`.
`node e2e/seed.mjs` prints a seeded account for manual use.
