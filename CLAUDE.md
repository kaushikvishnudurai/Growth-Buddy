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
| Notes, the rich-text editor | `docs/scripts/notes.js.md` | 687 |
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
  `node scripts/money-merge.test.mjs`, `node scripts/push.test.mjs`,
  **`node scripts/tokens.test.mjs`** (every bare `var(--x)` in `styles/` resolves — two dead
  tokens had been silently voiding whole declarations, one of them the modal's transition),
  `node scripts/gen-chimes.mjs` (regenerates, and asserts none of them is silent or clipping),
  `money.js` and `chime.js` `_demo()` on Vite DEV, `./mvnw test` (141 tests — including the three that guard
  invariants rather than code: `SchemaCoverageTest`, `AccountDeletionCoverageTest`,
  `SharedRecurrenceCasesTest`), and `scripts/ui-audit.mjs` — walks every screen at
  phone + desktop widths, screenshots each, then **opens one dialog per module and both header
  panels** and checks the shared overlay contract (animates in, carries a shadow, can scroll,
  traps focus, closes on Escape, panels aligned to the bell). Fails on horizontal overflow, a
  console error, or any HTTP 4xx/5xx — and names the request. Needs `npm run dev`, a **seeded** verified account (an empty one has no note or
  reminder to open a dialog from), and a Chrome started with `--remote-debugging-port=9222`
  (`puppeteer.launch()` dies here with an empty stderr; attaching works).
- After web changes, the Capacitor app needs `npm run sync` in `../Growth-Buddy-Mobile`.
- **Bump `BUILD` in `vite.config.js` by one before every push.** It's what the console prints
  at boot (`window.GB_BUILD`), and the only way to tell a live build from a cached one on
  someone's phone. Deriving it from git was tried and reverted: the prod image has no `.git`
  and no git binary, so every build reported 0.
- `grep 'ponytail:'` for deliberate simplifications and their upgrade paths.
- Edited `SOUNDS` in `chime.js` → re-run **`node scripts/gen-chimes.mjs`**. The same table is the
  phone's notification sound, rendered to `public/gb-*.wav`; the in-app chime and the lock-screen
  one drift apart silently otherwise.
- **New column on an existing `@Entity` → declare it in that table's `CREATE TABLE` in
  `tableCreationQueries.sql` AND append an `ALTER` to `migrations.sql`.** Two files, two jobs:
  the first builds a new database, the second is the only thing that can change one that already
  exists. **Prod is TiDB with `ddl-auto: none`** — it adds nothing and validates nothing — so a
  column that lands only in the `CREATE TABLE` reaches a fresh database and never the live one, and
  the first query naming it 500s. `SchemaCoverageTest` fails the build on an `ALTER` in the schema
  file, on an unguarded `CREATE`, and on a migration for a column no `CREATE TABLE` declares.
- New icon → add it to `scripts/icons.js`. New screen → `SCREENS` in `app.js` (+ `NAV_CATALOG` in
  `gb-kit.js` for a nav slot). New entity → add the table to `tableCreationQueries.sql` too;
  `ddl-auto: update` hides the omission in dev and breaks prod, and `SchemaCoverageTest` now
  fails the build if you forget. A table that holds a `user_id` also belongs in
  `AuthService.USER_OWNED_TABLES`, or a deleted account leaves its rows behind —
  `AccountDeletionCoverageTest` checks that one.
- **Recurrence lives twice** (`scripts/recurrence.js` + `ReminderService.occursOn`, because the
  WhatsApp scheduler can't import JS). Add cases to **`scripts/recurrence.cases.json`** — both
  test suites read it, so neither side can drift alone.
