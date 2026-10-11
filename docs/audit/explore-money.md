# Explore: Money, Food + Water, Health (prefix EXM)

Build 92, branch overhaul/2026-10-11. Driven with Playwright attached over CDP (localhost:9591) from
scratchpad scripts, at 1280x800 and 390x844 (isMobile, touch), on one seeded account
(`e2e.1791739894290.4870@example.com`, timezone set to Asia/Calcutta to match the browser) and one
`--empty` account. Totals were checked against `GET /api/money`, `/api/food`, `/api/water` and
`/api/health/readings` after each add, edit, delete and after a reload. Money history older than the
400-day window, two September rows and yesterday's meals were seeded through the API so Load older,
the month picker and Copy yesterday had something to work on.

Across every run: **no console errors, no page errors, no HTTP 4xx/5xx, no failed requests** (the
one 404 seen was a deliberate `GET /api/food/barcode/<unknown>` from the script). No horizontal page
overflow at 390 px on any screen in scope (the Spending tag strip is wider than the viewport, but it is
its own scroller, as intended). The AI gateway answered locally during this run (purchase advisor,
diet check, plate photo and calorie estimate all came back from the model), so the AI paths were
exercised and not only their fallbacks.

Screenshots: `docs/evidence/audit-explore-money/` (64 files, all under 300 KB).

## Completion by feature

