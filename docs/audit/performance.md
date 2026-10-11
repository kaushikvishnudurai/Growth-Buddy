# Performance audit (feat/overhaul, build 88, 2026-10-11)

Measured on this worktree with `npm run build` + `node scripts/bundle-budget.mjs`. Per-module
boot-chunk bytes come from a sourcemap build (`GB_SOURCEMAP=1`, output to a scratch dir) and are
minified, pre-gzip bytes. No servers or browser were run, so render costs are either benchmarked
in node or given as counts.

**Baseline**

| Thing | Size |
|---|---|
| Boot chunk `assets/index-*.js` | 497,595 B raw / 154,244 B gzip (budget 519,913 B, 95.7%) |
| Boot CSS `assets/index-*.css` (render-blocking, one file) | 284.7 kB raw / 49.1 kB gzip |
| Precache | 39 files, 1,426,349 B (budget 1,473,646 B, 96.8%) |
| Boot chunk by source | app.js 248.3 kB, dashboard.js 42.6 kB, calendar.js 41.8 kB, gb-kit.js 19.2 kB, **insights.js 17.8 kB**, money-core.js 12.3 kB, push.js 5.9 kB, achievements.js 5.1 kB, chime.js 4.9 kB, circle-core.js 3.3 kB |
| Fonts | 10 woff2 files, latin only, `font-display: swap`, none preloaded (Bricolage 3 x ~22 kB, Hanken 5 x ~13.8 kB, Space Mono 2 x ~16.6 kB) |
| public/ images | largest is icon-512.png at 22.8 kB. Nothing to fix |

Summary: 0 Critical, 2 High, 8 Medium, 11 Low.

---

### P1. Every render rebuilds every icon SVG in the document
- **Severity:** High | **Effort:** S
- **Where:** `scripts/gb-kit.js` `refreshIcons` / `Icon`, and lucide's `createIcons` (`node_modules/lucide/dist/esm/lucide.js`, `replaceElement.js`)
- **Cost:** `createIcons()` runs `document.querySelectorAll('[data-lucide]')`, and `replaceElement` copies `data-lucide` onto the `<svg>` it creates. So every SVG from an earlier sweep matches again and gets rebuilt. Each sweep re-creates *every* icon on the page: header, nav, open modals, and parts of the screen that did not change. `render()` triggers one sweep, and so does any single `Icon()` call (a toast, a timer button). The comment in timer.js (`a lucide.createIcons() sweep of the whole document once a second`) shows the cost was already noticed once. It was fixed there and nowhere else.
- **Fix:** In `Icon()`, build the SVG directly with lucide's `createElement(icons[Pascal])` and drop the sweep. Smaller alternative: query `i[data-lucide]` instead of `[data-lucide]`, so only placeholders get replaced.

### P2. `GET /api/tasks` runs one query per task (N+1 on a wave-1 boot call)
- **Severity:** High | **Effort:** S
- **Where:** `backend/.../task/TaskService.java` `list` -> `responseFor`
- **Cost:** `responseFor` calls `historyRepo.findByUserIdAndTaskIdOrderByChangedAtDesc` for each task and loads every history row, only to read `size()` and the first `changedAt`. With 40 tasks that is 41 round trips to TiDB. First paint waits on all five wave-1 calls, so this call's latency is first-paint latency. `toggleTask` hits the same pattern again through `/api/tasks/{id}/toggle`.
- **Fix:** Use one grouped query, `select h.taskId, count(h), max(h.changedAt) from TaskHistory h where h.userId = :u group by h.taskId`, mapped by id. `ix_task_hist_user_task_time` already covers it.

### P3. The whole Insights engine ships in the boot chunk for one helper
- **Severity:** Medium | **Effort:** S
- **Where:** `scripts/push.js` (`import { drinkRateByHour } from './insights.js'`)
- **Cost:** 17,822 B minified (about 6 kB gzip) of insights.js sits in `index-*.js`. Every insight sentence string ("You rate your sleep best...", "Looks like a monthly payment"...) is in the boot chunk and missing from report-*.js. Report is lazy, but a static import from a boot module makes Rollup hoist the shared module into the entry.
- **Fix:** Move `drinkRateByHour` (14 lines, pure) into `push.js` or a tiny `water-stats.js`, and have insights.js import it from there.

