# scripts/money.js — Money Buddy

Exports: `emptyMoney()`, `normalizeMoney(m)` (returns COPIES of the ledger arrays: aliasing them lost quick-add expenses), `mergeMoney`, `ledgerDiff`, `applyLedgerDiff`, `docPart`, `LEDGER_ARRAYS`,
`MoneyCustomisePane(money, save)`, `ScreenMoney`, `MoneyHomeCard`, `searchExpenses` (for its test).

The screen still sees **one doc** (`GET /api/money`), but it is stored in two places: `expenses`,
`income`, `transfers` are ledger rows (`money_transactions`, last 400 days loaded) and `accounts` are
live balances from the server; everything else is the `MoneyState` document. app.js `saveMoney` splits
a save with `ledgerDiff(before, after)` → `POST /api/money/tx`, and `docPart(m)` → `PUT` only if changed.
Insights are client-side heuristics; the server AI calls are the purchase advisor (`POST /api/money/advice`) and the receipt reader in `openReceiptScan` (`POST /api/money/receipt-scan` via the `requestReceiptScan` prop, which shrinks the photo with Notes' `shrinkPhoto`); both fall back to no AI, and scanned items are only rows to confirm, never saved by the scan.
The tapped-day summary (`GET /api/money/day-summary`) is rules-only on purpose: its facts are exact,
so the AI only reworded them; the budget goes to Food, whose numbers are estimates.
Tone rule stated at the top of the file: money framed as growth, never guilt.

## Doc shape (`emptyMoney`)

```
expenses[]  {id, amount, category, note, date, createdAt, accountId?, reflection?{reason, planned, satisfaction}}   ← ledger
income[]    {id, amount, source:'salary'|'other', label, date, accountId?}                                       ← ledger
transfers[] {id, amount, from, to?, date, note}   (moving money between accounts; never counted as spending. No `to` = lent out, see loans; hidden from Recent moves)     ← ledger
accounts[]  {id, name, kind:'cash'|'bank'|'card'|'wallet', openingBalance, balance, archived}   (server's, read-only)
loans[]     {id, direction:'given'|'received', party, amount, date, note, settled, accountId?}   (accountId = optional "Given from" on a lent row: while outstanding, `loanMove` keeps a transfer `loan-<id>` with no `to` out of that account, so the balance drops; settling or deleting removes it)   ("Split a bill" writes one 'given' row per person, note `Split: …`)
goals[]     {id, name, target, dueDate, contribs[{amount,date}]}
subscriptions[] {id, name, amount, dueDay, category, paidFor?:'YYYY-MM', usesPerMonth?}  (paid → drops out of upcomingSubs; expense id `sub-<id>-<month>`, same as the server's WhatsApp path)
budgets{}   categoryKey -> monthly limit
challenges[], wishlist[], customCategories[], noSpendDays[]
settings{reflectThreshold:1000, currency:'₹', defaultTag:'others', lastAccountId?, accountsSetUp?}
```

`normalizeMoney` is the trust boundary — every array/object defaulted, `contribs` backfilled, and a
`noSpendDays` entry dropped once that day has a real expense (one place, for every path that logs one).

## Dates

All keys are `YYYY-MM-DD` strings; **all range filtering is string comparison**:
- `inRange(list, from, to)` — `e.date >= from && e.date <= to`
- month scope = `thisMonthPrefix() + '-01'` → `todayKey()`
- `lastMonthPrefix() + '-31'` is a deliberate string-max upper bound, not a real date
- helpers: `todayKey`, `dkey`, `parseKey`, `addDays`, `diffDays`, `daysInMonth`, `weekStartKey`, `lastNDays`

## Engines (pure functions)

| Function | What |
|---|---|
| weekly/monthly insight builders | plain-language "where your money goes" lines |
| `budgetStatus(money)` | per-category `{cat, budget, spent, pct, remaining}` for **this month** |
| purchase advice `advise` | does it fit the category budget / what it costs a goal, and how many days it sets that goal back at the recent saving pace (`goalPlan().weeklyRate`, only when there is one) |
| savings plan + ETA | from contributions + `dueDate`, no income needed |
| `setAsideThisMonth` / `setAsideInRange` | goal contributions as savings |
| `incomeInRange` / `sumIncome` | income filtering |
| monthly forecast | run-rate projection; subscriptions counted as committed spend |
| `challengeProgress(money, ch)` | no-spend / daily-cap / monthly save / log / reduce kinds |
| `suggestChallenges(money)` | personalized when data is rich, common presets when thin |
| daily tip | deterministic by day-of-month |
| `financialHealth(money)` | 0–100; **an empty account must score 0** (no phantom points) |
| `searchExpenses(money, q)` | NL-ish query: "how much on food last month" |
| `logStreak` / `bestStreak` | consecutive logging days |
| scenario projection | "cut X% of category for N months" |
| `recoveryPlan` | reallocate from categories with room when over budget |

## Tabs (each returns an array of cards)

| Fn | Contents |
|---|---|
| `tabOverview` | **today hero** (what's left for today; past its share, tomorrow's new daily share, never the overshoot as the headline) + **`monthTape`** (one cell per day: under / close / over a flat daily share, or depth by spend with no budget; no-spend ringed, today outlined; display-only, cells are far under a 44px target, so a day opens from Spending's 7-day graph; fills in on a visit's first paint only, `tapeShown`), `accountsCard`, `healthCard`, **`budgetsSection`**, **`goalsSection`**, donut, forecast |
| `tabSpending` | actions row, NL search card, last-7-days bars, by-tag breakdown, weekly review, subscriptions (due cards carry **Mark as paid**), **this-month expense list** (`list = mExp`, tag filter, 60 rows then **Show more**, `expShown`) |
| `budgetsSection` | ONE card (title, intro, totals, bars) + ≥80% nudges + recovery card. Was the Budgets tab. |
| `goalsSection` | ONE card (title, plan/new-goal actions, goal list). Was the Goals tab; its wishlist moved to Coach. |
| `tabIncome` | one kept-vs-spent bar for the month, the latest 6 income entries with their account (`showAllIncome` toggles all), loans (stats only when there are loans) |
| `tabCoach` | challenges, **wishlist**, journey, insights, personality, tips, share |
| `tabBar` | sub-tab bar: overview, spending, income, coach |

`healthCard` turns each part's `fix` (`'budgets' | 'goal' | 'log' | null`, set in `financialHealth`) into a
button, one per distinct fix; the "Next step" tip shows only once nothing is left at zero.

Subscriptions card: total per month **and per year**; each row shows its yearly cost and **cost per use**
(`costPerUse(sub)` = amount / `usesPerMonth`); the row is a button to `openSubscriptionUses`. Loans card has
**Split a bill** (`openSplitBill`, `splitShares(total, parties, includeMe)` — worked in paise, odd paise go to the
others, so the shares plus yours equal the bill to the paisa; exported, pinned in `money-ledger.test.mjs`). Loan rows are signed from your side: lent `+` green (owed to you), borrowed `−` red; the summary says **Owed to you** or **You owe**. Both helpers have asserts in `_demo()`.

Shared row/card builders: `expRow(e, withDelete)`, `subscriptionsCard`, `coachCard`,
`emptyHint`, `stat`, `weekBars`, `openMoneyModal`, `confirmDelete` (module level; every delete in Money goes through it, the customise pane's tag manager included).

**Share summary** is Money's use of `share-card.js` (Report's "Share my month" is the other). `shareSummary()` draws the week
as a 1080×1920 PNG and opens the OS share sheet (Instagram Stories lives in there); `summaryText()` /
`shareSummaryText()` are the original text path, kept as the fallback for anything that can't take a
file — old WebViews, desktop Firefox, and the Capacitor wrapper. Both share buttons (`weeklyReviewCard`,
the Coach tab) call `shareSummary`.

## Gotchas

- **Everything month-scoped derives from dates**, so it self-clears when the month rolls over. If a
  number looks stale, the culprit is a list that skipped `inRange` — that was the bug in the History
  card (fixed: it now reuses `mExp`).
- Currency: module-level `cur`, set by `applyCurrency(money)` on every render. Not threaded through `fmt()`.
- Amount fields: `readAmount(input)` keeps paise (the ledger is decimal(14,2)) and refuses a value `type=number` couldn't parse (`validity.badInput`, e.g. "1,250") instead of reading it as 0. Used by expense, income, loan, transfer, goal target and contribution, wishlist price, split total and account balances. Subscriptions, budgets and the reflection threshold stay whole units on purpose (the server's WhatsApp path rounds a subscription's amount, and its expense id is shared with ours): those fields are `inputmode=numeric step=1`, labelled "whole amounts" (not "rupees": the currency symbol is a setting), and read through `readWhole`, which refuses a decimal rather than rounding it. `fmt()` still displays whole units. The expense modal checks its own `max` (10,000,000) in JS, since a number input's `max` is never enforced outside a `<form>` submit; the server holds the same cap for client-written expenses (`MoneyService.applyLedger`, `MoneyLedger.EXPENSE_MAX`) and rounds to paise before its > 0 check, so 0.001 is refused rather than stored as 0.
- `commit(fn)` mutates the doc then persists via the injected `save`; `money` is the live object.
- **Every save re-renders the screen**: app.js calls `ScreenMoney` again. View state therefore lives at module level (`activeTab`, `spendFilter` + `filterScroll`, `lastSearch` typed / `searchAsked` run, `pickedDay`, `showAllIncome`, `tapeShown`, `expShown`, `loanOrder`, `daySummaries`). The second group resets on a fresh visit, detected by the previous root being detached (`moneyRoot.isConnected`; app.js builds the new screen before swapping). `loanOrder` keeps loan rows where they were on Settle/Undo until a tab switch.
- The "Quick reflection" sheet opens after a new expense only at or above `settings.reflectThreshold` (0 = off).
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
- `dayPanel(day)`: facts from the local copy at once, the server's rules paragraph from `requestDaySummary`, cached
  per screen by the day's entries (`stable()`), with Try again on error. app.js runs `requestDaySummary`
  behind `moneySaveQueue` + `flushLedger`: asked before the new expense reached the server, it
  summarised the old day and that answer was kept under the new key; an empty day offers
  "Add an expense" (date prefilled) and "I spent nothing".
- `searchExpenses` answers are scoped "since <earliest loaded month>", never "all time" (only ~13 months are loaded). Intents, checked in order: **essentials** ("unavoidable", "essential", "necessary": everything outside shopping/entertainment); **worth it** (a negation before skip/avoid/cut, "worth it": rated ≥4/5 or planned); **skip** ("skip", "avoid", "unnecessary", "not worth it"): spends rated ≤2/5 or unplanned wants not rated ≥4, with the
  reason on each row (`e.why`); a question it can't narrow tries its words against notes and tags, then says
  it didn't understand — it used to return every expense as "matching".
- `fmtDateShort` adds the year only when it isn't this year (two "1 Oct" salaries were different Octobers).
- Every save passes its snapshot: `save(next, money)` / `commitOn`. app.js `saveMoney(next, base)` diffs against `base` and lays the change onto the live state (`applyLedgerDiff`), so an item that arrived after the snapshot is never sent as a delete.
