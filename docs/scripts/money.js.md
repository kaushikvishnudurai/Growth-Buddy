# scripts/money.js — Money Buddy (5958 lines)

Exports: `emptyMoney()`, `normalizeMoney(m)` (returns COPIES of the ledger arrays: aliasing them lost quick-add expenses), `mergeMoney`, `ledgerDiff`, `applyLedgerDiff`, `docPart`, `LEDGER_ARRAYS`,
`MoneyCustomisePane(money, save)`, `ScreenMoney`, `MoneyHomeCard`, `searchExpenses` (for its test).

The screen still sees **one doc** (`GET /api/money`), but it is stored in two places: `expenses`,
`income`, `transfers` are ledger rows (`money_transactions`, last 400 days loaded) and `accounts` are
live balances from the server; everything else is the `MoneyState` document. app.js `saveMoney` splits
a save with `ledgerDiff(before, after)` → `POST /api/money/tx`, and `docPart(m)` → `PUT` only if changed.
Insights are client-side heuristics; the server AI calls are the purchase advisor (`POST /api/money/advice`)
and the tapped-day summary (`GET /api/money/day-summary`), both with a no-AI fallback.
Tone rule stated at the top of the file: money framed as growth, never guilt.

## Doc shape (`emptyMoney`, ~255)

```
expenses[]  {id, amount, category, note, date, createdAt, accountId?, reflection?{reason, planned, satisfaction}}   ← ledger
income[]    {id, amount, source:'salary'|'other', label, date, accountId?}                                       ← ledger
transfers[] {id, amount, from, to, date, note}   (moving money between accounts; never counted as spending)     ← ledger
accounts[]  {id, name, kind:'cash'|'bank'|'card'|'wallet', openingBalance, balance, archived}   (server's, read-only)
loans[]     {id, direction:'given'|'received', party, amount, date, settled}
goals[]     {id, name, target, dueDate, contribs[{amount,date}]}
subscriptions[] {id, name, amount, dueDay, category, paidFor?:'YYYY-MM'}  (paid → drops out of upcomingSubs; expense id `sub-<id>-<month>`, same as the server's WhatsApp path)
budgets{}   categoryKey -> monthly limit
challenges[], wishlist[], customCategories[], noSpendDays[]
settings{reflectThreshold:1000, currency:'₹', defaultTag:'others', lastAccountId?, accountsSetUp?}
```

`normalizeMoney` (~271) is the trust boundary — every array/object defaulted, `contribs` backfilled, and a
`noSpendDays` entry dropped once that day has a real expense (one place, for every path that logs one).

## Dates

All keys are `YYYY-MM-DD` strings; **all range filtering is string comparison**:
- `inRange(list, from, to)` (~325) — `e.date >= from && e.date <= to`
- month scope = `thisMonthPrefix() + '-01'` → `todayKey()`
- `lastMonthPrefix() + '-31'` is a deliberate string-max upper bound, not a real date
- helpers: `todayKey`, `dkey`, `parseKey`, `addDays`, `diffDays`, `daysInMonth`, `weekStartKey`, `lastNDays`

## Engines (~359–1400, pure functions)

| Function | What |
|---|---|
| weekly/monthly insight builders (~359–420) | plain-language "where your money goes" lines |
| `budgetStatus(money)` (~424) | per-category `{cat, budget, spent, pct, remaining}` for **this month** |
| purchase advice (~470–520) | does it fit the category budget / what it costs a goal |
| savings plan + ETA (~524) | from contributions + `dueDate`, no income needed |
| `setAsideThisMonth` / `setAsideInRange` (~632) | goal contributions as savings |
| `incomeInRange` / `sumIncome` (~637) | income filtering |
| monthly forecast (~719) | run-rate projection; subscriptions counted as committed spend |
| `challengeProgress(money, ch)` (~841) | no-spend / daily-cap / monthly save / log / reduce kinds |
| `suggestChallenges(money)` (~960) | personalized when data is rich, common presets when thin |
| daily tip (~1076) | deterministic by day-of-month |
| `financialHealth(money)` (~1130) | 0–100; **an empty account must score 0** (no phantom points) |
| `searchExpenses(money, q)` (~1165) | NL-ish query: "how much on food last month" |
| `logStreak` / `bestStreak` | consecutive logging days |
| scenario projection (~1383) | "cut X% of category for N months" |
| `recoveryPlan` (~1300) | reallocate from categories with room when over budget |

## Tabs (each returns an array of cards)

