# scripts/dashboard.js — Home screen (1691 lines)

Exports (~1680): `ScreenDashboard`, `ScreenFood`, `MiniCalendarCard`, `HOME_WIDGETS`,
`resolveHomeLayout` (check the export block for the exact list).

Every card is a plain function taking a props object and returning DOM. `ScreenDashboard` (~1460)
assembles them in the user's saved widget order; `resolveHomeLayout(saved)` (~1444) reconciles the
saved layout against `HOME_WIDGETS` (~1406) so a new widget appears and a removed one vanishes
without migration. Persisted by `saveHomeLayout` in app.js.

| Card | Line | Notes |
|---|---|---|
| `OnboardingCard` | 22 | first-run checklist; each step marks itself done from real data, so it doubles as live progress. Dismissal key `gb.onboardDismissed` |
| `ScoreCard` | 104 | growth score ring + level |
| `TaskRow` / `TasksCard` | 180 / 196 | today's tasks, `PRIORITY` colors (~77) |
| `HabitCard` / `HabitStrip` | 226 / 1008 | habit check-ins |
| `QuoteCard` | 245 | quote of the day (cached per day in app.js) |
| `TodayPlanCard` | 262 | prompts a plan when the day looks empty |
| `WellnessCard` | 320 | sleep + mood entry points; `sleepHours(entry)` (~89) |
| `WeeklyReflectionCard` | 352 | nudge into the weekly review |
| `BadgeCard` | 384 | recent achievements |
| `ReminderSuggestionsCard` | 417 | suggests reminders from habit/water/wellness gaps |
| `GoalTimelineCard` | 475 | upcoming goal dates; `allGoals(sections)` (~100) |
| `WaterCard` | 522 | biggest card (~360 lines): quick-add, goal edit, entry delete |
| `FoodCard` | 880 | today's food summary |
| `PhotoHistoryCard` | 945 | recent food-photo scans |
| `MiniCalendarCard` | 1035 | ~370 lines; also used on Home, styled by `styles/mini-calendar.css`; app.js repaints it in place via `rerenderHomeMiniCalendarIfActive` |
| `HabitSleepInsightCard` | 1575 | fitness × sleep correlation |
| `ScreenFood` | 1545 | the standalone Food screen |

Styles: `styles/app.css` §"Dashboard-specific blocks" (~1896) — two logical columns
(`.gb-dash-main` / `.gb-dash-side`) that stack on phones.
