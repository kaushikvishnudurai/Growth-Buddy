# Project map (overhaul 2026-10-11, build 92)

This map is the overhaul's starting index. It does not repeat **CODEMAP.md** (every small module,
every endpoint, repo traps) or the per-file docs listed in **CLAUDE.md**; it points at them.

## Shape

| Layer | What | Where to read |
|---|---|---|
| Shell, state, routing, API client, auth, settings | One module-scope `state`, `render()` rebuilds the screen; hash routes (`#home`, `#money`, `#/circle?join=`) parsed by `screenFromHash()`, `hashchange` listener, `setScreen()` | `scripts/app.js` (16k lines) → `docs/scripts/app.js.md` |
| Screens (registry `SCREENS` in app.js) | home, report, achievements, health, focus, habits, food, summary, calendar, mentor (Buddy chat), circle, family, money, notes, goals (+ settings, auth views) | per-screen docs in `docs/scripts/` |
| UI kit | `h()` hyperscript, `Card`, `Icon` (Lucide subset in `icons.js`), nav (`NAV_CATALOG`) | `scripts/gb-kit.js` → `docs/scripts/gb-kit.js.md` |
| Pure logic (tested with plain-assert `*.test.mjs`) | recurrence, outbox, money-core/ledger/merge, insights, review, habit-stats, nudges, day-plan, nutrition, notes-core, timer-math, i18n, health-logic | CODEMAP "Frontend" table |
| Styles | tokens → app.css (15.8k lines) → module CSS → premium.css skin | `docs/styles/*.md` |
| Storage | No localStorage: in-memory map + cookie allowlist (`gb.token`, `gb.session`, theme…) + Cache API `gb-store-v2` | `scripts/cache-storage.js` |
| Offline | Workbox precache (vite-plugin-pwa), NetworkFirst API GETs, outbox replay with Idempotency-Key | `vite.config.js`, `scripts/outbox.js` |
| Realtime | STOMP over SockJS (`/ws`), notification + family + mentorship frames | app.js `connectWebSocket` |
| Backend | Spring Boot, package per feature (26 packages), MySQL locally, TiDB in prod (`ddl-auto: none`) | CODEMAP "Backend" + endpoint index |
| AI | Claude via Cloudflare AI Gateway (OpenAI wire format), every feature has a no-AI fallback | `mentor/OpenAIClient`, CODEMAP |
| Build | `vite build` → `dist/`; `BUILD` int in `vite.config.js`; bundle budget `scripts/bundle-budget.mjs`; Docker image serves API + `dist/` | `DEPLOYING.md` |
| App wrapper | Capacitor 8 in `../Growth-Buddy-Mobile`: `npm run sync` builds this repo and copies `dist/` → `www/`; `androidScheme: https` (origin `https://localhost`), CapacitorHttp on (no CORS), plugins: app, browser, device, local-notifications, splash-screen, status-bar; native helpers no-op on web (`scripts/native.js`) | `../Growth-Buddy-Mobile/MOBILE.md` |
| CI | lint, every `scripts/*.test.mjs`, build + bundle budget, `./mvnw test` (205), npm audit, gitleaks, CodeQL | `.github/workflows/ci.yml` |

## Features and completion

Provisional figures from code signals (tests, docs, `ponytail:` deferrals, `bugs.txt` history).
The Step 2 audits replace each with a measured figure and evidence in `docs/audit/`.

| Feature | Provisional % | Evidence today |
|---|---|---|
| Auth (signup/OTP, login, 2FA, sessions, delete/cancel) | 90 | Backend tests; **concurrent signups deadlock (L-001)** |
| Home / dashboard (score ring, widgets, mini calendar, Plan my day) | 85 | home-order + day-plan tests; recent revert of the bead hero |
| Habits (build/quit, streaks, freezes, health links) | 85 | habit-stats tests, HabitService tests |
| Tasks | 85 | backend tests, goal-tasks test |
| Calendar + reminders (recurrence, snooze, .ics) | 85 | recurrence cases shared with Java, DstWindowTest |
| Money (ledger, budgets, bills, receipts, bank feed) | 80 | 5 money test files; bank feed "unconfirmed against a live sandbox" |
| Notes (rich text, photos, labels, trash) | 85 | notes-core tests, NoteServiceTest |
| Goals (milestones, linked tasks/habits, progress log) | 80 | goal-milestones / goal-tasks tests |
| Report + Insights | 80 | insights + review tests |
| Focus timer | 85 | timer tests |
| Food + water | 75 | nutrition tests; AI estimates fall back locally (gateway 401) |
| Health v2 | 75 | health-logic tests; shipped in build 91 |
| Family + meal planner | 75 | FamilyService doc; AI-heavy |
| Growth Circle + mentorship | 75 | circle-core tests, mentorship tests |
| Buddy (AI chat) + Quick add | 70 | depends on AI gateway; fallback regexes |
| i18n | 30 | `i18n.js`: two screens converted, no language picker |
| Mobile app parity | 70 | native.js; iOS not buildable on this machine |

## Local stack used by the overhaul

Scratch DB `gb_ov1011`, backend :8591 (mail printed to the log, WhatsApp off, `trust-proxy` on so the
seeder can vary its forwarded IP), Vite :5591 proxied to it, headless Chrome CDP :9591. See
`e2e/README.md`.
