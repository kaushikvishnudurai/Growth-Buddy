# scripts/report.js — Report screen

Exports `ScreenReport`. A per-feature progress overview. When a feature is switched off in
settings, `section(featureKey, title, icon, enabled, onEnableFeature, contentFn)` swaps that
section for `disabledCard` — a "turn it back on" prompt — so the report explains *why* it's
empty instead of showing zeros.

| Piece | What |
|---|---|
| `insightsSection(data)` | renders `buildInsights(data)` from `scripts/insights.js`. `ScreenReport` passes wellness, trends, money, habits, tasks, flattened goals, `goalProgress` and `insightHistory` as `history` |
| `statTile(label, value, sub, color)` | |
| `disabledCard` | feature-off placeholder |
| **hand-rolled SVG charts** | `svgEl` (110), `trendChart(values, color, days, fmt)` (160), `trendCard(..., vs)` (263). No chart library. Hover/drag shows one day's value via `.gb-trend-tip`, snapped to the nearest logged day. `pointerleave` hides it for a mouse only: on touch it fires right after the lift, so a tap's readout stays until the next tap or a scroll. The Calories series drops 0 kcal like `vsLine` does `vs` = `{dir, text}` line under the chart |
| `SCALE_NUM` / `SCALE_LABEL` | categorical check-ins → 1–4 and back (`low/poor`=1 … `great`=4) |
| day helpers | `pad2`, `dayKeyOf`, `lastNDays(n)`, `nDays(n)` |
| `summarize(values)` | latest + delta for a trend card |
| `rangeToggle(range, onRange)` | 7 / 30-day switch |
| `trendsSection({on, trends, wellness, range, onRange})` | the drill-down. Each card carries **"vs last week"** (`vsLine` → `periodDelta`): the last `range` *full* days against the `range` before them. Today is excluded from both — half-logged, it read as a drop every morning. kcal 0 = not logged |
| `pixelsSection` / `pixelGrid` | **year in pixels**: a row per month for the last 12 (oldest on top) x 31 day columns, shade = `pixelValues(metric)`, blank = nothing logged, outline = a day still to come. Tapping a day reads it out under the grid (`.gb-pixels-readout`, one delegated listener); otherwise that line is the year's summary. Legend words come from `PIXEL_METRICS` (`low`/`high`). **Today's score is blank** (still climbing; as a finished day it read as 0%), and `monthReview` averages finished days only. Score / Mood / Habits toggle repaints in place (`pixelMetric`, module-level, not app state, not persisted) |
| `yearOf(trends, wellness, insightHistory)` | boot holds only 60 days of daily logs; Report fetches 366 (`insightHistory.year`) and the pixels + records use it once it lands |
| `recordsSection` | `personalRecords` tiles + **Share my month** (`monthReview` → `share-card.js`). Section is omitted when both are empty |
| `section(...)` | feature-gated section wrapper |
| `ScreenReport({...})` | assembles all sections |

The look-back maths (pixels, records, period delta, month card) lives in **`scripts/review.js`** — pure,
no DOM, checked by `node scripts/review.test.mjs`. Habits on the pixel grid only reach back as far
as the habit history Report loads (60 days).

Data is local: `trends` and `wellness` come from the client-side stores in app.js (hydrated from
`/api/daily-logs?days=60` at boot). `insightHistory`, which app.js `loadInsightHistory` fetches when
Report opens (at most every ten minutes), arrives after the first paint: insight cards, records and
the full year of pixels that need it appear on the re-render.
Styles: `app.css` §"Report screen" (note base `.gb-card` has no padding, so report cards
inset their own content), §"Insights", §"Report — trends drill-down", §"Report — period comparison,
personal records, year in pixels" (end of file).
