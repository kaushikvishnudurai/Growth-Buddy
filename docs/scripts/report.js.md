# scripts/report.js — Report screen (528 lines)

Exports `ScreenReport` (~403). A per-feature progress overview. When a feature is switched off in
settings, `section(featureKey, title, icon, enabled, onEnableFeature, contentFn)` (~394) swaps that
section for `disabledCard` (~62) — a "turn it back on" prompt — so the report explains *why* it's
empty instead of showing zeros.

| Piece | Line | What |
|---|---|---|
| `insightsSection(data)` | 12 | renders `buildInsights(data)` from `scripts/insights.js`. `ScreenReport` passes wellness, trends, money, habits, tasks, flattened goals, `goalProgress` and `insightHistory` as `history` |
| `statTile(label, value, sub, color)` | 51 | |
| `disabledCard` | 62 | feature-off placeholder |
| **hand-rolled SVG charts** | 94–268 | `svgEl` (100), `trendChart(values, color, days, fmt)` (150), `trendCard(...)` (253). No chart library. Hover/drag shows one day's value via `.gb-trend-tip`, snapped to the nearest logged day. |
| `SCALE_NUM` / `SCALE_LABEL` | 109 / 110 | categorical check-ins → 1–4 and back (`low/poor`=1 … `great`=4) |
| day helpers | 112–135 | `pad2`, `dayKeyOf`, `lastNDays(n)`, `nDays(n)` |
| `summarize(values)` | 135 | latest + delta for a trend card |
| `rangeToggle(range, onRange)` | 269 | 7 / 30 / 90-day switch |
| `trendsSection({on, trends, wellness, range, onRange})` | 284 | the drill-down |
| `section(...)` | 394 | feature-gated section wrapper |
| `ScreenReport({...})` | 403 | assembles all sections |

Data is local: `trends` and `wellness` come from the client-side stores in app.js, not the server.
The one exception is `insightHistory`, which app.js `loadInsightHistory` fetches when Report opens
(at most every ten minutes) and which arrives after the first paint: insight cards that need it
appear on the re-render.
Styles: `app.css` §"Report screen" (~1338 — note base `.gb-card` has no padding, so report cards
inset their own content), §"Insights" (~1436), §"Report — trends drill-down" (~6268).
