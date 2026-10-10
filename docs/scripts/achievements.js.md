# scripts/achievements.js — badge gallery

Exports `ScreenAchievements(props)`, `computeAchievements(props)`, `levelProgress(user)`. All
client-side, derived from data already tracked (XP/level, freeze-protected habit streaks, goals,
wellness, trends, today's food and water). Reached from the profile menu. Checked by
`node scripts/achievements.test.mjs`.

## `levelProgress(user)` — no level curve of its own

The server owns the curve (`ProgressService.XP_PER_LEVEL`, 100) and sends `level`, `xpIntoLevel`,
`xpForNextLevel`, `xpPerLevel` on the user. This reads those; `XP_PER_LEVEL_FALLBACK` (100) is only
for an older cached user. Returns `{xp, level, into, toNext, pct}`. The client once said 500 and
showed the wrong % — here and in the profile dropdown's bar, which also uses it.

## `computeAchievements({user, topStreak, goals, wellness, trends, food, water, seen})`

→ groups `[{title, items, note?}]`: Progress, Streaks, Consistency, Wellness, Hydration, Goals,
Nutrition. Each item `{id, icon, title, desc, tier, target, current, unlocked}`, built by the inner
`m(id, …, value, target)`. Level badges compare the **level itself**. Targets are deliberately hard
(first tier a real milestone, gold sustained effort). Badge **ids are stable keys** stored in
`achSeen` and don't match their current targets (`lvl2` = Level 3, `streak3` = 5 days) — never
renumber them, or earned badges relock and old ones re-celebrate.

Invariants:

- **`seen` keeps a badge unlocked once earned.** It is `ui_prefs.achSeen` (app.js
  `achievementProps`). The day counts only see the 60 days boot loads, so "Be active 14 days" would
  relock as old days slid out.
- **Day counts are sets of dates.** Today's live food/water is added to a history that may already
  hold today; counting instead of set-adding counted it twice (two plates on day 1 unlocked "3 days").
  Today = `toLocaleDateString('en-CA')`. Photo-log dates count as food days.

## Rendering

| Fn | What |
|---|---|
| `badgeTile(item)` | unlocked: check; locked: `role=progressbar` + `current / target` |
| `ScreenAchievements` | summary card with **two separate labelled bars** — badges earned %, and XP % to next level (they used to share one caption and read as the same metric) — then a `role=list` grid per group |

The celebration on first unlock is **not here**: app.js `checkAchievements` diffs unlocked ids
against `ui_prefs.achSeen` ∪ the session's ids, baselines silently on the first run with data, and
saves the union **before** `celebrate()` so a re-render can't double-fire.

Styles: `app.css` (`.gb-ach-*`).
