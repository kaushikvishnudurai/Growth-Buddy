# Growth Buddy

Vanilla-JS + Vite frontend, Spring Boot + MySQL backend, Capacitor mobile wrapper in
`../Growth-Buddy-Mobile`.

## Read the docs before the code

Docs mirror the source tree: **the doc for `X` is `docs/X.md`.** They exist only for files big
enough that reading the code costs real tokens (≥300 lines). Everything else is cheaper to just
open — don't go looking for a doc that isn't in this list.

| Need to work on | Read first | Instead of |
|---|---|---|
| app shell, state, routing, any API call, settings, auth views | `docs/scripts/app.js.md` | 6336 lines |
| Money Buddy | `docs/scripts/money.js.md` | 4872 |
| Home screen / widgets / mini calendar | `docs/scripts/dashboard.js.md` | 1691 |
| Family tab, meal planner | `docs/scripts/family.js.md` | 2032 |
| Growth Circle, mentorship | `docs/scripts/circle.js.md` | 1164 |
| Calendar, reminders, recurrence | `docs/scripts/calendar.js.md` | 1022 |
| Focus timer, ambient sound | `docs/scripts/timer.js.md` | 733 |
| UI primitives (`h`, `Card`, `Icon`, nav) | `docs/scripts/gb-kit.js.md` | 701 |
| Goals | `docs/scripts/goals.js.md` | 690 |
| Report screen, charts | `docs/scripts/report.js.md` | 462 |
| any styling | `docs/styles/app.css.md` | 6952 |
| Money styling | `docs/styles/money.css.md` | 1502 |
| colors, type, theming | `docs/styles/tokens.css.md` | 359 |
| the Home mini calendar's CSS | `docs/styles/mini-calendar.css.md` | 375 |
| family/meal-plan backend | `docs/backend/FamilyService.java.md` | 1492 |
| auth, sessions, user settings | `docs/backend/AuthService.java.md` | 754 |
| habits, streaks, freeze tokens | `docs/backend/HabitService.java.md` | 546 |
| food logging, photo estimates | `docs/backend/FoodService.java.md` | 481 |
| Google Calendar sync | `docs/backend/GoogleCalendarService.java.md` | 393 |
| the DB schema | `docs/tableCreationQueries.sql.md` | 801 |

**[CODEMAP.md](CODEMAP.md)** covers everything else in one pass: every small frontend module, every
backend package with its full endpoint list, config files, and the repo-wide traps. Read it when you
don't yet know *which* file you need.

Docs can drift. Locating something → trust them. **Changing something → read the real code**, and
fix the doc line if it was wrong. A doc you touch and don't update is worse than no doc.

## Working here

- Backend: **`./run.sh`** (loads `.env`, frees port 8080). Bare `mvnw spring-boot:run` breaks OTP email.
- Frontend: `npm run dev` (:5173, proxies `/api` + `/ws` to :8080). `npm run lint` before committing.
- Checks that exist: `node scripts/insights.test.mjs`, `money.js` `_demo()` on Vite DEV,
  `GoogleCalendarEventParsingTest`.
- After web changes, the Capacitor app needs `npm run sync` in `../Growth-Buddy-Mobile`.
- `grep 'ponytail:'` for deliberate simplifications and their upgrade paths.
- New icon → add it to `scripts/icons.js`. New screen → `SCREENS` in `app.js` (+ `NAV_CATALOG` in
  `gb-kit.js` for a nav slot). New entity → add the table to `tableCreationQueries.sql` too;
  `ddl-auto: update` hides the omission in dev and breaks prod.