| Feature | Measured completion | Evidence |
|---|---|---|
| Expenses: add, validate, edit, delete | 80% | Add/edit/delete reach the server and survive reload; amount validation (empty, 0, 0.001, over 1 crore) correct. Future dates accepted and then invisible (EXM-1); dialog delete has no confirm (EXM-2). `expense-modal-desktop.jpg`, `row-delete-confirm.jpg` |
| Income | 80% | Salary of 50,000 into Bank moved Bank 17,351 to 67,351; kept bar 48,151 = 50,000 - 1,849.50. No edit (EXM-9). `income-tab-filled.jpg` |
| Transfers (Move money) | 95% | Bank to Cash 2,000: Cash 5,000 to 7,000, Bank 20,000 to 18,000, total unchanged; Recent moves row with Undo. `move-money-dialog.jpg` |
| Accounts | 90% | Set "in it right now" on Cash/Bank moves the opening balance, balances exact; add card account works. Card debt is described as unlogged income (EXM-12). `accounts-card.jpg` |
| Budgets + month statement | 70% | Budgets save (decimal refused with a clear toast); per-tag bars correct. The statement mixes untagged spending with budgeted totals and contradicts itself (EXM-3); rounding drift (EXM-11). `overview-with-budgets.jpg`, `money-overview-seeded-390.jpg` |
| Bills / subscriptions | 75% | Totals 16,849/month and 2,02,188/year exact; overdue detection correct; Mark as paid books 649 to Bank. Deleting that payment strands the bill as paid (EXM-7); tag fixed to Entertainment (EXM-16). `subscriptions-card.jpg`, `subs-after-delete-paid.jpg` |
| Recurring ("Every month") | 85% | Rules save, list, pause; forecast shows "50,000 expected in". Posting on the rule's day not observable on the test day (a day-1 rule created on the 11th posts next month, as documented). |
| Loans + Split a bill | 70% | Lend 1,000 from Cash (Cash -1,000), part repayment 400 (Cash +400, "600 of 1,000"), borrow 5,000 into Bank (Bank +5,000), net "You owe 2,800" exact. Split a bill moves no money and books no expense (EXM-6). `loans-card.jpg`, `loans-after-split.jpg` |
| Savings goals | 85% | Create, contribute 2,500, health score picks it up. Suggested pace falls short of the target (EXM-10). `overview-goal-health.jpg` |
| Purchase advisor | 55% | Local verdict ignores price and goal impact when no reason is typed (EXM-4); AI take prints raw markdown (EXM-5). `advisor-result.jpg`, `advisor-buddy-take-markdown.jpg` |
| Coach: challenges, wishlist, journey, insights | 85% | Week-over-week and month-over-month percentages verified by hand (311%, 167%). Journey dates a milestone in the future (EXM-13). `coach-tab.jpg`, `coach-filled.jpg` |
| Customise pane (Settings) | 75% | New tag, duplicate refused, threshold 0, currency $ at 83.2, account in $: an expense of $10 booked as 832 with `orig`. Default-tag picker misses a just-added tag (EXM-14); the pane is hard to find (EXM-15). `customise-pane-filled.jpg` |
| Receipt scan + fallback | 90% | Camera pick from the expense dialog opens the receipt sheet; a non-receipt photo answers "Couldn't find any items..." with editable rows. `receipt-scan-result.jpg` |
| CSV | 100% | Every loaded expense, newest first, includes Load older rows, account names, BOM, formula-safe. Captured via a `URL.createObjectURL` hook (CDP contexts do not raise download events). |
| Load older + month picker | 95% | Fetches the 12 rows before the 400-day window, adds Mar-Jul 2025 to the picker, rows read-only. On an empty account the button just disappears with no "nothing older" note. `after-load-older.jpg`, `older-month-may-2025.jpg` |
| Spending search | 95% | "food this month" 1,201, "food last month" 450, skip intent, nonsense query, all correct. |
| Day panel, No-spend day | 100% | Today panel lists both tags; empty Saturday offers "I spent nothing", which persists across reload; No-spend refused on a day with spending. `day-panel-today.jpg` |
| Share summary | 90% | `navigator.share` received `money-week.png` (1.68 MB). |
| Water | 80% | +250, the 600 ms double-tap guard, custom 200 ml tea counted as 180 (server effective 1,180 / drank 1,200), goal 3,000, reload: all exact. Only 3 entries ever visible (EXM-8). `food-water-after.jpg`, `water-custom-dialog.jpg` |
| Food logging (typed kcal, AI estimate, recent chips, favourites, edit, delete) | 95% | Chapati 2 pcs typed 240 kcal; Paneer butter masala 200 g AI-estimated 330 kcal in 4.7 s with the loader; edit 80 g to 120 g rescaled 240 to 360; delete confirmed; 5,000 g refused; totals equal server after each step. `log-food-dialog.jpg`, `edit-food-dialog.jpg` |
| Barcode | 50% (verified part) | Button shows (BarcodeDetector present); headless camera refused, the overlay says "Camera permission was refused. Type the food in instead." Lookup itself not reachable without a camera. `barcode-scanner.jpg` |
| Copy yesterday | 100% | "Copy yesterday's breakfast" put Poha 200 g / 250 kcal on today as manual; the button for a slot already logged today disappears. |
| Week summary | 95% | Macro shares check out (carbs 209 g x 4 = 72% of 1,170 kcal; protein 10%; fat 18%); "Poha - 2 times" correct. `food-week-summary.jpg` |
| Diet check (day, week, tapped day) | 85% | All three answered with facts and suggestions. Disabled with no reason on an empty week (EXM-18); past days read against today's water goal (EXM-19). `diet-check-today.jpg`, `diet-check-empty.jpg` |
| Health readings + ledger | 95% | Steps sum (6,000 + 4,000), weight takes the newest, BP pair; refusals inline under the field (diastolic above systolic, 200,000 steps, a future day); detail 7/30/90 stats correct (72.2 average); edit, delete with confirm, reload all consistent with the server. `health-filled-desktop.jpg`, `health-weight-detail.jpg` |

## Findings