### P4. Settings, the food dialogs and other one-tap modals are in the boot chunk
- **Severity:** Medium | **Effort:** M
- **Where:** `scripts/app.js` `openProfileSettings` (56.9 kB of source), `reminderSettingsPane` (11.5 kB), `customisePanes` (10.6 kB), `accountSecuritySections` (9.2 kB), `securitySection`, `bankFeedSection`, `openCustomToneDialog` (7.6 kB), `openAddFood` (19.6 kB), `openEditFood`, `openFreezeCalendar` (8.4 kB), `habitHistoryPanel`, `openHabitForm`
- **Cost:** About 175 kB of source, roughly 75 kB minified (app.js minifies at 0.43) and roughly 23 kB gzip. All of it is parsed and compiled at boot and only runs after a tap. app.js alone is 248 kB of the 498 kB boot chunk.
- **Fix:** Move Settings (`openProfileSettings` and its panes) into `settings.js`, and the food dialogs into `food-dialogs.js`. Load both with `import()`, the way `money.js` and `notes.js` already load. They pass app state through a props object, as `focusProps()` does.

### P5. One 285 kB render-blocking stylesheet holds every lazy screen's CSS
- **Severity:** Medium | **Effort:** M
- **Where:** `index.html` (five `<link rel="stylesheet">`, merged into one `index-*.css`), `styles/money.css`, `styles/premium.css`, `styles/app.css`
- **Cost:** 49.1 kB gzip blocks first paint. Included in it: money.css at 58.3 kB raw / 10.5 kB gzip, of which Home only uses the `gb-money-mini` rules (12 of about 300). premium.css at 21 kB raw / 6.1 kB gzip, inert unless the toggle is on. Also lazy-screen rules in app.css: about 216 `gb-family*`, 120 `gb-note*`, 112 `gb-goal*`, 53 `gb-circle*`, 42 `gb-focus*` top-level rules.
- **Fix:** Move the `gb-money-mini` rules into app.css and `import '../styles/money.css'` from `money.js`. Vite then emits it as a CSS chunk that loads with the screen. Do the same for the family, notes and circle sections over time. Load premium.css only when `data-premium='on'`.

### P6. Ticking a task or a habit costs three serial round trips
- **Severity:** Medium | **Effort:** S
- **Where:** `scripts/app.js` `toggleTask`, `toggleHabit` (the `await api('/api/score/today')` then `await refreshCurrentUser()` sequence)
- **Cost:** PATCH, then GET `/api/score/today`, then GET `/api/auth/me`, each waiting for the one before. On a 300 ms mobile RTT the server-confirmed score and XP arrive about 0.9 s after the tap. That is three requests per tick, each one auth-resolved and DB-backed.
- **Fix:** Run the two GETs in parallel with `Promise.all`. Better: have the toggle endpoint return `{ task, score, xp }` and drop both.

### P7. Most taps rebuild the whole screen, and boot renders six times
- **Severity:** Medium | **Effort:** M
- **Where:** `scripts/app.js` `render` (105 `render()` call sites). Hot callers: `toggleTask` (up to 4 renders), `quickAddWater` (5), `saveMoodEntry`, `selectDate`, `calPrevMonth`. At boot: `loadData` (sync), the module-end `render()`, `CacheStorage.init().then`, `loadQuote`, wave 1, wave 2.
- **Cost:** Each render does `root.replaceChildren` of the whole app (header, nav, every Home widget), then a full icon sweep (P1), `tweenFromLast`, `refocus`, `checkAchievements` and the mini calendar's scans (P8). Ticking one checkbox redraws the whole Home.
- **Fix:** For the three hottest actions (task tick, habit tick, water add), patch the row or widget in place, as `rerenderHomeMiniCalendarIfActive` and `repaintOverlays` already do. Coalesce boot renders through one `requestAnimationFrame`-batched `scheduleRender()`.

### P8. The Home mini calendar re-scans all tasks and reminders for each of its 42 cells
- **Severity:** Medium | **Effort:** S
- **Where:** `scripts/dashboard.js` mini calendar (`dueTasksOn`, `completedTasksOn`, `remindersOn` inside the 42-cell loop). `scripts/calendar.js` grid (`remindersOn` per cell) has the same pattern.
- **Cost:** Each cell runs two `new Date(iso)` parses per task plus `occursOn` for every reminder. Benchmarked in node: **3.5 ms per render** with 300 tasks and 60 reminders on a desktop CPU, so expect 4-6x that on a mid-range phone. This runs on every Home render (P7).
- **Fix:** Bucket tasks by day key once per render (`Map<key, {due, done}>`), then compute `occursOn` for the 42 keys once per reminder. That is O(T + 42R) instead of O(42(2T + R)).

