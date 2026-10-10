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
- **Loading:** the boot chunk is Home only. Six screens (family, circle, timer, goals, report,
  mentor) and the realtime stack (sockjs + stompjs) are dynamic imports, kept out of the service
  worker precache via `globIgnores` and cached on first use by a CacheFirst rule. Fonts are
  latin-subset only. Boot chunk 449 kB -> 298 kB (gzip 129 -> 85); precache 992 kB -> 659 kB.
  Boot fetches run in two waves (`loadData` -> `loadSecondaryData`): five calls gate first paint,
  eight follow. Throttled Home paint 1448 ms -> 900 ms.

---

## Frontend — `scripts/` (small modules; the big ones are in `docs/`)

| File | What |
|---|---|
| `insights.js` | Insights on Report: plain statistics over sleep, mood, check-ins, water, kcal and spend, plus focus hours, habit misses, goal pace, task follow-through, unusual and repeating expenses, water gaps and score changes. No AI. Has its own doc (`docs/scripts/insights.js.md`). Listed here for one trap: sleep is keyed on the WAKE date, so stress -> sleep must look at the next day. |
| `insights.test.mjs` | Plain-assert check for the above. `node scripts/insights.test.mjs`. |
| `review.js` | Report look-backs, pure: `pixelValues(metric)` (score / mood / daily-habit share per day, blank = absent, never 0), `personalRecords` (longest habit streak, best focus day, longest water streak, lowest-spend *finished* week with something logged), `periodDelta`, `monthReview` (the month card for `share-card.js`). |
| `review.test.mjs` | Plain-assert check for the above. `node scripts/review.test.mjs`. |
| `cache-storage.js` | The storage layer. In-memory map (sync source of truth) + cookies (tiny boot-critical allowlist only, ~3.5 kB cap) + Cache API (`gb-store-v2`, hydrated async in `init()`). Migrates old localStorage once. Keys prefixed `gb.`. Exports `CacheStorage`. |
| `recurrence.js` | The ONE answer to "does this reminder fall on this day?", shared by the Calendar screen and Home's mini calendar. There were three copies and the dashboard's had drifted. `ReminderService.occursOn` is the fourth-that-must-stay (WhatsApp delivery); keep them in step. Checked by `scripts/recurrence.test.mjs`. |
| `icons.js` | The Lucide subset actually used (121 icons). Load-bearing for bundle size — the full set is ~600 kB. **Add new icon names here or they won't render** — `scripts/icons.test.mjs` fails the moment one is missing, because nothing else can see it: a missing icon is not an error, not a console warning and not an empty box. |
| `achievements.js` | Badge gallery derived from data already tracked (XP/level, freeze-protected streaks, goals, wellness/trends). `XP_PER_LEVEL = 500`. Exports `ScreenAchievements`, `computeAchievements`. |
| `mentor.js` | Buddy chat screen. `renderRich()` = tiny markdown (`**bold**`, `*italic*`, newlines). Exports `ScreenMentor`. |
| `celebrate.js` | One-off unlock celebration: badge pop + hand-rolled confetti, queued one at a time, respects `prefers-reduced-motion`. Registered with `trackOverlay`, so Back closes it and navigation drops it. |
| `a11y.js` | Global modal a11y. A modal is **anything carrying `aria-modal="true"`** — keyed on the attribute, not a class, so a new overlay can't opt out by forgetting one (which is how the celebration overlay and `confirmDialog` both ended up outside the trap, each carrying its own Escape handler). Usually `.gb-modal-overlay > .gb-modal[role=dialog]`, but the outermost box may be the dialog itself. A MutationObserver on `<body>` adds Escape-to-close, Tab trapping, focus in/out (never back to the trigger while another modal is still up) and names each control from the `.gb-field-label` before it, **centrally**, so individual modals need no a11y code. `initA11y()`. |
| `share-card.js` | Draws a 1080×1920 story card on a canvas and hands the PNG to the OS share sheet (where Instagram's "Add to story" lives — there is no web API that posts to Instagram directly). `shareStoryCard(card, opts)` → `'shared'｜'saved'｜'unsupported'`; `renderStoryCard(card)` for the raw blob. Canvas text does NOT trigger font loading — it calls `document.fonts.load()` per face first. No deps. |
| `push.js` | Notification client. On the web: Web Push — `pushSupported`, `pushPermission`, `pushSubscribed`, `enablePush(api)`, `disablePush(api)`, inert when unsupported or VAPID keys are missing. Inside the Capacitor app the same calls route to on-device local notifications via `native.js` (an Android WebView has no `PushManager`), plus `pushTestLocal()`. **Timed reminders, habit reminders and the water nudge fork the same way**: the server can only reach a Web Push subscription, and the app can never register one, so `syncDeviceAlarms({reminders, water, habits, sound})` queues them on the device instead — cancelled and rebuilt whole, capped at 100 in firing order, each id derived from the minute it fires in — a positional counter handed a rebuilt batch the ids of notifications already in the shade, and Android replaced them. Pure builders behind it, all checked by `scripts/push.test.mjs`: `upcomingReminderAlarms()` (14 days, shares `recurrence.js` with the calendar), `upcomingWaterAlarms()` (3 days — a 2-hourly drumbeat would otherwise crowd out real reminders; 30-minute floor; an inverted window means silence; a slot right after one of `usualHours` is dropped — `usualDrinkHours(times)` picks the hours the user logs water in on 60%+ of days, and app.js adds it per sync, it is never a stored pref), `upcomingHabitAlarms()` (daily at `reminderTime`, today skipped once checked in), and `upcomingAlarms()` which merges, sorts, caps and stamps each notification's chime file — a reminder's own `sound` when it has one, the user's default otherwise (the water nudge never has one, so it always follows the default). **The 'Silent' tone is queued like any other, onto `SILENT_CHANNEL`** — it used to be filtered out of the queue entirely, so picking Silent cost the user the notification as well as the sound (it still reached the in-app bell and WhatsApp, so only the phone went quiet) while the Test button, which ignored the tone, kept ringing and made the wiring look fine. |
| `native.js` | Capacitor-only helpers, reached through the bridge rather than imported — the plugin packages live in `../Growth-Buddy-Mobile`, so an import would break the web build. **`nativePlugin(name)`** is the only way in: `Capacitor.Plugins` is filled by `registerPlugin()` inside those packages, so in the shipped app it is always empty and every lookup returned null (no splash control, no device name, and "this browser doesn't support push notifications" **on a phone**). It falls back to the bridge's own `Capacitor.nativePromise(plugin, method, opts)`, which reaches the same native class. Promise-style methods only — listeners would need `nativeCallback`. Every export is a no-op on the web. `isNative()`, `initNative()` (device model at boot + the splash backstop), `deviceLabelHeader()` (the `X-GB-Device` value), the LocalNotifications wrappers (`scheduleLocalNotifications` batch + `cancelPendingLocalNotifications` for the whole queue, `cancelLocalNotifications(ids)` for specific ones — the focus timer's end alarm must drop without taking every reminder with it), `applyNativeStatusBar(theme)` and `hideNativeSplash()`. **`readTodaySteps()`** asks the OS health store (HealthKit / Health Connect, via `@capgo/capacitor-health`) for today's total, once, when `openMeasuredCheckin` opens on a Steps habit, and fills the box only if it is still empty. The phone already counts steps on its motion chip, so there is no sensor, service or listener of ours. It returns null for 0, because HealthKit answers 0 rather than saying a read was denied. Health Connect's permission sheet links to `public/privacy.html`, which ships in `www/`. **`SILENT_CHANNEL`** is the one channel this app makes itself (`importance: 2`, created on first use): Android takes a notification's sound from its channel, so silence is only reachable by posting to a channel that has none. |
| `notes.js` | Notes screen — has its own doc (`docs/scripts/notes.js.md`). Listed here for one reason: `sanitize()` is the allow-list that makes storing rich text as HTML safe, and it runs on save AND on paint. |
| `chime.js` | The five built-in notification sounds, synthesised from a table of oscillator notes (`SOUNDS`) — no audio files, so nothing to licence and nothing added to the bundle or the APK. `playChime(key)`, `CHIMES`, `DEFAULT_CHIME`. Plus the user's own file: `readCustomChime(file)` (gate: `audio/*` and `CUSTOM_MAX_BYTES` = 300 kB), `setCustomChime(url)`, `hasCustomChime()`; playback stops at 5 s. The **choice** lives in `ui_prefs.notifySound`, the **bytes** in CacheStorage key `gb.notifySoundFile` — per device, because a base64 blob in ui_prefs would ride along with every `/api/auth/me`. Picker is the Alerts tab. The same table is **also** the phone's notification sound: `scripts/gen-chimes.mjs` renders it to `gb_<key>.wav` in **both** `public/` and `../Growth-Buddy-Mobile/android/app/src/main/res/raw/`, so the in-app and lock-screen chimes can't drift. The underscore is load-bearing: a raw resource name is `[a-z0-9_]` only, and `gb-chime` resolves to nothing with no error. res/raw exists because an Android **channel's** sound can only be a raw resource, and we build the channels ourselves (the plugin's own are IMPORTANCE_DEFAULT, which rings without a banner). **Edit `SOUNDS` → re-run the generator.** The user's own upload stays in-app: it's a data URL in CacheStorage, and Android can only ring a file that shipped with the app. |
| `toast.js` | Late-bound toast registry. Breaks the app.js ↔ screens import cycle: app.js calls `registerToast(impl)` at boot, screens `import { toast }`. |

---

## Backend — `backend/src/main/java/com/growthbuddy/`

Per feature: `XController` (routes only) → `XService` (logic, `@Transactional`) → entities + `XDtos`
(records) + repositories. Entry point: `GrowthBuddyApplication.java`.

### `common/` — cross-cutting
`CurrentUserInterceptor` validates the bearer token and puts the user id in `CurrentUser`
(ThreadLocal). It is registered on `/api/**` and **the only way past it is an exact match in
`ANONYMOUS_PATHS`** — don't add a second escape based on the raw URI, which is spelled differently
from the path Spring routed on and once let `/%61pi/…` through unauthenticated.
`RateLimiter` is a fixed-window counter in the **shared database** (`ThrottleStore` →
`JdbcThrottleStore`), not a HashMap — it and `LoginAttemptGuard` were both per-process, which made
every limit per-instance and forgave every account lockout on restart.
`LoginAttemptGuard.recordFailure` commits in `REQUIRES_NEW`, load-bearing: `AuthService.login` is
`@Transactional` and records the failure immediately before throwing, so on the caller's
transaction the count would roll back with the rejection it exists to count.
`RateLimitInterceptor` = per-IP on auth routes, `AiRateLimitInterceptor` = 40/hour per user, **POSTs only** (a GET of the saved meal plan or a
chat clear on the same path costs nothing), on an **allowlist of paths in `WebConfig`** — the four vision endpoints were missing from it for months,
the most expensive call in the app running uncapped. The allowlist is no longer the only line:
**`OpenAIClient` charges every call against its own 60/hour per-user budget**, so a forgotten path
is still bounded and the request never reaches the model. The interceptor stays because only it can
answer 429 *before* the handler runs — inside the client, a caller's catch block turns the refusal
into a silent fallback. `LoginAttemptGuard` = per-**account** exponential lockout on wrong passwords and OTPs (5 free, then 1→2→4… min, capped at 1h, cleared on success) — the per-IP limiter alone does nothing against a botnet. `ApiException` (status + message),
`GlobalExceptionHandler`, `ClientIp` (must not blindly trust forwarded headers), `WebConfig`
(interceptors + CORS), `IndexController` (serves `index.html`).
`RequestSizeLimitFilter` caps an `/api/**` body at 8 MB — `@Size` on a DTO field runs *after*
Jackson has already buffered the body, and nothing else bounds a JSON request (Tomcat's
`maxPostSize` is form-encoding only, `spring.servlet.multipart.*` is multipart only). It refuses a
chunked write too (411), since that is the one shape a Content-Length check cannot see.
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
merged in: `expenses` / `income` / `transfers` (last 400 days, `MoneyLedger.WINDOW_DAYS`) and live
`accounts` balances. Saving splits again: `saveMoney` diffs before/after with `ledgerDiff` (pure,
`money-ledger.test.mjs`) and sends only changed items to `POST /api/money/tx`; the rest goes to `PUT`
only if it changed. Unconfirmed ledger writes wait in storage (`<money key>.pending`) and replay on the
next launch. An invalid entry is refused by id, never the whole batch.
The document part is still versioned: `PUT` sends `If-Match`, a stale one is **409**, the client
merges (`mergeMoney`, `money-merge.test.mjs`, keeps the later `paidFor`) and writes once more. **The
GET's ETag is `<version>-<hash of the whole response>`** — tagged with the version alone, a new expense
(ledger changed, document not) got a 304 and every device kept its stale copy. `MoneyController.versionOf`
strips the hash on save. Old documents move into the ledger lazily on first read (`MoneyService.migrate`;
TiDB has no JSON_TABLE, so no SQL can), and an old app build that still PUTs expenses in the document
has them upserted.

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

**Deleting an account** runs off `AuthService.USER_OWNED_TABLES`, a hand-written list — every table
with a plain `user_id` column must be in it, and `AccountDeletionCoverageTest` reads
`tableCreationQueries.sql` and fails the build when one isn't. (`focus_sessions` and
`weekly_reviews` were both missing, so a deleted account left those rows behind.) It brackets the
purge with `SET FOREIGN_KEY_CHECKS=0/1` in a **try/finally** — that is a session variable on a
pooled connection, so a throw in between handed the next request a connection with integrity
checks off.

