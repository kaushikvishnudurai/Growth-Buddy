# scripts/report.js — Report screen

Exports `ScreenReport`. A per-feature progress overview. When a feature is switched off in
settings, `section(featureKey, title, icon, enabled, onEnableFeature, contentFn)` swaps that
section for `disabledCard` — a "turn it back on" prompt — so the report explains *why* it's
empty instead of showing zeros.

| Piece | What |
|---|---|
| `insightsSection(data, {loading, onDismiss, onAction})` | renders `buildInsights(data)` from `scripts/insights.js`. `ScreenReport` passes `yearOf(...)` trends + wellness (the year once it lands), money, habits, tasks, flattened goals, `goalProgress`, `insightHistory` as `history`, `features` and `dismissedInsights` (`ui_prefs.insightsDismissed`, last 50, written by app.js `onDismissInsight`). Each card shows "Based on …" (`basis`) and a dismiss ✕, plus its `action` as a `.gb-insight-action` button when `onAction` (`ScreenReport`'s `onInsightAction` = app.js `runInsightAction`) is passed. Empty: a skeleton while `insightLoading`, else "N of 7 days logged" + a progressbar (`insightProgress`) |
| `statTile(label, value, sub, color)` | a `null`/`NaN` value renders as a dash |
| `disabledCard` | feature-off placeholder |
| **hand-rolled SVG charts** | `svgEl`, `trendChart(values, color, days, fmt, title, opts)` (the SVG is `aria-hidden`, a `.gb-sr-only` table with a summary caption carries the data; `opts.bucket: 'week'` makes each point a week's daily average keyed by its Monday — summary, table header and tip say "week of" — and `opts.ticks` `[{i, label}]` prints month labels under it, `.gb-trend-ticks`, edge labels hang inward), `trendCard(..., vs, opts)`. No chart library. Hover/drag shows one day's value via `.gb-trend-tip`, snapped to the nearest logged day. `pointerleave` hides it for a mouse only: on touch it fires right after the lift, so a tap's readout stays until the next tap or a scroll. The Calories series drops 0 kcal like `vsLine` does `vs` = `{dir, text}` line under the chart |
| `SCALE_NUM` / `SCALE_LABEL` | categorical check-ins → 1–4 and back (`low/poor`=1 … `great`=4) |
| day helpers | `pad2`, `dayKeyOf`, `lastNDays(n)`, `nDays(n)` |
| `summarize(values)` | latest + delta for a trend card |
| `rangeToggle(range, onRange)` | 7 / 30 / 90-day / 1-year switch (`state.reportRange` 365; 90 needs the year fetch for its "vs the 90 days before") |
| `trendsSection({on, trends, wellness, range, onRange})` | the drill-down. Each card carries **"vs last week"** (`vsLine` → `periodDelta`): the last `range` *full* days against the `range` before them. Today is excluded from both — half-logged, it read as a drop every morning. kcal 0 = not logged. **1 year**: the local `card` wrapper buckets the 365 daily values with `weeklyBuckets` and labels every other month (`monthTicks(keys, 3)`, counted back from this one); the latest/avg line stays daily and there is no vs line (the year fetch holds no year before). Mood/sleep `fmt` rounds, so a weekly average still reads as a word |
| `weekRollupSection({on, trends})` | **This week vs last**: a visible `<table class="gb-wow">` (sr caption) of water ml/day, kcal/day and protein g/day (`proteinG`, shown only when some day carries it) from `weekOverWeek`: Monday→yesterday against the full week before, per-day average over logged days, 0 = not logged. Gated by the water/food features; omitted when neither week logged anything |
| `compareSection({on, trends, wellness, money, insightHistory})` / `scatterChart(res, mx, my)` | **Compare**: two `<select>`s over `COMPARE_METRICS` (sleep hours, mood, energy, stress, water, kcal, spend, focus minutes, habit %; feature-gated). Series come from insights.js `signals()` (water 0 dropped), `focusMinutesByDay(insightHistory.focus)` and `pixelValues('habits')` ×100. Every ordered pair is run through `correlate(..., {min: 14, before: today})`; only metrics with a ≥14-day partner are offered, Y only lists X's partners, a stale pick falls back to the first valid one. Shows a scatter (points `--brand` 0.55 with a surface ring, recessive `.gb-scatter-axis`/`.gb-scatter-tick`, nearest-point tip), `r` + N days, `correlationWords` and an "association, not a cause" line; `.gb-sr-only` table of the days. Pick is module-level (`compareX`/`compareY`), not app state. No pair → an empty-state card explaining the 14 shared days |
| `pixelsSection` / `pixelGrid` | **year in pixels**: a row per month for the last 12 (oldest on top) x 31 day columns, shade = `pixelValues(metric)`, blank = nothing logged, outline = a day still to come. Tapping a day reads it out under the grid (`.gb-pixels-readout`, aria-live, one delegated listener); the grid is a focusable `role=group`, arrow keys walk the pick (left/right by day, up/down by month), Home/End jump to the first/last day, Escape clears; otherwise that line is the year's summary. Legend words come from `PIXEL_METRICS` (`low`/`high`). **Today's score is blank** (still climbing; as a finished day it read as 0%), and `monthReview` averages finished days only. Score / Mood / Habits toggle repaints in place (`pixelMetric`, module-level, not app state, not persisted) |
| `yearOf(trends, wellness, insightHistory)` | boot holds only 60 days of daily logs; Report fetches 366 (`insightHistory.year`) and insights, trends, pixels + records use it once it lands. **Merged**, live stores winning a shared day (they hold today's edits); sleep is included |
| `recordsSection` | `personalRecords` tiles (money in lakh grouping for ₹ only, the device's grouping otherwise) + **Share my month** (`monthReview` → `share-card.js`); on the 1st–3rd it shares **last month** (`reviewMonth`). Section is omitted when both are empty |
| `section(...)` | feature-gated section wrapper |
| `ScreenReport({...})` | assembles all sections |

The look-back maths (pixels, records, period delta, month card, `weeklyBuckets`, `monthTicks`, `correlate`, `correlationWords`, `focusMinutesByDay`, `weekOverWeek`) lives in **`scripts/review.js`** — pure,
no DOM, checked by `node scripts/review.test.mjs`. Habits on the pixel grid only reach back as far
as the habit history Report loads (60 days).

Data is local: `trends` and `wellness` come from the client-side stores in app.js (hydrated from
`/api/daily-logs?days=60` at boot). `insightHistory`, which app.js `loadInsightHistory` fetches when
Report opens (at most every ten minutes after a fetch that got anything back; a failed one is retried on the next render, one request in flight at a time), arrives after the first paint: insight cards, records and
the full year of pixels that need it appear on the re-render.
Styles: `app.css` §"Report screen" (note base `.gb-card` has no padding, so report cards
inset their own content), §"Insights", §"Report — trends drill-down" (also the 1-year ticks, Compare and This week vs last), §"Report — period comparison,
personal records, year in pixels" (end of file).
