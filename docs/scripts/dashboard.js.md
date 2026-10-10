# scripts/dashboard.js — Home screen

Exports: `ScreenDashboard`, `ScreenFood`, `MiniCalendarCard`, `HOME_WIDGETS`,
`resolveHomeLayout` (check the export block for the exact list).

Every card is a plain function taking a props object and returning DOM. `ScreenDashboard`
assembles them in the user's saved widget order; `resolveHomeLayout(saved)` reconciles the
saved layout against `HOME_WIDGETS` so a new widget appears and a removed one vanishes
without migration. Persisted by `saveHomeLayout` in app.js. Both live in **`scripts/home-order.js`**
(DOM-free, re-exported here) with Home's ordering rules — `sortTasksForHome`, `sortHabitsForHome`,
`habitDue`, `topStreaks`, `homeGoals` — checked by `node scripts/home-order.test.mjs`.

**What Home actually renders** (the `renderers` map, one per `HOME_WIDGETS` id): `score` →
`ScoreCard`, `plan` → `TodayPlanCard`, `wellness` → `WellnessCard`, `tasks` → `TasksCard`,
`calendar` → `MiniCalendarCard`, `habits` → `HabitStrip`, `goals` → `GoalsCard`, `money` →
`MoneyHomeCard` (money-home.js), `reminders` → `ReminderSuggestionsCard`; plus `OnboardingCard` on top.
`QuoteCard`, `WeeklyReflectionCard`, `BadgeCard`, `GoalTimelineCard` and `HabitSleepInsightCard`
are defined and exported here but rendered elsewhere (Report, the Habits screen, the quote slot in
app.js); `WaterCard` / `FoodCard` belong to `ScreenFood`.

**First run short-circuits the whole layout:** with no data of any kind yet (tasks, habits,
reminders, money entries, food, water, mood or sleep), `ScreenDashboard` returns the
`OnboardingCard` alone (`.gb-dash--onboarding` centres it, on desktop too). Every widget renders its
own "nothing yet" state, so a new account used to open on nine empty cards saying the same thing
three ways. Adding anything — or dismissing the checklist — brings the full Home back.

