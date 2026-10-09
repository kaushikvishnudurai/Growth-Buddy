# styles/money.css — Money Buddy styles

Reuses the app's tokens, cards and buttons. Signature elements: the "safe to spend" hero ring and a
growth/sprout motif. All classes are `gb-money-*`. Numbers in the banners map to the Money feature
list (e.g. "(14)" = financial health).

| Section | Used by |
|---|---|
| Sub-tabs — `position: sticky` at the top of `.gb-scroll`, full-bleed `--surface` bar (same recipe as `.gb-family-sectionnav`) | `tabBar` |
| Hero: safe-to-spend ring | `tabOverview` |
| Insights | overview |
| Donut | spending breakdown |
| Coach callouts (`gb-money-coach-*`) | budgets, coach |
| Gamification | coach |
| Stat rows | income, review |
| Forecast | overview |
| Personality | coach |
| Actions row | spending |
| Week bars — each column carries its own CSS tooltip (`::after` on `data-tip`); the `title` it replaced was effectively invisible and absent entirely on touch | spending (last 7 days) |
| Category list / breakdown | spending (by tag) |
| History list (`gb-money-exp-row`, `gb-money-exp-list`) | spending (this month), income, subscriptions |
| Income / loans — settled row dims, amount struck through | income |
| Budget cards (`gb-money-bcard*`, `is-over` / `is-near`) | budgets |
| Budget modal fields | set-budgets modal |
| Purchase advisor | coach |
| Goal chips (modal) | goals |
| Savings goals | goals |
| Receipt scanner | spending |
| Empty state (`emptyHint`) | everywhere |
| Section head with multiple actions | budgets |
| Financial health (14) | coach |
| Daily tip (13) | coach |
| Recovery plan (20) | budgets |
| Search (16) | spending |
| Subscriptions (24) | spending |
| Wishlist (18) | coach |
| Challenges (11 / 15) | coach |
| Timeline (19) | overview |
| Tag chip picker — wraps instead of overflowing (replaced the segmented bar) | add-expense modal |
| Tag manager (custom tags) | customise pane |
| Simulator (23) | coach |
| Reflection dot (12) | expense rows |
| Home widget (mini card) | `MoneyHomeCard` |
| Star rating (reflection, 12) — `.gb-stars` + its caption; the amber fill is decoration, the caption carries the meaning | reflection modal |
| Responsive | — |

Threshold colours: `is-near` at ≥80% of a budget, `is-over` above 100% — the JS in
`scripts/money.js` (`tabBudgets`) picks these class names, so keep the names in sync.

Every `:hover` rule sits inside `@media (hover: hover)`: touch keeps `:hover` after a tap, so bars and
chips stayed recoloured. Pressed (`:active`) feedback for Money's own buttons is the last block in the
file (`.gb-btn` / `.gb-icon-btn` get theirs from app.css). Small pills take a 44px tap with an
`::after` overlay (`.gb-money-health-fix`, `.gb-money-quick-amt`). Loan rows (`.gb-money-loan-row`)
wrap their amount and buttons onto a second line when the name can't keep 9rem.