### P9. The app server does not compress responses
- **Severity:** Medium | **Effort:** S
- **Where:** `backend/src/main/resources/application.yml`, `application-prod.yml` (no `server.compression`). `Caddyfile` has `encode gzip zstd`, but the Render deployment (DEPLOYING.md) has no Caddy in front.
- **Cost:** If Render's edge does not compress, the boot chunk goes over the wire at 498 kB instead of 154 kB, CSS at 285 kB instead of 49 kB, and the JSON (`/api/money` carries 400 days of ledger) is uncompressed. I could not verify Render's edge behaviour from here. `curl -sI -H 'Accept-Encoding: gzip' https://<host>/assets/index-*.js | grep -i content-encoding` settles it.
- **Fix:** Set `server.compression.enabled: true` with `mime-types` covering js, css, json and svg, and `min-response-size: 1KB`. It does no harm if the edge also compresses.

### P10. The Calendar screen is in the boot chunk
- **Severity:** Medium | **Effort:** M
- **Where:** `scripts/app.js` static import of `ScreenCalendar`, `RenderCalendarToolbar`, `RenderCalendarSide`, `RenderCalendarGrid` and others from `./calendar.js`
- **Cost:** 41.8 kB minified in boot. The screen is the larger part of it. The rest are small helpers that app.js uses everywhere (`snoozeLabel`, `describeRepeat`, `LEAD_OPTIONS`, `REPEATS`, `TAGS`, `NotifySelect`).
- **Fix:** Split the helpers into `calendar-core.js` (boot) and make `SCREENS.calendar` a `lazyScreen(() => import('./calendar.js'))`, the same split Money got.

### P11. Fonts are discovered only after the CSS has parsed
- **Severity:** Low | **Effort:** S
- **Where:** `index.html` (no `<link rel="preload" as="font">`), `styles/tokens.css` (`@fontsource` imports, `font-display: swap`)
- **Cost:** The body font (Hanken 400) and display font (Bricolage 700/800) are requested only after the 49 kB gzip stylesheet has downloaded and parsed. The text paints in the fallback first and then swaps, which costs CLS and a visible reflow on slow links.
- **Fix:** Preload the two or three first-paint faces. A small Vite plugin can inject the hashed URLs, or the font files can be copied unhashed into `public/`. Optionally swap the five static Hanken weights (69 kB woff2) for the variable font.

### P12. The service worker writes every API GET to Cache Storage
- **Severity:** Low | **Effort:** S
- **Where:** `vite.config.js` `workbox.runtimeCaching` (`NetworkFirst`, `gb-api-get`, 200 entries)
- **Cost:** Each GET response is cloned and written to Cache Storage, including `/api/money` with 400 days of ledger and `/api/daily-logs?days=60`. This duplicates the app's own offline layer (`cache-storage.js` and the `cache*` helpers in app.js), and it adds a 5 s `networkTimeoutSeconds` race to every request. Authenticated responses also stay on disk after sign-out.
- **Fix:** Drop the API route, since the app already paints offline from its own cache. Or narrow it to the few GETs that have no app-side cache.

### P13. The notification page query cannot use its index for ordering
- **Severity:** Low | **Effort:** S
- **Where:** `NotificationRepository.findPage` / `findPageInCategory` (`user_id = ? and created_at <= ? order by created_at desc limit n`) against `tableCreationQueries.sql` `ix_notifications_user (user_id, read_at, created_at)`
- **Cost:** `read_at` sits between the equality column and the sort column, so MySQL/TiDB range-scans and filesorts every notification the user has to return one page. This runs at boot in wave 2 and again on every `visibilitychange`.
- **Fix:** Add `KEY ix_notifications_user_time (user_id, created_at)` to the `CREATE TABLE`, plus an `ALTER ... ADD INDEX` in `migrations.sql`.

### P14. Unindexed lookups on `notifications.related_id` and `push_subscriptions`
- **Severity:** Low | **Effort:** S
- **Where:** `NotificationService.deleteByRelated` -> `findByRelatedId`. `PushService` -> `findByUserId` (on every push send) and `findByEndpoint` (subscribe/unsubscribe). `push_subscriptions` has only `PRIMARY KEY (id)`.
- **Cost:** Each of these scans the full table across all users. `findByUserId` runs once per delivered reminder.
- **Fix:** Add `KEY (related_id)` on notifications and `KEY (user_id)` on push_subscriptions (create + migration). For `endpoint TEXT`, either add a prefix index (`endpoint(255)`) or store and index a hash of it.

