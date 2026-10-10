# CODEMAP

Whole-repo orientation in one read: what every file is, and every backend endpoint. Use this when you
don't yet know which file you need. Files with their own doc are listed in
**[CLAUDE.md](CLAUDE.md)** — go there instead of grepping those.

---

## Architecture in ten lines

- **Frontend:** vanilla JS ES modules + Vite. No framework, no JSX. DOM built with the `h()`
  hyperscript helper from `scripts/gb-kit.js`. Screens are functions returning DOM nodes.
- **State:** one module-scope state object in `scripts/app.js`; `render()` rebuilds the screen.
  Money, family, mentor and circle own their state and repaint their own subtree.
- **Storage:** no `localStorage` — `scripts/cache-storage.js` (in-memory map + cookies + Cache API).
- **Backend:** Spring Boot + MySQL, package-per-feature under
  `backend/src/main/java/com/growthbuddy/<feature>/` as `Controller` / `Service` / entities / `Dtos`.
- **Auth:** opaque bearer tokens; `CurrentUserInterceptor` resolves the user per request into a
  ThreadLocal (`CurrentUser`).
- **Frontend-first bias:** wellness, mood, trends, insights and goal progress are computed and stored
  client-side. The server holds what must sync. Money is a small JSON document per user (budgets,
  goals, subscriptions…) plus a **ledger**: accounts and every expense / income / transfer as rows.
- **Mobile:** `../Growth-Buddy-Mobile` is a Capacitor wrapper around this repo's build.
- **Loading:** the boot chunk is Home only. The lazy screens (family, circle, timer, goals, report,
  mentor, notes, **money**) and the realtime stack (sockjs + stompjs) are dynamic imports — and **precached anyway**
  (no `globIgnores`: excluding them let an old shell ask for a chunk the new deploy had deleted;
  why: the `workbox` comment in `vite.config.js`). Fonts are latin-subset only. Money got there by a split: `money-core.js` (document model, ledger diff, `budgetStatus` /
  `buildInsights`, no imports) and `money-home.js` (Home's card) are boot; `money.js` (the screen,
  Customise pane, expense modal) loads on first visit, from Settings, or on the card's "Add expense";
  never import `money.js` statically from a boot module or the split is undone. After the split
  (2026-10-10): boot chunk 447,141 B raw / 137.8 kB gzip (from 551,884 B / 170.4 kB), budget lowered to
  469,498 B; `money-*.js` chunk 115 kB. Sizes at build 73
  (2026-10-10, before the split): boot chunk `assets/index-*.js` 548,878 B raw / 169 kB gzip, precache 35 unique files
  1,259,045 B (Workbox says "41 entries": icons listed twice). **Enforced by
  `scripts/bundle-budget.mjs`** (CI, after the build): budgets are those + 5% (boot now 469,498 B, see above /
  1,321,998 B), set at the top of the script — raise them deliberately, in the change that needs it.
  Real-user numbers (LCP, CLS, INP, TTFB, `gb-home-painted` mark) come from `vitals.js`.
  Boot fetches run in two waves (`loadData` -> `loadSecondaryData`): five calls gate first paint,
  eight follow. Throttled Home paint 1448 ms -> 900 ms.

---

## Frontend — `scripts/` (small modules; the big ones are in `docs/`)