### EXM-1: A future-dated expense is accepted, taken off the balance, and then shown nowhere
- Severity: High
- Where: scripts/money.js `openExpenseModal` (date input), `tabSpending` expense list (`mExp`), `tabOverview`; backend `MoneyService.applyLedger`. Both viewports.
- Repro / evidence: Money > Add expense, 500, "Concert tickets", date = tomorrow (2026-10-12), Add. The server stores it (`GET /api/money` has `[500,"Concert tickets","2026-10-12"]`) and Cash drops by 500 (-1,450.50 to -1,950.50). It appears in no total ("Spent this month" stays 1,451), in no list (This month ends at today; the month picker has no November and no "upcoming"), so it can't be opened, edited or deleted from the app until that day. It is in the CSV, and it counts as a logged day: Coach shows "3-day logging streak" beside the badge's "2-day streak", and health's "Expense logging" reads 3/14 days. `overview-after-expenses-desktop.jpg`, `spending-tab-desktop.jpg`.
- Cause: the date input has no `max` (`date max attr null`), `onPrimary` never checks the date, the server takes any date, and every list and total is `inRange(..., todayKey())`.
- Fix: `max: todayKey()` on the expense (and income) date input plus a check in `onPrimary` ("Pick a day up to today.", the wording Health already uses); refuse `date > user's today + 1` in `MoneyService.applyLedger` for client-written rows. If planned spends are wanted, list rows after today under an "Upcoming" head in `tabSpending` instead.

### EXM-2: "Delete expense" in the edit dialog deletes at once, with no confirm and no undo
- Severity: Medium
- Where: scripts/money.js `openExpenseModal`, `danger.onClick`. Both viewports.
- Repro / evidence: Spending > tap the "Lunch" row > Delete expense. The dialog closes and the row is gone (`after dialog delete: modal= null`), no question asked. The trash icon on the same row asks "Delete "Groceries at BigBasket" (1,201)?" first (`row-delete-confirm.jpg`). docs/scripts/money.js.md says every delete in Money goes through `confirmDelete`; this one doesn't.
- Cause: `danger.onClick` filters and saves directly.
- Fix: wrap it in `confirmDelete('Delete expense', ..., () => {...})` as `expRow`'s trash button does.

### EXM-3: The month statement subtracts all spending from the budgeted tags' total, and the line under it contradicts the figure above
- Severity: Medium
- Where: scripts/money.js `tabOverview` (`totalBudget`, `spentMonth`), `buddyLine`. Overview, both viewports.
- Repro / evidence: budgets Food 2,000 and Shopping 1,500; spend Food 1,200.50, Entertainment 649 (Netflix), Pets 832. The slip reads "Budget for October 3,500 / Spent so far -2,681 / Left this month 819" and "41 a day from tomorrow. Today went 2,515 past its share", while the Budgets card right under it says Food 800 left and Shopping 1,500 left (2,300 left). The closing line says "Looking good - your budgets have breathing room this month." `money-overview-seeded-390.jpg`.
- Cause: `totalBudget` sums only tags with a budget, `spentMonth` sums every expense; `buddyLine` checks only per-tag `pct`, never the slip's own numbers.
- Fix: pick one meaning. Either spent = spending in budgeted tags (and a separate "plus 1,481 in tags without a budget" line), or label the budget line "Budget for October (Food, Shopping)" and treat untagged spending as over. Have `buddyLine` say nothing reassuring when today is past its share or the slip's left is under the per-tag left.

### EXM-4: "Should I buy this?" says "Go for it" for any price when no reason is typed
- Severity: Medium
- Where: scripts/money.js `advise` (want/need scoring, verdict). Overview > Should I buy this?
- Repro / evidence: Item "New phone", price 25,000, reason empty, Ask. Verdict "Go for it", with the reasons "This sounds like a genuine need", "Skipping it would cover 53% of what's left on Emergency fund" and "puts Emergency fund about 559 days further away". `advisor-result.jpg`. For "Earbuds 2,999" the same sheet then shows the AI's "Worth a short pause" under the local "Go for it".
- Cause: score 0 (no want or need words) counts as a need, and with no budget for the tag `fits` is true, so `!isWant && fits` wins; the goal impact never feeds the verdict. The word match is substring `txt.includes(w)`, so "workout" counts as "work" (need) and "refund" as "fun" (want).
- Fix: score 0 = undecided ("Worth a short pause" or "Depends on why"); let a large goal impact (for example over 25% of what is left) downgrade "Go for it"; match whole words (`\b` regex), as `predictCategory` already does for tags.

