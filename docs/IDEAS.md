# The wow layer: ideas, scored (2026-10-12)

Guiding rule: **low input, high outcome.** Sources: `docs/RESEARCH.md`, `docs/audit/friction-capture.md`
(FRC), `docs/audit/friction-setup.md` (FRS), `docs/audit/first-run.md` (FRU), `docs/PROJECT_MAP.md`,
`CODEMAP.md`, `research/low-input-high-output.md` on `main`, and a grep of the code on
`overhaul/2026-10-11`, `main` and the parallel session's `ov-integration` feature branches.

## Read this first: three things already exist that the audits did not see

1. **`main` is 37 commits ahead of this branch** (build 95, against 92 here; merge-base `df11758`). It
   carries the `feat/life-plan` merge: `scripts/one-thing.js` `pickOneThing` + `dashboard.js`
   `OneThingCard` (one next-best action on Home), a Quick add bar at the top of Home, the goal picker as
   first-run step 1 (`openFirstRunSetup` `goalStep`), `outlook-card.js` `OutlookCard`, one camera
   button that routes itself, filled-in check-ins (`nudges.js` `lastNightGuess` / `sleepToConfirm`),
   the "Salary arrived?" coach card in `money.js`, health-custom, and two QA rounds. The FRU and FRC
   audits ran on build 92, so some of their "before" counts are already better on `main`.
   **Step 0 of any plan below: merge `main` into `overhaul/2026-10-11`** (see the sequence plan).
2. **The parallel session built several of these ideas on build 88** and they never reached `main`:
   `feat/ov-palette` (0e46d2b, command palette + shortcuts), `feat/ov-undo` (69b359c, undo instead of
   confirms), `feat/ov-import` (dcdf87a, Money CSV + .ics import), `feat/ov-ux-flows` (c227b40, ten
   short-flow fixes), `feat/ov-onboard` (656c9f2, shorter sign-up), `feat/ov-pwa` (3b51874, manifest
   shortcuts + share target), `feat/ov-parity`, and e1c4325 (one-tap next steps). Each has tests and
   an e2e script. Porting them is the cheapest wow there is; their effort below is a port, not a build.
3. **WhatsApp already takes input.** `WhatsAppWebhookController` sends any text that isn't SNOOZE
   through `QuickAddService` and `QuickAddApplier` saves it. What's missing is that nobody is told.

## Scoring

- **Impact** 1-5: how much it changes the outcome for most users (5 = daily, every user).
- **Effort** 1-5: engineering cost (1 = under half a day, 5 = weeks or an external dependency).
- **Input** 1-5, lower is better: what the *user* has to do once it exists.
- **Score = impact x 2 - effort - input.**
- Input counts are taken from the FRC/FRS/FRU tables (taps / fields / decisions / screens) where the
  flow was measured; "after" is what the spec would give on the same path.
- AI rule: every AI use has its no-AI path stated. Repo trap 6 in CODEMAP.

---

## Ideas

### I-01 Capture line: one sentence, applied at once, with Undo

Quick add (header +, the Home bar from `main`, and the palette) focuses its input on open. A line the
model reads as **one** log intent (expense, water, food, task, note, reminder, sleep, mood, habit tick) is
written straight away and the toast names what was guessed, with Undo: "Expense 250 · lunch · Food ·
Cash · Undo". The preview stays for two or more intents, for `fallback: true` reads and for any unknown
row. Undo deletes what was written (`removeDocItem` + `saveMoney`, `deleteWaterEntry`,
`deleteFoodEntry`, the task / note / reminder DELETE). Quick add expense and income land in the default
account (FRC-3). The add sheet gains Expense, Water and Meal rows. A new pure `parseWhen(text, now)`
(today, tonight, tomorrow, a weekday, "at 5pm", "17:00", "in 2 hours"; "urgent" / "asap" = High) reads
dates out of a **task title** and the **reminder form**, shown as a removable "Due tomorrow 17:00" chip
and stripped from the title on save. A one-off reminder whose time already passed today moves to
tomorrow and the toast says so (FRC-12). No-AI path: `QuickAddFallback` already answers with
`fallback: true`, and those reads keep the preview.

| | Before | After |
|---|---|---|
| Expense via Quick add | 4 taps, 1 field, 1 decision, 3 screens, +2.5 s parse | 2 taps, 1 field, 0 decisions, 1 screen |
| Task with a due time | 7 taps, 2 fields, 2 decisions, 2 screens | 2 taps, 1 field, 0 decisions, 2 screens |
| One-off reminder | 5 taps, 2 swipes, 2 fields, 2 decisions, 3 screens | 2 taps, 1 field, 0 decisions, 1 screen |

- Impact 5 · Effort 3 · Input 1 · **Score 6**
- Exists: `app.js` `openAddSheet`, `submitQuickAdd`, `openQuickAddPreview`, `applyQuickAdd`,
  `parseQuickAdd`, `addQuickExpense` / `addQuickIncome`, `pushToast(msg, kind, ms, {label, run})`;
  `main`'s Home Quick add bar (97d2e11); `QuickAddFallback.DAY` / `AT_TIME` (the Java twin of
  `parseWhen`); `feat/ov-ux-flows` F05 (reminder sheet reads the time from the words) and F12
  (Today / Tomorrow chips on a task's due field).
- Files: `scripts/app.js` (the functions above, `taskForm`, `addReminder`), new `scripts/when.js` +
  `scripts/when.test.mjs`, `scripts/calendar.js` (reminder add form), `docs/scripts/app.js.md`.
- Backend / schema: no.
- Absorbs FRC-3, FRC-4, FRC-5, FRC-11, FRC-12, FRC-13.
- Playwright: seeded account, 390x844. Fill the Home bar with "spent 250 lunch", Enter. Expect a toast
  matching `/Expense 250.*lunch.*Undo/`, no "Log these?" dialog, and `GET /api/money` to hold the
  expense with an `accountId`. Click Undo, expect the row gone from `GET /api/money`. New task "Call
  plumber tomorrow 5pm": expect a chip "Due tomorrow" and the `POST /api/tasks` body to carry
  `title: "Call plumber"` and a `dueAt` of tomorrow 17:00 local. Guard fixture: zero console errors,
  zero 4xx.

### I-02 Today: finish the next-best-action layer

`main` already pins one action on Home (`pickOneThing`). This finishes the layer so every daily log on
Home is one tap. The Daily brief's chips become buttons: the water pill is "+250 ml" (the user's most
common size today, `quickAddWater`, already optimistic and offline-safe) with Undo; the sleep and mood
pills go while the Sleep and mood card is on screen (FRC-6). The default Home order puts habits right
after Sleep and mood (only accounts without a saved layout move; FRC-7, FRU-2). "Same as yesterday"
chips per meal slot ("Breakfast: 2 idli again?", from `GET /api/food?date=<yesterday>` read once, only
while the slot is empty; tap = `entries/copy?slot=`), the repeat-expense guess (`repeatExpense`, today
3 swipes down in the Money card, FRC-15) and the salary guess (`main`'s "Salary arrived?" rule, moved
into `money-core.js` so boot can read it, FRC-16) join the brief as one-tap chips. The one-tap sleep
confirmation saves the user's usual quality, and a quick mood tap carries their usual energy and stress
(`usualSleep` returns `quality`, new `usualMood`; FRC-9). No AI anywhere.

