# scripts/money.js — Money Buddy (4964 lines)

Exports: `emptyMoney()`, `normalizeMoney(m)`, `MoneyCustomisePane(money, save)`, `ScreenMoney`, `MoneyHomeCard`.

Persisted as **one JSON doc** per user via `GET/PUT /api/money` (app.js `loadMoney`/`saveMoney` →
backend `MoneyState`). Every insight here is a client-side heuristic — the only server AI call is the
purchase advisor (`POST /api/money/advice`), which falls back to a local heuristic when unconfigured.
Tone rule stated at the top of the file: money framed as growth, never guilt.

## Doc shape (`emptyMoney`, ~255)

```
expenses[]  {id, amount, category, note, date, createdAt, reflection?{satisfaction}}
income[]    {id, amount, source:'salary'|'other', label, date}
loans[]     {id, direction:'given'|'received', party, amount, date, settled}
goals[]     {id, name, target, dueDate, contribs[{amount,date}]}
subscriptions[] {id, name, amount, dueDay, category}
budgets{}   categoryKey -> monthly limit
challenges[], wishlist[], customCategories[], noSpendDays[]
settings{reflectThreshold:1000, currency:'₹', defaultTag:'others'}
```

`normalizeMoney` (~271) is the trust boundary — every array/object defaulted, `contribs` backfilled.

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
| `tabOverview` | ~2998 | safe-to-spend ring (`totalBudget - spentMonth`), per-day allowance for days left, buddy line, quick actions |
| `tabSpending` | ~3498 | actions row, NL search card, last-7-days bars, by-tag breakdown, weekly review, subscriptions, **this-month expense list** (`list = mExp`, tag filter, 60-row cap) |
| `tabBudgets` | ~3858 | monthly budget bars, ≥80% nudges, recovery card, totals |
| `tabGoals` | ~3990 | savings goals, contributions, ETA |
| `tabIncome` | ~4339 | this-month income/spent/net/lent stats, income list (all-time), loans |
| `tabCoach` | ~4553 | tips, health score, challenges, purchase advisor |
| `tabBar` | ~4742 | sub-tab bar: overview, spending, budgets, goals, income, coach |

Shared row/card builders: `expRow(e, withDelete)` (~3690), `subscriptionsCard`, `coachCard`,
`emptyHint`, `stat`, `weekBars`, `openMoneyModal`, `confirmDelete`.

## Gotchas

- **Everything month-scoped derives from dates**, so it self-clears when the month rolls over. If a
  number looks stale, the culprit is a list that skipped `inRange` — that was the bug in the History
  card (fixed: it now reuses `mExp`).
- Currency: module-level `cur`, set by `applyCurrency(money)` on every render. Not threaded through `fmt()`.
- `commit(fn)` mutates the doc then persists via the injected `save`; `money` is the live object.
- Self-check `_demo()` at the bottom runs **only on Vite DEV**, wrapped in try/catch so it never
  blocks boot. It covers: challenge progress, empty-account health = 0, income/loan sums,
  challenge suggestions. Add an assert here when you touch an engine.
