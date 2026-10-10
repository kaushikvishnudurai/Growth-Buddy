# scripts/insights.js — Insights engine

Pure pattern finder over the local wellness + trends + money stores, plus history the Report
screen fetches on open. No AI, no imports. `push.js` imports `drinkRateByHour` from here.
One caller: `report.js` `insightsSection` (Report screen only). Checked by
`node scripts/insights.test.mjs`.

Exports `buildInsights({wellness, trends, money, habits, tasks, goals, goalProgress, history, features, dismissed, now})`
→ up to `MAX_INSIGHTS` cards `{id, icon, title, text, basis, effect, action?}`, sorted by `effect`. Every argument is
optional; a card whose data is missing just doesn't appear. Each rule is exported for the test.
`features` off (`money`, `water`, `food`, `habits`, `goals`, `focus`) empties that feature's signals and
drops its cards. `dismissed` ids are filtered **before** the cap, so the next card fills the slot; ids
of this-week/today cards carry the week's Monday or the day (`sleepDebt:2026-10-05`), so a dismissal
doesn't silence next month's. `basis` is what the card stands on ("23 days", "12 sessions"); each rule
sets its own. `insightProgress(wellness)` → `{days, need}` for the empty state.
`action` `{label, kind, params}` is the card's next step, as **data only** — app.js `runInsightAction`
does it (Report draws the button). Kinds: `bedtimeReminder` {time, repeat} (bestBedtime),
`waterNudge` {hour, from, to} (waterGap), `editTask` {taskId} (pushedTask), `habitReminder`
{habitId, time} (habitWeekdayMiss, via `earlierReminder`), `openMoney` (unusualExpense,
hiddenSubscription). A new kind needs a `case` there or its button does nothing.

`history` is `state.insightHistory`, filled by app.js `loadInsightHistory`:
`{focus: [{durationSec, completedAt}], finished: [{priority, createdAt, doneAt}],
waterTimes: [instant], scores: [dayBeforeYesterday, yesterday], habits: {id: {since, days}}}`.
A quit ("break a habit") habit is skipped by the habit series: its clean days have no row.

| Piece | What |
|---|---|
| `ORD` | check-in words → numbers. Mood / sleep quality `low`–`great` = 1–4, energy `low`–`high` = 1–3, stress `calm`–`high` = 1–3. Must match the segmented options in `app.js` `openSleepSchedule` / `openMoodCheckin`; an unknown word drops the day silently. |
| thresholds | `MIN_DAYS=7`, `MIN_HALF=3` (each side of a split), `MIN_EFFECT=0.12` (fraction of the outcome's range), `MIN_REL=0.25` (spend, which has no range), `MAX_INSIGHTS=6` |
| `META` | per signal: label, the `hi`/`lo` names of the two halves, icon, `range` (for effect sizing), `fmt` (shows the scale: `2.8/4`) |
| `TESTS` | `[predictor, outcome, lag?]` pairs. **Add a pair here** to get a new comparison. |
| `bedMinutes` | bedtime as minutes **after noon**, so 23:30 and 00:30 sort next to each other |
| `shift(s, lag)` | re-keys so `out[d]` = value from `d + lag` |
| `compare(xs, ys)` | median split on `xs`, mean of `ys` per half |
| `signals(...)` | every series, keyed `YYYY-MM-DD`. `bedShift` = hours from the user's median bedtime, empty unless most nights sit within an hour of it (two equal camps of bedtimes have no usual one). `kcal` 0 = not logged, dropped. |
| `pairInsight` | one `TESTS` row → card |
| `thisWeek` / `sleepDebt` / `moodShift` | latest 7 days (≥4 logged) vs everything before (≥7) |
| `weekdayPattern(sig, key, 'min'｜'max')` | needs 14 days total, 2 per weekday |
| `bestBedtime` | hour buckets of bedtime, needs 10 nights and 3 in the best bucket |
| `focusHours` | 2-hour window by session START hour with the longest sessions; 10 sessions, 3 inside, +20% |
| `habitDays` | daily habits only, `since` to yesterday; a frozen day counts as done |
| `earlierReminder(time)` | the habit miss card's offer: an hour before the habit's reminder, 09:00 with none, null before 06:00 (no check-in times are stored, so it is a nudge, not a measured hour) |
| `habitWeekdayMiss` / `missTwice` / `keystoneHabit` | weekday miss rate 25 points over the habit's own; one miss turning into two in half of 4+ cases, shown only while a habit missed yesterday is still undone today; mood on done vs skipped days |
| `paceSlope(log, frac, today)` / `goalPace` | least-squares slope through the blob's `progressLog` (last 90 days, today's value replacing today's entry; 3+ points over 5+ days), run on from today's progress; a slope ≤ 0 is "has stalled" (target still ahead). Without a usable log, the old straight line from creation (0%). Reported when the finish lands 3+ days past `targetDate`. Progress = milestones, else day tracker |
| `taskTiming` / `pushedTask` / `taskWeekday` | created→done days per priority (3+ each); open task with `pushCount` 3+; weekday with the most finishes (10+) |
| `unusualExpense` / `hiddenSubscription` | an expense this week 3x the category median (5+ before it); same note, amounts within 15%, gaps of 25–35 days, 3+ times, not matching a subscription name |
| `drinkRateByHour` / `waterGap` | share of logged days with water in each local hour; longest 3h+ run between 09:00 and 21:00 under 20% |
| `scoreChange` | yesterday vs the day before, 10+ points, names the part (tasks or habits) whose rate moved most |

**Traps**

- **Sleep is keyed on the wake date.** The night under `2026-03-10` is the one *before* the 10th's
  mood and stress. So sleep → mood the same day is the right direction, and stress → sleep has to
  look at the next day's entry (lag 1). A same-day stress → sleep pair is backwards.
- Day maths is UTC on the date keys (`dayNum`/`dayKey`), so a lag works across a month end or a DST change.
  The test checks month ends.
- **Day and hour of an instant are the device's zone** (`localKey`, `getHours`); date keys stay UTC
  maths. The test runs clean under any `TZ`.
- **`effect` of the non-pair cards is set by hand** (e.g. `missTwice` 0.6, `pushedTask` 0.3+) to
  place them among the pair cards; it is not a measured size. Tune there if one crowds the rest out.
- Task priority is the stored one, and an overdue task is escalated to High on the server, so
  "High takes N days" includes tasks that became High by being late.
- Spend only has days with an expense. A day with no spending is missing from the series, not 0.
- Effects are only comparable because every card divides by its outcome's `range`. A new signal
  needs a real `range`, or `null` with the relative rule.
