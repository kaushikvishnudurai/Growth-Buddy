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
  client-side. The server holds what must sync. Money is one JSON blob per user.
- **Mobile:** `../Growth-Buddy-Mobile` is a Capacitor wrapper around this repo's build.
- **Loading:** the boot chunk is Home only. Six screens (family, circle, timer, goals, report,
  mentor) and the realtime stack (sockjs + stompjs) are dynamic imports, kept out of the service
  worker precache via `globIgnores` and cached on first use by a CacheFirst rule. Fonts are
  latin-subset only. Boot chunk 449 kB -> 298 kB (gzip 129 -> 85); precache 992 kB -> 659 kB.
  Boot fetches run in two waves (`loadData` -> `loadSecondaryData`): five calls gate first paint,
  eight follow. Throttled Home paint 1448 ms -> 900 ms.

---

## Frontend — `scripts/` (small modules; the big ones are in `docs/`)

| File | Lines | What |
|---|---|---|
| `insights.js` | 174 | Pure correlation engine. Median-splits each predictor (sleep, mood, energy, stress, growth score, water) and reports where the outcome differs. `MIN_DAYS=4`, `MIN_EFFECT=0.12`, `MAX_INSIGHTS=3`. Exports `compare`, `signals`, `buildInsights`. |
| `insights.test.mjs` | 70 | Plain-assert check for the above. `node scripts/insights.test.mjs`. |
| `cache-storage.js` | 214 | The storage layer. In-memory map (sync source of truth) + cookies (tiny boot-critical allowlist only, ~3.5 kB cap) + Cache API (`gb-store-v2`, hydrated async in `init()`). Migrates old localStorage once. Keys prefixed `gb.`. Exports `CacheStorage`. |
| `icons.js` | 224 | The Lucide subset actually used (82 icons). Load-bearing for bundle size — the full set is ~600 kB. **Add new icon names here or they won't render.** |
| `achievements.js` | 269 | Badge gallery derived from data already tracked (XP/level, freeze-protected streaks, goals, wellness/trends). `XP_PER_LEVEL = 500`. Exports `ScreenAchievements`, `computeAchievements`. |
| `mentor.js` | 256 | Buddy chat screen. `renderRich()` = tiny markdown (`**bold**`, `*italic*`, newlines). Exports `ScreenMentor`. |
| `celebrate.js` | 119 | One-off unlock celebration: badge pop + hand-rolled confetti, queued one at a time, respects `prefers-reduced-motion`. |
| `a11y.js` | 111 | Global modal a11y. Every modal is `.gb-modal-overlay > .gb-modal[role=dialog]`; a MutationObserver on `<body>` adds Escape-to-close, Tab trapping and focus in/out **centrally**, so individual modals need no a11y code. `initA11y()`. |
| `push.js` | 98 | Web Push client: `pushSupported`, `pushPermission`, `pushSubscribed`, `enablePush(api)`, `disablePush(api)`. Inert when unsupported or VAPID keys are missing. |
| `toast.js` | 22 | Late-bound toast registry. Breaks the app.js ↔ screens import cycle: app.js calls `registerToast(impl)` at boot, screens `import { toast }`. |

---

## Backend — `backend/src/main/java/com/growthbuddy/`

Per feature: `XController` (routes only) → `XService` (logic, `@Transactional`) → entities + `XDtos`
(records) + repositories. Entry point: `GrowthBuddyApplication.java`.

### `common/` — cross-cutting
`CurrentUserInterceptor` validates the bearer token and puts the user id in `CurrentUser`
(ThreadLocal). `RateLimiter` is an in-memory sliding window, no deps, per-bucket synchronized;
`RateLimitInterceptor` = per-IP on auth routes, `AiRateLimitInterceptor` = per-user on OpenAI-backed
routes (mentor, quick-add, money, food photos). `ApiException` (status + message),
`GlobalExceptionHandler`, `ClientIp` (must not blindly trust forwarded headers), `WebConfig`
(interceptors + CORS), `IndexController` (serves `index.html`).

