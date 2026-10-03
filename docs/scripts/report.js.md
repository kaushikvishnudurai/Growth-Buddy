# scripts/report.js — Report screen (733 lines)

Exports `ScreenReport` (~597). A per-feature progress overview. When a feature is switched off in
settings, `section(featureKey, title, icon, enabled, onEnableFeature, contentFn)` (~588) swaps that
section for `disabledCard` (~72) — a "turn it back on" prompt — so the report explains *why* it's
empty instead of showing zeros.

| Piece | Line | What |
|---|---|---|
| `insightsSection(data)` | 22 | renders `buildInsights(data)` from `scripts/insights.js`. `ScreenReport` passes wellness, trends, money, habits, tasks, flattened goals, `goalProgress` and `insightHistory` as `history` |
| `statTile(label, value, sub, color)` | 61 | |
| `disabledCard` | 72 | feature-off placeholder |
| **hand-rolled SVG charts** | 104–278 | `svgEl` (110), `trendChart(values, color, days, fmt)` (160), `trendCard(..., vs)` (263). No chart library. Hover/drag shows one day's value via `.gb-trend-tip`, snapped to the nearest logged day. `vs` = `{dir, text}` line under the chart |
| `SCALE_NUM` / `SCALE_LABEL` | 119 / 120 | categorical check-ins → 1–4 and back (`low/poor`=1 … `great`=4) |
| day helpers | 122–145 | `pad2`, `dayKeyOf`, `lastNDays(n)`, `nDays(n)` |
| `summarize(values)` | 145 | latest + delta for a trend card |
| `rangeToggle(range, onRange)` | 280 | 7 / 30-day switch |
| `trendsSection({on, trends, wellness, range, onRange})` | 295 | the drill-down. Each card carries **"vs last week"** (`vsLine` → `periodDelta`): the last `range` *full* days against the `range` before them. Today is excluded from both — half-logged, it read as a drop every morning. kcal 0 = not logged |
| `pixelsSection` / `pixelGrid` | 483 / 455 | **year in pixels**: 53 week-columns (Monday on top), shade = `pixelValues(metric)`, blank = nothing logged. Score / Mood / Habits toggle repaints in place (`pixelMetric`, module-level, not app state, not persisted) |
| `yearOf(trends, wellness, insightHistory)` | 533 | boot holds only 60 days of daily logs; Report fetches 366 (`insightHistory.year`) and the pixels + records use it once it lands |
| `recordsSection` | 540 | `personalRecords` tiles + **Share my month** (`monthReview` → `share-card.js`). Section is omitted when both are empty |
| `section(...)` | 588 | feature-gated section wrapper |
| `ScreenReport({...})` | 597 | assembles all sections |

The look-back maths (pixels, records, period delta, month card) lives in **`scripts/review.js`** — pure,
no DOM, checked by `node scripts/review.test.mjs`. Habits on the pixel grid only reach back as far
as the habit history Report loads (60 days).

Data is local: `trends` and `wellness` come from the client-side stores in app.js (hydrated from
`/api/daily-logs?days=60` at boot). `insightHistory`, which app.js `loadInsightHistory` fetches when
Report opens (at most every ten minutes), arrives after the first paint: insight cards, records and
the full year of pixels that need it appear on the re-render.
Styles: `app.css` §"Report screen" (~2085 — note base `.gb-card` has no padding, so report cards
inset their own content), §"Insights", §"Report — trends drill-down", §"Report — period comparison,
personal records, year in pixels" (end of file).