| | Before | After |
|---|---|---|
| Log water | 3 taps, 1 decision, 3 screens | 1 tap, 1 screen |
| Tick a habit from Home | 1 tap + 3 swipes | 1 tap |
| Repeat breakfast | 5 taps, 1 swipe, 1 decision, 4 screens | 1 tap |
| Repeat expense | 1 tap + 3 swipes | 1 tap |
| Salary on payday | 5 taps, 1 field, 2 decisions, 4 screens | 1 tap |
| Quick sleep "Yes" | 2 taps, saves the wrong quality | 1 tap, right quality |

- Impact 5 · Effort 2 · Input 1 · **Score 7**
- Exists (on `main`): `one-thing.js` `pickOneThing`, `dashboard.js` `OneThingCard` / `TodayPlanCard` /
  `WellnessQuick`, `nudges.js` `repeatExpense` / `usualSleep` / `sleepToConfirm`, `money.js` salary
  coach card, `app.js` `quickAddWater` / `copyYesterdaySlot`; `feat/ov-ux-flows` "brief chips are
  buttons" (F07).
- Files: `scripts/nudges.js` + `nudges.test.mjs`, `scripts/one-thing.js` + test, `scripts/dashboard.js`
  (`TodayPlanCard`, `WellnessQuick`), `scripts/home-order.js` + test, `scripts/money-core.js` (one pure
  salary rule), `scripts/app.js` (`SCREENS.home` props, `onConfirmSleep`, `onQuickMood`).
- Backend / schema: no.
- Absorbs FRC-6, FRC-7, FRC-9, FRC-15, FRC-16, FRU-2 (habit placement half).
- Playwright: account B from the FRC audit (6 "good" nights, nothing today), `page.clock` at 08:30.
  Expect the first "Mark as done" inside the first 844 px of `#gb-main`. Click "+250 ml": expect
  `POST /api/water/entries` with 250 and the chip to update. Click the sleep "Yes": expect
  `GET /api/daily-logs` today's quality `good`. With yesterday's breakfast seeded, expect a chip
  "Breakfast: ... again?" and one click to `POST /api/food/entries/copy?slot=breakfast`.

### I-03 Command palette, universal search, keyboard shortcuts (port)

Port `feat/ov-palette`. Ctrl/Cmd+K, "/" or the header search button opens one input over actions,
screens and the user's tasks, habits, goals, reminders and notes, ranked by `palette-core.js` (prefix,
then word start, then substring; diacritic-insensitive; ties by kind then recency). A sentence that
matches nothing goes to Quick add (`runQuickAdd`, which the port extracts and I-01 then builds on).
Recent picks persist in `ui_prefs.paletteRecent` (the database, per the persist-to-DB rule). Shortcuts:
`n` new task, `g` then `h/c/m/n/r/s` to go, `?` a help sheet. The UI is a lazy chunk; the original
grew boot by 3.4 kB. No AI except the Quick add hand-off, which has its fallback.

| | Before | After |
|---|---|---|
| Open a note by name | 4 taps, 1 field, 3 screens | 1 chord, 1 field, Enter |
| Go to Money (desktop) | 2 clicks | 2 keys (`g m`) |
| Find a reminder | More, Calendar, scroll the month | 1 chord, 1 field |

- Impact 4 · Effort 2 (port) · Input 1 · **Score 5**
- Exists: `feat/ov-palette` 0e46d2b: `scripts/palette.js`, `palette-core.js` + test,
  `scripts/e2e/palette.e2e.mjs`, hooks in `app.js`, `gb-kit.js`, `notes.js`, `goals.js`;
  `notes-core.js` `createSearchCache`.
- Files: new `scripts/palette.js`, `scripts/palette-core.js` + test, `e2e/palette.spec.mjs` (rewritten
  for `e2e/fixtures.mjs`); `scripts/app.js` (global keydown, header button, `runQuickAdd`);
  `scripts/gb-kit.js` (header slot); small exports in `notes.js`, `goals.js`; CSS in a new
  `styles/palette.css` imported by `palette.js` (not `app.css`, which the design agent is editing).
- Backend / schema: no (`ui_prefs`).
- Playwright: desktop project. `page.keyboard.press('Control+K')`, expect `role=dialog` with the input
  focused. Type "milk", expect the seeded "buy milk" task first, Enter opens it. Type "spent 80 chai",
  expect a "Log with Quick add" row. Press Escape, then `?`, expect the shortcuts sheet. Press `g` `m`,
  expect `location.hash` `#money`. Mobile project: the header search icon opens the same dialog.

### I-04 Undo everywhere instead of "Are you sure?" (port)

Port `feat/ov-undo`. One shared deferred delete (`deferDelete` over DOM-free `undo-queue.js`): the item
leaves the screen at once, a toast says "Task deleted." with Undo for 6 s, and the DELETE is sent only
when the window passes. Hover or focus on the toast holds the window; closing the toast sends it now;
pagehide, hidden and sign-out flush first (keepalive, through the outbox, so offline still queues and a
temp-id delete cancels its queued create). Each delete has its own toast. Applies to task, habit, goal,
water and food entries, a one-off reminder and "delete whole series"; notes already Undo. Kept as
confirms: shared or irreversible things (delete forever, leave family, delete circle, end mentorship).
Money stays out on purpose (its own ledger diff and pending queue; see ROADMAP R-17).

| | Before | After |
|---|---|---|
| Delete a task | 3 taps, 1 decision | 2 taps, 0 decisions, 6 s to take it back |
| Delete a water entry | 2 taps, 1 decision | 1 tap |

- Impact 4 · Effort 2 (port) · Input 1 · **Score 5**
- Exists: `feat/ov-undo` 69b359c (`undo-queue.js` + test, `scripts/e2e/undo.e2e.mjs`); today
  `app.js` `confirmDelete` (5 uses), `notes.js` `restoreNote`, `family.js` shopping Undo.
