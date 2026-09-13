# Growth Buddy

Vanilla-JS + Vite frontend, Spring Boot + MySQL backend, Capacitor mobile wrapper in
`../Growth-Buddy-Mobile`.

## Read the docs before the code

Docs mirror the source tree: **the doc for `X` is `docs/X.md`.** They exist only for files big
enough that reading the code costs real tokens (≥300 lines). Everything else is cheaper to just
open — don't go looking for a doc that isn't in this list.

| Need to work on | Read first | Instead of |
|---|---|---|
| app shell, state, routing, any API call, settings, auth views | `docs/scripts/app.js.md` | 6799 lines |
| Money Buddy | `docs/scripts/money.js.md` | 5001 |
| Home screen / widgets / mini calendar | `docs/scripts/dashboard.js.md` | 1712 |
| Family tab, meal planner | `docs/scripts/family.js.md` | 2032 |
| Growth Circle, mentorship | `docs/scripts/circle.js.md` | 1210 |
| Calendar, reminders, recurrence | `docs/scripts/calendar.js.md` | 1022 |
| Focus timer, ambient sound | `docs/scripts/timer.js.md` | 733 |
| UI primitives (`h`, `Card`, `Icon`, nav) | `docs/scripts/gb-kit.js.md` | 701 |
| Goals | `docs/scripts/goals.js.md` | 690 |
| Report screen, charts | `docs/scripts/report.js.md` | 462 |
| any styling | `docs/styles/app.css.md` | 7190 |
| Money styling | `docs/styles/money.css.md` | 1615 |
| colors, type, theming | `docs/styles/tokens.css.md` | 359 |
| the Home mini calendar's CSS | `docs/styles/mini-calendar.css.md` | 375 |
| family/meal-plan backend | `docs/backend/FamilyService.java.md` | 1492 |
| auth, sessions, user settings | `docs/backend/AuthService.java.md` | 754 |
| habits, streaks, freeze tokens | `docs/backend/HabitService.java.md` | 546 |
| food logging, photo estimates | `docs/backend/FoodService.java.md` | 481 |
| the DB schema | `docs/tableCreationQueries.sql.md` | 801 |

**[CODEMAP.md](CODEMAP.md)** covers everything else in one pass: every small frontend module, every
backend package with its full endpoint list, config files, and the repo-wide traps. Read it when you
don't yet know *which* file you need.

Docs can drift. Locating something → trust them. **Changing something → read the real code**, and
fix the doc line if it was wrong. A doc you touch and don't update is worse than no doc.

## Working here

- Backend: **`./run.sh`** (loads `.env`, frees port 8080). Bare `mvnw spring-boot:run` breaks OTP email.
- Frontend: `npm run dev` (:5173, proxies `/api` + `/ws` to :8080). `npm run lint` before committing.
- Checks that exist: `node scripts/insights.test.mjs`, `node scripts/recurrence.test.mjs`,
  `node scripts/money-merge.test.mjs`,
  `money.js` `_demo()` on Vite DEV, `./mvnw test` (123 tests — including the three that guard
  invariants rather than code: `SchemaCoverageTest`, `AccountDeletionCoverageTest`,
  `SharedRecurrenceCasesTest`), and `scripts/ui-audit.mjs` — walks every screen at
  phone + desktop widths, screenshots each, and fails on horizontal overflow or a console
  error. Needs `npm run dev` plus a Chrome started with `--remote-debugging-port=9222`
  (`puppeteer.launch()` dies here with an empty stderr; attaching works).
- After web changes, the Capacitor app needs `npm run sync` in `../Growth-Buddy-Mobile`.
- **Bump `BUILD` in `vite.config.js` by one before every push.** It's what the console prints
  at boot (`window.GB_BUILD`), and the only way to tell a live build from a cached one on
  someone's phone. Deriving it from git was tried and reverted: the prod image has no `.git`
  and no git binary, so every build reported 0.
- `grep 'ponytail:'` for deliberate simplifications and their upgrade paths.
- New icon → add it to `scripts/icons.js`. New screen → `SCREENS` in `app.js` (+ `NAV_CATALOG` in
  `gb-kit.js` for a nav slot). New entity → add the table to `tableCreationQueries.sql` too;
  `ddl-auto: update` hides the omission in dev and breaks prod, and `SchemaCoverageTest` now
  fails the build if you forget. A table that holds a `user_id` also belongs in
  `AuthService.USER_OWNED_TABLES`, or a deleted account leaves its rows behind —
  `AccountDeletionCoverageTest` checks that one.
- **Recurrence lives twice** (`scripts/recurrence.js` + `ReminderService.occursOn`, because the
  WhatsApp scheduler can't import JS). Add cases to **`scripts/recurrence.cases.json`** — both
  test suites read it, so neither side can drift alone.
