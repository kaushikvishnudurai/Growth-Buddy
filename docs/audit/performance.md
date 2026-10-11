# Performance audit (PRF)

Build 92, branch overhaul/2026-10-11. Production bundle (`npm run build`) served by
`vite preview --port 4591` (the `preview` block in `vite.config.js` already carries the same `/api` +
`/ws` proxy as `server`, so `API_PROXY_TARGET=http://localhost:8591` was enough). Lighthouse 13.5.0
attached to the shared CDP Chrome on :9591. Signed-in runs used a seeded account with 360 expenses,
24 income rows and 53 tasks (`perf.1791740040882.6077@example.com`), signed in by writing the
`gb.token` / `gb.session` cookies, then `--disable-storage-reset` (cache, Cache API and service
worker cleared before each run).

## Scores

| Run | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|---|---|---|
| Signed out, mobile | 92 | 98 | 100 | 91 | 2.6 s | 2.7 s | 0 ms | 0 | 2.6 s |
| Signed out, desktop | 100 | 98 | 100 | 91 | 0.6 s | 0.6 s | 0 ms | 0 | 0.6 s |
| Home (seeded), mobile | 92 | 94 | 81 | 91 | 2.1 s | 2.2 s | 40 ms | 0 | 5.6 s |
| Home (seeded), desktop | 97 | 94 | 81 | 91 | 0.5 s | 0.7 s | 0 ms | 0 | 1.8 s |

Reports: `docs/evidence/audit-performance/{signedout,home}-{mobile,desktop}.report.{json,html}`.

### Every failing audit

