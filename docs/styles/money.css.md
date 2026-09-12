# styles/money.css — Money Buddy styles (1615 lines)

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
| 527 | Week bars | spending (last 7 days) |
| 566 | Category list / breakdown | spending (by tag) |
| 619 | History list (`gb-money-exp-row`, `gb-money-exp-list`) | spending (this month), income, subscriptions |
| 657 | Income / loans — settled row dims, amount struck through | income |
| 665 | Budget cards (`gb-money-bcard*`, `is-over` / `is-near`) | budgets |
| 725 | Budget modal fields | set-budgets modal |
| 753 | Purchase advisor | coach |
| 799 | Goal chips (modal) | goals |
| 817 | Savings goals | goals |
| 882 | Receipt scanner | spending |
| 914 | Empty state (`emptyHint`) | everywhere |
| 927 | Section head with multiple actions | budgets |
| 934 | Financial health (14) | coach |
| 986 | Daily tip (13) | coach |
| 1020 | Recovery plan (20) | budgets |
| 1044 | Search (16) | spending |
| 1065 | Subscriptions (24) | spending |
| 1078 | Wishlist (18) | coach |
| 1097 | Challenges (11 / 15) | coach |
| 1197 | Timeline (19) | overview |
| 1245 | Tag chip picker — wraps instead of overflowing (replaced the segmented bar) | add-expense modal |
| 1327 | Tag manager (custom tags) | customise pane |
| 1363 | Simulator (23) | coach |
| 1388 | Reflection dot (12) | expense rows |
| 1396 | Home widget (mini card) | `MoneyHomeCard` |
| 1479 | Star rating (reflection, 12) — `.gb-stars` + its caption; the amber fill is decoration, the caption carries the meaning | reflection modal |
| 1592 | Responsive | — |

Threshold colours: `is-near` at ≥80% of a budget, `is-over` above 100% — the JS in
`scripts/money.js` (`tabBudgets`) picks these class names, so keep the names in sync.
