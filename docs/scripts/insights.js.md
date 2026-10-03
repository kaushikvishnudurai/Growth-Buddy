# scripts/insights.js — Insights engine (474 lines)

Pure pattern finder over the local wellness + trends + money stores. No AI, no server, no imports.
One caller: `report.js` `insightsSection` (Report screen only). Checked by
`node scripts/insights.test.mjs`.

Exports `buildInsights({wellness, trends, money})` → up to `MAX_INSIGHTS` cards
`{icon, title, text, effect}`, sorted by `effect`. Also `compare`, `shift`, `signals` for the test.

| Piece | Line | What |
|---|---|---|
| `ORD` | 22 | check-in words → numbers. Mood / sleep quality `low`–`great` = 1–4, energy `low`–`high` = 1–3, stress `calm`–`high` = 1–3. Must match the segmented options in `app.js` `openSleepSchedule` / `openMoodCheckin`; an unknown word drops the day silently. |
| thresholds | 24–29 | `MIN_DAYS=7`, `MIN_HALF=3` (each side of a split), `MIN_EFFECT=0.12` (fraction of the outcome's range), `MIN_REL=0.25` (spend, which has no range), `MAX_INSIGHTS=4` |
| `META` | 33 | per signal: label, the `hi`/`lo` names of the two halves, icon, `range` (for effect sizing), `fmt` (shows the scale: `2.8/4`) |
| `TESTS` | 119 | `[predictor, outcome, lag?]` pairs. **Add a pair here** to get a new comparison. |
| `bedMinutes` | 173 | bedtime as minutes **after noon**, so 23:30 and 00:30 sort next to each other |
| `shift(s, lag)` | 204 | re-keys so `out[d]` = value from `d + lag` |
| `compare(xs, ys)` | 218 | median split on `xs`, mean of `ys` per half |
| `signals(...)` | 245 | every series, keyed `YYYY-MM-DD`. `bedShift` = hours from the user's median bedtime. `kcal` 0 = not logged, dropped. |
| `pairInsight` | 269 | one `TESTS` row → card |
| `thisWeek` / `sleepDebt` / `moodShift` | 305–361 | latest 7 days (≥4 logged) vs everything before (≥7) |
| `weekdayPattern(sig, key, 'min'｜'max')` | 363 | needs 14 days total, 2 per weekday |
| `bestBedtime` | 409 | hour buckets of bedtime, needs 10 nights and 3 in the best bucket |

**Traps**

- **Sleep is keyed on the wake date.** The night under `2026-03-10` is the one *before* the 10th's
  mood and stress. So sleep → mood the same day is the right direction, and stress → sleep has to
  look at the next day's entry (lag 1). A same-day stress → sleep pair is backwards.
- Day maths is UTC on the date keys (`dayNum`/`dayKey`), so a lag works across a month end or a DST change.
  The test checks month ends.
- Spend only has days with an expense. A day with no spending is missing from the series, not 0.
- Effects are only comparable because every card divides by its outcome's `range`. A new signal
  needs a real `range`, or `null` with the relative rule.