### Endpoint index

| Base | Routes |
|---|---|
| `/api/auth` | `signup`, `login`, `verify`, `resend-verification`, `forgot-password`, `reset-password`, `logout`, `me`, `sessions`, `sessions/{id}` DELETE, `change-password`, `delete-account`, `whatsapp` PUT |
| `/api/users` | `search`, `browse` (public-ish lookup for Circle) |
| `/api/money` | GET, PUT, `advice` POST, `receipt-scan` POST (photo → line items, saves nothing), `tx` POST (ledger writes → balances), `accounts` POST, `accounts/{id}` PUT/DELETE, `day-summary?date=` GET |
| `/api/whatsapp/webhook` | GET (Meta handshake), POST (anonymous, HMAC-signed — the "Mark as paid" tap → `MoneyService.markSubscriptionPaid`) |
| `/api/habits` | CRUD, `{id}/checkin`, `{id}/toggle`, `freeze`, `{id}/protect`, `{id}/unprotect` |
| `/api/tasks` | CRUD (PUT takes `paused`: an on-hold task is never escalated to High when overdue; Home's task row has the pause/resume button), `{id}/toggle`, `{id}/history`, `finished?days=` (ticked off lately, swept ones included: priority, createdAt, doneAt, for Insights). A due date moved 12h+ later bumps `pushCount` |
| `/api/goals` | CRUD, `{id}/toggle`, `{id}/progress`, `{id}/actions` (+ per-action PUT/DELETE) |
| `/api/family` | `members` CRUD + `{id}/profile`, `search`, `members/link`, `invites` (+accept/decline), `leave`, `grocery-scan`, `meal-plan` GET/POST, `pantry` (+`/scan`, `{id}` PUT/DELETE), `shopping` (+`/generate`, `{id}/toggle`, `{id}` DELETE) |
| `/api/food` | `search`, `entries` POST/DELETE, `photo-estimate`, `photo-estimate-multi`, `photo-history` GET/POST, `week` GET (7 days of kcal + estimated protein/carbs/fat/fiber, targets, averages, levels, top dishes per nutrient; fills missing `*_g` in one AI batch), `diet-check[?date=]` POST (AI; a day of the last 7, or the week; water included) |
| `/api/water` | `entries` POST/DELETE, `week` GET (7 days of ml for the Food summary), `times?days=` GET (every entry's `loggedAt`, for Insights and the water nudge), `goal` PUT (writes `users.daily_water_goal_ml`, the Settings field; a pre-move `water_goals` row is read first until either screen edits the goal) |
| `/api/daily-logs` | GET, `sleep`, `mood`, `snapshot` — **there is no PUT.** The client used to call one from three places (`persistWellness`, a boot "force-sync", a 5-minute timer); all three 405'd forever and logged `CRITICAL: failed to reach database`. Sleep and mood are saved by their own POSTs as you enter them. |
| `/api/score` | `today`, `today/snapshot`, `day?date=` (a finished day's parts, via `ScoreService.on`) |
| `/api/focus` | `stats`, `sessions` POST, `sessions?days=` GET (focus-mode only: durationSec, completedAt) |
| `/api/weekly-review` | GET/POST (wins + one focus, keyed by ISO week start) |
| `/api/quotes` | `today` |
| `/api/mentor` | `chat`, `chat/messages` POST/DELETE, `threads` GET/POST, `threads/{id}/messages` GET/POST, `threads/{id}` DELETE |
| `/api/mentorship` | `requests` POST, `requests/{id}/accept|reject|revoke`, `requests/incoming`, `requests/outgoing`, `connections/{partnerId}/status` |
| `/api/circles` | `mine`, `{id}/join`, `{id}/leave`, `{id}/posts` GET/POST, `{id}/challenges` GET/POST |
| `/api/notifications` | list, `unread-count`, `{id}/read`, `read-all`, `{id}` DELETE, **`custom-sound` GET/PUT/DELETE** (the user's own notification sound; the API speaks the data URL the client stores, the row holds raw bytes in `audio` + `content_type` and a pre-bytes row converts on first GET — one row per account, 300 kB ceiling enforced both sides, GET answers **204** when there is none because that is the ordinary state, not an error) |
| `/api/push` | `public-key`, `subscribe`, `unsubscribe`, `test` |
| `/api/reminders` | list, POST, **PATCH `{id}?scope=&date=`** (scoped edit — `this` skips the day and leaves a one-off in its place, `future` cuts the series and starts a new one, `all` edits the row), DELETE `{id}?scope=&date=`, `occurrences`, `day/{date}` |
| `/api/notes` | list (photos cut out, `cover` + `photoCount` + `bodyTrimmed` instead), `{id}` GET (whole note), POST, `{id}` PATCH, `{id}` DELETE, `draft` GET/PUT/DELETE (composer autosave, `note_drafts`) |
| `/api/quick-add` | POST — free text ("spent 200 on lunch, slept 7h, drank 500ml") → writes across features. Parses **task, habit, water, sleep, mood, expense** and nothing else: the old example here was "ran 3km", which there is no tracker for. |

### Notable services (the ones without their own doc)

- `user/SessionService` — mints/validates opaque tokens; stores
  `HMAC-SHA256(token, serverSecret)` so a DB dump alone can't validate a stolen token. 60-day life.
- **Every `@RequestBody` takes `@Valid`, and every field a bound.** `mentor` was the one package
  without either: an over-long thread title reached the insert and came back a 500 reading
  "Something went wrong". A bound belongs at the boundary, not at the column.
- `mentor/OpenAIClient` — minimal chat-completions client on the JDK `HttpClient`, no SDK.
  Per-user caps live in `common/AiRateLimitInterceptor`, and the client charges a call budget of its
  own and refuses once it is spent — both apply to every AI route (mentor, photo estimate, meal plan,
  receipt scan, purchase advice).
- **What the mentor is given** (`MentorService.buildContext`): the user's **tasks and habits only**.
  Not money, not food, not family. Say that plainly anywhere the mentor is described — "sees your
  trackers" reads as all of them.
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
  `ReminderDeliveryScheduler` polls and delivers near the user's local time — the in-app
  bell always (it needs no setup, and `NotificationService.publish` pushes it down the websocket so
  an open app shows it immediately), plus WhatsApp + push for the users configured for them, dispatching a tick's batch across a 16-thread pool; The delivery window is a zone-resolved `Instant`, so a reminder inside a spring-forward gap fires late rather than never. `ReminderDispatchLog` prevents
  double sends: the day's row is claimed ('sending') before anything goes out, a retry reuses a 'failed' row, and a 'sending' row a crash left counts as delivered (`habit/HabitReminderDeliveryScheduler` does the same, over the same three channels: bell, WhatsApp, push); `WhatsAppService` = Meta WhatsApp Cloud API. Scheduled sends need
  `WHATSAPP_TEMPLATE` (an approved template, body = one `{{1}}`) — free-form text is only
  deliverable inside a user's 24h window.
- `digest/DigestScheduler` + `DigestService` — progress digest near each user's preferred
  local hour, honouring their timezone. Reports the **last day that finished**, never the live
  score: a digest fires in the morning, by which point `TaskMidnightSweep` has cleared yesterday's
  ticked tasks and the habit check-ins belong to a new log date, so a live reading is a truthful 0
  about a day nobody has lived yet. `ScoreService.on(user, day)` / `.between(...)` rebuild a past
  day from `task_completion_history` plus the check-in log.
- `push/PushService` — Web Push (VAPID); inert until keys are set.
- `mail/MailService` — transactional email; **no-ops with a log line when
  `spring.mail.username` is empty** (this is why local OTP flows need `./run.sh`).
- `quickadd/QuickAddService` — free text → structured writes across features.
- `note/NoteService` — quick notes: soft delete, `""` clears a colour or cover where `null`
  means "leave it alone", 2 MB body cap (photos are data URLs in the body). The list, POST and
  PATCH answer with the body's photos **cut out** (`bodyTrimmed: true`) and a client-made `cover`
  thumbnail in their place; only `GET {id}` returns the whole note, and the editor must open from
  that or a save would write the photo-less copy back. The body is **HTML** from the editor on the Notes screen and is
  sanitised where it is rendered (`sanitize()` in `scripts/notes.js`), never in Java.
  `NoteServiceTest` covers the null-vs-empty branch and the trimmed list.
- `notification/NotificationService` + `WebSocketConfig` — realtime channel
  (STOMP/SockJS; the frontend uses `@stomp/stompjs`). `clearAll` **deletes** rather than stamping
  readAt — the bell is nudges with a lifetime, not a ledger — and `sweepOldNotifications`
  (nightly) drops read rows after 30 days and anything after 90.
- `mentorship/MentorshipService`, `circle/CircleService` — invites and circles;
  `CircleChallenge` is a time-boxed habit challenge, members ranked by check-ins completed.
  The two mentorship directions are INDEPENDENT — A can mentor B while B mentors A — so
  `relationship()` returns `mentorLink` / `menteeLink` (none|pending|active) per side and `revoke()`
  cancels only the side it was handed. The single `state()` word is a legacy summary; UI uses the
  two links. Covered by `MentorshipRelationshipTest`.
- `config/DataSeeder` — demo user + starter data, keyed on `growthbuddy.demo-user-id`.
- `task/TaskMidnightSweep` — soft-deletes each user's **done** tasks at their own local
  midnight (hourly cron, hour-0-in-their-zone, same shape as `DigestScheduler`). Tasks have no day
  of their own, so yesterday's ticks used to sit in today's list and still count towards today's
  score (`ScoreService` counts live rows). Unfinished tasks carry forward — they're still to do.
  `task_history` is left alone, so the report and the "done 3×" count survive.
- `config/DataCleanupJob` — nightly purge of append-only tables never read again (hosting
  quota; includes `food_diet_checks` past 8 days and `food_photo_logs` past a user's newest 12), plus abandoned signups: `signup()` writes the users row BEFORE the OTP is checked, so a
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
  `reminder_dispatch_log` under a name-derived UUID). It reads only the documents of users the database picks on
  `money_state.sub_due_days` (bit d-1 per due day, derived in `MoneyState.touch()`; NULL rows from before the
  column are included and filled in); `WhatsAppWebhookController` takes the tap.

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
| `.github/workflows/ci.yml` | CI. `.githooks/pre-commit` = local hook |
| `public/push-handlers.js` | service-worker `push` / `notificationclick` handlers, merged into the generated SW |
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
