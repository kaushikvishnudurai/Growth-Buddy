# Project map

Snapshot of build 88 (`main` @ 367ed2a, 2026-10-11). This file is the one-page overview and the
feature scorecard. File-by-file detail and the full endpoint list live in
[CODEMAP.md](../CODEMAP.md); per-module docs are listed in [CLAUDE.md](../CLAUDE.md). Neither is
repeated here.

## Product

**Growth Buddy**: a personal "life OS" for one person and their family. Habits, tasks, goals,
reminders, focus timer, food and water, sleep and mood, money, notes, a family meal planner, a
social accountability circle, mentorship, and an AI companion ("Buddy") that reads all of it.
Built for an Indian audience first (INR, UPI, Account Aggregator bank feed, WhatsApp delivery).

## Stack and how the pieces load

| Layer | What |
|---|---|
| Web | Vanilla JS ES modules, no framework. `h()` hyperscript in `gb-kit.js`. Vite 5 build, `vite-plugin-pwa` (Workbox precache, NetworkFirst for API GETs). ~70k lines in `scripts/` + `styles/`. |
| State | One module-scope `state` in `scripts/app.js`; `render()` rebuilds the screen. Money, Family, Circle, Mentor repaint their own subtrees. |
| Routing | Hash routes (`#home`, `#money`, ...) mapped by `SCREENS` in `app.js`. Lazy screens are dynamic imports. |
| Storage | `cache-storage.js`: in-memory map + small cookie allowlist + Cache API. Offline writes go through `outbox.js` with idempotency keys. No localStorage. |
| Backend | Spring Boot 3 + MySQL (TiDB in prod, `ddl-auto: none`). Package per feature. Opaque bearer tokens. |
| Realtime | STOMP over SockJS (`/ws`) for the bell, family and mentorship events. |
| AI | Claude via a Cloudflare AI Gateway (OpenAI wire format). Every AI route has a non-AI fallback. |
| Delivery | In-app bell, Web Push (VAPID), WhatsApp Cloud API, on-device alarms in the app. |
| App | `../Growth-Buddy-Mobile`: Capacitor 6 wrapper. `npm run sync` there copies this repo's `dist/` into `www/`. Same JS; `native.js` holds the Capacitor-only branches (no service worker in the app). |
| Hosting | Render (one Docker image serves API + `dist/`), TiDB Serverless. |

## Screens

home, tasks (Home), habits, goals, calendar/reminders, timer, food, water, sleep/mood (check-ins),
money, notes, family, circle, mentor (Buddy chat), mentorship, report (+ insights, achievements),
settings, auth (sign-in, sign-up, OTP, reset, 2FA, deletion grace).

## Health at the start of this pass

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `scripts/*.test.mjs` (28 files) | all pass |
| `npm run build` + `bundle-budget.mjs` | pass; boot chunk 497,595 B (95.7% of budget), precache 96.8% |
| `./mvnw test` | 675 tests, 0 failures |
| Open items in `bugs.txt` | QA-02 (partly), QA-04, QA-06 (test-only), QA-09, QA-10 (by design), QA-11 (suspected) |

## Feature scorecard

"Complete" means: works end to end, has empty/error/offline states, and has a check. The evidence
column says what the estimate rests on. The brief assumed 70-80% everywhere; the code says most
features are further along than that, and a few have real gaps.

| Feature | % | Evidence | What is actually missing |
|---|---|---|---|
| Auth, sessions, 2FA, account deletion | 95 | `AuthService` doc, TOTP RFC vectors, `AccountDeletionCoverageTest` | Nothing functional. |
| Habits (build + quit, streaks, freezes) | 95 | `HabitService` doc, `habit-stats.test.mjs` | Daily targets live in the habit's name (`nudges.js` ponytail) |
| Tasks | 95 | `home-order.test.mjs`, midnight sweep | none found |
| Goals (milestones, linked tasks/habits) | 90 | `goal-*.test.mjs` | none found |
| Calendar + reminders (recurrence, snooze, done, ICS) | 95 | shared `recurrence.cases.json`, `DstWindowTest` | Time blocks can't cross midnight (ponytail) |
| Focus timer | 95 | `timer.test.mjs` | none found |
| Food (photo AI, barcode, manual, week) | 85 | `FoodService` doc, `nutrition.test.mjs` | QA-04: day verdict renders off-screen on phones |
| Water | 95 | `nutrition.test.mjs` | QA-10 by design |
| Sleep / mood check-ins | 90 | `nudges.test.mjs` | QA-06 rest day under mismatched zones |
| Money (ledger, budgets, bills, loans, receipts, bank feed) | 85 | 4 money test files, merge + ledger | Bank feed never run against a live Setu sandbox |
| Notes (rich text, labels, archive, trash) | 95 | `notes-core.test.mjs`, `NoteServiceTest` | Uses deprecated `execCommand` (ponytail) |
| Family + meal planner | 85 | `FamilyService` doc, audit round | Dishes not in the nutrition table contribute nothing |
| Circle + challenges | 90 | `circle-core.test.mjs`, `CircleKudosAndMetricsTest` | none found |
| Mentorship | 90 | `MentorshipRelationshipTest`, chat tests | none found |
| Buddy (AI chat, threads, actions) | 85 | `mentor.test.mjs`, `MentorActionsTest` | Local AI gateway token is rejected (401), so only fallbacks are verifiable locally |
| Quick add (natural language) | 85 | `QuickAddFallback` | Fallback is English regexes |
| Report, insights, achievements | 90 | `insights/review/achievements` tests | none found |
| Notifications (bell, push, WhatsApp) | 90 | `push.test.mjs`, retention tests | Nothing publishes the `money` category yet |
| i18n | 15 | `i18n.js` ponytail | Only `en` ships; most strings not through `t()`; no language picker |
| PWA / offline | 85 | Workbox config, outbox tests | Manifest `orientation: portrait` while the app now supports landscape (round 12) |
| SEO | 30 | `index.html` | No Open Graph, no canonical, no robots.txt or sitemap. App behind a login, so only the landing/sign-in page matters |
| Landscape layout | 60 | QA-09 | Content gets half the screen in landscape |

Two notes on the brief's assumptions:

- **No placeholders found.** `grep -rn "coming soon\|TODO\|FIXME\|lorem" scripts styles` turns up
  nothing in shipped code. The 80 `ponytail:` markers are deliberate, documented ceilings, not
  unfinished work.
- **Another session is building the low-input layer right now** on `feat/life-plan` (Quick add
  bar on Home, a "one thing today" card, goal-first onboarding, prefills, a camera shortcut,
  plus `research/low-input-high-output.md`). This pass works on `feat/overhaul` in its own
  worktree and stays off those surfaces to avoid duplicate work and merge conflicts.
