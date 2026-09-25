# styles/money.css — Money Buddy styles (1661 lines)

Reuses the app's tokens, cards and buttons. Signature elements: the "safe to spend" hero ring and a
growth/sprout motif. All classes are `gb-money-*`. Numbers in the banners map to the Money feature
list (e.g. "(14)" = financial health).

| Line | Section | Used by |
|---|---|---|
| 15 | Sub-tabs | `tabBar` |
| 71 | Hero: safe-to-spend ring | `tabOverview` |
| 155 | Insights | overview |
| 195 | Donut | spending breakdown |
| 263 | Coach callouts (`gb-money-coach-*`) | budgets, coach |
| 307 | Gamification | coach |
| 398 | Stat rows | income, review |
| 432 | Forecast | overview |
| 470 | Personality | coach |
| 512 | Actions row | spending |
| 527 | Week bars — each column carries its own CSS tooltip (`::after` on `data-tip`); the `title` it replaced was effectively invisible and absent entirely on touch | spending (last 7 days) |
| 612 | Category list / breakdown | spending (by tag) |
| 665 | History list (`gb-money-exp-row`, `gb-money-exp-list`) | spending (this month), income, subscriptions |
| 703 | Income / loans — settled row dims, amount struck through | income |
| 711 | Budget cards (`gb-money-bcard*`, `is-over` / `is-near`) | budgets |
| 771 | Budget modal fields | set-budgets modal |
| 799 | Purchase advisor | coach |
| 845 | Goal chips (modal) | goals |
| 863 | Savings goals | goals |
| 928 | Receipt scanner | spending |
| 960 | Empty state (`emptyHint`) | everywhere |
| 973 | Section head with multiple actions | budgets |
| 980 | Financial health (14) | coach |
| 1032 | Daily tip (13) | coach |
| 1066 | Recovery plan (20) | budgets |
| 1090 | Search (16) | spending |
| 1111 | Subscriptions (24) | spending |
| 1124 | Wishlist (18) | coach |
| 1143 | Challenges (11 / 15) | coach |
| 1243 | Timeline (19) | overview |
| 1291 | Tag chip picker — wraps instead of overflowing (replaced the segmented bar) | add-expense modal |
| 1373 | Tag manager (custom tags) | customise pane |
| 1409 | Simulator (23) | coach |
| 1434 | Reflection dot (12) | expense rows |
| 1442 | Home widget (mini card) | `MoneyHomeCard` |
| 1525 | Star rating (reflection, 12) — `.gb-stars` + its caption; the amber fill is decoration, the caption carries the meaning | reflection modal |
| 1638 | Responsive | — |

Threshold colours: `is-near` at ≥80% of a budget, `is-over` above 100% — the JS in
`scripts/money.js` (`tabBudgets`) picks these class names, so keep the names in sync.