| Audit | Runs | Verdict |
|---|---|---|
| render-blocking-insight (CSS 54 kB gz + `/global-shim.js`; est. 300-1,050 ms mobile) | all | real: PRF-2, PRF-4 |
| unused-javascript (boot chunk 81% unused on first load, ~107-126 KiB) | all | real: PRF-3, PRF-5 |
| unused-css-rules (97% of the one 54 kB gz stylesheet unused on login) | all | real: PRF-4 |
| network-dependency-tree-insight | all | informational: CSS then fonts chain, no preload (PRF-7) |
| first-contentful-paint / largest-contentful-paint (mobile) | signed out, Home | consequence of PRF-2/3/4: login LCP waits for the 510 kB boot chunk |
| speed-index (mobile 5.6 s, desktop 1.8 s) | Home | partly environmental (see Caveats), partly PRF-6 |
| mainthread-work-breakdown (2.0 s, mobile) | Home | Lighthouse 4x CPU; see render timings below |
| deprecations: "Unload event listeners are deprecated" (`entry-*.js`) | Home | real: PRF-1 |
| bf-cache: "The page has an unload handler in the main frame" | Home | real: PRF-1 |
| forced-reflow-insight (73-121 ms desktop, in the boot chunk) | Home | minor, see PRF-6 note |
| color-contrast: "Overdue" task time, 3.4:1 in dark theme | Home desktop/mobile | real: PRF-8 |
| heading-order: Home "Today's tasks" is an h3 with no h2 above it | Home | real: PRF-9 |
| label-content-name-mismatch: avatar `aria-label="Account"` shows "AR"; mini-calendar day buttons | Home | real: PRF-9 |
| landmark-one-main: sign-in screen has no `<main>` | signed out | real: PRF-9 |
| unminified-javascript (15 KiB) | all | NOT the app: three `chrome-extension://mhkgegcmcapcgmnnloigolapjkajgfmd/` scripts installed in the shared Chrome |
| robots-txt invalid (35 errors) | all | NOT prod: `vite preview` answers `/robots.txt` with index.html. Live answers 404, which Lighthouse passes |
| cls-culprits-insight | Home mobile | NOT the app: the culprits are fonts from `localhost:5591` (another session's tab in the same Chrome) |
| llms-txt, ard-schema ("Agentic Browsing" category) | all | not applicable to a signed-in personal app; ignored |

Text compression: `vite preview` and Spring send no `Content-Encoding` (no `server.compression` in
`application*.yml`), but the live site does: `https://growth-buddy-cu63.onrender.com` answers `br`
for both `index.html` and the boot chunk through Cloudflare, and the Caddyfile path has
`encode gzip zstd`. No finding.

## Bundle composition

`npm run build` + `node scripts/bundle-budget.mjs` (exit 1):

```
boot chunk assets/index-CyamlIKr.js: 510743 B (gzip 158204 B), budget 519913 B (98.2%)
precache 40 entries: 1488655 B, budget 1473646 B (101.0%)
bundle-budget: precache is 15009 B over budget
```

Boot chunk by module (Rollup `renderedLength`, i.e. before minification; total 989,733 B):

| Module | Bytes | Share |
|---|---|---|
| scripts/app.js | 447,778 | 45.2% |
| scripts/calendar.js | 93,327 | 9.4% |
| scripts/dashboard.js | 90,642 | 9.2% |
| scripts/gb-kit.js | 49,243 | 5.0% |
| scripts/insights.js | 36,400 | 3.7% (Report-only code, PRF-3) |
| scripts/money-core.js | 28,305 | 2.9% |
| scripts/native.js | 27,085 | 2.7% |
| scripts/push.js | 21,181 | 2.1% |
| lucide (155 icons, tree-shaken) | ~70,000 | ~7% |
| everything else (habit-stats, achievements, outbox, a11y, recurrence, chime, cache-storage, nudges, ...) | | <1.2% each |

Lazy chunks: `money` 117.5 kB, `family` 48.3 kB, `entry` (sockjs-client + url-parse +
querystringify) 47.2 kB, `circle` 43.3 kB, `notes` 37.4 kB, `timer` 25.6 kB, `stomp` 23.3 kB,
`report` 22.8 kB. One CSS file, `index-*.css` 311.8 kB raw / 53.9 kB gzip (app.css 361 kB source,
money.css 66 kB, premium.css 21 kB, tokens, mini-calendar), render-blocking on every screen.

## Images and fonts

- Images: no raster image on the sign-in screen or Home. PNG icons only (`icon-512.png` 22.8 kB,
  the rest < 5 kB); `logomark.svg` 480 B; the sign-in garden is inline SVG. Nothing to fix.
- Fonts: 10 latin-subset faces, `font-display: swap` on all, self-hosted via @fontsource,
  woff2 13.5-22.5 kB each (164 kB for all 10). Home loads 8 of them (~135 kB). No `<link rel=preload>`:
  they are discovered only after the 54 kB CSS parses. Vite also emits a `.woff` twin of every face
  (14 files, ~240 kB); harmless (not precached, never requested by a woff2 browser) but dead weight
  in the image. CLS stays 0, so this is Low (PRF-7).

## Long tasks and render() cost (seeded account, phone 390 px)

Measured on the production bundle in a fresh Playwright context (service workers blocked), with a
PerformanceObserver for `longtask` and a `hashchange` listener registered before the app's, so the
time from the event to the end of the app's handler is exactly `setScreen()` + `render()`.

| | 1x CPU | 4x CPU throttle |
|---|---|---|
| FCP | 512 ms | 352 ms |
| `gb-home-painted` mark | 580 ms | 736 ms |
| Boot long tasks | none | 149 ms (module eval), 123 ms (first Home render), 63 ms, 84 ms |
| `render()` -> Home (8 samples) | 4.8-13.5 ms | 16-30 ms |
| `render()` -> Calendar | 5-7 ms | 19-25 ms |
| `render()` -> Report | 4 ms | 20 ms |
| `render()` -> Habits / Goals / Notes | 1.4-2.8 ms | 3.7-6 ms |
| Money (lazy, paints itself after the hash handler) | 1.3-7.9 ms sync + one 50-80 ms task | 5-35 ms sync + 80 ms tasks |
| Scrolling the Money screen 8,000 px | no long task | no long task |
| DOM elements | Home 705, Report 783, Calendar 662, Money 426 | |

`render()` is cheap even with 384 money rows and 53 tasks: worst Home repaint 30 ms at 4x CPU, well
under a frame budget concern for a tap. No finding on render cost. Screenshot of the seeded Money
screen: `docs/evidence/audit-performance/money-big-mobile-4x.jpg`.

Boot request order (1x): wave 1 (tasks, habits, score, water, reminders, quote) 494-552 ms; wave 2
(goals, notifications, food, money, daily-logs, photo-history, weekly-review) 573-733 ms. At 4x,
wave 1 ends at 290 ms and wave 2 does not start until 652 ms (PRF-6).

## Caveats (measurement environment)

- The CDP Chrome is shared with other sessions. Its `prefers-color-scheme` flipped between dark and
  light several times during one 6-second sample, which is why the signed-in Lighthouse filmstrip
  shows the page repainting from light to dark at ~2 s; the app follows the media query correctly
  (`followSystemTheme`), so that is not a bug, but it inflates Speed Index on Home.
- One 4x run measured an 18.6 s Home with long tasks up to 410 ms; repeated runs gave 1.1 s. Treat it
  as contention, not as an app result.
- The first signed-in Lighthouse pair was discarded: `e2e/seed.mjs` returns the user from `verify`,
  before its `PUT /api/auth/timezone`, so the cookie said UTC and the timezone dialog became the LCP
  element. The kept runs use the `/api/auth/me` user.

## Findings

### PRF-1: sockjs-client is the only reason for the unload handler, the bf-cache miss, the render-blocking shim and a 47 kB chunk
- Severity: Medium
- Where: scripts/app.js:connectWebSocket; index.html (`/global-shim.js`); public/global-shim.js
- Repro / evidence: Lighthouse Home mobile + desktop: `deprecations` "Unload event listeners are
  deprecated and will be removed." at `assets/entry-BSWwEFKR.js` col 1269; `bf-cache` "The page has
  an unload handler in the main frame" (UnloadHandlerExistsInMainFrame). `entry-BSWwEFKR.js` is
  sockjs-client (`unloadAdd` / `triggerUnloadCallbacks` from `sockjs-client/lib/utils/event.js`).
  Module breakdown of that chunk: sockjs shims 17.7 kB, url-parse 17.3 kB, sockjs main 9.9 kB,
  iframe/jsonp/xhr fallbacks for IE-era browsers. `/global-shim.js` exists only for sockjs
  (its own comment) and is a parser-blocking classic script in `<head>`: Lighthouse
  render-blocking-insight attributes 301 ms (mobile) to it.
- Cause: `new SockJS(API_BASE + '/ws')`. The backend already accepts a plain WebSocket:
  `WebSocketConfig` registers `/ws` a second time without SockJS, and both
  `GET /ws` and `GET /ws/websocket` with `Upgrade: websocket` answer `101` from :8591.
- Fix: in `connectWebSocket`, drop the sockjs import and give `@stomp/stompjs` a
  `brokerURL: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'`
  (or keep `webSocketFactory: () => new WebSocket(thatUrl)`; native WebSocket in the Capacitor
  WebView too, so compute the host from `API_BASE` when it is absolute). Then remove
  `sockjs-client` from package.json, delete `public/global-shim.js` and its `<script>` in
  index.html. Removes the unload listener (bf-cache restores work again: back/forward and phone
  tab switches), one render-blocking request, and ~47 kB from the precache, which alone puts the
  precache back under budget (PRF-5). Verify the Vite `/ws` proxy (`ws: true`) and Render pass a
  raw upgrade; Render does for web services.

### PRF-2: the sign-in screen cannot paint until the whole 510 kB boot chunk has loaded and run
- Severity: Medium
- Where: index.html -> scripts/app.js (sign-in views `renderAuth`); boot chunk
- Repro / evidence: Lighthouse signed out, mobile: FCP 2.6 s, LCP 2.7 s (element:
  `p.gb-login-sub`, 206 ms render delay after the chunk). `unused-javascript`: 126 KiB of the
  158 kB gz boot chunk (81%) unused on the sign-in screen. `#root` is empty in the HTML, so nothing
  paints before the module evaluates.
- Cause: the sign-in views live in app.js beside every signed-in screen; the boot chunk carries
  calendar.js, dashboard.js, insights.js and the rest before the first frame of a login form.
- Fix: lowest-cost first: (a) put a static sign-in shell (logo, heading, the same markup the login
  card renders) inside `#root` in index.html so first paint happens on the HTML + CSS alone, and
  let `render()` replace it; (b) longer term, make the signed-out path its own entry (dynamic
  `import('./app-main.js')` only when a session cookie exists). (a) is a few lines in index.html.

### PRF-3: Report's insight engine ships in the boot chunk because push.js borrows one helper from it
- Severity: Low
- Where: scripts/push.js:33 `import { drinkRateByHour } from './insights.js'`
- Repro / evidence: `insights.js` is imported only by `report.js` (lazy) and `push.js` (boot).
  Module breakdown: insights.js = 36,400 B pre-minification in `assets/index-*.js`. The built boot
  chunk contains `hiddenSubscription`, `keystone` and the "Open in Money" insight copy;
  `report-*.js` contains none of it.
- Cause: Rollup puts a module shared by a boot module and a lazy one into the boot chunk whole
  (every export Report uses is kept).
- Fix: move `drinkRateByHour` (12 lines, depends on `localKey` from dates.js) into push.js or a tiny
  `water-hours.js`, and have insights.js import it from there. insights.js then moves into the
  report chunk (~3.7% of the boot chunk's source).

### PRF-4: one 312 kB stylesheet blocks first paint on every screen, Money and the premium skin included
- Severity: Low
- Where: index.html `<link>`s to styles/*.css -> `assets/index-*.css`
- Repro / evidence: `index-DOxxL8O8.css` 311,804 B raw / 53.9 kB gzip. Lighthouse: render-blocking
  751 ms est. (mobile), `unused-css-rules` 97% unused on sign-in, 48 KiB unused on Home.
  money.css is 66 kB source (12.2 kB gz) for a lazy screen; premium.css 21 kB (6.2 kB gz) is inert
  unless the toggle is on.
- Cause: all five stylesheets are `<link>`ed from index.html, so Vite merges them into the boot CSS.
- Fix: `import '../styles/money.css'` from `money.js` (and remove its `<link>`), so Vite emits it with
  the money chunk. Check the Home Money card first (`money-home.js`): any class it uses must stay in
  app.css or move with a small `money-home.css` imported from money-home.js. Same for premium.css
  via a dynamic import in `applyPremium` when it is first turned on. Saves ~18 kB gz of
  render-blocking CSS; app.css itself is the bulk and is out of scope for a quick win.

### PRF-5: the bundle budget fails on HEAD: precache is 15,009 B over, so CI's budget step is red
- Severity: Medium
- Where: scripts/bundle-budget.mjs (`PRECACHE_BUDGET = 1_473_646`); .github/workflows/ci.yml:37
- Repro / evidence: clean worktree at build 92, `npm run build && node scripts/bundle-budget.mjs`
  -> "precache 40 entries: 1488655 B, budget 1473646 B (101.0%)", exit 1. Boot chunk is at 98.2%
  of its budget (510,743 / 519,913 B).
- Cause: growth since the build-78 raise; nothing was moved out to compensate.
- Fix: do not just raise the number. PRF-1 removes ~47 kB of precache (sockjs chunk) and PRF-3 moves
  insights out of boot; together they put both budgets back under with room. Re-run the script
  and lower the budgets in the same change, per the file's own rule.

### PRF-6: wave 2 of boot (goals, notifications, money, daily logs) waits for Home's first render
- Severity: Low
- Where: scripts/app.js:loadData (the `render()` / `maybeStartFirstRun()` / `armNotificationActions()`
  before `loadSecondaryData()`)
- Repro / evidence: Resource Timing, seeded account, 4x CPU: wave 1 responses end at 290 ms; wave 2
  requests start at 652-661 ms. The 123 ms long task in between is the first Home render. At 1x the
  gap is 21 ms. On a slow phone the bell badge, goals and the Money card arrive ~360 ms later than
  the network allows, and the Lighthouse filmstrip shows Home repainting (sleep/mood "Log" -> 7.5h /
  Good) after first paint.
- Cause: `loadSecondaryData()` is called after the synchronous render, so its `api()` calls are not
  in flight while Home builds.
- Fix: start the wave-2 promises before `render()` and consume them after, e.g. have
  `loadSecondaryData()` accept pre-started promises, or call it before `render()` with its body
  unchanged (it already skips its final repaint if the screen changed, and every handler writes to
  `state` then renders). Keep `state.achReady` last as the doc requires.
  Note: the 73-121 ms forced-reflow Lighthouse reports on desktop is in the same first render
  (boot chunk cols 50976 / 51151 / 1812); worth a look while there, not worth its own change.

### PRF-7: fonts are discovered late (after the CSS) and Hanken Grotesk ships as five static weights
- Severity: Low
- Where: styles/tokens.css (`@import '@fontsource/...'`), index.html
- Repro / evidence: network tree: CSS ends at 49 ms, then 8 woff2 requests start (87-93 ms locally;
  later on a real link). No `rel=preload`. Hanken Grotesk 400/500/600/700/800 = 5 x ~13.8 kB =
  69 kB; Bricolage 600/700/800 = 67 kB. CLS stays 0 thanks to `font-display: swap`.
- Fix: `<link rel="preload" as="font" type="font/woff2" crossorigin>` for Hanken 400 and Bricolage
  700 (the body and the title face; hashed names need Vite's `?url` import or a small
  `transformIndexHtml` plugin). Optional: `@fontsource-variable/hanken-grotesk` (one latin file for
  every weight) instead of five statics.

### PRF-8: "Overdue" task times fail contrast in dark theme (3.4:1)
- Severity: Medium
- Where: scripts/dashboard.js task row (`task.overdue ? { style: { color: 'var(--coral-700)' ... } }`)
- Repro / evidence: Lighthouse Home (dark): `color-contrast`, "Overdue · 9 Oct · 21:04",
  foreground #be4a0a on #211a16, 3.4:1, 12.5 px normal weight; needs 4.5:1. 53 rows on the seeded
  account fail.
- Cause: a raw palette step, not a theme-aware token; `--coral-700` is tuned for white.
- Fix: use `var(--brand-ink)` instead of `var(--coral-700)`. It is coral-700 in light (5.0:1 on
  white, unchanged) and coral-500 in dark, which tokens.css documents as 6.1:1 on the dark surface.

### PRF-9: small accessibility audit failures (heading order, accessible-name mismatch, no main landmark on sign-in)
- Severity: Low
- Where: scripts/dashboard.js (`SectionTitle({ title: "Today's tasks" })` renders an h3 with no h2
  above it); app header avatar button (`aria-label="Account"`, visible text "AR"); dashboard mini
  calendar day buttons (`aria-label="Sat, October 10, 5 items"`, visible "10 5"); scripts/app.js
  sign-in view (`.gb-login-wrap` is a div).
- Repro / evidence: Lighthouse `heading-order`, `label-content-name-mismatch`, `landmark-one-main`
  (signed out only).
- Fix: render SectionTitle as h2 on Home (or give Home an h1/h2 above it); make the avatar's label
  start with its visible text ("AR, account") and the day labels start with the day number
  ("10, Sat October ..."); wrap the sign-in card in `<main>`.

## Counts

Critical 0, High 0, Medium 4 (PRF-1, PRF-2, PRF-5, PRF-8), Low 5 (PRF-3, PRF-4, PRF-6, PRF-7, PRF-9).
