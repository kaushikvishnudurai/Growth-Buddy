# scripts/dashboard.js — Home screen (1712 lines)

Exports (~1680): `ScreenDashboard`, `ScreenFood`, `MiniCalendarCard`, `HOME_WIDGETS`,
`resolveHomeLayout` (check the export block for the exact list).

Every card is a plain function taking a props object and returning DOM. `ScreenDashboard` (~1453)
assembles them in the user's saved widget order; `resolveHomeLayout(saved)` (~1444) reconciles the
saved layout against `HOME_WIDGETS` (~1406) so a new widget appears and a removed one vanishes
without migration. Persisted by `saveHomeLayout` in app.js.

**First run short-circuits the whole layout:** with no tasks and no habits yet, `ScreenDashboard`
returns the `OnboardingCard` alone (`.gb-dash--onboarding` centres it). Every widget renders its own
"nothing yet" state, so a new account used to open on nine empty cards saying the same thing three
ways. Adding a task or habit — or dismissing the checklist — brings the full Home back.

| Card | Line | Notes |
|---|---|---|
| `OnboardingCard` | 25 | first-run checklist; each step marks itself done from real data, so it doubles as live progress. Dismissal key `gb.onboardDismissed` |
| `ScoreCard` | 107 | today's completion ring. The `%` lives in the number (`100%` over `SCORE`), matching Progress's summary tile and its "Daily score" trend — one number, one name. The sub-line (`4/4 tasks · 3/3 habits`) is the percentage's own arithmetic. No level/XP pill: different currency, lives in the profile menu. |
| `TaskRow` / `TasksCard` | 175 / 203 | today's tasks, `PRIORITY` colors (~77). The trailing `.gb-icon-btn` pencil is the only way to edit a task — it calls `onEditTask` (app.js `openEditTask`) and is skipped when that prop is absent |
| `HabitCard` / `HabitStrip` | 226 / 1008 | habit check-ins |
| `QuoteCard` | 255 | quote of the day (cached per day in app.js) |
| `TodayPlanCard` | 272 | the "Plan my day" action plus chips for **what's still open**. Two rules: it never repeats the score ring (which owns tasks + habits), and it never congratulates — a "Sleep logged" chip sitting above a card reading "7.5h · Good" said less than the thing beneath it. Everything done → the chip row doesn't render. |
| `WellnessCard` | 325 | sleep + mood entry points; `sleepHours(entry)` (~89) |
| `WeeklyReflectionCard` | 357 | nudge into the weekly review |
| `BadgeCard` | 389 | recent achievements |
| `ReminderSuggestionsCard` | 430 | suggests reminders from habit/water/wellness gaps |
| `GoalTimelineCard` | 518 | upcoming goal dates; `allGoals(sections)` (~100) |
| `WaterCard` | 565 | biggest card (~360 lines): quick-add, goal edit, entry delete |
| `FoodCard` | 891 | today's food summary |
| `FoodSummaryLink` / `ScreenSummary` | 982 | Food screen's link to `SCREENS.summary`; the screen: nutrient thali (4 katoris on the diagonals, kcal in the centre, % geometry so it shrinks on a narrow phone), calorie split bar, Day by day card (tabs flip panels in place, the pick kept in `summaryNutrient`; chart + top dishes per nutrient), water tumblers, diet check. Colours come from one `--n` per `.is-<nutrient>` in app.css. Headline and pills read the server's `levels`. Data and invalidation live in app.js `loadWeekSummary` / `invalidateWeek` (fetched on open, not at boot: the food week may run an AI estimate) |
| `MiniCalendarCard` | 1477 | ~370 lines; also used on Home, styled by `styles/mini-calendar.css`; app.js repaints it in place via `rerenderHomeMiniCalendarIfActive` |
| `HabitSleepInsightCard` | ~1580 | fitness × sleep correlation. **Returns `null`** without at least one fitness habit *and* one sleep entry — it has no correlation to report, and it used to say so at full card size. Callers must guard on the returned node, not on the function. |
| `ScreenFood` | 1967 | the standalone Food screen |

Styles: `styles/app.css` §"Dashboard-specific blocks" (~1896) — two logical columns
(`.gb-dash-main` / `.gb-dash-side`) that stack on phones.