### EXM-5: Buddy's take in the purchase advisor prints raw markdown
- Severity: Low
- Where: scripts/money.js `openPurchaseAdvisor` (`res.advice` into a `<p>`); backend `MoneyService` `ADVISOR_PROMPT`.
- Repro / evidence: Ask about "Earbuds 2,999". The take starts "**Worth a short pause.** Earbuds at 2,999 ...", asterisks visible. `advisor-buddy-take-markdown.jpg`.
- Cause: the model answers in markdown; the text is set as plain text.
- Fix: tell the prompt "plain text, no markdown" and strip `**`/`*`/`#` server side before returning (one regex in the advice method), so every client is covered.

### EXM-6: Split a bill records the IOUs but not the bill: no expense, no money leaves an account
- Severity: Medium
- Where: scripts/money.js `openSplitBill`. Income > Loans > Split a bill.
- Repro / evidence: Total 2,400, "Ravi, Meena", Include my share on, "Dinner". Two loans of 800 each are written ("Ravi owes you 800 / Meena owes you 800"), but Cash and Bank are unchanged (6,400 / 72,351 before and after), and month spending is unchanged (1,849.50), so your own 800 share is never spending and the 2,400 that left your account is never recorded. The dialog itself says "You paid". `loans-after-split.jpg`.
- Cause: the loans are written without `accountId` and no expense is created.
- Fix: add a "Paid from" `accountPicker` and a tag to the split dialog; write one expense for your share on that account, and give each loan that `accountId` so `loanMove` books the others' shares as money out. Shares plus yours then equal the bill, as `splitShares` already guarantees.

### EXM-7: Deleting the expense that "Mark as paid" created leaves the bill marked paid
- Severity: Medium
- Where: scripts/money.js subscriptions card, `expRow` delete, `upcomingSubs`; backend `MoneyService.applyPaid` (forward-only `paidFor`).
- Repro / evidence: Netflix (due day 5) shows "overdue - was due 6 days ago", Mark as paid books `sub-<id>-2026-10` (649, Bank). Delete that expense from the list (confirm). The subscription keeps `paidFor: "2026-10"`, the overdue card and its Mark as paid button are gone, and the payment is no longer in spending or the Bank balance. The user can't mark it paid again this month. `subs-after-delete-paid.jpg`.
- Cause: `paidFor` is forward-only and nothing clears it when its expense goes.
- Fix: when an expense whose id is `sub-<subId>-<month>` is deleted, clear that subscription's `paidFor` if it equals `<month>` (in the delete path, before `save`). Or keep `paidFor` and have `upcomingSubs` treat "paid but no `sub-` row for the month" as unpaid. The server's `applyPaid` needs the same rule, or the WhatsApp tap path stays forward-only alone.

### EXM-8: The water card shows only the latest three drinks; earlier ones can't be seen or deleted
- Severity: Medium
- Where: scripts/dashboard.js `WaterCard` (`lastThree = entries.slice(-3)`). Food screen and Home, both viewports.
- Repro / evidence: log 500, 250, 250, tea 200. The server has 4 entries (1,180 effective), the card lists only tea, 250, 250 and has no "show all". The 500 ml entry has no delete button anywhere on the Food screen. `food-water-after.jpg`.
- Cause: the list is cut to three with no way to expand.
- Fix: show all of today's entries behind a "Show all N" toggle (as Money's income list does with `showAllIncome`), keeping three by default.

### EXM-9: Income entries can't be edited, only deleted
- Severity: Low
- Where: scripts/money.js `tabIncome` income rows, `openAddIncome`.
- Repro / evidence: Income > the Salary row has only "Delete income" (`income buttons [ 'Add income', 'Delete income' ]`); the row text is not a button. Expenses open an edit dialog from the row. A wrong salary amount or account means delete and re-add.
- Cause: `openAddIncome` has no `existing` path.
- Fix: give `openAddIncome(existing)` the same edit mode `openExpenseModal` has (same id, `editedHomeAmount` for the currency case) and make the row's text its button.

