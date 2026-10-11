# styles/money.css — Money Buddy styles

Reuses the app's tokens, cards and buttons. Signature: **the statement** — the Overview hero is a
bank slip (`gb-money-slip*`: mono date head, perforated `gb-money-slip-tear` with notches clipped by the
slip's `overflow: hidden`, dotted-leader `gb-money-slip-line`s, the total double-underlined). The rest
keeps the ledger habits quietly: every amount in Space Mono, hairline rules instead of tinted boxes. All classes are `gb-money-*`. Numbers in the banners map to the Money feature
list (e.g. "(14)" = financial health).

| Section | Used by |
|---|---|
| Sub-tabs — `position: sticky` at the top of `.gb-scroll`, full-bleed `--surface` bar (same recipe as `.gb-family-sectionnav`); words on a rule, the open tab underlined in `--brand` | `tabBar` |
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
| Receipt scanner (rows are a grid: name / amount / remove, the tag `<select>` under them) + Add expense's `gb-money-scan-cta` | Add expense dialog |
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
| Every month (`gb-money-rec-row`, `.is-paused` dims; `gb-money-exp-amt.is-in` green; `gb-money-forecast-in`) | income tab, forecast |
| Budget rollover (`gb-money-roll` 44px checkbox label in the set-budgets row, which is a grid so every amount box starts at one x (≤440px, every phone: Roll over drops to a second row; the name wraps at word breaks only, `overflow-wrap: break-word`); `gb-money-bcard-carry` "+₹X carried", `.is-less` when negative) | set-budgets modal, budgets |
| Other currencies (`gb-money-fx*` rate rows + account selects, `gb-money-exp-orig` under an amount, `gb-money-account-home` under a foreign balance) | customise pane, rows, accounts |
| Load older (`gb-money-older`, sits with `.gb-money-showall`) | expense list |
| Slip check (`gb-money-jump-warn`: the 20x question as a warning above Save) and quiet deletes (`.gb-money-sheet .gb-btn--primary ~ .gb-btn--danger`: a dialog's Delete under its Save is red text, not a red block; a confirm's red primary is untouched) | expense dialog, every Money dialog with a delete |
| Responsive | — |
| The statement (last section before pressed feedback, so it wins same-specificity fights): the slip, the Space Mono amount list, the passbook expense list (`gb-money-ledger`, `gb-money-ledger-day`), accounts as ruled lines + double-underlined total, budgets on hairlines, `bsummary` / `review-stats` as label-left amount-right lines, `.gb-money-modal` number inputs in mono, the set-budgets row as a grid (icon / tag over Roll over / amount) | overview, spending, income, dialogs |

Threshold colours: `is-near` at ≥80% of a budget, `is-over` above 100% — the JS in
`scripts/money.js` (`tabBudgets`) picks these class names, so keep the names in sync.

Every `:hover` rule sits inside `@media (hover: hover)`: touch keeps `:hover` after a tap, so bars and
chips stayed recoloured. Pressed (`:active`) feedback for Money's own buttons is the block before Touch targets at the end of the
file (`.gb-btn` / `.gb-icon-btn` get theirs from app.css). Small pills take a 44px tap with an
`::after` overlay (`.gb-money-health-fix`, `.gb-money-quick-amt`), or `::before` (`.gb-money-tagchip`,
`.gb-money-chip`; "Touch targets" block at the end). Money's dialogs carry `.gb-money-sheet`
(`openMoneyModal`), which scopes the 44px `.gb-seg` there and on the screen (`.gb-money .gb-seg`)
without touching app.css; the receipt row's remove button is 44px square. Loan rows (`.gb-money-loan-row`)
wrap their amount and buttons onto a second line when the name can't keep 9rem.