### Endpoint index

| Base | Routes |
|---|---|
| `/api/auth` | `signup`, `login`, `verify`, `resend-verification`, `forgot-password`, `reset-password`, `logout`, `me`, `sessions`, `sessions/{id}` DELETE, `change-password`, `delete-account`, `whatsapp` PUT |
| `/api/users` | `search`, `browse` (public-ish lookup for Circle) |
| `/api/money` | GET, PUT, `advice` POST |
| `/api/habits` | CRUD, `{id}/checkin`, `{id}/toggle`, `freeze`, `{id}/protect`, `{id}/unprotect` |
| `/api/tasks` | CRUD, `{id}/toggle`, `{id}/history` |
| `/api/goals` | CRUD, `{id}/toggle`, `{id}/progress`, `{id}/actions` (+ per-action PUT/DELETE) |
| `/api/family` | `members` CRUD + `{id}/profile`, `search`, `members/link`, `invites` (+accept/decline), `leave`, `grocery-scan`, `meal-plan` GET/POST, `pantry` (+`/scan`, `{id}` PUT/DELETE), `shopping` (+`/generate`, `{id}/toggle`, `{id}` DELETE) |
| `/api/food` | `search`, `entries` POST/DELETE, `photo-estimate`, `photo-estimate-multi`, `photo-history` GET/POST |
| `/api/water` | `entries` POST/DELETE, `goal` PUT |
| `/api/daily-logs` | GET, `sleep`, `mood`, `snapshot` — **there is no PUT.** The client used to call one from three places (`persistWellness`, a boot "force-sync", a 5-minute timer); all three 405'd forever and logged `CRITICAL: failed to reach database`. Sleep and mood are saved by their own POSTs as you enter them. |
| `/api/score` | `today`, `today/snapshot` |
| `/api/focus` | `stats`, `sessions` |
| `/api/weekly-review` | GET/POST (wins + one focus, keyed by ISO week start) |
| `/api/quotes` | `today` |
| `/api/mentor` | `chat`, `chat/messages` POST/DELETE, `threads` GET/POST, `threads/{id}/messages` GET/POST, `threads/{id}` DELETE |
| `/api/mentorship` | `requests` POST, `requests/{id}/accept|reject|revoke`, `requests/incoming`, `requests/outgoing`, `connections/{partnerId}/status` |
| `/api/circles` | `mine`, `{id}/join`, `{id}/leave`, `{id}/posts` GET/POST, `{id}/challenges` GET/POST |
| `/api/notifications` | list, `unread-count`, `{id}/read`, `read-all`, `{id}` DELETE |
| `/api/push` | `public-key`, `subscribe`, `unsubscribe`, `test` |
| `/api/reminders` | CRUD, `occurrences`, `day/{date}` |
| `/api/quick-add` | POST — free text ("ran 3km, spent 200 on lunch, slept 7h") → writes across features |

### Notable services (the ones without their own doc)

- `user/SessionService` (204) — mints/validates opaque tokens; stores
  `HMAC-SHA256(token, serverSecret)` so a DB dump alone can't validate a stolen token. 60-day life.
- `mentor/OpenAIClient` (188) — minimal Chat Completions client on the JDK `HttpClient`, no SDK.
  Stateless: each call sends the whole rolling context. `isConfigured()` gates every AI feature.
- `score/ScoreService` (78) — today's score = average completion rate across enabled features.
- `reminder/ReminderService` (143) — recurrence expansion + scoped deletes; **mirrors the client-side
  expansion in `scripts/calendar.js` — keep both in step.**
  `ReminderDeliveryScheduler` (196) polls and sends WhatsApp + push near the user's local
  time, dispatching a tick's batch across a 16-thread pool; `ReminderDispatchLog` prevents
  double sends; `WhatsAppService` (123) = Meta WhatsApp Cloud API. Scheduled sends need
  `WHATSAPP_TEMPLATE` (an approved template, body = one `{{1}}`) — free-form text is only
  deliverable inside a user's 24h window.