| Card | Notes |
|---|---|
| `OnboardingCard` | first-run checklist; each step marks itself done from real data, so it doubles as live progress. Dismissal key `gb.onboardDismissed`; the ✕ calls `onOnboardDismiss({ rerender: true })` so a fresh account (checklist = whole Home) re-renders instead of going blank. The all-done path calls it bare on purpose: it runs mid-render (a re-render from there would nest), and an all-done account already has data, so the full Home renders anyway |
| `ScoreCard` | today's completion ring. The `%` lives in the number (`100%` over `SCORE`), matching Progress's summary tile and its "Daily score" trend — one number, one name. The sub-line (`4/4 tasks · 3/3 habits`) is the percentage's own arithmetic: habits are only the ones **owed today** (`habitDue`, the server's `dueToday` — a weekly habit already met this week, or a paused one, is not today's miss), same rule as `HabitService.countsOn`. The streak pill is split by unit (`topStreaks`): `N-day` for daily habits, `N-week` for weekly / N-a-week ones. No level/XP pill: different currency, lives in the profile menu. |
| `GoalsCard` | the `goals` widget: up to 3 open goals, nearest target first (`homeGoals`), each with days left / overdue, the next unticked milestone and the day tracker's count from `goalProgress` (app.js passes `effectiveGoalProgress()`, so a tracker counting from linked habits shows that count). Every row opens Goals (`onOpenGoals`); nothing is edited here |
| `TaskRow` / `TasksCard` | today's tasks, `PRIORITY` colors, ordered by `sortTasksForHome` (overdue → today → upcoming → no date, paused and done last). The sub line prints `task.time` as-is (already formatted by `mapTask`), coral when `task.overdue`. The trailing `.gb-icon-btn` pencil is the only way to edit a task — it calls `onEditTask` (app.js `openEditTask`) and is skipped when that prop is absent. A timer button before it (`onFocusTask`, app.js `startFocusOn({taskId})`, null when the Focus feature is off; not on done/paused rows) opens Focus with the task picked. The list grows with the page (no inner scroll box); past `TASKS_SHOWN` (6) a "Show all" button opens the rest in place (`tasksExpanded`, module-level) |
| `HabitCard` / `HabitStrip` | habit check-ins, ordered by `sortHabitsForHome` (owed and unticked first, then not owed today, done, paused). The flame + number carries an `aria-label` ("5-day streak" / "3-week streak") |
| `QuoteCard` | quote of the day (cached per day in app.js); not a Home widget |
| `TodayPlanCard` | the "Plan my day" action plus chips for **what's still open**. Two rules: it never repeats the score ring (which owns tasks + habits), and it never congratulates — a "Sleep logged" chip sitting above a card reading "7.5h · Good" said less than the thing beneath it. Everything done → the chip row doesn't render. |
| `WellnessCard` | sleep + mood entry points; `sleepHours(entry)` |
| `WeeklyReflectionCard` | nudge into the weekly review — rendered on Report, not Home |
| `BadgeCard` | recent achievements — rendered on Report, not Home |
| `ReminderSuggestionsCard` | suggests reminders from habit/water/wellness gaps; a habit that has its own `reminderTime`, or isn't owed today (`habitDue`), is never suggested. The habit suggestion's time is `suggestReminderTime` (habit-stats.js): the median of the reminder times on the user's other active habits, else 19:00 — the server keeps no time of day for a check-in, so "when they usually tick" isn't knowable. Dropped once that time has passed |
| `GoalTimelineCard` | recent goal actions; `allGoals(sections)` — rendered on Report, not Home |
| `WaterCard` | biggest card (~360 lines): quick-add (always water), custom amount with a drink picker (`withDrink`, `DRINKS` from `nutrition.js`; `onQuickAddWater(ml, day, drink)`), goal edit with a one-tap suggestion (`suggestWaterGoalMl(weightKg)`: 33 ml/kg to the nearest 250, shown only with a profile weight and when it differs), entry delete; a non-water row reads "250 ml coffee (counts 200)". `consumedMl` is the server's effective total. The fill is full height and slid down with `translateY` (the summary tumblers use `scaleY`, the pour a scaled fixed height): transforms, not `height`, so no layout per frame |
| `FoodCard` | today's food summary, grouped by meal slot (`groupBySlot`; a pre-slot row by its logged hour) with each slot's kcal; an empty slot that has begun offers "Copy yesterday's …" (`onCopySlot(slot)`); a fibre/sugar/sodium line only for the figures the day has (`dayMicros`) |
| `FoodSummaryLink` / `ScreenSummary` | Food screen's link to `SCREENS.summary`; the screen: nutrient thali (4 katoris on the diagonals, kcal in the centre, % geometry so it shrinks on a narrow phone), calorie split bar, Day by day card (tabs flip panels in place, the pick kept in `summaryNutrient`; chart + top dishes per nutrient), water tumblers (the average uses calories' days, `FoodWeek.averaged`: finished logged days, else today), diet check. Everything that looks tappable is: a katori, a calorie share or one of Buddy's pills calls `showNutrient(key, true)` (flips Day by day and scrolls to it); a day's bar calls `onPickDay(date)` (the water tumblers are read-only: a tap ran an AI diet check): Buddy's card reads that day (like Money's day panel: `dayFacts` shows kcal, dishes and water from the loaded week at once, the check fills in under it, and "See these meals in Calendar" is the old `onOpenDay` route). The diet check (Check <day> / Check my week; `onCheck(date?)`, `state.dietCheck.{scope,date}`; a Water pill when the server judged water) and the first load wait with `Thinking()`. Colours come from one `--n` per `.is-<nutrient>` in app.css. Headline and pills read the server's `levels` (calories lead the headline: `levels.calories` is the average against the goal, and the server scales each entry's grams to its logged kcal so the two always agree). Data and invalidation live in app.js `loadWeekSummary` / `invalidateWeek` (fetched on open, not at boot: the food week may run an AI estimate) |
| `MiniCalendarCard` | ~370 lines; also used on Home, styled by `styles/mini-calendar.css`; app.js repaints it in place via `rerenderHomeMiniCalendarIfActive` |
| `HabitSleepInsightCard` | fitness × sleep correlation. **Returns `null`** without at least one fitness habit *and* one sleep entry — it has no correlation to report, and it used to say so at full card size. Callers must guard on the returned node, not on the function. |
| `ScreenFood` | the standalone Food screen |

Styles: `styles/app.css` §"Dashboard-specific blocks" — two logical columns
(`.gb-dash-main` / `.gb-dash-side`) that stack on phones.
