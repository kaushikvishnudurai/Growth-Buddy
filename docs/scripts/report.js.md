# scripts/report.js — Report screen (462 lines)

Exports `ScreenReport` (~348). A per-feature progress overview. When a feature is switched off in
settings, `section(featureKey, title, icon, enabled, onEnableFeature, contentFn)` (~339) swaps that
section for `disabledCard` (~66) — a "turn it back on" prompt — so the report explains *why* it's
empty instead of showing zeros.

| Piece | Line | What |
|---|---|---|
| `insightsSection({wellness, trends, money})` | 12 | renders `buildInsights()` from `scripts/insights.js` |
| `statTile(label, value, sub, color)` | 55 | |
| `disabledCard` | 66 | feature-off placeholder |
| **hand-rolled SVG charts** | 98–223 | `svgEl` (104), `trendChart(values, color)` (152), `trendCard(...)` (208). No chart library. |
| `SCALE_NUM` / `SCALE_LABEL` | 113 / 114 | categorical check-ins → 1–4 and back (`low/poor`=1 … `great`=4) |
| day helpers | 116–139 | `pad2`, `dayKeyOf`, `lastNDays(n)`, `nDays(n)` |
| `summarize(values)` | 139 | latest + delta for a trend card |
| `rangeToggle(range, onRange)` | 224 | 7 / 30 / 90-day switch |
| `trendsSection({on, trends, wellness, range, onRange})` | 239 | the drill-down |
| `section(...)` | 339 | feature-gated section wrapper |
| `ScreenReport({...})` | 348 | assembles all sections |

Data is local: `trends` and `wellness` come from the client-side stores in app.js, not the server.
Styles: `app.css` §"Report screen" (~1338 — note base `.gb-card` has no padding, so report cards
inset their own content), §"Insights" (~1436), §"Report — trends drill-down" (~6268).