- `digest/DigestScheduler` (75) + `DigestService` (88) — progress digest near each user's preferred
  local hour, honouring their timezone; content derived from the live score.
- `push/PushService` (135) — Web Push (VAPID); inert until keys are set.
- `mail/MailService` (93) — transactional email; **no-ops with a log line when
  `spring.mail.username` is empty** (this is why local OTP flows need `./run.sh`).
- `quickadd/QuickAddService` (142) — free text → structured writes across features.
- `notification/NotificationService` (99) + `WebSocketConfig` (123) — realtime channel
  (STOMP/SockJS; the frontend uses `@stomp/stompjs`).
- `mentorship/MentorshipService` (191), `circle/CircleService` (196) — invites and circles;
  `CircleChallenge` is a time-boxed habit challenge, members ranked by check-ins completed.
- `config/DataSeeder` (152) — demo user + starter data, keyed on `growthbuddy.demo-user-id`.
- `config/DataCleanupJob` (35) — nightly purge of append-only tables never read again (hosting quota).
- `user/ProgressService` (47), `wellness/WellnessService` (99), `water/WaterService` (87),
  `task/TaskService` (132), `goal/GoalService` (151), `focus/FocusService` (81),
  `money/MoneyService` (97 — 512 kB blob cap + the purchase advisor).

### Entities worth knowing
`MoneyState` (one JSON doc per user, deliberately not normalized — see its `ponytail:` note),
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
| `styles/premium.css` | the **premium skin** (621). Every rule scoped to `html[data-premium='on']` and loaded last, so it overrides tokens and is fully inert when off. Lit canvas on `.gb-app`, glass cards, floating pill nav (`<1024px` only — it's a sidebar above that), circular icon buttons, pill buttons, size-specific tracking. §9 is the signature: the **live seedling** in the header — the brand mark itself, nodding when you actually finish a task or habit (`buddyReact()` from `toggleTask`/`toggleHabit`) and shaking its head on errors. Shares its refusal rhythm with `@keyframes gb-shake`, the Face-ID-style "no" any refusing surface does (`shakeRefusal()` — sign-in card, modal sheets). §10 gives toasts an entrance they never had (they used to snap in). Toggle: Settings → Display → Look (the header gem button is gone — a skin switch isn't a daily action). |
| `vite.config.js` | dev server :5173, proxies `/api` + `/ws` to :8080 **rewriting the Origin header** (the backend's CORS allow-list excludes :5173); `vite-plugin-pwa` for manifest, offline precache, NetworkFirst on API GETs, and it pulls in `public/push-handlers.js`. Target override: `API_PROXY_TARGET`. |
| `run.sh` | **start the backend with this** — loads `.env`, frees port 8080 |
| `DEPLOYING.md` | how to ship it. The two variables that fail *silently* are `SPRING_PROFILES_ACTIVE=prod` and `VITE_API_BASE` — read it before any deploy |
| `backend/Dockerfile` | 3-stage build (Vite → Maven → JRE). Serves the API **and** `dist/` from one origin, which is why the bundle can use relative paths and CORS drops out of the deployment. Bakes `SPRING_PROFILES_ACTIVE=prod` in so a deploy can't omit it |
| `backend/src/main/resources/application-prod.yml` | prod overrides. Every value is `${VAR}` with **no default**, so a missing one fails startup instead of booting on a dev fallback. Pins `ddl-auto: validate` |
| `.env.example` | required env: DB, mail, OpenAI, VAPID, WhatsApp |
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
3. **`./run.sh`**, not bare Maven — otherwise `.env` is unloaded and OTP email silently no-ops.
3b. **Never call `LocalDate.now()` for anything a user sees dated.** "Today" belongs to the
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
7. `ddl-auto: update` in dev hides missing DDL. New entity → also add the table to
   `tableCreationQueries.sql`.
8. `grep 'ponytail:'` for deliberate simplifications and their stated upgrade path.
