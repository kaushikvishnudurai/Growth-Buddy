# scripts/dashboard.js — Home screen

Exports: `ScreenDashboard`, `ScreenFood`, `MiniCalendarCard`, `HOME_WIDGETS`,
`resolveHomeLayout` (check the export block for the exact list).

Every card is a plain function taking a props object and returning DOM. `ScreenDashboard`
assembles them in the user's saved widget order; `resolveHomeLayout(saved)` reconciles the
saved layout against `HOME_WIDGETS` so a new widget appears and a removed one vanishes
without migration. Persisted by `saveHomeLayout` in app.js.

**First run short-circuits the whole layout:** with no data of any kind yet (tasks, habits,
reminders, money entries, food, water, mood or sleep), `ScreenDashboard` returns the
`OnboardingCard` alone (`.gb-dash--onboarding` centres it, on desktop too). Every widget renders its
own "nothing yet" state, so a new account used to open on nine empty cards saying the same thing
three ways. Adding anything — or dismissing the checklist — brings the full Home back.

| Card | Notes |
|---|---|
| `OnboardingCard` | first-run checklist; each step marks itself done from real data, so it doubles as live progress. Dismissal key `gb.onboardDismissed` |
| `ScoreCard` | today's completion ring. The `%` lives in the number (`100%` over `SCORE`), matching Progress's summary tile and its "Daily score" trend — one number, one name. The sub-line (`4/4 tasks · 3/3 habits`) is the percentage's own arithmetic. No level/XP pill: different currency, lives in the profile menu. |
| `TaskRow` / `TasksCard` | today's tasks, `PRIORITY` colors. The sub line prints `task.time` as-is (already formatted by `mapTask`), coral when `task.overdue`. The trailing `.gb-icon-btn` pencil is the only way to edit a task — it calls `onEditTask` (app.js `openEditTask`) and is skipped when that prop is absent. The list grows with the page (no inner scroll box); past `TASKS_SHOWN` (6) a "Show all" button opens the rest in place (`tasksExpanded`, module-level) |
| `HabitCard` / `HabitStrip` | habit check-ins |
| `QuoteCard` | quote of the day (cached per day in app.js) |
| `TodayPlanCard` | the "Plan my day" action plus chips for **what's still open**. Two rules: it never repeats the score ring (which owns tasks + habits), and it never congratulates — a "Sleep logged" chip sitting above a card reading "7.5h · Good" said less than the thing beneath it. Everything done → the chip row doesn't render. |
| `WellnessCard` | sleep + mood entry points; `sleepHours(entry)` |
| `WeeklyReflectionCard` | nudge into the weekly review |
| `BadgeCard` | recent achievements |
| `ReminderSuggestionsCard` | suggests reminders from habit/water/wellness gaps; a habit that has its own `reminderTime` is never suggested |
| `GoalTimelineCard` | upcoming goal dates; `allGoals(sections)` |
| `WaterCard` | biggest card (~360 lines): quick-add, goal edit, entry delete. The fill is full height and slid down with `translateY` (the summary tumblers use `scaleY`, the pour a scaled fixed height): transforms, not `height`, so no layout per frame |
| `FoodCard` | today's food summary |
| `FoodSummaryLink` / `ScreenSummary` | Food screen's link to `SCREENS.summary`; the screen: nutrient thali (4 katoris on the diagonals, kcal in the centre, % geometry so it shrinks on a narrow phone), calorie split bar, Day by day card (tabs flip panels in place, the pick kept in `summaryNutrient`; chart + top dishes per nutrient), water tumblers (the average uses calories' days, `FoodWeek.averaged`: finished logged days, else today), diet check. Everything that looks tappable is: a katori, a calorie share or one of Buddy's pills calls `showNutrient(key, true)` (flips Day by day and scrolls to it); a day's bar or tumbler calls `onPickDay(date)`: Buddy's card reads that day (like Money's day panel: `dayFacts` shows kcal, dishes and water from the loaded week at once, the check fills in under it, and "See these meals in Calendar" is the old `onOpenDay` route). The diet check (Check <day> / Check my week; `onCheck(date?)`, `state.dietCheck.{scope,date}`; a Water pill when the server judged water) and the first load wait with `Thinking()`. Colours come from one `--n` per `.is-<nutrient>` in app.css. Headline and pills read the server's `levels` (calories lead the headline: `levels.calories` is the average against the goal, and the server scales each entry's grams to its logged kcal so the two always agree). Data and invalidation live in app.js `loadWeekSummary` / `invalidateWeek` (fetched on open, not at boot: the food week may run an AI estimate) |
| `MiniCalendarCard` | ~370 lines; also used on Home, styled by `styles/mini-calendar.css`; app.js repaints it in place via `rerenderHomeMiniCalendarIfActive` |
| `HabitSleepInsightCard` | fitness × sleep correlation. **Returns `null`** without at least one fitness habit *and* one sleep entry — it has no correlation to report, and it used to say so at full card size. Callers must guard on the returned node, not on the function. |
| `ScreenFood` | the standalone Food screen |

Styles: `styles/app.css` §"Dashboard-specific blocks" — two logical columns
(`.gb-dash-main` / `.gb-dash-side`) that stack on phones.