| Fn | Line | Contents |
|---|---|---|
| `tabOverview` | ~3118 | **today hero** (what's left for today; past its share, tomorrow's new daily share, never the overshoot as the headline) + **`monthTape`** (one cell per day: under / close / over a flat daily share, or depth by spend with no budget; no-spend ringed, today outlined; last-7-day cells open that day on Spending; fills in once per visit, `tapeShown`), `accountsCard`, `healthCard`, **`budgetsSection`**, **`goalsSection`**, donut, forecast |
| `tabSpending` | ~3498 | actions row, NL search card, last-7-days bars, by-tag breakdown, weekly review, subscriptions (due cards carry **Mark as paid**), **this-month expense list** (`list = mExp`, tag filter, 60-row cap) |
| `budgetsSection` | — | ONE card (title, intro, totals, bars) + ≥80% nudges + recovery card. Was the Budgets tab. |
| `goalsSection` | — | ONE card (title, plan/new-goal actions, goal list). Was the Goals tab; its wishlist moved to Coach. |
| `tabIncome` | ~4339 | one kept-vs-spent bar for the month, the latest 6 income entries with their account (`showAllIncome` toggles all), loans (stats only when there are loans) |
| `tabCoach` | ~4553 | challenges, **wishlist**, journey, insights, personality, tips, share |
| `tabBar` | ~4742 | sub-tab bar: overview, spending, income, coach |

`healthCard` turns each part's `fix` (`'budgets' | 'goal' | 'log' | null`, set in `financialHealth`) into a
button, one per distinct fix; the "Next step" tip shows only once nothing is left at zero.

Shared row/card builders: `expRow(e, withDelete)` (~3690), `subscriptionsCard`, `coachCard`,
`emptyHint`, `stat`, `weekBars`, `openMoneyModal`, `confirmDelete`.

**Share summary** (~3049) is the only place `share-card.js` is used. `shareSummary()` draws the week
as a 1080×1920 PNG and opens the OS share sheet (Instagram Stories lives in there); `summaryText()` /
`shareSummaryText()` are the original text path, kept as the fallback for anything that can't take a
file — old WebViews, desktop Firefox, and the Capacitor wrapper. Both share buttons (`weeklyReviewCard`
~3421, the Coach tab ~4791) call `shareSummary`.

## Gotchas

- **Everything month-scoped derives from dates**, so it self-clears when the month rolls over. If a
  number looks stale, the culprit is a list that skipped `inRange` — that was the bug in the History
  card (fixed: it now reuses `mExp`).
- Currency: module-level `cur`, set by `applyCurrency(money)` on every render. Not threaded through `fmt()`.
- `commit(fn)` mutates the doc then persists via the injected `save`; `money` is the live object.
- Self-check `_demo()` at the bottom runs **only on Vite DEV**, wrapped in try/catch so it never
  blocks boot. It covers: challenge progress, empty-account health = 0, income/loan sums,
  challenge suggestions. Add an assert here when you touch an engine. It also calls `share-card.js`'s
  `_demo()`, which has no DEV hook of its own.

## Accounts, the week chart, day summaries (Overview / Spending)

- `accountsCard` (Overview, under the hero): balances, `openAddAccount` / `openEditAccount` ("in it right now"
  moves the opening balance, history untouched; remove = archive when it has history) / `openSetBalances`
  (first-run prompt), `openTransfer` (From disables itself in To, Swap, quick amounts, "X has ₹… now"),
  and the last 3 transfers with undo — a transfer appears in no spending view, so this is where it's seen.
  Account writes go through the injected `accountRequest`, which app.js queues behind unsent ledger writes.
- "Paid from" / "Received in" = `accountPicker` over `segmented`; the expense modal defaults to
  `settings.lastAccountId`, bills to the first bank/card account (same rule as the WhatsApp path).
- `openExpenseModal(money, save, prefillDate, existing)` also edits: same id, reflection and createdAt kept;
  the expense row's text is the edit button (`gb-money-exp-edit`), delete sits in the dialog and the row.
- `weekBars(expenses, {selected, onPick, noSpendDays})`: amount over each bar, weekday + date under, "No log"
  for an empty day (worked out, not stored), "No spend" for one marked so. An outlier over 3x the next day
  caps the scale at 1.5x the next and draws that bar cut off (`is-clipped`), keeping its real label.
- `dayPanel(day)`: facts from the local copy at once, the coach's paragraph from `requestDaySummary`, cached
  per screen by the day's entries (`stable()`), with Try again on error. app.js runs `requestDaySummary`
  behind `moneySaveQueue` + `flushLedger`: asked before the new expense reached the server, it
  summarised the old day and that answer was kept under the new key; an empty day offers
  "Add an expense" (date prefilled) and "I spent nothing".
- `searchExpenses` answers are scoped "since <earliest loaded month>", never "all time" (only ~13 months are loaded). Intents, checked in order: **essentials** ("unavoidable", "essential", "necessary": everything outside shopping/entertainment); **worth it** (a negation before skip/avoid/cut, "worth it": rated ≥4/5 or planned); **skip** ("skip", "avoid", "unnecessary", "not worth it"): spends rated ≤2/5 or unplanned wants not rated ≥4, with the
  reason on each row (`e.why`); a question it can't narrow tries its words against notes and tags, then says
  it didn't understand — it used to return every expense as "matching".
- `fmtDateShort` adds the year only when it isn't this year (two "1 Oct" salaries were different Octobers).
- Every save passes its snapshot: `save(next, money)` / `commitOn`. app.js `saveMoney(next, base)` diffs against `base` and lays the change onto the live state (`applyLedgerDiff`), so an item that arrived after the snapshot is never sent as a delete.