### P15. The goals list loads recent actions one goal at a time
- **Severity:** Low | **Effort:** S
- **Where:** `backend/.../goal/GoalService.java` `withActions(Goal, long, long)` -> `actions.findTop3ByGoalIdOrderByCreatedAtDesc`
- **Cost:** One query per goal on a wave-2 boot call. Counts are already batched, but this query is not.
- **Fix:** Use one window query (`ROW_NUMBER() OVER (PARTITION BY goal_id ORDER BY created_at DESC) <= 3` over `goal_id IN (...)`) and group the rows in Java.

### P16. Boot renders twice back to back
- **Severity:** Low | **Effort:** S
- **Where:** `scripts/app.js` boot tail: `loadData()` (which calls `render()` synchronously when not a refresh) followed by `render()` a few lines later
- **Cost:** The second call rebuilds the same loading screen and runs another full icon sweep, before any data has arrived.
- **Fix:** Call the module-end `render()` only in the signed-out branch, or let `loadData` skip its own first render.

### P17. Every render forces synchronous layout twice
- **Severity:** Low | **Effort:** S
- **Where:** `scripts/app.js` `restoreScrollPosition` (reads `scrollHeight` right after `replaceChildren`, then again in a rAF) and `tweenFromLast` (`void document.body.offsetWidth`)
- **Cost:** A forced layout of the freshly built tree happens on every same-screen render, and a second one happens when a tweened value changed.
- **Fix:** Skip the synchronous `apply()` when `snapshot.top === 0`, and fold the tween commit into the same rAF as the scroll restore.

### P18. `/icons/**` is cached for a year but the filenames are not hashed
- **Severity:** Low | **Effort:** S
- **Where:** `backend/.../common/WebConfig.java` `addResourceHandlers` (`/icons/**` -> `immutable`, 365 days), `public/icons/*.png`
- **Cost:** A regenerated app icon never reaches a browser that already has the old one.
- **Fix:** Serve `/icons/**` with `noCache()`, as the other root-level unhashed files are served, or add a version query to the icon references.

### P19. The boot chunk has grown 50 kB since the Money split, and CODEMAP is stale
- **Severity:** Low | **Effort:** S
- **Where:** `CODEMAP.md` "Loading" bullet (447,141 B / 137.8 kB gzip) vs now 497,595 B / 154.2 kB gzip. `scripts/bundle-budget.mjs` is at 95.7%.
- **Cost:** The split saved 105 kB and about half of that has come back within a day. The budget now has 22 kB of headroom.
- **Fix:** Update the CODEMAP numbers. P3 + P4 + P10 together would bring the chunk back under 400 kB, after which the budget can be lowered.

### P20. Dead CSS
- **Severity:** Low | **Effort:** S
- **Where:** `styles/app.css`: selectors with no reference anywhere in scripts/ or index.html: `gb-gratitude-*` (7 rules), `gb-fab` (7), `gb-goal-row` / `gb-goal-main` (6), `gb-ach-summary-xp*` (4), `gb-workout-card` (3), plus `gb-coach-chip--done`, `gb-crash-detail`, `gb-login-hint`, `gb-sec-divider`, `gb-profile-apply`, `gb-rem-del--danger`
- **Cost:** About 30 rules, a few kB raw. Small, but they are parsed on every load.
- **Fix:** Delete them. Check each against a dynamic `'gb-x-' + v` class build before removing it.

### P21. More shared modules pulled whole into boot
- **Severity:** Low | **Effort:** S
- **Where:** `scripts/app.js` `import { winLines } from './circle-core.js'` (3.3 kB: the seat ring, agreement parser and challenge templates come with it), and `ScreenAchievements` from `achievements.js` (5.1 kB, a screen)
- **Cost:** About 8 kB minified of non-Home code in the boot chunk.
- **Fix:** Move `winLines` into the circle.js chunk, or into a tiny `circle-wins.js` if app.js needs it at boot. Make `SCREENS.achievements` lazy, keeping `computeAchievements` / `levelProgress` in boot.

---

**Checked and fine:** the habit list is batched (`HabitService.list`). Reminder delivery reads a snapshot and costs three queries per due set. Session resolve has an in-memory cache and throttles `last_used_at` writes. Money GET takes no lock on the plain-read path. `/assets/**` is served immutable for a year. sockjs + stomp (47 kB + 23 kB) are lazy. The SW registers on `load`. Lazy screens are precached on purpose (documented in `vite.config.js`). public/ images are small.
