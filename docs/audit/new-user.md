# New-user audit (NEW)

Tester: New-User Tester, 2026-10-12, build 96, integrated build at http://localhost:5588 (backend :8590).
Method: Playwright over CDP against my own headless Chrome (:9585). Real UI signup, 6-digit code read
from the backend console mail log, device timezone Asia/Kolkata. Four signups in total:

| Persona | Viewport | Account |
|---|---|---|
| 1. Busy professional (habits + tasks) | 390x844 | nu.pro.1791750053@example.com |
| 2. Spending in India (rupees) | 390x844 | `nu.rupee.*@example.com` |
| 3. Parent, family meal planning | 390x844 | `nu.parent.*@example.com` |
| 1 again, default plan | 1280x800 | `nu.desk.*@example.com` |

Screenshots: `docs/evidence/new-user/` (`p1-*`, `p2-*`, `p3-*` at 390x844, `d-*` at 1280x800).

Human time is estimated the same way as `first-run.md`, so the two can be compared: 3 s to read a new
screen, 1 s per tap, 0.3 s per character typed, 20 s to fetch the code from the mail app, plus the
measured machine wait where it is longer than 1 s. Taps count field focus taps, buttons and picker
options. Swipes are listed separately.

Note on the run: all personas shared one browser profile. Headless Chrome answers the notification
prompt with "denied", so after persona 1 the "Get reminded on time" step showed as done from the start
(the checklist reads "2 of 5" where a fresh browser would read "1 of 5"). That is my setup, not a bug.
NEW-8 covers the real behaviour behind it.

## What changed since first-run.md