- Files: new `scripts/undo-queue.js` + test; `scripts/app.js` (`deferDelete`, the five
  `confirmDelete` sites, sign-out and pagehide flush, `render` / `overlayOutbox` re-apply), 
  `scripts/calendar.js` (one-off delete, series delete), `scripts/notes.js`, `scripts/a11y.js` (a toast
  button is never a dialog's trigger), `e2e/undo.spec.mjs`.
- Backend / schema: no.
- Playwright: delete a seeded task. Expect it gone, and **no** `DELETE /api/tasks/*` within 5 s
  (`page.on('request')`). Click Undo, expect it back at the same index and still no request. Delete
  again and wait 7 s, expect one DELETE. Delete a third, close the page, expect the DELETE sent with
  `keepalive`. Both projects.

### I-05 Evening close-out in two minutes, and tomorrow planned

From 19:00 the one-thing card (and the evening reflection bell card, when the user set one) offers
"Close the day". One sheet, five rows, each one tap: (a) habits still open, tick in place; (b)
unfinished tasks, "Move all to tomorrow" (or per row); (c) a mood tap if none today; (d) a drafted line
built from the day ("Today: 3 tasks done, Walk streak 5, water goal met"), editable, saved as the day's
note in the weekly review's wins when the user keeps it; (e) tomorrow's plan, `buildDayPlan` run for
tomorrow (FRC-8: after `DAY_END` it drafts nothing today), with "Add to tomorrow". One Done. This is
Sunsama's shutdown ritual without the twenty minutes. The line is written from data, not by a model; an
AI rewording can come later with the data line as its fallback.

| | Before | After |
|---|---|---|
| Tick 2 habits, move 2 tasks, log mood, plan tomorrow | about 25 taps, 7 swipes, 4+ screens (two date pickers at ~4 taps each, tomorrow's reminders by hand) | 7 taps, 0 swipes, 1 screen |
| A day with nothing open | n/a | 2 taps (open, Done) |

- Impact 5 · Effort 3 · Input 2 · **Score 5**
- Exists: `day-plan.js` `buildDayPlan` (today only), `app.js` `openDailyPlan`, `review.js`
  `weeklyWinsDraft`, `dashboard.js` `WellnessQuick` mood scale, `PUT /api/tasks/{id}` `dueAt`,
  `mentor/ReflectionScheduler` (`ui_prefs.buddyReflection`, a fixed-text bell card + push).
- Files: new `scripts/close-out.js` (pure: the rows and `dayWinsDraft`) + `close-out.test.mjs`, new
  `scripts/close-out-ui.js` (lazy sheet) + `styles/close-out.css`; `scripts/day-plan.js` (take `day`
  and `nowMin`, skip one-offs already past) + `day-plan.test.mjs`; `scripts/app.js` (one lazy opener
  `openCloseOut`, `openDailyPlan` switches to tomorrow after `DAY_END`). The one-thing hook is a
  `closeout` kind in `one-thing.js`, wired by I-02's owner (see the sequence plan).
- Backend / schema: no. Later, text only: `ReflectionScheduler`'s card deep-links `#/closeout`.
- Absorbs FRC-8.
- Playwright: seeded account with 2 open habits and 2 open tasks, `page.clock` at 21:30. Expect the
  Home card "Close the day", open it. Tick one habit: expect `POST /api/habits/{id}/checkin`. Click
  "Move all to tomorrow": expect two `PUT /api/tasks/*` with tomorrow's `dueAt`. Click "Add to
  tomorrow": expect `POST /api/reminders` with tomorrow's date. Done: expect the card gone from Home.

### I-06 Money in one tap: budgets suggested, bills from templates, repeats detected

The budgets sheet opens filled in: with 30 days of spending, every category from `budgetsFrom` (10%
under spend, already written and tested); with none, one question, "What can you spend a month?"
(prefilled from logged or repeating income), split across categories by a default ratio, then Save.
An empty Budgets card sits on the Overview (today the only way in is below the fold, FRS-7). One "Bills
and repeats" sheet replaces Add subscription and Add repeat on two tabs (FRS-9): chips Rent,
Electricity, Phone, Internet, Netflix, SIP, EMI fill tag, kind ("Posts by itself" / "I mark it paid")
and a due day of today; a typed name sets the tag through `suggestCategory` until the user picks one
(FRS-8). `repeatExpense` and a second matching salary each offer "Make it a monthly repeat". The six
rollover boxes become one switch. No AI.

| | Before | After |
|---|---|---|
| Set budgets (3 categories) | 7 taps, 3 fields, 8 decisions, 5 screens | 3 taps, 0-1 field, 1 decision, 3 screens |
| Add a recurring bill | 9 taps, 2-3 fields, 4 decisions, 6 screens | 4 taps, 1 field, 1 decision, 3 screens |
| Salary every month | 5 taps a month | 0 after one tap |

- Impact 4 · Effort 2 · Input 1 · **Score 5**
- Exists: `starter-packs.js` `budgetsFrom`, `money-core.js` `suggestCategory`, `money.js`
  `openAddSubscription` / `openRecurring` / `budgetsSection` / `tabOverview`, `recurring[]` (auto-post),
  `nudges.js` `repeatExpense`, `main`'s salary-arrived card.
- Files: `scripts/money.js`, `scripts/money-core.js` (a pure `splitBudget`), `scripts/money-calc.test.mjs`,
  `e2e/money-onetap.spec.mjs`, `docs/scripts/money.js.md`.
- Backend / schema: no.
- Absorbs FRS-7, FRS-8, FRS-9, FRU-14.
- Playwright: empty account, Money. Expect a Budgets card on Overview, click "Set budgets", type 30000
  once, Save: expect `PUT /api/money` with six budgets summing to 30000. Open "Bills and repeats", click
  "Electricity", type 1200, Save: expect the saved subscription tagged `bills` with today's day of month.

### I-07 Indian home food in one tap, with katori portions

Log food opens on a slot-aware grid of about 40 common home dishes (breakfast: idli, dosa, poha, upma,
paratha; lunch and dinner: rice, roti, dal, sambar, rasam, sabzi, curd, rajma, chole, biryani; snacks:
chai, coffee, samosa, banana, sundal), each with a default portion in katori (a 150 ml bowl), piece,
plate or cup and a per-portion kcal and macro figure from one checked-in table. A tap logs it as manual
kcal (no AI, no 11 s wait, outside the AI rate limit) with Undo; a second tap on the same chip within
the toast adds a portion ("2 roti"); a stepper gives half, one, two. "Same as yesterday" for the slot is
the first chip (`copyYesterdaySlot`). The typed path gets a "katori" unit too. The AI photo estimate
stays for anything not on the grid; the grid is the fallback when the gateway is off (it returns 401
locally today).

| | Before | After |
|---|---|---|
| Log "masala dosa" typed | 5 taps, 1 swipe, 2 fields, 1 decision, 4 screens, +11.2 s AI wait | 1-2 taps, 0 fields, 0 decisions, 0 s wait |
| Lunch of rice, dal, sabzi, curd | 4 typed entries (or a photo and an AI wait) | 4 taps |

- Impact 4 · Effort 2 · Input 1 · **Score 5**
- Exists: backend `FoodWeek.kcalPer100g` / `gramsPerPiece` keyword table, `POST /api/food/entries/manual`,
  `nutrition.js` `MEAL_SLOTS` / `mealSlotAt`, `app.js` `openAddFood` (recent chips, `UNITS`),
  `copyYesterdaySlot`, food favourites; `feat/ov-ux-flows` F10 (recent and favourite chips log at once
  with Undo).
- Files: `scripts/nutrition.js` (`INDIAN_PICKS`, pure `portionKcal`) + `nutrition.test.mjs`;
  `scripts/app.js` `openAddFood` (the grid, the katori unit); optionally backend `FoodWeek` (katori
  grams, so a WhatsApp or Quick add "2 katori dal" agrees with the grid).
- Backend / schema: no (optional small `FoodWeek` change, no schema).
- Decision needed: the source of the kcal table (IFCT 2017 / NIN), see the decision list.
- Playwright: `page.clock` at 08:30, open Log food. Expect the first chips to include Idli, Dosa,
  Poha. Click "Idli (2 pc)": expect `POST /api/food/entries/manual` with `foodName: "Idli"`,
  `mealSlot: "breakfast"`, a `kcal` in range, and the dialog closed within 500 ms. Click Undo, expect
  `DELETE /api/food/entries`.

### I-08 A break, not a broken streak (rough week) and a reward for coming back

One switch in Settings, and offered by the one-thing card after 2+ missed days or three low moods in a
row: "Take a break: 3 / 7 / 14 days". While on a break, habit days count as rest (no freeze tokens
spent, no missed cells), habit reminders, the water nudge and the digest stay quiet (timed reminders the
user set still ring: they chose that minute), budgets read "paused", and Home says "On a break until Fri
· End now". Coming back, from a break or from a gap longer than the user's own usual gap, the next
check-in gets a "Back on it" toast and a small XP bonus instead of a reset counter, and a broken streak
shows the best run kept and the days done in the last 30 rather than a zero. Evidence:
Silverman and Barasch 2023 (broken streaks lower continuation), Milkman et al. 2021 (a comeback bonus
was the megastudy's best arm, +27%), Apple's paused rings.

| | Before | After |
|---|---|---|
| Keep 3 habits alive through a 7-day rough patch | not possible (2 freeze tokens at most); else pause each habit (3 taps each) and mute kinds (6 taps) | 2 taps, once |
| Coming back | a "0 day streak" | one kind line and the run kept |

- Impact 5 · Effort 3 · Input 1 · **Score 6**
- Exists: `StreakFreezeWallet`, `POST /api/habits/{id}/protect` (protected days keep a streak,
  `HabitService` "done or protected"), habit `active: false`, `ui_prefs` keys the server already reads
  (`workWeek`, `quietStart` / `quietEnd`, `notifyMute`), `NotificationPrefs`, `push.js`
  `syncDeviceAlarms` quiet rules, `habit-stats.js` `heatmapWeeks` / `bestStreak`.
- Files: backend `habit/HabitService` (a day inside `ui_prefs.breakFrom..breakUntil` counts as
  protected), `habit/HabitReminderDeliveryScheduler`, `digest/DigestScheduler`, a pure `OnBreak`
  helper + `BreakStreakTest`; frontend `scripts/app.js` (Settings switch, Home banner, the comeback
  toast in the habit toggle), `scripts/push.js` (water and habit alarms skip), `scripts/habit-stats.js`
  (`rest` cells, `daysSinceLast`, `usualGap`) + test, `scripts/one-thing.js` (`break` kind, by I-02's
  owner).
- Backend: yes. Schema: no (`ui_prefs` JSON; no column, so no migration).
- Decision needed: do break days count toward XP, the score and circle challenges?
- Playwright: seeded habit with a 5-day streak. Settings, "Take a break", 3 days. `page.clock` +2 days:
  expect the habit's streak still 5, no missed cell in its heatmap, no habit card in the bell, and
  Home's "On a break until". Clock past the end, tick: expect a "Back on it" toast and the streak 6.

### I-09 Instant onboarding: value inside 30 seconds

A neutral first screen with one line of value proposition and two equal buttons (FRU-1); one password
field with the reveal eye (FRU-6); the code submits itself on the sixth digit (FRS-4); no timezone step
when the zones match (FRS-2); the goal picker (already step 1 on `main`) opens with one pack
pre-selected so the preview is full (FRU-3); push asked at the first timed save, not in setup (FRU-4);
no "Dreamer" modal for items the pack wrote (FRU-8); Home opens scrolled to what the pack created
(FRU-2). `feat/ov-onboard` already built most of the sign-up half.

| | Before | After |
|---|---|---|
| Landing to first habit ticked | 17 taps, 69 keys, 3 swipes, ~108 s | 6 taps, ~45 keys, 0 swipes, ~26 s + email wait |

- Impact 5 · Effort 3 · Input 1 · **Score 6**
- Exists: `main` `goalStep`; `feat/ov-onboard` 656c9f2 (`app-logic.js` `firstRunSteps`, `pushAskDue`,
  OTP auto-submit, one password); `starter-packs.js` `planStarter`; `app.js` `applyStarter`.
- Files: `scripts/app.js` auth views + `openFirstRunSetup` + `applyStarter`, `scripts/app-logic.js`,
  `scripts/starter-packs.js`, `scripts/dashboard.js` `OnboardingCard`.
- Backend / schema: no (deferring email verification, FRU-5, would be backend and is a decision).
- **Not in the top 8: it is the onboarding fix agent's own finding list (FRU-1..14, FRS-1..6).** Make
  sure that agent ports `feat/ov-onboard` rather than rewriting it.
- Playwright: fresh context, 390x844. Expect a "Create account" button as prominent as "Sign in".
  Sign up with one password; type the OTP: expect navigation with no further click. Expect the goal
  step with one chip on and a filled preview; "Set it up": expect no `.gb-celebrate`, and the first
  habit's "Mark as done" inside the first 844 px.

### I-10 The habit form fills itself from the name

Typing "Journal before bed" sets category, icon and a 21:30 reminder; "walk", "run", "gym" set fitness at
07:00 or 18:00; "no ..." / "quit ..." set Break a habit. The same input listener already suggests a health
link (`suggestHealthLink`). `HABIT_TEMPLATES` carry the reminder times the starter packs use (FRS-6).
Colour, cadence, auto-tick and tone fold under "More options". No AI.

- Before 6 taps, 2 fields, 8 decisions, 4 screens · After 3 taps, 1 field, 2 decisions, 3 screens
- Impact 4 · Effort 2 · Input 1 · **Score 5**
- Exists: `app.js` `openHabitForm`, `HABIT_TEMPLATES`, `nudges.js` `suggestHealthLink`,
  `habit-stats.js` `suggestReminderTime`, `starter-packs.js` `PACKS`; `feat/ov-ux-flows` F18.
- Files: `scripts/app.js` (`openHabitForm`, `HABIT_TEMPLATES`), `scripts/nudges.js` (`suggestHabit`) + test.
- Backend / schema: no.
- Playwright: Habits, Add a habit, type "Journal before bed": expect category Journal and the time
  field 21:30 without a click; Add: expect `POST /api/habits` with `reminderTime: "21:30"`.

### I-11 WhatsApp as an input: reply to log

Inbound parsing exists. This tells people. A habit reminder ends with "Reply DONE to tick it"; a DONE (or
"done", "ho gaya", "mudinjathu") reply ticks the habit the newest habit message in the last 12 h named,
the way SNOOZE finds its reminder (`SNOOZE_REPLY`). After the WhatsApp number is verified the app sends
one welcome line with three examples ("spent 240 chai", "2 glasses water", "remind me 9am call amma").
The Settings WhatsApp section shows the same examples. No-AI path: `QuickAddFallback` already answers.

- Before: open the app, find the habit, tick (2-4 taps) · After: one reply
- Impact 3 (only users with WhatsApp connected; prod runs on a test number) · Effort 2 · Input 1 · **Score 3**
- Exists: `money/WhatsAppWebhookController` (quick add, `SNOOZE_REPLY`), `quickadd/QuickAddApplier`,
  `reminder/WhatsAppService` `sendSnoozableReminder`, `habit/HabitReminderDeliveryScheduler`.
- Files: backend `WhatsAppWebhookController`, `WhatsAppService`, `HabitReminderDeliveryScheduler`;
  `scripts/app.js` WhatsApp settings copy.
- Backend: yes. Schema: no.
- Decision needed: a production WhatsApp Business number and Meta business verification.
- Playwright: not drivable end to end (Meta). Backend test posts a signed webhook body "done" after a
  habit dispatch row and expects a check-in; a Playwright check covers the Settings examples.

### I-12 Day-1 value from the phone's history

On the first sign-in in the phone app, read the last 14 days of steps and sleep from Health Connect /
HealthKit (the `sync` endpoint already takes today-13..today+1) so Home's first screen already says
"You average 6,200 steps; your usual night is 23:40 to 06:50", the sleep check-in is prefilled, and
Insights has days to work with. Rise and Copilot do this; it turns a blank first day into a finished one.

- Before: blank Home and "1 of 7 days logged" · After: 0 inputs beyond the health permission
- Impact 4 · Effort 2 · Input 1 · **Score 5**
- Exists: `health.js`, `health-logic.js`, `native.js`, `app.js` `syncHealth` / `autoLogSleep`,
  `POST /api/health/sync`.
- Files: `scripts/app.js` (`syncHealth` first-run backfill), `scripts/health.js`, `scripts/native.js`.
- Backend / schema: no.
- Not in the top 8: native only, so Playwright cannot verify it, and it waits on the native agent.
- Playwright: web project asserts the backfill is skipped (no error, no request); native verification is
  a manual device run.

### I-13 Bank feed live, with a one-tap review inbox

`BankFeedService` (Setu, Account Aggregator) is inert until credentials are set. Turn it on, and add a
"To review" inbox on Money for imported rows whose category came from the keyword table's default:
swipe or tap a category chip, and the next row from the same merchant takes it.

- Before: every expense typed · After: one consent, then a tap per uncategorised row
- Impact 5 · Effort 3 · Input 2 · **Score 5**
- Exists: `money/BankFeedService`, `BankFeedClient`, `BankFeedController`, `money.js` "Bank" tag.
- Files: `scripts/money.js` (inbox), backend `BankFeedService` (merchant memory).
- Backend: yes. Schema: maybe (merchant-category memory can live in the Money document).
- Decision needed: Setu production credentials, FIU agreement and cost per fetch.
- Playwright: with a stubbed `GET /api/money/bank` (`configured: true`) and imported rows, expect the
  inbox count, tap "Food" on a row, expect `POST /api/money/tx` with that tag.

### I-14 Import history from other apps (port)

Port `feat/ov-import`: Money CSV (bank statements, Indian and European amounts, day-first dates,
duplicates unticked, stable ids so a second import upserts) and Calendar `.ics` (RRULE subset,
EXDATE, VALARM leads). A new user's first week then has their own history in it.

- Before: retype history (or keep two apps) · After: 1 file pick, 1 confirm
- Impact 3 · Effort 2 (port) · Input 2 · **Score 2**
- Exists: `feat/ov-import` dcdf87a (`csv-import.js`, `ics-import.js`, `import-ui.js`, tests, e2e).
- Files: those new files; `scripts/money.js`, `scripts/calendar.js`, `scripts/app.js` (Settings entry).
- Backend / schema: no.
- Playwright: `setInputFiles` with a 20-row CSV, expect a preview of 20 with 0 duplicates, Import:
  expect the rows in `GET /api/money`; import again, expect 20 duplicates unticked.

### I-15 Share into the app, and launcher shortcuts (port)

Port `feat/ov-pwa`'s manifest shortcuts (Add expense, Log water, Quick add) and share target (share a
receipt photo or a line of text to Growth Buddy; the photo goes through `main`'s one camera button
router, the text through Quick add). Add the same shortcuts as Android launcher shortcuts in the
Capacitor app.

- Before: open app, navigate, 2-4 taps · After: long-press icon, 1 tap
- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `feat/ov-pwa` 3b51874; `main` camera router (`f9d806e`).
- Files: `vite.config.js` (manifest), `public/` share handler, `scripts/app.js` route; mobile project.
- Backend / schema: no.
- Playwright: open `/?share-target&text=spent%20120%20auto`, expect the Quick add flow with that line.

### I-16 Focus in one tap

A Focus action on Home (and long-press on +) starts the last length and sound, linked to the first open
task; a task row's timer button starts the clock; the sprint that ends on a task offers "Mark it done?".

- Before 3 taps, 3 decisions, 3 screens · After 1 tap
- Impact 3 · Effort 1 · Input 1 · **Score 4**
- Exists: `app.js` `startFocusOn`, Home `onFocusTask`, `timer.js`; `feat/ov-ux-flows` F06 / F13.
- Files: `scripts/dashboard.js`, `scripts/timer.js`, `scripts/app.js`.
- Backend / schema: no.
- Playwright: Home, click a task's timer button, expect the Focus screen running with that task linked.

### I-17 The weekly review that writes itself

Lower rungs for the wins draft (any check-ins, any goal action, any log, the best day); the focus
prefilled from the weakest habit or the nearest milestone; the saved focus shown on Home until the next
review with "Make it a habit" (FRS-12, FRS-13); the weekly digest on by default for new accounts
(FRS-16); "This week so far" from day 3.

- Before 4 taps, 2 fields, 2 decisions · After 2 taps, 0 fields, 1 decision
- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `review.js` `weeklyWinsDraft` / `weekOverWeek`, `app.js` `openWeeklyReview`, `DigestScheduler`.
- Files: `scripts/review.js` + test, `scripts/app.js`, `scripts/dashboard.js`, backend digest default.
- Backend: one default. Schema: no.
- Playwright: seeded week with 1 check-in, open the review: expect "What went well?" non-empty.

### I-18 Circles and families that start themselves

A new circle opens the share sheet and starts the default 7-day sprint on the shared goal; joining
offers the shared goal as a habit in one tap (FRS-11, FRS-18); family members' relationship is read from
the name (Amma, Appa, Paati, Thatha, Akka, Anna...), "Save and add another" keeps the panel open, and
the Today tab makes the plan when members exist and there is none (FRS-10, flow 6).

- Before: circle 11 taps, family (2) 16 taps / 9 screens · After: circle 4 taps, family 7 taps / 4 screens
- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `circle.js` `newCircle` / `shareInvite` / `startChallenge` / `joinFromLink`, `circle-core.js`
  `CHALLENGE_TEMPLATES`, `family.js` `addChooserPanel` / `REL_GENDER`, meal-plan endpoints.
- Files: `scripts/circle.js`, `scripts/family.js`.
- Backend / schema: no (auto meal plan is an AI cost decision; its fallback is the saved favourites).
- Playwright: create a circle, expect the share sheet and a running challenge; second account joins,
  expect "Add 'Walk 30 minutes' to your habits?" and one click to `POST /api/habits`.

### I-19 Goal steps drafted for you

The goal form suggests pre-ticked milestones from a template table keyed on the title's words (run,
half marathon, save, emergency fund, read, books, lose, kg, learn, course), and infers the horizon from
the date. An AI suggestion through the gateway comes later with the table as its fallback.

- Before 11 taps, 5 fields, 7 decisions · After 4 taps, 1 field, 2 decisions
- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `goals.js` `openGoalForm`, `goal-milestones.js`.
- Files: `scripts/goals.js`, `scripts/goal-milestones.js` + test.
- Backend / schema: no.
- Playwright: New goal "Run a half marathon", expect 4 ticked suggestions; Save: expect the progress
  blob to hold 4 milestones.

### I-20 One notification budget across modules

A shared daily cap (1-2 proactive prompts: water, habit nudges, digest, bill-due, circle), skipped on
days the app was already opened, decaying when prompts go unanswered. User-set reminders are exempt.
Evidence: HeartSteps habituation, Drink Less, 37% disable push at 2-5 a week.

- Input: 0 (it removes prompts)
- Impact 4 · Effort 4 · Input 1 · **Score 3**
- Exists: `NotificationPrefs`, `ReminderPrefs.isQuiet`, `reminder_dispatch_log`, each scheduler.
- Files: backend schedulers + a shared budget service; `push.js` device alarms.
- Backend: yes. Schema: possibly (a per-user daily counter; `ThrottleStore` may serve).
- Playwright: backend test only (schedulers); Playwright checks the bell holds at most 2 nudges/day.

### I-21 Split a bill, settle by UPI

On any expense, "Split" with people (contacts, family members, circle mates); each share becomes a
"lent" transfer (the loans model exists: `loanMove`), with a `upi://pay` deep link and a share link for
friends without the app. Splitwise's daily cap is the opening.

- Before: not possible · After: 2 taps + pick people, 1 tap to settle
- Impact 4 · Effort 3 · Input 2 · **Score 3**
- Exists: `money.js` loans (`loanMove`, Settle), transfers with only `from`.
- Files: `scripts/money.js`, `scripts/money-core.js`.
- Backend: no for the deep link; yes for a public share page.
- Decision needed: a public share link (privacy) and UPI deep link only (no payments handled).
- Playwright: split 900 three ways, expect two lent transfers of 300 and a `upi://pay` href.

### I-22 Two-way Google Calendar sync

Read Google events into Calendar and Plan my day (blocks avoid real meetings); optionally write reminders
back.

- Impact 4 · Effort 5 · Input 2 · **Score 1**
- Exists: `.ics` export, `ics-import.js` on `feat/ov-import`, `calendar.js` `freeBusy`.
- Backend: yes (OAuth, token storage). Schema: yes.
- Decision needed: Google OAuth app verification (sensitive scope), privacy policy.
- Playwright: stubbed events endpoint, expect Plan my day's blocks to skip a 10:00-11:00 event.

### I-23 Home-screen widgets (Android)

Today's habits with tick, +250 ml water, Add expense, in a Capacitor widget.

- Impact 4 · Effort 4 · Input 1 · **Score 3**
- Exists: `native.js`, the done-link and water endpoints a widget can call.
- Files: `../Growth-Buddy-Mobile` (Kotlin AppWidget), a small token-scoped endpoint.
- Backend: likely (a widget token). Schema: maybe.
- Playwright: n/a (native); a backend test for the widget endpoint.

### I-24 Hindi and Tamil

A language picker writing `uiPrefs.locale`, and the Home, Quick add, habit and food strings moved to
`t()` with `hi` and `ta` catalogs. Quick add already takes a voice language.

- Impact 4 · Effort 4 · Input 1 · **Score 3**
- Exists: `i18n.js` (`t`, `setLocale`, plurals, catalogs), two screens converted.
- Files: `scripts/i18n.js`, every screen's strings.
- Decision needed: who translates and reviews.
- Playwright: set `ta`, expect Home's headings in Tamil and `<html lang="ta">`.

### I-25 Fresh-start prompts

On Mondays, the 1st, the user's birthday and the first open after a gap, the one-thing card offers one
new goal or one starter pack, framed as a new week or chapter (Dai, Milkman and Riis 2014).

- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `one-thing.js`, `starter-packs.js`.
- Files: `scripts/one-thing.js` + test.
- Backend / schema: no.
- Playwright: `page.clock` on a Monday, expect a "New week" card with a pack.

### I-26 Bulk actions

Long-press to select tasks or expenses: move to tomorrow, done, re-tag, delete (with I-04's Undo).

- Impact 3 · Effort 3 · Input 1 · **Score 2**
- Files: `scripts/app.js` task list, `scripts/money.js` expense list.
- Backend: no (one PUT per item; a batch endpoint later).
- Playwright: select 3 tasks, "Tomorrow", expect 3 PUTs.

### I-27 Routines: one tap ticks a bundle

"Morning: water, vitamins, walk" as one row that ticks its habits together; "every Sunday make the meal
plan" as a recurring automation.

- Impact 3 · Effort 3 · Input 1 · **Score 2**
- Files: `scripts/app.js` habits, a `routines` key in `ui_prefs`; backend for the scheduled automation.
- Playwright: tick the routine, expect 3 check-ins.

### I-28 Offline you can see and trust

A small "3 changes waiting" chip when the outbox holds writes, and a review list for `conflicts` and
`dropped` ops (the outbox already returns both) so nothing vanishes silently.

- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `outbox.js` (`conflicts`, `dropped`), `app.js` `syncOfflineBanner`, `overlayOutbox`.
- Files: `scripts/app.js`.
- Backend / schema: no.
- Playwright: `context.setOffline(true)`, add 3 tasks, expect "3 changes waiting"; back online, expect
  it to clear.

### I-29 Projection plus a default

The Outlook card's savings pace gets one button that sets a monthly savings goal or a recurring
transfer at the projected amount (Save More Tomorrow).

- Impact 3 · Effort 2 · Input 1 · **Score 3**
- Exists: `main` `outlook-card.js`, Money goals, `recurring[]`.
- Files: `scripts/outlook-card.js`, `scripts/money.js`.
- Playwright: click "Save 4,000 a month", expect a `recurring[]` transfer in `PUT /api/money`.

### I-30 Honest habit timelines and quiet delight

A habit's strength as a curve towards automatic (median 59-66 days), not only a streak count; small
moments at 7, 21, 66 days instead of modals.

- Impact 2 · Effort 2 · Input 1 · **Score 1**
- Exists: `habit-stats.js`, `celebrate.js`.
- Playwright: habit 30 days old, expect the strength label and no modal.

### I-31 Notification controls where the annoyance happens

A gear in the bell's header (`openProfileSettings('notifications')`) and "Mute Money" on a row (FRS-15).

- Before 6 taps · After 1-2 taps
- Impact 2 · Effort 1 · Input 1 · **Score 2**
- Files: `scripts/app.js`. Fix-sized: belongs to the shell fixer.
- Playwright: open the bell, click the gear, expect Settings on Alerts.

### I-32 Undo for Money

Extend I-04 to ledger deletes: hold the row out of `ledgerDiff` for the window instead of deleting it,
so a remote merge mid-window cannot resurrect it.

- Impact 3 · Effort 3 · Input 1 · **Score 2**
- Exists: `money-core.js` `ledgerDiff`, `removeDocItem` tombstones, `mergeMoney`.
- Files: `scripts/money.js`, `scripts/money-core.js`, `money-ledger.test.mjs`.
- Playwright: delete an expense, expect no `POST /api/money/tx` delete for 5 s; Undo restores it.

---

## Ranked table

| Rank | ID | Idea | Impact | Effort | Input | Score | Backend | In top 8 |
|---|---|---|---|---|---|---|---|---|
| 1 | I-02 | Today: finish the next-best-action layer | 5 | 2 | 1 | 7 | no | yes |
| 2 | I-01 | Capture line: one sentence, applied, Undo, dates from titles | 5 | 3 | 1 | 6 | no | yes |
| 3 | I-08 | A break, not a broken streak + comeback reward | 5 | 3 | 1 | 6 | yes, no schema | yes |
| 4 | I-09 | Instant onboarding under 30 s | 5 | 3 | 1 | 6 | no | no: onboarding fixer's list |
| 5 | I-05 | Evening close-out + tomorrow planned | 5 | 3 | 2 | 5 | no | yes |
| 6 | I-03 | Command palette + search + shortcuts (port) | 4 | 2 | 1 | 5 | no | yes |
| 7 | I-04 | Undo instead of confirms (port) | 4 | 2 | 1 | 5 | no | yes |
| 8 | I-06 | Money in one tap | 4 | 2 | 1 | 5 | no | yes |
| 9 | I-07 | Indian home food, katori portions | 4 | 2 | 1 | 5 | no | yes |
| 10 | I-10 | Habit form fills itself | 4 | 2 | 1 | 5 | no | no: FRS-6 is a fixer finding |
| 11 | I-12 | Day-1 value from phone history | 4 | 2 | 1 | 5 | no | no: native only, not verifiable here |
| 12 | I-13 | Bank feed live + review inbox | 5 | 3 | 2 | 5 | yes | no: needs Setu credentials |
| 13 | I-16 | Focus in one tap | 3 | 1 | 1 | 4 | no | no |
| 14 | I-11 | WhatsApp reply to log | 3 | 2 | 1 | 3 | yes | no: needs a prod WhatsApp number |
| 15 | I-15 | Share target + launcher shortcuts (port) | 3 | 2 | 1 | 3 | no | no |
| 16 | I-17 | Weekly review writes itself | 3 | 2 | 1 | 3 | default only | no |
| 17 | I-18 | Circles and families start themselves | 3 | 2 | 1 | 3 | no | no |
| 18 | I-19 | Goal steps drafted | 3 | 2 | 1 | 3 | no | no |
| 19 | I-20 | One notification budget | 4 | 4 | 1 | 3 | yes | no |
| 20 | I-21 | Split a bill, UPI settle | 4 | 3 | 2 | 3 | maybe | no |
| 21 | I-23 | Android widgets | 4 | 4 | 1 | 3 | likely | no |
| 22 | I-24 | Hindi and Tamil | 4 | 4 | 1 | 3 | no | no |
| 23 | I-25 | Fresh-start prompts | 3 | 2 | 1 | 3 | no | no |
| 24 | I-28 | Offline you can see | 3 | 2 | 1 | 3 | no | no |
| 25 | I-29 | Projection plus a default | 3 | 2 | 1 | 3 | no | no |
| 26 | I-14 | Import from other apps (port) | 3 | 2 | 2 | 2 | no | no |
| 27 | I-26 | Bulk actions | 3 | 3 | 1 | 2 | no | no |
| 28 | I-27 | Routines | 3 | 3 | 1 | 2 | partly | no |
| 29 | I-31 | Notification controls in the bell | 2 | 1 | 1 | 2 | no | no: shell fixer |
| 30 | I-32 | Undo for Money | 3 | 3 | 1 | 2 | no | no |
| 31 | I-22 | Google Calendar two-way sync | 4 | 5 | 2 | 1 | yes + schema | no |
| 32 | I-30 | Honest habit timelines | 2 | 2 | 1 | 1 | no | no |

Ties at 5 were broken by: can it be verified here with Playwright, does it wait on an external account,
and does a fix agent already own it as a finding.

---

## The top 8, built in parallel

| Pick | ID | Wow agent branch (proposed) |
|---|---|---|
| W1 | I-02 Today layer | `ov1011/wow-today` |
| W2 | I-01 Capture line | `ov1011/wow-capture` |
| W3 | I-08 Break + comeback | `ov1011/wow-break` |
| W4 | I-05 Evening close-out | `ov1011/wow-closeout` |
| W5 | I-03 Palette (port) | `ov1011/wow-palette` |
| W6 | I-04 Undo (port) | `ov1011/wow-undo` |
| W7 | I-06 Money in one tap | `ov1011/wow-money` |
| W8 | I-07 Katori quick picks | `ov1011/wow-food` |

### File ownership

"Today's owner" is the fix agent that holds the file now (shell: app.js shell / session / outbox;
money: money*.js, health*.js; food: Food and Water in app.js, nutrition.js; capture: Quick add, Plan my
day, day-plan.js, nudges.js, task / sleep / mood dialogs; onboarding: auth views, setup,
starter-packs.js, home-order.js, dashboard.js; social: circle / family / mentor / report / insights /
review / timer; perf: vite.config, index.html, websocket; design: tokens and styles; backend:
backend/).

| Pick | Owns exclusively | Touches (named functions only) | Today's owner of those files |
|---|---|---|---|
| W1 Today | `nudges.js` (+test), `one-thing.js` (+test), `home-order.js` (+test), `dashboard.js` `TodayPlanCard` / `WellnessQuick` / `OneThingCard` | `app.js` `SCREENS.home` props, `onConfirmSleep`, `onQuickMood`; `money-core.js` one pure salary rule | onboarding (dashboard, home-order), capture (nudges, sleep/mood dialogs), money (money-core) |
| W2 Capture | new `when.js` (+test); `app.js` `openAddSheet`, `submitQuickAdd`, `openQuickAddPreview`, `applyQuickAdd`, `addQuickExpense` / `addQuickIncome`, `taskForm`, `addReminder` | `calendar.js` reminder add form | capture |
| W3 Break | backend `HabitService` streak predicate, `HabitReminderDeliveryScheduler`, `DigestScheduler`, new `OnBreak` + test; `habit-stats.js` (+test) | `app.js` Settings pane (one switch), Home banner, habit toggle toast; `push.js` `syncDeviceAlarms` skip | backend; shell (Settings in app.js); `push.js` and `habit-stats.js` unowned |
| W4 Close-out | new `close-out.js` (+test), `close-out-ui.js`, `styles/close-out.css`; `day-plan.js` (+test) | `app.js` `openDailyPlan`, new `openCloseOut` | capture (day-plan.js, Plan my day) |
| W5 Palette | new `palette.js`, `palette-core.js` (+test), `styles/palette.css` | `app.js` global keydown + header button + `runQuickAdd` extraction; `gb-kit.js` header; `notes.js`, `goals.js` one export each | shell (app.js header), design (styles), social-adjacent (goals/notes: nobody) |
| W6 Undo | new `undo-queue.js` (+test) | `app.js` `confirmDelete` sites (task, habit, goal, water, food), sign-out / pagehide flush, `render` / `overlayOutbox` re-apply; `calendar.js` deletes; `notes.js` delete; `a11y.js` toast trigger | shell (session, outbox), capture (task), food (water/food delete) |
| W7 Money | `money.js` budgets sheet, Overview Budgets card, Bills and repeats sheet; `money-core.js` `splitBudget`; `money-calc.test.mjs` | none outside Money | money |
| W8 Food | `nutrition.js` `INDIAN_PICKS` / `portionKcal` (+test) | `app.js` `openAddFood` | food (L-002 is reworking this same dialog) |

New CSS goes in new per-feature files imported by the lazy module (`styles/palette.css`,
`styles/close-out.css`) using existing tokens only, so nothing collides with the design agent in
`app.css` / `tokens.css`. Any lazy chunk keeps `scripts/bundle-budget.mjs` green (perf agent's file is
not touched).

### Sequence

**Step 0, sequential, before anything else: merge `main` (build 95) into `overhaul/2026-10-11`** and
have the eleven `ov1011/*` fix branches rebase. Without it W1 rebuilds `one-thing.js`, W2 misses the
Home Quick add bar, the onboarding fixer rewrites a first-run that `main` already changed, and every
merge back to `main` replays 1,100 lines of `app.js` conflicts. The fix branches have 0-3 commits each
today, so now is the cheapest moment. This needs the user's go-ahead (D-01 fixed the base at build 92).

**Wave 1, start now (new files, or areas no fixer is editing):**
- W3 Break: backend part has no conflict with `ov1011/backend`'s current commits (quick add, ledger,
  WhatsApp money). The `app.js` Settings switch is three lines in the notifications pane.
- W4 Close-out: tell the capture fixer that FRC-8 and `day-plan.js` move to W4.
- W5 Palette: lands the `runQuickAdd` extraction that W2 builds on. Tell the shell fixer the header
  and the global keydown are W5's.

**Wave 2, start when the named fixer has merged (they rewrite the same functions):**
- W2 Capture after `ov1011/capture` (and after W5 merges, for `runQuickAdd`). Better: hand FRC-3/4/5/11/12/13
  to W2 and let the capture fixer stop at the other findings.
- W1 Today after `ov1011/onboard` (dashboard.js, home-order.js) and after the capture fixer's FRC-9
  change, or hand FRC-6/7/9/15/16 to W1. W1 then wires W4's `closeout` and W3's `break` kinds into
  `one-thing.js`, so W1 merges after W3 and W4.
- W6 Undo after `ov1011/shell` (it changes the sign-out and outbox seams the undo flush hooks into;
  `ov-integration`'s e3def37 shows those seams broke once).
- W7 Money after `ov1011/money` (FRS-7/8/9 are that agent's; or hand them to W7).
- W8 Food after `ov1011/food` finishes L-002 (same `openAddFood` dialog).

**Merge order into the overhaul:** W5, W3, W4, then W2, W6, W7, W8 in any order, then W1 last.

---

## Decisions needed from the user

| # | Decision | Affects | Kind |
|---|---|---|---|
| 1 | Merge `main` (build 95, 37 commits, includes `feat/life-plan`) into the overhaul now. D-01 fixed the base at build 92 | Step 0, every pick | Process |
| 2 | Port the parallel session's `ov-integration` feature branches (palette, undo, onboard, ux-flows; later import, pwa) feature by feature, though D-01 chose not to build on that branch | W5, W6, I-09, I-14, I-15 | Process |
| 3 | Source of the Indian food kcal table (IFCT 2017 / NIN figures, or the existing `FoodWeek` keyword table only) and how it is labelled to users | W8 | Data accuracy |
| 4 | Whether break days count toward XP, the daily score and circle challenges | W3 | Product |
| 5 | Production WhatsApp Business number and Meta business verification (per-conversation cost) | I-11 | Cost, external account |
| 6 | Setu production credentials and FIU agreement (cost per fetch, RBI AA terms) | I-13 | Cost, external account, privacy |
| 7 | Google OAuth app verification for Calendar (sensitive scope) and a privacy-policy update | I-22 | External account, privacy |
| 8 | A public share page for bill splits (people without the app see a name and an amount) | I-21 | Privacy |
| 9 | Letting a new account in before email verification (FRU-5) | I-09 | Security |
| 10 | A daily AI call per family for an automatic meal plan, and AI goal-step suggestions | I-18, I-19 | AI cost |
| 11 | A shared notification cap that holds back prompts users get today | I-20 | Product |
| 12 | Who translates and reviews Hindi and Tamil | I-24 | Cost |