| File | What |
|---|---|
| `insights.js` | Insights on Report: plain statistics over sleep, mood, check-ins, water, kcal and spend, plus focus hours, habit misses, goal pace, task follow-through, unusual and repeating expenses, water gaps and score changes. No AI. Has its own doc (`docs/scripts/insights.js.md`). Listed here for one trap: sleep is keyed on the WAKE date, so stress -> sleep must look at the next day. |
| `insights.test.mjs` | Plain-assert check for the above. `node scripts/insights.test.mjs`. |
| `home-order.js` | Home's DOM-free rules: `HOME_WIDGETS` + `resolveHomeLayout` (re-exported by dashboard.js), `sortTasksForHome` (overdue → today → upcoming → no date, paused and done last), `sortHabitsForHome` / `habitDue` (the server's `dueToday`), `topStreaks` (days and weeks kept apart), `homeGoals` (the Goals widget's rows). Checked by `node scripts/home-order.test.mjs`. |
| `habit-stats.js` | A habit's history as numbers, DOM-free: `heatmapWeeks` (12 ISO weeks of `done`/`missed`/`frozen`/`open`/`today`/`before`/`future` — `missed` only for daily habits), `completionRate` (done ÷ owed; owed = target/7 a day, frozen days and an unticked today not owed, capped at 100%), `bestStreak` (HabitService's daily / weekly run rules), `canEditDay` (today and the 7 days before, never before `since`), `suggestReminderTime` (median of the other habits' reminder times, else 19:00 — the server keeps no check-in time of day), `linkedHabitActivity` (a goal's linked habits). Quit ("break a habit") habits: `kind: 'quit'` turns days into `clean`/`slipped` (`isSlipRow`: a not-done, not-frozen row), `quitStreak` / `longestQuitRun` mirror HabitService's; `recentNotes` (days with a note, newest first). Checked by `node scripts/habit-stats.test.mjs`. |
| `goal-milestones.js` | Milestone list edits as data (`moveItem`, `renameMilestone`, `setMilestoneDue`, `milestoneDueState`), `liveLinkedIds`, and the dated progress log (`progressFraction`, `appendProgressLog`, `withProgressLog`, `needsProgressLog`: `progressLog` [{date, pct}] in the blob, one per day, last wins, newest 120 — app.js `updateGoalProgress` writes it, insights.js `goalPace` fits it). Checked by `node scripts/goal-milestones.test.mjs`. |
| `goal-tasks.js` | A goal's linked tasks as data: `goalTaskStats(goal, tasks)` (live tasks by `goalId` + the goal's `clearedTaskCount`, so the midnight sweep doesn't reset "Tasks: 3/5"), `combinedGoalProgress(progress, stats)` (milestones + finished tasks when the blob's `countTasks` is on, one step each), `goalFinishedBy(taskId, before, after, goals)` (the tick that closed a goal's last open task → toggleTask's "Mark goal done" toast). Checked by `node scripts/goal-tasks.test.mjs`. |
| `nutrition.js` | Pure food & water helpers, checked by `scripts/nutrition.test.mjs`: `MEAL_SLOTS`, `mealSlotForHour` / `mealSlotAt` / `slotOf` / `groupBySlot` (same hours as the server's `MealSlot.forHour`), `HYDRATION` / `DRINKS` / `effectiveMl` (same factors as `DrinkType`), `suggestWaterGoalMl(weightKg)`, `labelFor(barcodeProduct, grams)`, `dayMicros(summary)`. Two of these are mirrored in Java: change both sides. |
| `review.js` | Report look-backs, pure: `pixelValues(metric)` (score / mood / daily-habit share per day, blank = absent, never 0), `personalRecords` (longest habit streak, best focus day, longest water streak, lowest-spend *finished* week with something logged), `periodDelta`, `monthReview` (the month card for `share-card.js`; `month: 'YYYY-MM'` reviews an earlier one — Report shares last month on the 1st–3rd — and the streak stat is labelled "Current streak" and left off a past month), `weeklyBuckets` + `monthTicks` (the 1-year trend), `correlate` (Pearson r, ≥14 shared days) + `correlationWords` + `focusMinutesByDay` (the Compare card), `weekOverWeek` (This week vs last). |
| `review.test.mjs` | Plain-assert check for the above. `node scripts/review.test.mjs`. |
| `i18n.js` | Words and formats, DOM-free. `t(key, vars)` (catalog → English → the key itself; `{name}` interpolation; `vars.count` picks `one`/`other`/… via `Intl.PluralRules`), `setLocale` (also sets `<html lang>`; app.js calls it at boot and in `hydrateUiPrefs` with `localeFromUser(state.user)` = `uiPrefs.locale` → `user.locale`/`language` → `navigator.language` — **no locale field exists on the profile yet**, and `uiPrefs.qaLang` is the voice language, not this), `fmtDate(dateOrKey, style)` (named styles in `DATE_STYLES`, or Intl options), `fmtTime`, `fmtNumber`, `fmtPercent` (0..1), `fmtRelativeDays`. **A `'YYYY-MM-DD'`/`'YYYY-MM'` key is parsed as LOCAL noon** — `new Date('2026-03-08')` is UTC midnight and reads a day early west of Greenwich. Display strings only: `toLocaleDateString('en-CA')` building a key is data and stays. User-facing clock text still goes through gb-kit `formatTime` (it owns the 12/24h pref). Converted so far: dashboard, review; the rest (`grep toLocale scripts/*.js`) is a backlog, as are almost all strings. **Adding a language:** add `CATALOGS.xx = { key: 'text', plural: { one, few, many, other } }` in `i18n.js` (base tag, e.g. `ta`; partial is fine — English fills gaps), move the screen's literals to `t('screen.key')` with the English in `en`, then give users a way to pick it by saving `uiPrefs.locale` (Settings has no picker yet). Checked by `node scripts/i18n.test.mjs` (re-runs itself under `TZ=America/Los_Angeles` and `Asia/Kolkata`). |
| `i18n.test.mjs` | Plain-assert check for the above: key no-shift in two timezones, plurals, number/percent grouping per locale, `t()` fallback. |
| `cache-storage.js` | The storage layer. In-memory map (sync source of truth) + cookies (tiny boot-critical allowlist only, ~3.5 kB cap) + Cache API (`gb-store-v2`, hydrated async in `init()`). Migrates old localStorage once. Keys prefixed `gb.`. Exports `CacheStorage`. |
| `outbox.js` | Offline outbox, DOM-free. `createOutbox(storage, keyFn)` → `enqueue` / `list` / `remove` / `clear` / `size` / `flush(apiFn)`; `tempId()` (`tmp-…`), `isTempId`. app.js keeps one instance in CacheStorage `gb.outbox.<uid>` (cleared by `purgeUserCache`). Collapse at enqueue: same `toggleKey` → both go; DELETE of a `tmp-` id → its create and every op naming it go; DELETE of a real resource → its earlier queued writes go. Every op gets an `idemKey` at enqueue (`newIdemKey()`: `crypto.randomUUID`, `tmp-`-style fallback outside a secure context; a legacy op without one is given one on first send and keeps it), sent as `Idempotency-Key` on every attempt. Flush is FIFO and single-flight; stops (keeps) on no response / 5xx / 401 / 408 / 429 and on a 409 with `code: idempotency_in_progress`; any other 409 is removed into `conflicts`, any other 4xx into `dropped` (with the ops naming its temp id); a create's server id rewrites later queued paths and bodies and comes back in `idMap`. Never touches the op whose request is out. Tests: `outbox.test.mjs`. |
| `outbox.test.mjs` | Plain-assert check for the above (ordering, collapse, temp-id rewrite, 4xx drop, 409, network stop, idemKey stable across retries). `node scripts/outbox.test.mjs`. |
| `recurrence.js` | The ONE answer to "does this reminder fall on this day?", shared by the Calendar screen and Home's mini calendar. There were three copies and the dashboard's had drifted. `ReminderService.occursOn` is the fourth-that-must-stay (WhatsApp delivery); keep them in step. Checked by `scripts/recurrence.test.mjs`. Reads the richer rule too: `repeatInterval`, `repeatDays` (weekly, weeks start Monday), `repeatNth` (monthly nth/last weekday of the anchor's weekday), `repeatCount` (counted from the anchor over the rule alone, so skips and `from` use one up, as RRULE COUNT does; memoised). `parseRepeatDays`, `nthWeekdayOf`, `DAY_CODES`/`WEEK_ORDER` feed calendar.js's controls. |
| `icons.js` | The Lucide subset actually used (121 icons). Load-bearing for bundle size — the full set is ~600 kB. **Add new icon names here or they won't render** — `scripts/icons.test.mjs` fails the moment one is missing, because nothing else can see it: a missing icon is not an error, not a console warning and not an empty box. |
| `achievements.js` | Badge gallery (`ScreenAchievements`, `computeAchievements`, `levelProgress`) → **[docs/scripts/achievements.js.md](docs/scripts/achievements.js.md)**. Trap: no level curve of its own — `levelProgress` reads the server's `level`/`xpIntoLevel`/`xpForNextLevel`, and `seen` (`ui_prefs.achSeen`) keeps a badge unlocked once earned (day counts only see 60 days). |
| `mentor.js` | Buddy chat screen (`ScreenMentor`, `richParts`, `crisisMatch`, `parseSse`, `actionChips`, `streamVisible`; threads sheet, one-tap action chips) → **[docs/scripts/mentor.js.md](docs/scripts/mentor.js.md)**. Trap: replies stream (`parseSse`, Stop = abort); only an error carrying `fallback` drops to the plain POST, and a failed send is never cached. |
| `celebrate.js` | One-off unlock celebration: badge pop + hand-rolled confetti, queued one at a time, respects `prefers-reduced-motion`. `kicker` overrides the "Achievement unlocked" line (toggleGoal passes "Goal complete"). Registered with `trackOverlay`, so Back closes it and navigation drops it. |
| `error-report.js` | Crash reporter. `initErrorReporting({apiBase, build, screen})` (called at boot in app.js) posts `window` `error` / `unhandledrejection` to `POST /api/client-errors` → server log. Prod only, ≤5 per page load, deduped by message, skipped offline. No SDK, no source maps (the build emits none). |
| `vitals.js` | RUM. `initVitals({apiBase, build, screen})` (boot, next to error-report) samples **10% of prod page loads** and measures LCP, CLS, INP (approximate: the slowest interaction, not p98 — ponytail), TTFB and the `gb-home-painted` mark set by `markHomePainted()` (app.js, after the first Home render with data; marked a frame later, i.e. at paint). PerformanceObserver only, no web-vitals package. Sent **once** on `pagehide` / `visibilitychange`→hidden via `navigator.sendBeacon` as a text/plain string (CORS-safelisted, so the Capacitor origin needs no preflight) to `POST /api/client-vitals` → server log. Anonymous, like error-report. |
| `a11y.js` | Global modal a11y. A modal is **anything carrying `aria-modal="true"`** — keyed on the attribute, not a class, so a new overlay can't opt out by forgetting one (which is how the celebration overlay and `confirmDialog` both ended up outside the trap, each carrying its own Escape handler). Usually `.gb-modal-overlay > .gb-modal[role=dialog]`, but the outermost box may be the dialog itself. A MutationObserver on `<body>` adds Escape-to-close, Tab trapping, focus in/out (never back to the trigger while another modal is still up) and names each control from the `.gb-field-label` before it (again whenever the open dialog adds nodes — a per-dialog subtree observer), **centrally**, so individual modals need no a11y code. `initA11y()`. |
| `share-card.js` | 1080×1920 story card → OS share sheet (`shareStoryCard`, `renderStoryCard`) → **[docs/scripts/share-card.js.md](docs/scripts/share-card.js.md)**. Trap: canvas text does not load fonts (`document.fonts.load()` per face first); in Capacitor it needs `@capacitor/share` + `@capacitor/filesystem` in `../Growth-Buddy-Mobile`, else it just downloads. |
| `push.js` | Web Push on the web, on-device alarm queue in the app (`syncDeviceAlarms`, pure `upcoming*Alarms` builders) → **[docs/scripts/push.js.md](docs/scripts/push.js.md)**. Trap: alarm ids derive from the minute they fire in (a positional counter overwrote delivered notifications), and Silent is queued onto `SILENT_CHANNEL`, not dropped. |
| `native.js` | Capacitor-only helpers, all no-ops on the web → **[docs/scripts/native.js.md](docs/scripts/native.js.md)**. Trap: `nativePlugin(name)` is the only way in (`Capacitor.Plugins` is always empty in the shipped app); channels are frozen once created, so bump `CHANNEL_VERSION` to change one, and a re-sync keeps `TIMER_ALARM_ID`. |
| `notes-core.js` | Notes' DOM-free rules: `parseLabels`/`validateLabels` (= `NoteLabels.java`), `labelsInUse`, `compareNotes` (sort: Last edited / Date created / Title, pinned first; choice in CacheStorage `gb.notesSort`), `splitHighlights` + `snippetAround` (search marks), `createSearchCache` (keyed id+updatedAt), `offlineCopy` (CacheStorage `gb.notesOffline.<userId>`, cleared by `clearSession`), `trashDaysLeft`. Checked by `node scripts/notes-core.test.mjs`. |
| `notes.js` | Notes screen — has its own doc (`docs/scripts/notes.js.md`). Listed here for one reason: `sanitize()` is the allow-list that makes storing rich text as HTML safe, and it runs on save AND on paint. |
| `chime.js` | Synthesised notification tones (`SOUNDS`) + the user's own sounds → **[docs/scripts/chime.js.md](docs/scripts/chime.js.md)**. Trap: **edit `SOUNDS` → re-run `node scripts/gen-chimes.mjs`**, which writes `gb_<key>.wav` to `public/` and the mobile `res/raw/` — the underscore is load-bearing (`gb-chime` resolves to nothing, no error). |
| `toast.js` | Late-bound toast registry. Breaks the app.js ↔ screens import cycle: app.js calls `registerToast(impl)` at boot, screens `import { toast }`. `success` / `error` / `dismiss` / `action(msg, label, run)` (one-button toast, e.g. Undo). |
| `timer-math.js` | The focus timer's DOM-free decisions: `remainingFrom`, `restoredSession` (what a session saved before a reload becomes — resume, paused, or *finish*: counted once), `titleWith`/`stripTitle` (the countdown in the tab title), the 4-sprint cycle (`afterSession`, `cycleLabel`, `sprintNumber`: the 4th break is 15 min), the daily goal (`goalMinutes`, `goalProgress`) and the history chart's `barLayout`. `node scripts/timer.test.mjs`. |
| `calendar.test.mjs` | Checks `calendar.js`'s `isPastSlot` (refuses a past one-off; decides whether a row claims it will reach WhatsApp), `freeBusy`, `wholeHours`. `node scripts/calendar.test.mjs`. |
| `money-core.js` / `money-home.js` | The light half of Money, split out of `money.js` so the screen can be lazy; documented in `docs/scripts/money.js.md` (Module split). |
| `money-calc.test.mjs` | Checks `money.js`'s `_calc` engines on a pinned clock (forecast, due/overdue bills, budget status, logging streaks, loan balance) plus `normalizeMoney` and `ledgerCsv`. `node scripts/money-calc.test.mjs`. |

---

## Backend — `backend/src/main/java/com/growthbuddy/`

Per feature: `XController` (routes only) → `XService` (logic, `@Transactional`) → entities + `XDtos`
(records) + repositories. Entry point: `GrowthBuddyApplication.java`.

### `common/` — cross-cutting
`CurrentUserInterceptor` validates the bearer token and puts the user id in `CurrentUser`
(ThreadLocal). It is registered on `/api/**` and **the only way past it is an exact match in
`ANONYMOUS_PATHS`** — don't add a second escape based on the raw URI, which is spelled differently
from the path Spring routed on and once let `/%61pi/…` through unauthenticated.
`RateLimiter` is a sliding-window approximation over fixed-window counters in the **shared database**
(`ThrottleStore` → `JdbcThrottleStore`): it decides on `previous × (1 − elapsed/window) + current`, so
the old 2× burst at a window boundary is gone; the sweep keeps 2h of counters because the previous
window of a 1h limit starts up to 2h back. Not a HashMap — it and `LoginAttemptGuard` were both per-process, which made
every limit per-instance and forgave every account lockout on restart.
`LoginAttemptGuard.recordFailure` commits in `REQUIRES_NEW`, load-bearing: `AuthService.login` is
`@Transactional` and records the failure immediately before throwing, so on the caller's
transaction the count would roll back with the rejection it exists to count.
`SecurityHeadersFilter` sets nosniff / `X-Frame-Options: DENY` / Referrer-Policy on every response,
HSTS only when the request was HTTPS (or `X-Forwarded-Proto: https` with `trust-proxy`), and a CSP on
the HTML shell — **Report-Only until `CSP_ENFORCE=true`** (`growthbuddy.csp.enforce`). It assumes
`script-src 'self'`: no inline `<script>` in `index.html` (the sockjs `global` shim is
`public/global-shim.js` for that reason).
`RateLimitInterceptor` = per-IP on auth routes (plus `/api/auth/export` and `/api/client-errors`), `AiRateLimitInterceptor` = 40/hour per user, **POSTs only** (a GET of the saved meal plan or a
chat clear on the same path costs nothing), on an **allowlist of paths in `WebConfig`** — the four vision endpoints were missing from it for months,
the most expensive call in the app running uncapped. The allowlist is no longer the only line:
**`OpenAIClient` charges every call against its own 60/hour per-user budget**, so a forgotten path
is still bounded and the request never reaches the model. The interceptor stays because only it can
answer 429 *before* the handler runs — inside the client, a caller's catch block turns the refusal
into a silent fallback. `LoginAttemptGuard` = per-**account** exponential lockout on wrong passwords and OTPs (5 free, then 1→2→4… min, capped at 1h, cleared on success) — the per-IP limiter alone does nothing against a botnet. `ApiException` (status + message, optional machine `code` → `ApiError.code`, e.g. `totp_required`; the frontend's `authPost` puts it on `err.code`),
`GlobalExceptionHandler`, `ClientIp` (must not blindly trust forwarded headers), `WebConfig`
(interceptors + CORS), `IndexController` (serves `index.html`).
`RequestSizeLimitFilter` caps an `/api/**` body at 8 MB — `@Size` on a DTO field runs *after*
Jackson has already buffered the body, and nothing else bounds a JSON request (Tomcat's
`maxPostSize` is form-encoding only, `spring.servlet.multipart.*` is multipart only). It refuses a
chunked write too (411), since that is the one shape a Content-Length check cannot see.
**Replayed writes don't duplicate: `Idempotency-Key`.** `IdempotencyFilter` (wraps the response in a
`ContentCachingResponseWrapper`) + `IdempotencyInterceptor` (registered **second** in `WebConfig`,
right after `CurrentUserInterceptor`, because a key is per user and a filter runs before the user is
known; before `AiRateLimitInterceptor`, so a replay isn't charged). Applies to POST/PUT/PATCH/DELETE
under `/api/` with the header (≤64 of `[A-Za-z0-9_-]`, else 400), **not** `/api/auth/**` (sessions,
2FA secrets don't belong in a replay cache), `…/stream` or an `Accept: text/event-stream` (an SSE body
can't be buffered), nor anonymous paths. First use reserves `idempotency_keys (user_id, idem_key)` —
the PK is the lock, plain autocommit JDBC (`JdbcIdempotencyStore`, seam `IdempotencyStore` like
`ThrottleStore`); a finished one replays status + body with `Idempotent-Replay: true`; one still
running → 409 `code: idempotency_in_progress` (clients treat it as "later"); same key, other
method/path → 422 `idempotency_key_reused`. Stored: 2xx and 4xx except 408/429; a 5xx, a throw or a
body over 256 KB **deletes** the reservation so the retry runs. An in-progress row older than 5 min is
taken over (a dead instance's). Purged after 48h (`DataCleanupJob`); in `USER_OWNED_TABLES`, skipped by
the export. Tests: `IdempotencyTest`. Senders: the outbox, the water queue, Money's pending ledger.
`GlobalExceptionHandler` keeps Jackson's message off the wire but **logs it** — a malformed body
used to 400 with no detail to the client and no line in the log, so a wrong enum value was
undebuggable from either end.

**The session token is a bearer header, and stays one.** It lives in a JS-readable cookie, which
looks like debt until you notice the app runs from `https://localhost` and calls the API
cross-origin: an httpOnly cookie there is a third-party cookie, which WKWebView blocks outright. A
bearer header is the correct transport for a Capacitor app. **Closed, not deferred** — what keeps it
safe is that there is no XSS sink (one `innerHTML`, a static SVG literal), so keep it that way.

**Food is dated in the user's zone.** `FoodService` takes `UserClock` like every other dated
feature. `logDate` used to be derived in UTC while the summary read the day somewhere else, so in
IST every meal logged after 5:30pm — dinner — was filed under yesterday and vanished from the Food
screen on save. Rows written before the fix keep their old dates.

**Calories can be typed.** `AddFoodEntryRequest.kcal` means "use this, don't guess": the estimator,
the OpenFoodFacts lookup and the AI call are all skipped, and `estimateSource` reads `manual`. The
per-100g figure is back-derived and clamped, because that column CHECKs 40..900 while the typed
total does not.

**Money is two stores behind one GET.** `GET /api/money` returns the stored document with the ledger
merged in: `expenses` / `income` / `transfers` (last 400 days, `MoneyLedger.WINDOW_DAYS`; older pages via `GET /api/money/tx?before=`, `MoneyLedger.page`, shown by the expense list's **Load older** and never saved back) and live
`accounts` balances. Saving splits again: `saveMoney` diffs before/after with `ledgerDiff` (pure,
`money-ledger.test.mjs`) and sends only changed items to `POST /api/money/tx`; the rest goes to `PUT`
only if it changed. Unconfirmed ledger writes wait in storage (`<money key>.pending`, with an `idemKey` that `queueLedger` re-mints whenever the batch changes) and replay on the
next launch. An invalid entry is refused by id, never the whole batch. A transfer may have only `from` (money out of your accounts: lent, a loan paid back) or only `to` (in from outside: borrowed, repaid to you), never neither; that is how loans move balances (`loanMove`), and the balance query already reads each side on its own.
The document part is still versioned: `PUT` sends `If-Match`, a stale one is **409**, the client
merges (`mergeMoney`, `money-merge.test.mjs`, keeps the later `paidFor`, and drops an item either side
deleted: `removeDocItem` leaves a 120-day tombstone in `tombstones`) and writes once more. **The
GET's ETag is `<version>-<hash of the whole response>`** — tagged with the version alone, a new expense
(ledger changed, document not) got a 304 and every device kept its stale copy. `MoneyController.versionOf`
strips the hash on save. Old documents move into the ledger lazily on first read (`MoneyService.migrate`;
TiDB has no JSON_TABLE, so no SQL can), and an old app build that still PUTs expenses in the document
has them upserted. The GET locks the row only when that migration (or the one-time account seed) is
still due: `MoneyRepository.peekData` reads the document unlocked first.

**A "working days" reminder follows the user's week** (`WorkWeek` + `WORK_WEEKS` in
`scripts/recurrence.js`): Mon–Fri, Sun–Thu or Mon–Sat, stored in the user's `ui_prefs` blob under
`workWeek` — not its own column, because prod runs `ddl-auto: none`. It is one of two `ui_prefs`
keys the **server** reads (the WhatsApp scheduler needs it); the other is `shareProgress`, below. On the client it is module state in
`recurrence.js`, seeded at boot from the cached session and again by `hydrateUiPrefs()`.

**Mentorship progress flows one way.** A mentor opens their mentee's tasks and habit streaks via
`GET /api/mentorship/connections/{id}/status`; the mentee gets no window back — the endpoint 403s
that direction (`PartnerStatusAccessTest`), and `circle.js` only makes the mentor-side rows and
pills tappable. The mentee can close the window entirely with Settings → Account → Privacy, which
writes `shareProgress: false` into their `ui_prefs`; unset means shared, so accounts that predate
the toggle are unaffected.

**Deleting an account hands over the family first.** A family is not the owner's private data —
other members have their own accounts and a shared history — so `handOverOrRemoveFamilies` passes it
to the longest-standing mapped member and only deletes it outright when there is nobody left.
Leaving `families.owner_user_id` pointing at a deleted row, which is what happened before, is the
one option that is wrong either way.

**Deleting an account** is scheduled, not immediate: `deleteAccount` stamps `users.deletion_requested_at` and revokes every session; `user/AccountDeletionJob` (hourly) purges 7 days later and signing in before then answers 409 `deletion_scheduled` → the cancel screen. **During the grace period the account is gone to everyone else** (`User.isPendingDeletion()`): the reminder, habit-reminder, digest, bill-due and Buddy-reflection schedulers skip it (Reminder/Habit drop it in `usersById`, so it reads as "no user"), inbound WhatsApp (`WhatsAppWebhookController.senders`) acts for nobody, `UserRepository.search` / `browseExcluding` / `searchForFamily` filter `deletionRequestedAt is null` (`PendingDeletionDiscoveryTest` pins it), Family `linkMember` and mentorship `create` treat it as 404, and Circle `members` / the challenge board leave it out (not even in the hidden count). Not gated: a push another user's action triggers (mentorship chat) — PushService is the one place to close that. A new scheduler or people lookup must check it too. The purge runs off `AuthService.USER_OWNED_TABLES`, a hand-written list — every table
with a plain `user_id` column must be in it, and `AccountDeletionCoverageTest` reads
`tableCreationQueries.sql` and fails the build when one isn't. (`focus_sessions` and
`weekly_reviews` were both missing, so a deleted account left those rows behind.) It brackets the
purge with `SET FOREIGN_KEY_CHECKS=0/1` in a **try/finally** — that is a session variable on a
pooled connection, so a throw in between handed the next request a connection with integrity
checks off.

### Endpoint index

| Base | Routes |
|---|---|
| `/api/auth` | `signup`, `login`, `verify`, `resend-verification`, `forgot-password`, `reset-password`, `logout`, `me`, `timezone` PUT (zone only, from the client's device-zone offer; `profile` PUT replaces every field), `sessions`, `sessions/{id}` DELETE, `change-password`, `delete-account` (schedules: 7-day grace, sessions revoked), **`cancel-deletion`** (anonymous; a login that clears the schedule), `email/change` + `email/confirm` (code to the new address, old one notified), `security` GET (2FA state + pending email), `2fa/setup` POST (secret + otpauth URI, refused once on), `2fa/verify` (enables, returns 8 recovery codes once), `2fa/disable` (password + code), `whatsapp` PUT + `whatsapp/send-otp` / `whatsapp/verify-otp` POST, `features` / `ui-prefs` / `digest` / `home-layout` / `nav-layout` PUT, `nutrition-suggestion` POST, **`export` GET** (`user/DataExportController`: every `AuthService.USER_OWNED_TABLES` row + the `users` row as one JSON attachment; skips credential/session/OTP tables and push keys; per-IP rate-limited) |
| `/api/client-errors` | POST, **anonymous** (`ClientErrorController`): the frontend crash reporter (`scripts/error-report.js`) → server log only. Fields clipped, control chars stripped, per-IP rate-limited, nothing stored |
| `/api/client-vitals` | POST, **anonymous** (`ClientVitalsController`): `scripts/vitals.js`'s beacon (LCP/CLS/INP/TTFB + home-painted, 10% sample) → one log line. Body is `text/plain` (what `sendBeacon` sends; no preflight), ≤2048 chars, numbers clamped, strings clipped; per-IP rate-limited, nothing stored |
| `/api/users` | `search`, `browse` (public-ish lookup for Circle) |
| `/api/money` | GET, PUT, `advice` POST, `receipt-scan` POST (photo → line items, saves nothing), `tx` POST (ledger writes → balances), `tx?before=&limit=` GET (older history, whole days, `{…, more}`), `accounts` POST, `accounts/{id}` PUT/DELETE, `day-summary?date=` GET |
| `/api/whatsapp/webhook` | GET (Meta handshake), POST (anonymous, HMAC-signed — the "Mark as paid" tap → `MoneyService.markSubscriptionPaid`; a reminder's "Snooze" button, payload `snooze:<reminderId>`; a typed reply of `SNOOZE` / `snooze 20` (`SNOOZE_REPLY`, anything chattier is ignored) = the reminder whose bell card is newest in the last 12h; each answered with a plain-text reply, which the user's own message makes deliverable) |
| `/api/habits` | CRUD (`targetPerWeek` 1..7; `active: false` pauses; listed by `sort_order` then created, a new habit goes last), `PUT order` (`{ids}` top first; ids left out keep their place after them, a foreign id 404s), `kind` build|quit on create only (quit = "break a habit": daily, unmeasured, `done: false` is a slip, no freezes), `{id}/checkin` (future dates refused; XP once per habit per day; a quit habit's clean days are paid once by the list read instead; `note` absent = unchanged), `{id}/toggle`, `{id}/history?days=`, `history?days=` (every habit at once, `{habitId: {since, days}}`, days clamped 1..400 — Insights' read), `freeze`, `{id}/protect` (not before the habit's creation day), `{id}/unprotect` |
| `/api/tasks` | CRUD (PUT takes `paused`: an on-hold task is never escalated to High when overdue; Home's task row has the pause/resume button), `{id}/toggle`, `{id}/history`, `finished?days=` (ticked off lately, swept ones included: priority, createdAt, doneAt, for Insights). A due date moved 12h+ later bumps `pushCount`. **`goalId`** (POST/PUT, in every answer): one of the user's own goals, else 404 "Goal not found" (`GoalService.ownsGoal`); PUT `clearGoal: true` takes it off; DELETE clears it too, so a soft-deleted done task still on a goal means "cleared by the sweep" |
| `/api/goals` | GET (sections by horizon; one batched action count + top 3 actions per goal), POST, `{id}` PUT (title / description / horizon / targetDate; null = unchanged, `clearTargetDate` removes the date) and DELETE (takes its tasks off it — `tasks.goal_id` has no FK — the tasks stay), each goal's `clearedTaskCount` (finished linked tasks the midnight sweep removed from `/api/tasks`, one batched query), `{id}/toggle`, `{id}/progress` (opaque blob, must be a JSON object ≤ 64 KB), `{id}/actions` GET (all, newest first — Goals' "See all") / POST (+ per-action PUT/DELETE; an action date after the user's today is refused) |
| `/api/family` | `members` CRUD + `{id}/profile`, `search`, `members/link`, `invites` (+accept/decline), `leave`, `transfer` POST (owner → a mapped member), `grocery-scan`, `meal-plan` GET/POST, `meal-plan/multi` GET (204 when none)/POST (weekly/monthly), `meal-plan/{planId}/reuse` POST, `meal-plan/{planId}/cook` + `meal-plan/multi/{planId}/cook` PUT, `meal-plan/{planId}/cooked` POST, `plans/history` GET (last 8 one-day plans), `recipes` GET/PUT (upsert by dish; empty = delete, 204) + `recipes/{id}` DELETE, `chores` GET/POST + `{id}` PUT/DELETE + `{id}/toggle` POST, `favourites` GET/POST + `{id}` DELETE, `pantry` GET/POST (+`/scan`, `{id}` PUT/DELETE), `shopping` GET/POST (+`/generate` → `added` + `message`, `/from-pantry` POST (low or expiring ≤2 days, deduped), `{id}/toggle` body `{checked}` sets, no body flips, `{id}` DELETE) |
| `/api/food` | GET `?date=` (the day's summary), `search` (OpenFoodFacts; no caller in the app), `recent` GET (8 distinct latest foods, the add form's chips), `entries` POST/DELETE, `entries/{id}` PUT (edit name/grams/kcal/meal/slot/day; no AI), `entries/manual` POST (kcal required, no AI, so outside the AI rate limit), `entries/copy?slot=[&from=&to=]` POST (a slot's entries from yesterday onto today as manual kcal; no AI), `favourites` GET/POST `{entryId}`, `favourites/{id}` DELETE (starred foods, max 24), `barcode/{code}` GET (OpenFoodFacts product, per 100 g; 404 unknown; no AI), `photo-estimate`, `photo-estimate-multi`, `photo-history` GET/POST, `week` GET (7 days of kcal + estimated protein/carbs/fat/fiber, targets, averages, levels, top dishes per nutrient; fills missing `*_g` in one AI batch), `diet-check[?date=]` POST (AI; a day of the last 7, or the week; water included unless the `water` feature is off in `users.feature_prefs`; a day still in progress is judged "low" against the share of a 07:00–23:00 waking day gone; the estimate backoff is a `ThrottleStore` lock, the last answer a `food_diet_checks` row, so both are shared across instances) |
| `/api/water` | GET `?date=` (the day's summary), `entries` POST/DELETE (a `loggedAt` in the future is refused, with 10 min of clock slack; optional `drinkType` water/tea/coffee/juice/milk/other — every total (`consumedMl`, `week`, `totalsByDay` for FoodWeek and Progress) is EFFECTIVE ml, factors 1/0.9/0.8/0.9/0.9/1 in `DrinkType`, mirrored by `HYDRATION` in `nutrition.js`; `drankMl` is the raw sum), `week` GET (7 days of ml for the Food summary), `times?days=` GET (every entry's `loggedAt`, for Insights and the water nudge), `goal` PUT (writes `users.daily_water_goal_ml`, the Settings field; a pre-move `water_goals` row is read first until either screen edits the goal) |
| `/api/daily-logs` | GET, `sleep`, `mood`, `snapshot` — **there is no PUT.** The client used to call one from three places (`persistWellness`, a boot "force-sync", a 5-minute timer); all three 405'd forever and logged `CRITICAL: failed to reach database`. Sleep and mood are saved by their own POSTs as you enter them. |
| `/api/score` | `today`, `today/snapshot`, `day?date=` (a finished day's parts, via `ScoreService.on`) |
| `/api/focus` | `stats` (focus-mode only; today = since the user's local midnight, week = since their local Monday, via `UserClock`; `goalMinutes` + `goalStreak` from `ui_prefs.focusGoalMins`, a today not yet met doesn't break the streak), `sessions` POST (`{mode, durationSec, taskId?, goalId?}` — the link must be the caller's own task/goal (`FocusLinks`) or 404; a break is never linked), `sessions?days=` GET (focus-mode only: durationSec, completedAt), `history?days=30` GET (1..90: `days` [{date, minutes}] oldest first on the user's local days, `week` [{kind, id, title, minutes}] since local Monday per linked task/goal, title null once deleted) |
| `/api/weekly-review` | GET (all, newest first) / PUT (upsert; wins + one focus, keyed by ISO week start) |
| `/api/quotes` | GET (all), `today` |
| `/api/mentor` | `chat`, `chat/messages` POST/DELETE, `chat/messages/stream` POST (SSE), `threads` GET/POST, `threads/{id}/messages` GET/POST/DELETE (DELETE = clear that thread), `threads/{id}/messages/stream` POST (SSE), `threads/{id}` PATCH (rename) / DELETE |
| `/api/mentorship` | `requests` POST, `requests/{id}/accept|reject|revoke`, `requests/incoming`, `requests/outgoing`, `connections/{partnerId}/status`; and in `MentorshipChatController`: `{id}/nudge` POST (`kind` cheer|nudge, 3 a day per sender per link, then 429), `{id}/messages` GET (newest 50, `?before=`) / POST (≤2000 chars), `{id}/agreement` PUT (≤500 chars), `{id}/week` GET (mentor only; honours the mentee's `shareProgress`) |
| `/api/circles` | GET (every circle, with a joined flag), `mine`, POST (`visibility: private` mints a `joinCode`), `join-code` POST, `{id}/join` (403 on a private circle), `{id}/leave` (owner refused), `{id}` DELETE (owner), `{id}/members` GET, `{id}/members/{userId}` DELETE (owner), `{id}/transfer` POST (owner), `{id}/posts` GET (newest 50, `?before=`) / POST (≤2000 chars), `{id}/posts/{postId}` DELETE (author or owner; takes its kudos), `{id}/posts/{postId}/kudos` POST (toggle, one per member, answers the count), `{id}/challenges` GET/POST (≤10 running; `metric` habit_checkins|focus_minutes|water_days; `startDate` ≥ the creator's local today, ≤60 days out, absent = today) |
| `/api/notifications` | list (no params = every row, what shipped builds expect; **`?limit=&before=&category=`** = one page newest first, `before` an ISO instant and **inclusive** — `created_at` is second-precision, so a strict cursor skipped rows; the client drops repeats by id; `category` = `NotifyCategory`), `unread-count`, `{id}/read`, **`mark-all-read`** POST (stamps the caller's unread rows), **`read`** DELETE ("Clear read": the caller's read rows), `read-all` PATCH (still *deletes everything* — the old "Clear all", kept for cached builds), `{id}` DELETE, **`custom-sounds` GET (list, no bytes) / `custom-sounds/{id}` GET/PUT/PATCH/DELETE** (PATCH = rename only: bytes and `updatedAt` untouched, so other devices take the new name from the list without re-downloading) (the user's own notification sounds — files or voice recordings, **up to 5 per account** (`CustomSoundService.MAX_PER_USER` = chime.js `CUSTOM_MAX_COUNT`; change both, `CustomSoundLimitsTest` checks they match), the id minted by the client so PUT is an upsert and a retry can't fill a second slot; the cap holds under concurrent uploads because `put` locks the owner's `users` row first and then counts with a *locking* read (`countForUpdate`) — a plain count reads the transaction's snapshot and let 8 of 8 simultaneous uploads through; the API speaks the data URL the client stores, the row holds raw bytes in `audio` + `content_type` + a `name` + `source` (`recording`|`file` — stored, because a renamed recording can no longer be told by its name), and a pre-bytes row converts on first GET; 300 kB ceiling enforced both sides). **`custom-sound` GET/PUT/DELETE** is the one-sound API from before, kept for builds cached on phones: it means the account's oldest sound, and GET answers **204** when there is none |
| `/api/push` | `public-key`, `subscribe`, `unsubscribe`, `test` (sends regardless of mutes) |
| `/api/reminders` | list, POST, **PATCH `{id}?scope=&date=`** (scoped edit — `this` skips the day and leaves a one-off in its place, `future` cuts the series and starts a new one, `all` edits the row), DELETE `{id}?scope=&date=`, `occurrences`, `day/{date}`, `export.ics` GET (every reminder as an iCalendar attachment), `{id}/done?date=` POST/DELETE (check one occurrence off: not delivered, no device alarm), **`{id}/snooze`** POST `{minutes?}` (none = the user's `ui_prefs.snoozeMinutes`, default 10; 1-240; a timed reminder only) / DELETE (cancel), **`snooze-link`** POST `{token}` — anonymous: a push notification's Snooze button runs in the service worker, which holds no session, so the push carries a `SnoozeLinks` ticket (HMAC with the session secret under its own label, one user + one reminder, 24h). Bad or expired → 404, same as a deleted reminder. Create/PATCH take `notifyBefore` (minutes, 0-1440; null = the user's default `ui_prefs.reminderLead`; in a PATCH null = unchanged and **-1 = back to the default**). PATCH also takes `tag`, `repeat`, `until`, **`allDay: true`** (takes the time and end off — a null `time` means unchanged), **`clearUntil: true`**, and `date` (moves a one-off, or the one-off a `this` edit leaves; ignored on a series). A `future` delete/edit from the series' first live day (max of anchor and `from`) deletes the row instead of ending it before it starts. **Richer rule** on create/PATCH: `repeatInterval` (1-99, every N days/weeks/months/years; not `weekdays`), `repeatDays` (`"MO,WE,FR"`, weekly only), `repeatNth` (1..5 or -1 = last, monthly only, weekday from the anchor), `repeatCount` (end after 1-999, counted from the anchor; a `future` split carries what is left); PATCH clears with 1 / `""` / 0 / 0, and `normalizeRule` drops what a repeat can't use. Also **`notes`** (≤1000, `""` clears) and **`notifyBefore2`** (a second alert, 0-1440, no default; PATCH -1 clears). **`{id}/done?date=`** POST / DELETE (204): check one occurrence off — it is not delivered and the device queues no alarm; POST refuses a day the reminder isn't on and drops a pending snooze. The list carries **`doneDates`** (the last 90 days on; single-reminder answers carry null and the client keeps its own). **`export.ics`** GET: every reminder as VEVENTs, RRULE mapped from the rule (`ReminderIcs`: month-end clamp as `BYMONTHDAY=28,...;BYSETPOS=-1`, only one of COUNT/UNTIL, DTSTART moved to the first real occurrence), local times with `TZID` = the user's zone, a VALARM per alert, skips as EXDATE |
| `/api/notes` | list (photos cut out, `cover` + `photoCount` + `bodyTrimmed` instead; excludes archived — `?archived=true` is the Archived view), `trash` GET (soft-deleted in the last 30 days), `counts` GET (`{archived, trash}`), `{id}` GET (whole note), POST, `{id}` PATCH (also `labels` — list, `[]` clears, max 10 × 30 chars, 400 past that — and `archived` true/false), `{id}` DELETE (soft: to the Trash), `{id}/forever` DELETE (hard; 400 unless already in the Trash), `draft` GET/PUT/DELETE (composer autosave, `note_drafts`), `{id}/draft` GET/PUT/DELETE (an open edit's autosave, `note_edit_drafts`, labels included — `labels: []` is "all removed", null on GET a pre-labels row; any save of the note or its delete drops it), `{id}/restore` POST (undo a delete). PATCH takes `baseUpdatedAt` — the version the client edited; a newer one on the server is **409** (compared to the second: the column has no fraction) |
| `/api/quick-add` | POST — free text ("spent 200 on lunch, slept 7h, drank 500ml") → writes across features. Parses **task, habit, water, sleep, mood, expense, reminder** and nothing else: the old example here was "ran 3km", which there is no tracker for. Body `{text, habits, today}` — `today` is the device's date (used if within a day of the stored timezone's), named in the prompt with its weekday, because "tomorrow" / "next Friday" mean nothing without it. A **reminder** carries text, date, time, endTime, repeat, until, tag, notifyBefore; `QuickAddService.reminder` checks each field alone (a bad one is dropped, not the reminder; a past date becomes today; a lead needs a time). Before it existed, "remind me tomorrow at 9 to call mom" came back as a task or nothing. |

### Notable services (the ones without their own doc)

- `user/SessionService` — mints/validates opaque tokens; stores
  `HMAC-SHA256(token, serverSecret)` so a DB dump alone can't validate a stolen token. 60-day life.
- `user/TotpService` + `user/Totp` — optional authenticator-app 2FA. `Totp` is RFC 6238 by hand
  (HMAC-SHA1, 30 s, 6 digits, ±1 step, constant-time compare) + base32; `TotpService` stores the
  secret AES-GCM-encrypted (key derived from `SESSION_HMAC_SECRET`) in `user_totp`, rejects a step
  already used (replay), and spends bcrypt-hashed recovery codes. `TotpServiceTest` = RFC vectors.
- **Every `@RequestBody` takes `@Valid`, and every field a bound.** `mentor` was the one package
  without either: an over-long thread title reached the insert and came back a 500 reading
  "Something went wrong". A bound belongs at the boundary, not at the column.
- `mentor/OpenAIClient` — minimal chat-completions client on the JDK `HttpClient`, no SDK.
  Per-user caps live in `common/AiRateLimitInterceptor`, and the client charges a call budget of its
  own and refuses once it is spent — both apply to every AI route (mentor, photo estimate, meal plan,
  receipt scan, purchase advice).
- **What the mentor is given** (`MentorService.buildUserContext`): today's score, the user's **open
  tasks** (due today / overdue first, at most 25, `taskLines`), habits + streaks, and the last 7
  days' mood/energy/stress/sleep words (`WellnessService.contextSummary`, no notes). "Today" is the
  user's zone (`UserClock`). Names sit inside a `<user_data>` block the prompt calls data, not
  instructions. Not money, not food, not family. Say that plainly anywhere the mentor is described —
  "sees your trackers" reads as all of them.
- **Buddy threads + one-tap actions.** A thread still on a starting title (`New conversation` / `Talk to Buddy`) is renamed from its first user message (`MentorActions.autoTitle`: one line, ≤40 chars, cut at a word + …) when that message is saved — before the model call, so a refused send still names it. The system prompt (`ACTIONS_PROMPT`) lets the model end a reply with ````actions [{type,title,time?}]````; `MentorActions.parse` strips every such block (malformed or unclosed too) before the reply is saved, keeps ≤3 valid task / habit / reminder items, and `mentor_messages.actions_json` holds them. `MessageResponse.actions` is never null. Streamed deltas still carry the fence; the client hides it. Nothing is created server-side. `MentorActionsTest`, `MentorThreadsTest`.
- **Evening reflection** (`mentor/ReflectionScheduler`, every 5 min): a user whose `ui_prefs.buddyReflection` is "HH:MM" gets a `buddy_checkin` bell card + Web Push (`/#mentor`) inside [time, time + 10 min) in their own zone (`ZonedDateTime.of`, so a spring-forward slot still lands), once per local day (an in-memory map, plus a "one since local midnight" notifications check that survives a restart), held by quiet hours, skipped for unverified or deleting accounts. Fixed text, **no model call**, so no AI budget. Candidates come from a native `CAST(ui_prefs AS CHAR) LIKE` prefilter (`ReflectionUsers`). `ReflectionSchedulerTest`.
- Mentor replies: `max_tokens` 500 (`REPLY_MAX_TOKENS`). An `ApiException` from the client (its 429
  budget) propagates and the user's message is deleted again; any other failure saves a canned reply
  with `mentor_messages.fallback = true`, which `turnsFor` never replays to the model (nor older
  canned text, matched by prefix). Chat reads return the newest 200 (`READ_LIMIT`).
  `MentorServiceTest` also checks every mentor POST is in WebConfig's AI rate-limit list.
- **Streamed Buddy replies** (`…/messages/stream`): `SseEmitter`, events `delta {text}`, `done
  {message, userMessage}`, `error {status, message}`. The request thread validates and saves the
  user's message (`MentorService.beginStream`, so a 400/404 is plain JSON); the model call runs on
  `MentorController`'s bounded `buddy-stream` pool (16 + 32 queued, then 503) with `CurrentUser`
  set there, because `chargeBudget` reads a ThreadLocal. `OpenAIClient.stream` sends `"stream": true`
  and parses lines with the pure `parseStreamLine` (`[DONE]`, keep-alives, malformed JSON skipped,
  an in-stream `error` throws). The 429 budget is an `error` event before any delta; a Stop or a
  failure after some words saves those words; stopped before any, the user's message is deleted
  again. **Async traps it exposed:** `CurrentUserInterceptor.afterConcurrentHandlingStarted` clears
  the ThreadLocal (`afterCompletion` doesn't run on the first dispatch), and
  `AiRateLimitInterceptor` skips the ASYNC re-dispatch (preHandle runs again on it — it charged
  every streamed message twice). Client: `mentor.js` reads `fetch` + `ReadableStream`
  (`parseSse`), Stop = `AbortController`, falls back to the plain POST when `api.stream` throws
  `fallback` (no response, 404/405, not `text/event-stream`).
  Talks to **Claude through a Cloudflare AI Gateway**, whose `/compat/chat/completions` endpoint
  speaks the OpenAI wire format, so the provider swap was config plus the payload shape. Class name
  kept; `AiPayloadTest` pins the reply parser, the half that fails silently. Stateless: each call
  sends the whole rolling context. `isConfigured()` — token **and** URL — gates every AI feature.
  The gateway URL is account-specific and has no default in `application.yml`: set `AI_GATEWAY_URL`
  in `.env` and in Render, never in the repo.
- `score/ScoreService` — today's score = average completion rate across enabled features.
- `reminder/ReminderService` — recurrence expansion + scoped deletes; **mirrors the client-side
  expansion in `scripts/calendar.js` — keep both in step.** `create` rejects an `until` before the
  start date (a reminder that could never fire), and stores a blank `sound` as null — a reminder
  carries its **own** chime key, and null means "whatever tone the user picked in Alerts".
  **Notify before + snooze** (`ReminderPrefs`, `ReminderSnoozeService`): a reminder rings
  `notifyBefore` minutes early, or the user's `ui_prefs.reminderLead` when it has none (`leadFor`;
  push.js `leadOf` is the same rule for the phone's own alarms). So the scheduler's `dueDay` tries
  yesterday/today/tomorrow — a lead puts tomorrow's 00:10 on tonight, and the catch-up window can carry
  23:58 past midnight. One made inside its own lead (created after its early ring) rings on time
  instead. The text says what is actually left ("At 09:00 · in 10 min"), not the lead. A snooze is
  one `snoozed_until` per reminder (snoozing again moves it; moving the time clears it); the
  scheduler rings it over the same three channels, **at least once**: one transaction inserts a
  `pending` dispatch-log row keyed `(snoozeLogId(id, at), day)` — `ux_rem_dispatch_unique`, so of two
  instances only one gets it — and runs `claimSnooze` (an UPDATE that matches only the value it read;
  0 rolls the row back). Send, then `settleSnooze` → `sent`. A row still `pending` (instance died, or
  nothing got through) is resent by `resendStuckSnoozes` (cron :30) after `SNOOZE_STUCK` (2 min) per
  try, each resend taken by `claimResend` (matches the attempt count read), at most `SNOOZE_RESENDS`
  (2) times, then `failed`. Columns `snooze_of` (the reminder) + `attempts`.
  **Second alert** (`notify_before2`, `secondDueDay`): rings too, de-duped in the dispatch log under
  `secondAlertId(id)` (a name-derived UUID, so no new column); dropped when it would ring with the
  first, and never falls back to on-time. **Done** (`reminder_done`, `ReminderDone`): the scheduler
  batch-reads the tick's ticks (`findDone`) and skips those occurrences; a split moves the ticks to
  the reminder that now owns those days; deleting the row deletes its ticks.
  **Quiet hours** (`ReminderPrefs.isQuiet`, `ui_prefs.quietStart`/`quietEnd`, may wrap midnight):
  `HabitReminderDeliveryScheduler` holds a habit reminder back on every channel, and
  `DigestScheduler.digestHourFor` moves the digest to the first hour after the window. **A timed
  reminder the user set is never silenced by them** — they chose that minute; push.js follows the
  same split on the device (water nudge + habit alarms only).
  `ReminderDeliveryScheduler` polls and delivers near the user's local time — the in-app
  bell always (it needs no setup, and `NotificationService.publish` pushes it down the websocket so
  an open app shows it immediately), plus WhatsApp + push for the users configured for them, dispatching a tick's batch across a 16-thread pool; The delivery window is a zone-resolved `Instant`, so a reminder inside a spring-forward gap fires late rather than never. `ReminderDispatchLog` prevents
  double sends: the day's row is claimed ('sending') before anything goes out, a retry reuses a 'failed' row, and a 'sending' row a crash left counts as delivered (`habit/HabitReminderDeliveryScheduler` does the same, over the same three channels: bell, WhatsApp, push); `WhatsAppService` = Meta WhatsApp Cloud API. Scheduled sends need
  `WHATSAPP_TEMPLATE` (an approved template, body = one `{{1}}`) — free-form text is only
  deliverable inside a user's 24h window. Reminders go through `sendSnoozableReminder`: with
  `WHATSAPP_REMINDER_TEMPLATE` (body = one `{{1}}` + one QUICK_REPLY "Snooze") the tap comes back
  as `snooze:<id>`; without it the plain template, plus " — reply SNOOZE to hear it again in 10 min."
  only when the webhook can hear the reply (`WHATSAPP_APP_SECRET` set). One line on purpose: Meta
  refuses a template parameter with a newline.
- `digest/DigestScheduler` + `DigestService` — progress digest near each user's preferred
  local hour, honouring their timezone. Reports the **last day that finished**, never the live
  score: a digest fires in the morning, by which point `TaskMidnightSweep` has cleared yesterday's
  ticked tasks and the habit check-ins belong to a new log date, so a live reading is a truthful 0
  about a day nobody has lived yet. `ScoreService.on(user, day)` / `.between(...)` rebuild a past
  day from `task_completion_history` plus the check-in log.
- `push/PushService` — Web Push (VAPID); inert until keys are set. **`sendToUser(userId, NotifyCategory, …)`**
  checks the user's `ui_prefs.notifyMute` first (`isMuted` → `NotificationPrefs.isMuted`; people / money /
  habits only — reminders and system can't be muted, and cost no lookup). Callers that name a category:
  habit reminders (`habits`), mentorship chat (`people`). Nothing publishes `money` yet — the mute is
  stored and honoured the day something does. `PushMuteTest`.
- `mail/MailService` — transactional email; **no-ops with a log line when
  `spring.mail.username` is empty** (this is why local OTP flows need `./run.sh`).
- `quickadd/QuickAddService` — free text → structured writes across features.
- `note/NoteService` — quick notes: soft delete, `""` clears a colour or cover where `null`
  means "leave it alone", 2 MB body cap (photos are data URLs in the body). The list, POST and
  PATCH answer with the body's photos **cut out** (`bodyTrimmed: true`) and a client-made `cover`
  thumbnail in their place; only `GET {id}` returns the whole note, and the editor must open from
  that or a save would write the photo-less copy back. The body is **HTML** from the editor on the Notes screen and is
  sanitised where it is rendered (`sanitize()` in `scripts/notes.js`), never in Java.
  Labels are one comma-joined `labels` column; `NoteLabels` parses/validates/joins them (the
  client mirror is `parseLabels`/`validateLabels` in `scripts/notes-core.js`). Archive is
  `archived_at`; the Trash is `deleted_at` within `TRASH_DAYS` (30).
  `NoteServiceTest` covers the null-vs-empty branch, the trimmed list, the 409, restore, labels,
  archive, the Trash/purge cutoff and delete-forever; `NoteLabelsTest` the label limits.
- `notification/NotificationService` + `WebSocketConfig` — realtime channel
  (STOMP/SockJS; the frontend uses `@stomp/stompjs`). `clearAll` **deletes** rather than stamping
  readAt — the bell is nudges with a lifetime, not a ledger — and `sweepOldNotifications`
  (nightly) drops read rows after **the user's `ui_prefs.notifyKeepReadDays`** (7 / 30 / 90,
  default 30, `NotificationPrefs.keepReadDays`) and anything after 90 whatever they picked: one
  bulk delete for the default (`deleteReadBeforeExcept` the keep-longer users), one per shorter
  window (`deleteReadBeforeForUsers`, IN lists of 500), then the cap. Each row carries a
  **`category`** (`NotifyCategory`: reminders | habits | people | money | system — the bell's chips
  and the push mute); `publish(…, NotifyCategory, …)` sets it where the kind can't tell (family and
  mentorship-chat cards are `system` kind but `people`), a NULL on older rows falls back to the kind
  (`effectiveCategory`, and `legacyKinds` in the paged query). `NotificationRetentionAndMuteTest`.
- `mentorship/MentorshipService`, `circle/CircleService` — invites and circles;
  `CircleChallenge` is a time-boxed challenge (may start in the future), members ranked by its
  `metric`: habit check-ins, focus minutes (focus sessions bucketed into each member's own local
  day) or days on their water goal — `circle/ChallengeMetrics`, `CircleKudosAndMetricsTest`.
  The two mentorship directions are INDEPENDENT — A can mentor B while B mentors A — so
  `relationship()` returns `mentorLink` / `menteeLink` (none|pending|active) per side and `revoke()`
  cancels only the side it was handed. The single `state()` word is a legacy summary; UI uses the
  two links. Covered by `MentorshipRelationshipTest`.
  `mentorship/MentorshipChatService` is everything INSIDE an accepted link (`requireLink`: a party,
  and accepted — else 404 / 403): cheer/nudge (stored as `mentorship_messages` rows of that kind,
  so the 3-a-day cap can't be reset by clearing the bell), the thread, the `agreement` column, and
  the mentor-only weekly card. Each line rings the partner's bell (`system`) + web push and goes out
  as a transient `mentorship_message` frame (`MentorshipEvents`, the `FamilyEvents` pattern) that
  app.js re-dispatches as `gb:mentorship-message`. `MentorshipChatServiceTest`.
- `config/DataSeeder` — demo user + starter data, keyed on `growthbuddy.demo-user-id`.
- `task/TaskMidnightSweep` — soft-deletes each user's **done** tasks at their own local
  midnight (hourly cron, hour-0-in-their-zone, same shape as `DigestScheduler`). Tasks have no day
  of their own, so yesterday's ticks used to sit in today's list and still count towards today's
  score (`ScoreService` counts live rows). Unfinished tasks carry forward — they're still to do.
  `task_history` is left alone, so the report and the "done 3×" count survive.
- `user/AccountDeletionJob` — hourly: hard-deletes accounts whose `deletion_requested_at` is 7+ days old via `AuthService.purgeScheduledAccount` (one transaction each, re-checks the stamp so a late cancel wins).
- `config/DataCleanupJob` — nightly purge of append-only tables never read again (hosting
  quota; includes `food_diet_checks` past 8 days and `food_photo_logs` past a user's newest 12,
  and notes in the Trash past 30 days via `NoteService.purgeTrash` — same `trashCutoff` the Trash view reads), plus abandoned signups: `signup()` writes the users row BEFORE the OTP is checked, so a
  mistyped email leaves an account that can never sign in but still holds the unique email.
  Unverified + older than 7 days is deleted, children first (TiDB may not enforce FK cascade).
  The three people-lookup queries in `UserRepository` also require `emailVerified = true`, so a
  ghost is undiscoverable the moment it exists rather than only after the nightly sweep.
- `user/ProgressService`, `wellness/WellnessService`, `water/WaterService`,
  `task/TaskService`, `goal/GoalService`, `focus/FocusService`,
  `money/MoneyService` (document part, migration, ledger writes, purchase advisor). `MoneyLedger` (JdbcTemplate:
  accounts + balances computed, never stored; batched upserts keyed on the client's id). `MoneyDaySummary`
  (a tapped day: facts and a paragraph written from them, no AI and no cache on purpose — the AI only
  reworded exact facts; Food's day/week diet check is where the AI earns its call). `SubscriptionDueScheduler` WhatsApps a
  "due today" message with a Mark-as-paid button from 09:00 local on a subscription's due day (de-duped in
  `reminder_dispatch_log` under a name-derived UUID). A transient send failure is retried at most 3 times
that day, backing off a tick then two (`SubscriptionDueScheduler.Retries`, in memory); the third writes a
`failed` row so every instance stops. It reads only the documents of users the database picks on
  `money_state.sub_due_days` (bit d-1 per due day, derived in `MoneyState.touch()`; NULL rows from before the
  column are included and filled in); `WhatsAppWebhookController` takes the tap. `dueToday` and
  `MoneyService.applyPaid` share one rule: paid is forward-only (a bill paid ahead is not due), and a bill
  with no amount is never due (its tap replies "add an amount first").

### Entities worth knowing
`MoneyState` (the small per-user Money document; expenses/income/transfers live in `money_transactions`),
`HabitCheckin` (composite PK habit_id+log_date), `HabitStreak` (cache, recomputed per check-in),
`StreakFreezeWallet` (1 token/ISO week, cap 2), `DailyLog` (one row per user+day),
`FamilyMember` (may be unmapped — a profile with no account), `FocusSession` and
`FoodPhotoLog` (retention-capped), `EmailVerificationToken` / `PasswordResetToken` /
`WhatsAppOtpToken` (**bcrypt hash of the OTP only, never the code**).

---

## Config / root files

| File | What |
|---|---|
| `index.html` | single-page shell; module entry `scripts/app.js` |
| `styles/premium.css` | the **premium skin**. Every rule scoped to `html[data-premium='on']` and loaded last, so it overrides tokens and is fully inert when off. Lit canvas on `.gb-app`, glass cards, floating pill nav (`<1024px` only — it's a sidebar above that), circular icon buttons, pill buttons, size-specific tracking. §9 is the signature: the **live seedling** in the header — the brand mark itself, nodding when you actually finish a task or habit (`buddyReact()` from `toggleTask`/`toggleHabit`) and shaking its head on errors. Shares its refusal rhythm with `@keyframes gb-shake`, the Face-ID-style "no" any refusing surface does (`shakeRefusal()` — sign-in card, modal sheets). §10 gives toasts an entrance they never had (they used to snap in). Toggle: Settings → Display → Look (the header gem button is gone — a skin switch isn't a daily action). |
| `vite.config.js` | dev server :5173, proxies `/api` + `/ws` to :8080 **rewriting the Origin header** (the backend's CORS allow-list excludes :5173); `vite-plugin-pwa` for manifest, offline precache, NetworkFirst on API GETs, and it pulls in `public/push-handlers.js`. Target override: `API_PROXY_TARGET`. Also `define`s `__GB_BUILD__` (a hand-bumped int, starts at 0) — `app.js` logs it and parks it on `window.GB_BUILD`, so the console tells you which build a device is actually running. |
| `run.sh` | **start the backend with this** — loads `.env`, frees port 8080 |
| `DEPLOYING.md` | how to ship it. The two variables that fail *silently* are `SPRING_PROFILES_ACTIVE=prod` and `VITE_API_BASE` — read it before any deploy |
| `backend/Dockerfile` | 3-stage build (Vite → Maven → JRE). Serves the API **and** `dist/` from one origin, which is why the bundle can use relative paths and CORS drops out of the deployment. Bakes `SPRING_PROFILES_ACTIVE=prod` in so a deploy can't omit it |
| `backend/src/main/resources/application-prod.yml` | prod overrides. Every value is `${VAR}` with **no default**, so a missing one fails startup instead of booting on a dev fallback. Pins `ddl-auto: validate` |
| `.env.example` | required env: DB, mail, AI gateway, VAPID, WhatsApp |
| `backend/src/main/resources/application.yml` | Spring config (**dev defaults**; `application-prod.yml` overrides). `ddl-auto: ${SPRING_JPA_DDL_AUTO:update}` and `preferred_uuid_jdbc_type: CHAR` are both load-bearing |
| `backend/pom.xml`, `backend/README.md`, `backend/mvnw*` | Java build |
| `package.json` | `dev`, `build`, `preview`, `lint`, `lint:fix`, `format`, `format:check` |
| `eslint.config.js`, `.prettierrc.json`, `.prettierignore` | lint/format |
| `.github/workflows/ci.yml` | CI: `npm run lint`, **every `scripts/*.test.mjs`** (a loop — a new check joins by existing), `npm run build`, `./mvnw test`, and on PRs a `build-number` job that fails when `BUILD` in `vite.config.js` isn't above the base branch's. Not yet: `format:check` (the tree doesn't pass it), ui-audit. Also `npm audit --omit=dev --audit-level=high` (blocking) and a `secrets` job (gitleaks, full history). `.github/workflows/codeql.yml` = CodeQL JS + Java (build-mode none, weekly too). `.github/dependabot.yml` = npm, maven, actions. `.githooks/pre-commit` = local hook, opt-in per clone (CONTRIBUTING.md) |
| `public/push-handlers.js` | service-worker `push` / `notificationclick` handlers, merged into the generated SW. A reminder's push carries `tag` (its snooze replaces the card rather than stacking) and a `snooze` ticket: the Snooze action POSTs it to `/api/reminders/snooze-link` without opening the app; a failed or non-ok POST shows "Couldn't snooze — tap to open" instead of vanishing |
| `public/icons/`, `assets/` | PWA icons; `assets/` also holds dev screenshots (excluded from the build — `publicDir` is `public/`) |

---

## Repo-wide traps

1. **UUIDs are `char(36)` text** in MySQL. `preferred_uuid_jdbc_type: CHAR` is what makes that work.
2. **Lowercase Java enum constants are DB values** (`Cadence`, `HabitDomain`, `MessageRole`,
   `ReminderTag`, `RepeatFreq`, `NotificationKind`). `Priority` is `Low/Medium/High` on purpose.
3. **Never call `LocalDate.now()` for anything a user sees dated.** "Today" belongs to the
   user, not the server: resolve it through `UserClock.today(userId)` (their
   `users.timezone`, the same field the schedulers use) and resolve it **once** per
   operation, then pass it down — a loop costs a lookup each time and a request
   straddling midnight would compute rows against different days. `UserZone.of()` parses
   a stored zone and falls back to UTC. Covered by `UserZoneTest` / `UserClockTest`.
4. **Secrets are never stored in plain form** — OTPs bcrypt-hashed, session tokens HMAC'd, passwords
   bcrypt. Keep it that way.
5. **Date keys are `YYYY-MM-DD` strings** on the frontend; ranges are string comparisons.
6. **Every AI feature must degrade** when `OpenAIClient.isConfigured()` is false — there's a
   heuristic or fallback path for each one. Don't add an AI call without one.

(`./run.sh`, schema/DDL, `ponytail:` and the rest of the working rules live in CLAUDE.md, which is always loaded.)