Fixed and confirmed: the first screen is now "Create your account" with a one-line description
(FRU-1). One password field, Name marked optional (FRU-6). The OTP submits itself on the sixth digit.
The setup wizard is gone: verify lands straight on "Your plan is ready" with Balanced day pre-selected
and its five items listed (FRU-3, FRU-4, FRU-11). After "Start with this plan", Home puts the habits
right under the Log-it box, above the fold on both viewports (first tick button at y=377 of 800 on
desktop) (FRU-2). No achievement modal, and the toast says what was added ("Added 3 habits, 2
reminders and 2 goals.") (FRU-8, FRU-10). The streak freeze now explains itself ("1 streak freeze ·
covers a missed day · +1 a week") (FRU-13).

## Timelines

### Persona 1: busy professional, habits + tasks (390x844)

| # | Screen | Screenshot | Taps (cum.) | Keys (cum.) | Human s (cum.) | Notes |
|---|---|---|---|---|---|---|
| 1 | Create your account | p1-01-landing.jpg | 0 | 0 | 3 | Clear. Says what the app does |
| 2 | Form filled, Create account | p1-02-filled.jpg | 4 | 48 | 25 | |
| 3 | Verify your email | p1-03-verify.jpg | 4 | 48 | 28 | Still a hard gate (FRU-5, unchanged) |
| 4 | Code typed, auto-submits | p1-04-code.jpg | 5 | 54 | 51 | |
| 5 | Your plan is ready (Balanced day) | p1-05-after-verify.jpg | 5 | 54 | 57 | Machine 1.1 s from submit to sheet |
| 6 | Focus more added | p1-06-focus.jpg | 6 | 54 | 60 | Subtitle still says "A balanced day to start" (NEW-6). No pack creates a task |
| 7 | Start with this plan, Home | p1-07-after-start.jpg | 7 | 54 | 64 | Machine 2.6 s. Habits above the fold |
| 8 | **Plan for today, habits ready to tick** | p1-07-after-start.jpg | 7 | 54 | **67** | First value |
| 9 | First habit ticked | p1-08-ticked.jpg | 8 | 54 | 68 | The ticked row jumps to the bottom of the list (NEW-9) |
| 10 | "Add a task for today", task dialog | p1-09-task-dialog.jpg | 9 | 54 | 71 | Due is blank although the step says "for today" (NEW-5) |
| 11 | Task added | p1-10-task-added.jpg | 10 | 74 | 79 | Task shows "No due time" under "No tasks due on this day" (NEW-5) |
| 12 | Get reminded on time | p1-11-notify.jpg | 11 | | | "Notifications are blocked", yet the step ticks off (NEW-8) |
| 13 | Habits tab | p1-12-habits-tab.jpg | 12 | | | Two toasts from two screens stacked (NEW-15) |

Desktop 1280x800, same persona, taking the default plan: 6 taps, about 62 s, start to Home 1.6 s,
habits in the left column above the fold (d-01 to d-04).

**Totals:** about 67 s and 7 taps to a plan with habits to tick (first-run.md: about 108 s and 17
taps). Inside the app (after the code) it is now about 16 s and 2 taps, against about 47 s before.
Tasks need 3 more taps and still land without a date.

### Persona 2: spending in India, rupees (390x844)

| # | Screen | Screenshot | Taps (cum.) | Keys (cum.) | Human s (cum.) | Notes |
|---|---|---|---|---|---|---|
| 1 | Create your account | p2-01-landing.jpg | 0 | 0 | 3 | |
| 2 | Verify | p2-02-verify.jpg | 4 | 46 | 27 | |
| 3 | Your plan is ready | p2-03-plan.jpg | 5 | 52 | 56 | |
| 4 | Balanced day switched off | p2-04-none.jpg | 6 | 52 | 58 | Empty list, "Your plan is ready" and "A balanced day to start" stay; Start stays enabled (NEW-6) |
| 5 | Save money chosen | p2-05-money.jpg | 7 | 52 | 61 | Budget row greyed: "Suggested from your spending once you have logged some". Honest |
| 6 | Start, Home | p2-06-home.jpg | 8 | 52 | 65 | "Added 1 habit and 1 goal." |
| 7 | Log it: "spent 250 on lunch" | p2-07-logit.jpg | 10 | 70 | **73** | **Expense logged**: "Expense · ₹250 · Lunch · Cash", rupees without asking. The "Log every expense" habit stays unticked (NEW-7) |
| 8 | Open Money Buddy (Home card) | p2-08-money.jpg | 11 | | 80 | Cash already reads −₹250 with a warning (NEW-2). "Create a goal to score this" next to the pack's goal (NEW-12) |
| 9 | Monthly budgets: "From your last 30 days: Food ₹250." | p2-09-budget-suggest.jpg | 11 (+1 swipe) | | 84 | Suggests a month's food budget from one lunch (NEW-1) |
| 10 | Use these, **budget view** | p2-10-budget-set.jpg | 12 | | **86** | "₹0 a day from tomorrow", "Today went ₹238 past its share", "Food (100% used)", "Spent so far −₹250" (NEW-1, NEW-11) |

**Totals:** about 73 s and 10 taps to the first expense; about 86 s, 12 taps and 1 swipe to a budget
view. The budget it produces is useless: on day one it says the month is already spent.

### Persona 3: parent, family meal planning (390x844)

| # | Screen | Screenshot | Taps (cum.) | Keys (cum.) | Human s (cum.) | Notes |
|---|---|---|---|---|---|---|
| 1 | Signup + verify | (as above) | 5 | 51 | 51 | |
| 2 | Your plan is ready | p3-01-plan.jpg | 5 | 51 | 57 | Seven packs, none about family or meals for others. Hesitation (NEW-3) |
| 3 | I'll set it up myself, Home | p3-02-home-empty.jpg | 6 | 51 | 62 | Checklist of habits, tasks and mood. No word of Family anywhere on Home (NEW-3) |
| 4 | More sheet | p3-03-more.jpg | 7 | 51 | 70 | Family is the last item, under PEOPLE |
| 5 | Family: "Build your family" | p3-04-family.jpg | 8 | 51 | 76 | Good empty state with one button |
| 6 | Add family member form | p3-05-member-form.jpg | 9 | 51 | 82 | Six fields. Relationship pre-set to Mother, Gender to Female (NEW-10) |
| 7 | Name "Anu", Relationship Child, Add member | p3-06-after-add.jpg | 13 | 54 | 89 | **Member added.** Meena (Self) appears too, automatically. Anu is listed as Female (NEW-10). Stays on Members, no next step (NEW-4) |
| 8 | Today tab | p3-07-today.jpg | 14 | 54 | 94 | Groceries input and "Plan for: Anu, Meena", both on. Good |
| 9 | Make a meal plan, "Cooking up a plan" | p3-08-plan.jpg | 15 | 54 | 101 | 6 s wait |
| 10 | **Today's meal plan** | p3-09-plan-done.jpg | 15 | 54 | **104** | First value. "Assumed vegetarian" in fine print; "Who cooks?" offers the child (NEW-13) |
| 11 | Home afterwards | p3-10-home-after.jpg | 16 | | | No meal plan or family card on Home (NEW-3). The plan does persist (p3-11) |

**Totals:** about 104 s and 15 taps to a member and today's meal plan, with two navigation guesses
(More, then the "Today" tab). About 53 s of it is inside the app, close to the old first-run figure.

## Findings

### NEW-1: The one-tap budget suggestion turns a single expense into the month's budget, so day one reads "₹0 a day from tomorrow"
- Severity: High
- Where: `scripts/money.js:budgetsSection` (the "Use these" button), Money Overview, 390x844
- Repro / evidence: new account, log one expense "spent 250 on lunch" from Home. Open Money Buddy. The Monthly budgets card says "From your last 30 days: Food ₹250." Tap Use these. The overview then reads "₹0 a day from tomorrow · Today went ₹238 past its share, so the rest of the month has adjusted", "Left this month ₹0", and "You're close on Food (100% used), but there's room elsewhere" (there is no other budget). p2-09-budget-suggest.jpg, p2-10-budget-set.jpg
- Cause: the suggestion sums `last30` with no regard for how many days of history exist (here: one minute), then `Math.max(50, Math.round((v * 0.9) / 50) * 50)` rounds the "10% under" back up: 250 × 0.9 = 225, 225 / 50 = 4.5, rounds to 5, so ₹250. The starter pack's `budgetsFrom` deliberately declines on no history; this card does the opposite with one data point.
- Fix: offer the one-tap set only with enough history (for example expenses on 14 or more distinct days, or an account older than 2 weeks), else keep the "A gentle limit per tag" text with a "Set a budget" button that opens the budget dialog. If it must suggest early, scale by days covered (`spent / daysWithData * daysInMonth`) and use `Math.floor` for the 10% under. Touches `budgetsSection` in `scripts/money.js`; `budgetsFrom` in `scripts/starter-packs.js` uses the same `round` and should get the same `floor`.

### NEW-2: The first expense puts Cash at −₹250 and the app tells the user money must be missing
- Severity: Medium
- Where: Money Overview, "Where your money is" card, 390x844
- Repro / evidence: after the first expense from Home (it defaults to Cash), Money shows "Cash shows −₹250. Tell me what is in each right now and the balances line up again." and "A balance below zero usually means some money came in that isn't logged.", "Total across 2 accounts −₹250". p2-08-money.jpg (text from the run log)
- Cause: account balances start at 0, every expense is deducted, and the negative-balance warning has no exception for an account whose balance was never set.
- Fix: until the user sets a balance, show the accounts card as a neutral prompt ("How much is in Cash and Bank right now? Set balances") and hide negative totals and the warning. Touches the accounts block in `scripts/money.js` (grep "isn't logged").

### NEW-3: A parent finds no path to Family in first run: no pack, no Home card, and Family is three taps deep
- Severity: Medium
- Where: `scripts/app.js:openFirstRunSetup` (starter picker), `scripts/starter-packs.js:PACKS`, `scripts/dashboard.js:ScreenDashboard`, 390x844
- Repro / evidence: the plan sheet offers Balanced day, Sleep, Save money, Get fit, Eat better, Focus more, Stay hydrated (p3-01). Nothing mentions family or cooking for others. Home after "I'll set it up myself" has only habits, tasks and mood (p3-02). Family sits last in More › PEOPLE (p3-03). Even after a meal plan exists, Home shows nothing of it (p3-10). Result: 104 s and 15 taps, with two navigation guesses.
- Cause: the starter packs only write habits, reminders, goals, budgets and water; Family has no Home widget.
- Fix: add a "Plan family meals" chip to the plan sheet whose action, after "Start", opens Family's Add member form (or a pack kind `family` that routes there). Add a Home card "Today's meals" when the user has family members, showing the next meal from today's plan. Touches `PACKS` and `planStarter` in `scripts/starter-packs.js`, `applyStarter` in `scripts/app.js`, `HOME_WIDGETS` / `ScreenDashboard` in `scripts/dashboard.js`.

### NEW-4: After the first family member is added, the screen stays on Members with no pointer to the meal plan
- Severity: Medium
- Where: `scripts/family.js:addPanel` (save path), Family › Members, 390x844
- Repro / evidence: Add your first member → Add member. The list shows Anu and Meena (p3-06). The empty state promised "get balanced South Indian meal plans for everyone", but the meal plan lives behind a tab called "Today", with no button or hint on the Members view.
- Cause: save returns to the Members tab whatever the member count.
- Fix: when the first member is saved, either switch to the Today tab or show a card at the top of Members: "Make today's meal plan for Anu and you" that runs the plan. Consider renaming the "Today" tab "Meals today". Touches `addPanel` and the tab labels in `scripts/family.js`.

### NEW-5: "Add a task for today" opens with no due date, so the task is not on today and Home contradicts it
- Severity: Medium
- Where: `scripts/dashboard.js:OnboardingCard` step "Add a task for today" → task dialog; Home day detail, 390x844
- Repro / evidence: tap the step, type a title, Add task. The task shows "No due time" (p1-09, p1-10). Directly above it the day detail says "TASKS DUE 0 · No tasks due on this day." The new task sits at y=1867 of a 2010 px Home, under the calendar.
- Cause: the step calls the generic `onAddTask` with an empty Due field.
- Fix: open the dialog from this step with Due prefilled to today (date only, or end of day), and count undated tasks in "Today's tasks". Touches the `onAddTask` call in `OnboardingCard` (`scripts/dashboard.js`) and the task dialog's default due (in `scripts/app.js`, grep "Due (optional)").

### NEW-6: The plan sheet's copy does not follow the selection; with nothing picked it still says "Your plan is ready"
- Severity: Low
- Where: `scripts/app.js:openFirstRunSetup`
- Repro / evidence: switch off Balanced day: the list empties, the title stays "Your plan is ready", the subtitle stays "A balanced day to start…", and "Start with this plan" stays enabled (p2-04). With Save money chosen instead, it still says "A balanced day" (p2-05).
- Cause: title and subtitle are static strings built once; the primary button is never disabled by the picker.
- Fix: drop "A balanced day to start." from the subtitle (keep "Pick a goal to change it, or switch off anything that doesn't fit."), and disable the primary button, or relabel it "Skip for now", when the picker has no rows. Touches `openFirstRunSetup` and `starterPicker` in `scripts/app.js`.

### NEW-7: Logging an expense does not tick the "Log every expense" habit the Save money pack created
- Severity: Low
- Where: Home, Log it → expense; Save money pack habit, 390x844
- Repro / evidence: Save money pack → Home → "spent 250 on lunch" → Log it. Toast "Logged: Expense · ₹250 · Lunch · Cash", but "Log every expense" still shows an empty circle and streak 0 (p2-07).
- Cause: the habit is a plain manual habit; nothing links it to the money ledger.
- Fix: when an expense is saved, mark today done for a habit created by the money pack (store a `source: 'money'` marker on the habit at pack time, or match the pack's name). Touches `applyStarter` (`scripts/app.js`) and the expense save path.

### NEW-8: The "Get reminded on time" step ticks off when notifications are blocked
- Severity: Low
- Where: `scripts/app.js:remindersAsk`
- Repro / evidence: tap "Get reminded on time". The browser answers "denied"; toast "Notifications are blocked — enable them in your browser settings." The checklist goes to "4 of 5 done" with the step gone (p1-11). The user has no working reminders but the app counts it as set up.
- Cause: `return Notification.permission === 'default' ? 'ask' : 'done';` treats `denied` as done.
- Fix: return `'done'` only for `granted`; for `denied`, keep the step with the hint "Blocked in this browser. How to allow" (or drop the step without counting it). Touches `remindersAsk` and the step in `OnboardingCard`.

### NEW-9: Ticking a habit moves it to the bottom at once, sliding the next habit under the finger
- Severity: Low
- Where: Home › Habit streaks, 390x844
- Repro / evidence: tap the circle on "Drink a glass of water" (first row). It jumps to row 3 and "Walk 10 minutes" moves into row 1 (p1-07 then p1-08). A second quick tap at the same spot ticks a habit the user did not mean.
- Cause: the list re-sorts done habits last on every render.
- Fix: keep the order for the rest of the visit (sort once on screen entry), or delay the re-sort until the next render after navigation. Touches the habit list sort in `scripts/dashboard.js` (Habit streaks block).

### NEW-10: The Add member form pre-fills Mother/Female, and choosing Child keeps Female
- Severity: Low
- Where: `scripts/family.js:addPanel`, `memberFormControls`
- Repro / evidence: open Add your first member: Relationship "Mother", Gender "Female" (p3-05). Type "Anu", pick Child, Add member. The card reads "Child · Age not set · Female" (p3-06). The user never chose a gender. Date of birth, Height and Weight carry no "(optional)" label, though they are optional.
- Cause: the relationship select starts on its first option, and gender is set from `REL_GENDER` only when the name fills the relationship, never when the user changes the select.
- Fix: start Relationship on a blank "Choose" or "Child" (the most likely person a parent adds), set gender from `REL_GENDER` on every relationship change while gender is untouched, and default Gender to "Prefer not to say". Label the optional fields. Touches `memberFormControls` and `addPanel` in `scripts/family.js`.

### NEW-11: The budget line shows spending with a minus sign: "Spent so far −₹250"
- Severity: Low
- Where: `scripts/money.js` (`line('Spent so far', fmt(-spentMonth))`), Money Overview with a budget set
- Repro / evidence: p2-10-budget-set.jpg: "Budget for October ₹250 / Spent so far −₹250 / Left this month ₹0". Every other spend figure on the page is positive.
- Cause: the line is written as a receipt subtraction.
- Fix: print `fmt(spentMonth)` (the label already says spent), or label it "Minus spent". Touches that line in `scripts/money.js`.

### NEW-12: Financial health says "Create a goal to score this" right after the pack created a money goal
- Severity: Low
- Where: Money Overview, Financial health card
- Repro / evidence: Save money pack created the goal "Track spending for a month" (p2-06). Money's health card: "Goal progress 0 / 20 · Create a goal to score this", "Savings consistency · Add to a goal to build this" (p2-08 run log).
- Cause: the health score counts Money savings goals, a different object from Goals; the word "goal" means two things.
- Fix: call these "savings goals" in the health card ("Start a savings goal"), or have the Save money pack create a savings goal instead of a plain goal. Touches the health card copy in `scripts/money.js` or the money pack in `scripts/starter-packs.js`.

### NEW-13: The first meal plan silently assumes a vegetarian family and lists the child as a possible cook
- Severity: Low
- Where: Family › Today, after "Make a meal plan"
- Repro / evidence: p3-09: the plan is fine, but the only statement of the assumption is fine print under the macros: "No known allergens to avoid - assumed vegetarian preferences". Each meal's "Who cooks?" offers Anu (Child) alongside Meena.
- Cause: no food profile was asked for; the cook list is every member.
- Fix: one line above the plan: "Planned as vegetarian. Change food preferences" linking to the food profile; leave Child members out of "Who cooks?". Touches the meal plan view in `scripts/family.js`.

### NEW-14: Email verification is still a hard gate before any value (FRU-5, unchanged)
- Severity: Medium
- Where: `scripts/app.js:viewSignup` → `viewVerify`
- Repro / evidence: every persona spends about 26 s of their 51 s pre-app time on the code (p1-03, p1-04). With the in-app part now down to about 16 s for persona 1, verification is the largest single block on the path.
- Cause / Fix: as FRU-5 (product decision, security trade-off). The cheapest middle step: show the plan sheet before verification and write it after.

### NEW-15: Toasts from earlier screens stack and follow the user to the next screen
- Severity: Low
- Where: toast host, 390x844
- Repro / evidence: on the Habits tab, two toasts are visible at once: "Task added." (from Home) and "Notifications are blocked — enable them in your browser settings." (p1-12 run log). The money toast "Logged: Expense…" also stayed on screen into Money Buddy (p2-08).
- Fix: dismiss success toasts on screen change, keep only the newest one. Touches the toast module (`scripts/toast.js` or the toast helper in `scripts/app.js`).

## Severity counts

Critical 0, High 1, Medium 5, Low 9 (15 findings).