### EXM-10: The suggested goal pace falls short of the target
- Severity: Low
- Where: scripts/money.js `goalPlan` (`requiredWeekly`, `requiredDaily`).
- Repro / evidence: goal 50,000 due 1 Apr 2027, created 11 Oct 2026 (172 days). Shown: "Save 2,000/week (286/day) to make it by 1 Apr 2027." 172 days is 24.6 weeks: 2,000 x 24.6 = 49,143 and 286 x 172 = 49,192, both short by about 800. After a 2,500 contribution it reads 1,900/week and 272/day, again short.
- Cause: `weeks = ceil(days / 7)` rounds the number of weeks up, and `requiredDaily = ceil(weekly / 7)` derives the daily figure from the rounded weekly one.
- Fix: `requiredWeekly = ceil(remaining / (days / 7))`, `requiredDaily = ceil(remaining / days)`. Add the case to `money-calc.test.mjs`.

### EXM-11: Half-rupee amounts round differently in the statement and the budget card
- Severity: Low
- Where: scripts/money-core.js `fmt` (`Math.round`).
- Repro / evidence: one expense of 1,200.50 on Food. The slip says "Spent so far -1,200" while the Budgets card and the list say 1,201, and "1,201 of 2,000 / 800 left" adds to 2,001.
- Cause: `Math.round(-1200.5)` is -1200 but `Math.round(1200.5)` is 1201; the slip formats the negative.
- Fix: in `fmt`, round the absolute value and then apply the sign (`Math.sign(v) * Math.round(Math.abs(v))`).

### EXM-12: A credit card's balance below zero is explained as unlogged income
- Severity: Low
- Where: scripts/money.js `accountsCard` (`list.some((a) => Number(a.balance) < 0)`).
- Repro / evidence: add "HDFC Credit", type Card, in it right now -3,000. The card shows "A balance below zero usually means some money came in that isn't logged. Tap the account to set what it really holds." For a card, below zero is what it owes. `accounts-card.jpg`.
- Fix: skip `kind === 'card'` in that check and show a card's negative balance as "You owe 3,000" instead.

### EXM-13: The journey's "Best saving month" is dated the 15th, so it shows a future date
- Severity: Low
- Where: scripts/money.js journey builder (`date: topMonth + '-15'`).
- Repro / evidence: on 11 Oct, Coach > Your journey shows "Best saving month: 2,500 - October 2026 - 15 Oct" at the top, above events that already happened. `coach-tab.jpg`.
- Fix: use the latest contribution date inside that month (or today when it is the current month).

### EXM-14: The Customise pane's default-tag picker doesn't offer a tag added in the same pane
- Severity: Low
- Where: scripts/money.js `MoneyCustomisePane` (`defaultPicker` built once).
- Repro / evidence: Settings > Layout > Money: add the tag "Pets". It shows under Your tags, but "Default tag for new expenses" still lists only Food ... Others until Settings is closed and reopened. `customise-pane-filled.jpg`.
- Fix: rebuild the default picker in the add-tag and remove-tag handlers (the same place `renderList()` is called).

### EXM-15: Money's tags, currency and reflection settings are only reachable at the bottom of Settings > Layout
- Severity: Low
- Where: scripts/app.js `customisePanes` (`layoutPane`), scripts/money.js `ScreenMoney`.
- Repro / evidence: no button on any Money tab leads to tags, currency symbol, reflection threshold or other currencies. They sit in Settings > Layout under Features, Home cards and Bottom bar. The expense dialog's "New" tag chip is the only in-place customisation.
- Fix: a "Customise" link on Money (for example at the end of the Spending tag strip or the Overview footer) that opens Settings on Layout scrolled to the Money section.

### EXM-16: A new subscription is always tagged Entertainment
- Severity: Low
- Where: scripts/money.js `openAddSubscription` (`tagPicker(money, save, { initial: 'entertainment' })`).
- Repro / evidence: Rent (15,000) and Gym (1,200) both saved as `"category":"entertainment"`, so Mark as paid on Rent books 15,000 of Entertainment spending.
- Fix: guess from the name with `suggestCategory(name, money)` on input, as the expense dialog does, falling back to `others`.

### EXM-17: Several Money and Health controls are under the 44 px touch size at 390 px
- Severity: Low
- Where: scripts/money.js row icon buttons (`gb-icon-btn`), health card fix buttons, tag filter; scripts/health.js `Hero` facts. 390x844.
- Repro / evidence (measured with `getBoundingClientRect`): Delete expense / subscription / income / loan / challenge / goal, Undo this move, wishlist Remove: 30x30. Health card "Set budgets", "Create a goal", "Add expense": 26 px tall. Spending filter "All": 28x35. Health hero facts ("61 bpm", "120/80", "71.5 kg"): 18 px tall.
- Fix: raise `gb-icon-btn` to a 44 px hit area (padding or a `::before` hit box, keeping the 30 px look); same for the compact health-card buttons and the fact buttons.

### EXM-18: Diet check buttons are disabled on an empty week with no reason shown
- Severity: Low
- Where: scripts/dashboard.js diet check card (`disabled: !!st.loading || !canCheck`). Food > Summary, empty account.
- Repro / evidence: on the empty account "Check today" and "Check my week" are disabled; tapping does nothing and the card text still says "Buddy reads the dishes and water you logged". `diet-check-empty.jpg`.
- Fix: when `!canCheck`, replace the intro with "Log a meal or a glass of water first, then Buddy can read it."

### EXM-19: A past day's diet check is judged against today's water goal
- Severity: Low
- Where: backend `FoodService` diet check (water goal read from `users.daily_water_goal_ml`).
- Repro / evidence: the goal was 2.0 L on Saturday and changed to 3.0 L today. Tapping Saturday reads "1,170 of 2,000 kcal - 3 dishes - 0.0 of 3.0 L water".
- Cause: there is no goal history; the current goal is used for every day.
- Fix: acceptable as a ponytail, but say it ("against today's goal of 3.0 L"), or store the goal on each day's first water entry if history matters.

### EXM-20: Money and Food dialogs report field errors as toasts; Health puts them under the field
- Severity: Low
- Where: scripts/money.js `openExpenseModal`, `openSetBudgets`, `openAddSubscription`; scripts/app.js `openAddFood`.
- Repro / evidence: empty amount in Add expense gives a toast "Enter an amount greater than zero." (the field gets `aria-invalid` but no message); 5,000 g in Log food gives a toast "Amount must be 10 to 2000 grams."; a decimal budget gives a toast "Whole amounts only, like 1250.". Health's log form shows its refusals inline under the value (`gb-field-error`, role=alert). `expense-empty-amount-error.jpg`.
- Fix: throw `fieldRefusal(input, message)` (the helper Health already uses) from these `onPrimary` handlers so the message lands under the input.

### EXM-21: Copy nits seen on the way
- Severity: Low
- Where / evidence:
  - Spending search: "You spent 1,201 on "food" this month" vs "You spent 450 on Food last month": one quotes the raw key, the other the label (`searchExpenses`).
  - Coach > New challenge offers "Spend under 500 today" after today's spending is already 1,850.
  - Empty account, Spending > Weekly review: "Every expense you log makes next week clearer. Proud of you for showing up." with nothing logged.
  - Health header on an empty account: "Typed in by you." above "Nothing logged for today yet."
  - Account edit dialog always says "Removing an account with expenses archives it" even for an account with no history.
  - Advisor: "You haven't set a Others budget".
- Fix: use the tag label in the "this month" search answer; hide a daily-cap challenge already broken today; gate the weekly-review praise and the Health source line on there being entries; show the archive note only when the account has history; "an Others budget" or rephrase.

## Not verified

- Barcode lookup through the camera (headless Chrome refuses the camera; the refusal message is correct).
- Recurring rules actually posting on their day (needs the clock to reach the rule's day).
- The AI-unavailable fallbacks of the advisor, receipt reader and diet check: the local gateway answered during this run, so only the receipt reader's "no items" path was seen.
- Share summary on a browser without `navigator.share` (it was stubbed for the test).
