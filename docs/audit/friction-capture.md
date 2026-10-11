# Friction audit: the daily capture loop (prefix FRC)

Guiding rule: low input, high outcome. Every flow below was driven with Playwright over CDP
(`chromium.connectOverCDP('http://localhost:9591')`) at **390x844, touch, isMobile**, against Vite
:5591 and backend :8591, on 2026-10-11 between 23:10 and 23:45 IST (the device clock matters: see
Plan my day and the reminder flows). The scripts that produced every count are kept in the session
scratchpad (`frc-lib.mjs` = the recorder, one `frc-<flow>.mjs` per flow); screenshots are in
`docs/evidence/audit-friction-capture/`.

Accounts:
- **A** (`e2e/seed.mjs`, full seed: tasks, 2 habits, reminders, a note, water, food, sleep + mood today).
- **B** (`seedAccount({seed:false})` + 6 nights of sleep 23:15/23:30 to 06:45 "good", 4 moods, 2 habits,
  2 daily 08:00 reminders, 2 tasks, 5 days of water, **nothing logged today**), so the one-tap guesses
  in `nudges.js` have history to stand on. Reseeded once for the quick check-in run.

## How the counts are made

| Count | What it is |
|---|---|
| Taps | Every press: buttons, chips, focusing a field that was not already focused, the keyboard's Go/Enter. |
| Swipes | Scrolls needed to bring the next target on screen (#gb-main is the scroller; 1 swipe = 550 px), measured from the element's box before the tap. Fixed chrome (nav, header, dialogs) needs none. |
| Fields | Inputs that need typing or a picker. Native date/time pickers are counted as one field; on Android each is about 3 to 4 more taps that a headless browser cannot drive, so those flows are undercounted. |
| Decisions | Choices the user has to make or check (a default they must read to trust counts). |
| Screens | Distinct surfaces crossed, the starting one included (screen, sheet, dialog). |
| Seconds | Keystroke-level estimate for a phone: tap 1.1 s, swipe 0.8 s, 0.4 s per typed character, 1.35 s per decision. Measured system waits (AI parse, AI estimate) are listed separately, because they are dead time on top. |

The "after" counts are the counts the proposal would produce on the same path, worked out from the
code it touches; none of them is built yet.

## Summary

| Flow | Before (taps / swipes / fields / decisions / screens / s) | After | Main lever |
|---|---|---|---|
| Log an expense (Home card) | 3 / 3 / 2 / 2 / 2 / 11.6 | 2 / 0 / 1 / 0 / 1 / 5.8 (repeat: 1 / 0 / 0 / 0 / 1 / 1.1) | Autofocused one-line capture applied with Undo; repeat-expense chip at the top of Home |
| Log income (Money) | 5 / 0 / 1 / 2 / 4 / 10.2 | 1 / 0 / 0 / 0 / 1 / 1.1 | "Salary arrived?" from income history; offer to make it a repeat |
| Log a meal (typed) | 5 / 1 / 2 / 1 / 4 / 12.5 + 11.2 s AI wait | 2 / 0 / 1 / 0 / 1 / 6.6 + 0 s wait | Capture line, AI estimate off the critical path |
| Log a meal (recent chip) | 5 / 1 / 0 / 1 / 4 / 7.7 | 1 / 0 / 0 / 1 / 1 / 2.5 | "Again?" chip per meal slot on Home; chip saves |
| Log water | 3 / 0 / 0 / 1 / 3 / 4.7 | 1 / 0 / 0 / 0 / 1 / 1.1 | The Home "% water" pill becomes a +glass button |
| Sleep + mood (quick check-in) | 2 / 0 / 0 / 2 / 1 / 4.9 | 1 / 0 / 0 / 1 / 1 / 2.5 | One mood tap also logs the usual night, with the usual quality |
| Sleep + mood (tiles + dialogs) | 8 / 0 / 0 / 5 / 3 / 15.6 | 4 / 0 / 0 / 2 / 3 / 7.1 | Usual quality preselected; a mood tap saves |
| Add a task with a due time | 7 / 0 / 2 / 2 / 2 / 15.2 | 2 / 0 / 1 / 0 / 2 / 12.2 | Read "tomorrow 5pm" out of the title |
| Tick a habit (Home) | 1 / 3 / 0 / 0 / 1 / 3.5 | 1 / 0 / 0 / 0 / 1 / 1.1 | Habits card above the tasks and month calendar |
| One-off reminder (tomorrow 18:00) | 5 / 2 / 2 / 2 / 3 / 17.4 | 2 / 0 / 1 / 0 / 1 / 13.0 | Capture line + Undo; form focused and folded |
| Repeating reminder (every Monday 09:00) | 6 / 2 / 2 / 3 / 3 / 19.1 | 2 / 0 / 1 / 0 / 1 / 13.8 | Same, after the weekday bug (FRC-1) is fixed |
| Write a note | 4 / 0 / 1 / 0 / 3 / 18.4 | 2 / 0 / 1 / 0 / 1 / 16.2 | Capture line; Quick add's Note opens the composer |
| Quick add / command box | 4 / 0 / 1 / 1 / 3 / 9 to 24 + 2.5 to 14.4 s parse | 2 / 0 / 1 / 0 / 1 / 7 to 21 + parse | Autofocus; single log applied with Undo |
| Plan my day (after 21:00) | 2 taps, nothing schedulable; tomorrow by hand about 10 taps / 4 swipes | 2 / 0 / 0 / 1 / 2 / 3.6 | Plan tomorrow once today has no free hour |

Typing time is the floor for the typed flows (task, note, reminders): taps, swipes, fields and
decisions halve or better; seconds fall less because the words still have to be typed. Voice
(`captureReminder`, Quick add's mic) is already wired for those.

---

## Flow 1: Log an expense

Measured on A from Home's Money card (`frc-expense.mjs`).

| Step | Input | Type |
|---|---|---|
| Scroll to the Money card (8th of 9 Home widgets) | 3 swipes | scroll |
| Home: Add expense | tap | tap |
| Add expense dialog | - | screen |
| Amount (autofocused) | "250" | field |
| Note | "Lunch" (+1 tap to focus) | field |
| Check the tag ("Food" guessed from the note) | - | decision |
| Check Paid from (default Cash, `settings.lastAccountId`) | - | decision |
| Add expense | tap | tap |

**Before:** 3 taps, 3 swipes, 2 fields (8 chars), 2 decisions, 2 screens, 11.6 s.
Through Quick add ("spent 250 on lunch"): 4 taps, 1 field (18 chars), 1 decision, 3 screens, 13 s + 2.5 s parse.

**After:** 2 taps, 0 swipes, 1 field ("250 lunch", 9 chars), 0 decisions, 1 screen, 5.8 s. A habitual expense: 1 tap.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Capture line: Quick add's input focused on open, Enter applies a single log intent at once with an Undo toast that names what it guessed ("Expense 250 · lunch · Food · Cash · Undo") (FRC-4) | 2 taps, 3 swipes, 1 field, 2 decisions, 1 screen | `app.js` `openAddSheet` (`qaInput.focus()`), `submitQuickAdd` / `openQuickAddPreview`, `applyQuickAdd` | No |
| Surface `repeatExpense` (nudges.js) at the top of Home, not only in the Money card 3 swipes down (FRC-15) | whole flow to 1 tap | `dashboard.js` `TodayPlanCard` chips; `money-home.js` `MoneyHomeCard` already computes it | No |
| One field in the dialog: "250 lunch" reads amount + note, Enter submits | 1 field, 1 tap | `money.js` `openExpenseModal` | No |
| Quick add expense takes the same account as the dialog (FRC-3) | outcome: balances move | `app.js` `addQuickExpense` | No |

## Flow 2: Log income

Measured on A (`frc-income.mjs`).

| Step | Input | Type |
|---|---|---|
| Nav: More | tap | tap |
| More sheet | - | screen |
| More: Money | tap | tap |
| Money Overview | - | screen |
| Tab: Income | tap | tap |
| Add income | tap | tap |
| Add income dialog | - | screen |
| Amount (autofocused) | "50000" | field |
| Type Salary / Other (default Salary) | - | decision |
| Received in Cash / Bank (default Bank) | - | decision |
| Add income | tap | tap |

**Before:** 5 taps, 0 swipes, 1 field (5 chars), 2 decisions, 4 screens, 10.2 s.

**After:** 1 tap, 0 fields, 0 decisions, 1 screen, 1.1 s on payday; 0 taps a month once it repeats.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| `usualSalary(income, today)` in nudges.js: a salary on about the same day of month in 2 of the last 3 months, amount = the last one, account = the last one. On that day (±2) Home offers "Salary 50,000 arrived? Add" (FRC-16) | 4 taps, 1 field, 2 decisions, 3 screens | `nudges.js` (new pure helper, same shape as `repeatExpense`), `dashboard.js` `TodayPlanCard` | No |
| After the second matching salary, offer "Log it on the 1st every month?" which writes a `recurring[]` income row (already auto-posted by Money) | every later month: whole flow | `money.js` `openIncomeModal` save path → `recurring[]` (see `recurringCard`) | No |
| Add income dialog: amount prefilled with the last salary when type is Salary | 1 field | `money.js` income modal | No |

## Flow 3: Log a meal

Measured on A (`frc-food.mjs typed` / `chip`). It was 23:2x, so the slot defaulted to Snack.

Typed:

| Step | Input | Type |
|---|---|---|
| Nav: More | tap | tap |
| More sheet | - | screen |
| More: Food | tap | tap |
| Food screen | - | screen |
| Scroll to Log food (under the water card) | 1 swipe | scroll |
| Log food | tap | tap |
| Log food dialog | - | screen |
| Check Day / Meal Home-Hotel / Slot defaults | - | decision |
| Food (autofocused) | "Masala dosa" | field |
| Amount | "1" (+1 tap) | field |
| Add food, then the full-screen "Estimating calories" loader | tap, **11.2 s** wait | tap |

**Before:** 5 taps, 1 swipe, 2 fields (12 chars), 1 decision, 4 screens, 12.5 s + 11.2 s of AI wait.
Recent-chip path: 5 taps, 1 swipe, 0 fields, 1 decision, 4 screens, 7.7 s (the chip fills name and amount, Add food is still a tap).
Quick add ("had 2 idli for breakfast"): 4 taps, 1 field, 1 decision, 3 screens, 15.4 s + 5.3 s parse.

**After:** typed 2 taps, 1 field, 0 decisions, 1 screen, 6.6 s, no wait; a repeat meal 1 tap.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Capture line as in Flow 1 ("masala dosa") | 3 taps, 1 swipe, 1 field, 1 decision, 3 screens | `app.js` `openAddSheet`, `applyQuickAdd` food branch | No |
| Do not hold the dialog on the AI estimate: close at once, paint the row as "Estimating" and fill kcal when the POST answers; a failure keeps the payload and toasts Retry (FRC-10) | 11.2 s | `app.js` `logFoodEntry`, `showFoodLoader`, `openAddFood` | No (the server stays synchronous) |
| "Again?" chip per slot on Home: the food logged in this slot on 3+ of the last 7 days ("Breakfast: 2 idli again?"), saved as manual kcal like `copyYesterdaySlot` | chip path 5 taps → 1 | `nudges.js` (new `usualMeal`), `dashboard.js` `TodayPlanCard` | Small: `GET /api/food/recent` has no slot or dates; add `?slot=` with counts, or read `/api/food/week` |
| In Log food, a recent chip saves (the form stays for edits behind a long press or an Edit link) | 1 tap | `app.js` `openAddFood` recent chips | No |

## Flow 4: Log water

Measured on A (`frc-food.mjs water`).

| Step | Input | Type |
|---|---|---|
| Nav: More | tap | tap |
| More sheet | - | screen |
| More: Food | tap | tap |
| Food screen | - | screen |
| Pick 250 / 500 / 750 | - | decision |
| +250 ml | tap | tap |

**Before:** 3 taps, 0 swipes, 0 fields, 1 decision, 3 screens, 4.7 s. Home has no water control at all: the
"25% water" pill in the Daily brief looks like a chip but is a `<span>`.

**After:** 1 tap, 0 decisions, 1 screen, 1.1 s.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Make the "% water" pill a "+250 ml" button calling `quickAddWater` (optimistic, idempotent, offline-queued already) with Undo; the size is the user's most frequent entry today, else 250 (FRC-6) | 2 taps, 1 decision, 2 screens | `dashboard.js` `TodayPlanCard` (chips are `h('span')`), prop from `app.js` `SCREENS.home` | No |
| Drop the "Sleep not logged" / "Mood not logged" pills while the Sleep & mood card is on Home: the same question sits directly under them | 2 dead pills | `dashboard.js` `TodayPlanCard` | No |

## Flow 5: Sleep + mood check-in

Quick path measured on a fresh B (`frc-wellness.mjs quick`); dialogs on B (`frc-wellness.mjs dialog`).

Quick check-in (Home's `WellnessQuick`):

| Step | Input | Type |
|---|---|---|
| Read "Slept 23:25 to 06:45?" | - | decision |
| Yes | tap | tap |
| How are you feeling: Good | tap | decision |

Tiles + dialogs:

| Step | Input | Type |
|---|---|---|
| Home: Sleep tile | tap | tap |
| Sleep dialog (prefilled 23:25 / 06:45, quality Okay) | - | screen |
| Check the times | - | decision |
| Quality: Good | tap | decision |
| Save sleep | tap | tap |
| Home: Mood tile | tap | tap |
| Mood dialog (Okay / Medium / Normal preselected) | - | screen |
| Mood Good, Energy Medium, Stress Calm | 3 taps | decision x3 |
| Save check-in | tap | tap |

**Before:** quick 2 taps, 2 decisions, 1 screen, 4.9 s; dialogs 8 taps, 5 decisions, 3 screens, 15.6 s.
All 6 prior nights were "good"; Yes saved **Okay** (`wellness-quick-after.jpg`, FRC-9).

**After:** quick 1 tap, 1 decision, 2.5 s; dialogs 4 taps, 2 decisions, 7.1 s.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| `usualSleep` also returns the usual quality (mode of the same nights); the quick Yes and the sleep dialog use it | 1 decision (and a wrong default) | `nudges.js` `usualSleep`, `app.js` `SCREENS.home` `onConfirmSleep` (hard-codes `quality: 'okay'`), `openSleepSchedule` | No |
| One tap: a mood tap while the usual-night row is still showing logs that night too, and the row turns into "Last night 23:25 to 06:45 logged. Edit" | 1 tap, 1 decision | `dashboard.js` `WellnessQuick`, `app.js` `onQuickMood` | No |
| Mood quick tap and dialog take the usual energy and stress (mode of the last 14 moods) instead of medium/normal; in the dialog a mood tap saves, energy and stress sit under it as optional | 4 taps, 3 decisions on the dialog path | `nudges.js` (new `usualMood`), `app.js` `openMoodCheckin`, `onQuickMood` | No |

## Flow 6: Add a task

Measured on A (`frc-task.mjs`, with and without a due time).

| Step | Input | Type |
|---|---|---|
| Home: Today's tasks + Add | tap | tap |
| New task dialog | - | screen |
| Title (autofocused) | "Call plumber" | field |
| Due: native date-time picker | 1 field (about 4 taps on Android) | field |
| Pick day + time | - | decision |
| Priority (Medium default) / goal: leave | - | decision |
| Enter submits | key | tap |

**Before:** without a due time 2 taps, 1 field, 1 decision, 2 screens (already lean). With one: 7 taps (3 + about 4
in the picker), 2 fields, 2 decisions, 15.2 s. Typing "Call plumber tomorrow 5pm" saves that whole text as
the title with `dueAt: null` (request captured), so the cheap way gives an incomplete result (FRC-11).

**After:** 2 taps, 1 field, 0 decisions, 12.2 s, with the due time set.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| A pure `parseWhen(text, now)` (today / tonight / tomorrow / a weekday / "at 5pm" / "17:00" / "in 2 hours"), shown as a removable "Due tomorrow 17:00" chip under the title and stripped from it on save; "urgent", "asap" set High | 5 taps, 1 field, 2 decisions | new `scripts/when.js` + `when.test.mjs`; `app.js` `taskForm`; the reminder form can share it (`calendar.js` add form) | No (mirrors `QuickAddFallback.DAY` / `AT_TIME`, which stay as they are) |

## Flow 7: Tick a habit

Measured on A from Home and on B from the Habits tab (`frc-habit.mjs`).

| Step | Input | Type |
|---|---|---|
| Scroll past tasks and the month calendar | 3 swipes | scroll |
| Home: Mark as done | tap | tap |

**Before:** Home 1 tap + 3 swipes, 1 screen, 3.5 s; Habits tab 2 taps, 2 screens, 2.2 s.

**After:** 1 tap, 0 swipes, 1.1 s.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Default Home order: habits right after Sleep & mood, ahead of tasks and the mini calendar (only accounts without a saved layout move; `resolveHomeLayout` keeps a saved one) (FRC-7) | 3 swipes | `home-order.js` `HOME_WIDGETS` order, `home-order.test.mjs` | No |
| Already automatic and worth keeping: health-linked and focus habits tick themselves (`autoTickHealthHabits`, `autoTickFocusHabits`), and a habit push carries Done | - | - | - |

## Flow 8: Add a one-off reminder

Measured on B via More, Calendar (`frc-reminder.mjs once`). Today's 18:00 had already passed at 23:2x and
the form refused it ("That time has already passed, pick a later one", `rem-after-once.jpg`), so the
measured case is tomorrow 18:00. The tag defaults to Personal.

| Step | Input | Type |
|---|---|---|
| Nav: More | tap | tap |
| More sheet | - | screen |
| More: Calendar | tap | tap |
| Calendar screen | - | screen |
| Pick Mon 12 Oct on the month grid | tap | decision |
| Scroll to the form | 1 swipe | scroll |
| Focus "Add a reminder…" | tap | tap |
| Text | "Pick up parcel" | field |
| Notify / Second alert: leave the defaults | - | decision |
| Time (native picker) | "18:00" | field |
| Scroll to Add reminder (past Notes, Notify, Second alert, End time, Tag, Repeat, Tone) | 1 swipe | scroll |
| Add reminder | tap | tap |

**Before:** 5 taps, 2 swipes, 2 fields (19 chars), 2 decisions, 3 screens, 17.4 s. Quick add ("remind me at 9pm to call
mom"): 4 taps, 1 field (28 chars), 1 decision, 3 screens, 17 s + 3.3 s parse. Quick add's own **Reminder**
row lands on the top of Calendar with the form 1,090 px down, unfocused, and Add at 2,008 px (`qa-reminder.jpg`, FRC-5).

**After:** 2 taps, 1 field, 0 decisions, 1 screen, 13 s.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Capture line + Undo toast ("Reminder · Pick up parcel · Tomorrow 18:00 · Undo") | 3 taps, 2 swipes, 1 field, 2 decisions, 2 screens | `app.js` `openAddSheet` / `applyQuickAdd` | No |
| Quick add's Reminder row scrolls to and focuses the form | 2 swipes, 1 tap | `app.js` `openAddSheet` items (`key: 'reminder'`), `calendar.js` (export a `focusReminderForm()` beside `prefillCalendarReminder`, which focuses only when text is pending) | No |
| Fold Notes, Notify, Second alert, End time and Tone under "More options" in the add form; text, time, repeat, Add fit one screen | 1 swipe, 1 decision | `calendar.js` add form (`cachedFormRefs` builder near `UsualTimeChip(timeInput, ...)`) | No |
| A one-off time already gone today becomes tomorrow, said in the toast, instead of a refusal (FRC-12) | 1 retry loop | `app.js` `addReminder` (`isPastSlot` branch) and the form's `fieldRefusal` | No |

## Flow 9: Add a repeating reminder (every Monday 09:00)

Measured on B (`frc-reminder.mjs repeat`). Weekly picked Monday from the anchor by itself (`repeatDays: "MO"`).

| Step | Input | Type |
|---|---|---|
| Nav: More → More: Calendar | 2 taps | tap |
| Pick Mon 12 Oct | tap | decision |
| Scroll, focus text | 1 swipe, tap | tap |
| Text | "Water plants" | field |
| Notify defaults | - | decision |
| Time | "09:00" | field |
| Repeat: Weekly | tap | decision |
| Scroll, Add reminder | 1 swipe, tap | tap |

**Before:** 6 taps, 2 swipes, 2 fields, 3 decisions, 3 screens, 19.1 s. Quick add ("remind me every monday at 9am to
water plants"): 4 taps, 45 chars, 1 decision, but the preview reads **Tue 13 Oct · Weekly**, twice in a row
(FRC-1), so the cheap path makes a wrong series unless the user catches the date and rebuilds it in Calendar.

**After:** 2 taps, 1 field, 0 decisions, 1 screen, 13.8 s, on the right weekday.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Snap the model's date to the weekday the text names (FRC-1) | outcome | `QuickAddService.reminder` + `QuickAddFallback.DAY` | Yes |
| Capture line + Undo toast | 4 taps, 2 swipes, 1 field, 3 decisions, 2 screens | as Flow 8 | No |

## Flow 10: Write a note

Measured on B (`frc-note.mjs`).

| Step | Input | Type |
|---|---|---|
| Nav: More | tap | tap |
| More sheet | - | screen |
| More: Notes | tap | tap |
| Notes screen | - | screen |
| Jot something down… (editor autofocused on open) | tap | tap |
| Body | "Gift idea for Ravi: a book on birds" | field |
| Save note | tap | tap |

**Before:** 4 taps, 0 swipes, 1 field (35 chars), 0 decisions, 3 screens, 18.4 s. Quick add's **Note** row does
`setScreen('notes')` and leaves the composer closed, so it is the same 4 taps. The server draft
(`note_drafts`) is a good touch: a half-written note reopened itself on the next visit.

**After:** 2 taps, 1 screen, 16.2 s (typing is the floor).

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Capture line "note: …" applied at once with Undo | 2 taps, 2 screens | `app.js` `applyQuickAdd` note branch | No |
| Quick add's Note row opens the composer focused | 1 tap | `app.js` `openAddSheet` (`key: 'note'`), `notes.js` `ScreenNotes` (expose `openComposer` or open when a flag is set, like `prefillCalendarReminder`) | No |

## Flow 11: Quick add / command box

Measured on A for every capture intent (`frc-quickadd.mjs`, `frc-qa-net.mjs`). The AI gateway answered
(`configured: true, fallback: false`); parse waits: 2.5, 2.9, 14.4 (water), 5.3 (food), 2.9, 3.3, 4.0, 2.9, 2.9 s.

| Step | Input | Type |
|---|---|---|
| Header + | tap | tap |
| Quick add sheet (focus lands on the dialog, not the input) | - | screen |
| Focus the input (under six option rows, at y 581) | tap | tap |
| Type the line | 8 to 45 chars | field |
| Log it (Enter works too) | tap | tap |
| Preview "Log these?", one row | - | screen |
| Read the row | - | decision |
| Log them | tap | tap |

**Before:** 4 taps, 1 field, 1 decision, 3 screens, 9 to 24 s + the parse.

**After:** 2 taps, 0 decisions, 1 screen.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Focus `qaInput` when the sheet opens; put the line above the six rows (FRC-4) | 1 tap | `app.js` `openAddSheet` | No |
| A single log intent from the model applies at once, with an Undo toast that names it; keep the preview for 2+ intents, `fallback: true` reads, and any `unknown` row. Undo deletes what was written (expense/income: `removeDocItem` + `saveMoney`; water `deleteWaterEntry`; food `deleteFoodEntry`; task/note/reminder DELETE) | 1 tap, 1 decision, 1 screen | `app.js` `submitQuickAdd`, `openQuickAddPreview`, `applyQuickAdd` | No |
| Add Expense, Water and Meal rows to the sheet (it has Task, Habit, Note, Reminder, Sleep, Mood, none of the money or food flows) | Flows 1, 3, 4 lose the More/screen hops | `app.js` `openAddSheet` items | No |

## Flow 12: Plan my day

Measured on B at the real clock (23:30) and with `page.clock.install` at 10:05 (`frc-plan.mjs`).

| Step | Input | Type |
|---|---|---|
| Home: Plan my day | tap | tap |
| Today plan dialog | - | screen |
| Review the draft | - | decision |
| Add to my day (10:05) / Looks good (23:30) | tap | tap |

**Before:** 2 taps, 1 decision, 2 screens, 3.6 s. At 10:05 this wrote 2 focus reminders (10:30, 11:30): a good outcome.
At 23:30 the draft had no blocks (no free hour after 21:00), listed the 08:00 reminder that had already gone, and
"Looks good" wrote nothing (`plan-1.jpg`). Planning tomorrow by hand is two Calendar reminders, about 10 taps and
4 swipes. The care rows ("2000 ml of water to go") cannot be acted on from the plan.

**After:** 2 taps for tomorrow's plan; the water row is one tap inside the plan.

| Proposal | Cuts | Where | Backend |
|---|---|---|---|
| Once today has no free hour left (after `DAY_END`), draft tomorrow: `today` = tomorrow, `nowMin` = 0, title "Tomorrow plan", blocks added to tomorrow (FRC-8) | about 10 taps, 4 swipes | `app.js` `openDailyPlan` (passes `today` / `nowMin`, `addReminder(today, …)`); `day-plan.js` unchanged | No |
| Leave out (or grey) one-off reminders whose time has gone | 1 dead row | `day-plan.js` `buildDayPlan` reminders loop | No |
| Water row gets "+250"; habit rows tick in place | 3 taps per water log, Flow 7's swipes | `app.js` `openDailyPlan` care rows / rows | No |

---

## Findings

### FRC-1: Quick add files "every Monday" on a Tuesday
- Severity: High
- Where: `backend/.../quickadd/QuickAddService.java` `reminder(JsonNode, LocalDate)`; Quick add at 390x844
- Repro / evidence: On Sunday 2026-10-11, Quick add "remind me every monday at 9am to water plants". Request
  `{"today":"2026-10-11","now":"23:12"}`; response `{"type":"reminder","text":"water plants","date":"2026-10-13","time":"09:00","repeat":"weekly"}`
  with `note: "Got it! I'll remind you every Monday at 9am to water plants."`. The preview reads
  "water plants · Tue 13 Oct, 09:00 · Weekly". Reproduced in two runs. `qa-preview-remind_me_every_mond.jpg`.
- Cause: the model miscounts the next Monday although the prompt gives "TODAY: 2026-10-11 (Sunday)";
  `reminder()` only clamps a past date to today, it never checks the date against a weekday the text names.
  A weekly series anchors on its date, so it would ring every Tuesday.
- Fix: pass the cleaned text into `reminder()`; when `QuickAddFallback.DAY` finds exactly one weekday in it
  and the model's date falls on another, use `today.with(TemporalAdjusters.nextOrSame(dow))` (next, not same,
  when the time has already passed today). Add the case to `QuickAddServiceTest`.

### FRC-2: Quick add sleep and mood overwrite what was logged, with invented times
- Severity: Medium
- Where: `app.js` `applyQuickAdd` (`case 'sleep'`, `case 'mood'`), `sleepPayloadFromHours`
- Repro / evidence: Account A had 23:00 to 06:30 "good" and mood good / high energy / low stress for today.
  Quick add "slept 7h, feeling good", preview "Sleep: 7 h · good / Mood: good · medium energy", Log them.
  `GET /api/daily-logs` then: `bedtime "00:00", wakeTime "07:00"` and `energy "medium", stress "normal"`.
  The preview never said it replaces the logged night.
- Cause: `sleepPayloadFromHours` synthesises a 07:00 wake; the mood branch sends `energy: it.energy || 'medium'`
  and no stress.
- Fix: anchor the duration on today's logged wake time, else `usualSleep(...).wakeTime`, else 07:00; mood keeps
  today's energy and stress unless the sentence states them; when today already has an entry the preview row
  says "replaces 23:00 to 06:30".

### FRC-3: Quick add money lands in no account, so balances do not move
- Severity: Medium
- Where: `app.js` `addQuickExpense`, `addQuickIncome`
- Repro / evidence: A logged 2 x 250 through the expense dialog (Cash) and 2 x 250 plus 50,000 income through Quick
  add, then 50,000 through Add income (Bank). Money shows "1,000 spent", "1,00,000 came in", but Cash
  -500 and Bank 50,000; the Quick add income row has no account ("salary 11 Oct") where the form's row reads
  "Salary 11 Oct · Bank".
- Cause: both helpers write rows without `accountId`.
- Fix: expense takes `money.settings.lastAccountId` (the dialog's default), income the income dialog's default
  account; the Undo toast from FRC-4 names it.

### FRC-4: Quick add needs a tap to reach its input and a second dialog to confirm every single log
- Severity: Medium
- Where: `app.js` `openAddSheet`, `submitQuickAdd`, `openQuickAddPreview`; 390x844
- Repro / evidence: Header +: focus lands on the dialog (`document.activeElement` = `.gb-modal`); the input sits
  under six option rows. Every line, one intent or not, opens "Log these?" with one checkbox and "Log them":
  4 taps, 3 screens for "buy milk". `qa-1.jpg`, `qa-preview-*.jpg`.
- Cause: the preview was added after a misread wrote itself in (comment above `parseQuickAdd`); it now taxes
  every correct read.
- Fix: focus `qaInput` on open; apply a single model-read log intent at once with an Undo toast naming
  what was written; keep the preview for multi-intent, fallback and unknown reads.

### FRC-5: Quick add's Reminder and Note rows drop the user on a screen, not in the form
- Severity: Medium
- Where: `app.js` `openAddSheet` items `reminder` (`calToday(); setScreen('calendar')`) and `note`
  (`setScreen('notes')`); `calendar.js` `prefillCalendarReminder` / `applyPendingReminderText`
- Repro / evidence: + → Reminder: Calendar opens at the month grid; "Reminder text" is at y 1,090, unfocused,
  "Add reminder" at y 2,008 (`qa-reminder.jpg`). + → Note: Notes opens with the composer closed.
- Cause: the calendar form is focused only when text is pending; the notes composer has no opener from outside.
- Fix: a `focusReminderForm()` export that scrolls the cached form into view and focuses the text; a flag that
  makes `ScreenNotes` call `openComposer()` on mount.

### FRC-6: Water cannot be logged from Home, and the water pill looks tappable but is not
- Severity: Medium
- Where: `dashboard.js` `TodayPlanCard` (chips are `h('span', { class: 'gb-coach-chip …' })`)
- Repro / evidence: Home shows "25% water" as a pill; it is not a button. Logging a glass is More → Food →
  +250: 3 taps, 3 screens. The "Sleep not logged" / "Mood not logged" pills repeat the card right under them
  (`homeB.jpg`).
- Fix: turn the water pill into a "+250 ml" button (`quickAddWater`, already optimistic and offline-safe) with
  Undo; drop the two wellness pills while the Sleep & mood card is shown.

### FRC-7: Habits sit three swipes down Home
- Severity: Medium
- Where: `home-order.js` `HOME_WIDGETS` (score, plan, wellness, tasks, calendar, habits, …)
- Repro / evidence: On A the first habit check is at y 1,906 in #gb-main, under four tasks and the month grid:
  3 swipes for a 1-tap action (`frc-habit.mjs home`).
- Fix: move `habits` before `tasks` and `calendar` in the default order; `resolveHomeLayout` keeps saved layouts.

### FRC-8: Plan my day after 21:00 drafts nothing to act on and cannot plan tomorrow
- Severity: Medium
- Where: `app.js` `openDailyPlan`, `day-plan.js` `buildDayPlan`
- Repro / evidence: B at 23:30: the draft lists "08:00 Take vitamins" (already gone), two habits, two tasks as
  "Focus block" with no time, "2000 ml of water to go"; the button is "Looks good" and writes nothing
  (`plan-1.jpg`). With the clock at 10:05 the same data gives 2 timed blocks and "Add to my day".
- Cause: blocks are placed from the next half hour up to `DAY_END` (21:00) on today only.
- Fix: when no block fits today, build tomorrow's plan (`today` = tomorrow, `nowMin` = 0) and add to that day;
  skip one-off reminders already past; make the water row a +250 button.

### FRC-9: The one-tap sleep confirmation saves "Okay" for someone whose nights are "good"
- Severity: Low
- Where: `app.js` `SCREENS.home` `onConfirmSleep` (`quality: 'okay'`), `onQuickMood` (`saveMoodEntry({ mood })`);
  `nudges.js` `usualSleep`
- Repro / evidence: B with 6 nights "good": "Slept 23:25 to 06:45?" Yes → the tile reads "7.3h Okay"
  (`wellness-quick-after.jpg`); the mood tap stores medium energy / normal stress against 4 days of medium / low.
- Fix: return the usual quality from `usualSleep` and a `usualMood` (energy, stress) from nudges.js; use both in
  the quick path and as the dialogs' defaults; `nudges.test.mjs` cases.

### FRC-10: Log food holds the user 11 s on the AI estimate
- Severity: Medium
- Where: `app.js` `logFoodEntry`, `showFoodLoader`, `openAddFood`
- Repro / evidence: Log food "Masala dosa", 1 piece, Add food: the dialog stays behind the "Estimating calories"
  loader for 11.2 s before it closes (`frc-food.mjs typed`).
- Fix: close the dialog at once and paint a pending row; fill kcal when `POST /api/food/entries` answers; on
  failure keep the payload and toast Retry. The recent-food chips already skip the AI (manual kcal).

### FRC-11: Date words in a task title are kept as text
- Severity: Low
- Where: `app.js` `taskForm` / `openAddTask`
- Repro / evidence: Title "Call plumber tomorrow 5pm", Enter: `POST /api/tasks {"title":"Call plumber tomorrow 5pm","dueAt":null}`.
  Setting the due time takes the native date-time picker (about 4 more taps).
- Fix: a pure `parseWhen(text, now)` module with its own `*.test.mjs`, shown as a removable chip and stripped
  from the title on save; reuse it in the reminder form.

### FRC-12: The reminder form refuses a passed time and buries Add under optional fields
- Severity: Low
- Where: `app.js` `addReminder` (`isPastSlot` branch, "That time has already passed — pick a later one."),
  `calendar.js` add form
- Repro / evidence: at 23:2x, text + 18:00 + Add → refusal toast (`rem-after-once.jpg`). Add sits after Notes,
  Notify, Second alert, End time, Tag, Repeat and Tone: 2 swipes from the text field.
- Fix: move a passed one-off to tomorrow and say so in the success toast; fold the optional fields under
  "More options".

### FRC-13: Quick add's preview says "Logged" before anything is logged, with model emoji
- Severity: Low
- Where: `QuickAddService` `PROMPT` (`"note":"<=90 chars friendly confirmation"`), `app.js` `openQuickAddPreview`
- Repro / evidence: preview subtitles "Logged 250 spent on lunch", "Logged 500ml of water (2 glasses) 💧",
  "Added task: buy milk" above an unconfirmed row; title "Log these?" and button "Log them" for one row
  (`qa-preview-drank_2_glasses_of_w.jpg`).
- Fix: the prompt asks for no emoji and a future-tense line ("Will log…"), and the server strips emoji from
  `note`; title and button follow the row count ("Log this?" / "Log it"). Moot for single intents once FRC-4 lands.

### FRC-14: A system theme change rebuilds the whole screen and closes an open note composer
- Severity: Low
- Where: `app.js` `followSystemTheme` (`systemDark` change listener calls `render()`)
- Repro / evidence: on the shared CDP Chrome the colour scheme flipped mid-run; a trace of DOM swaps shows
  `render (app.js) ← MediaQueryList.<anonymous> (app.js:324)` replacing #gb-main, and the composer the user had
  just opened came back closed (3 of the 6 timed runs; `notes-composer.jpg`). On a phone this is the sunset auto-dark switch.
- Fix: `applyTheme()` already restyles through the tokens; call `render()` only when the open screen shows the
  theme choice (Settings), or not at all.

### FRC-15: The repeat-expense guess lives 3 swipes down
- Severity: Low
- Where: `money-home.js` `MoneyHomeCard` (`repeatExpense`), Home order (`money` is the 8th widget)
- Repro / evidence: the Money card's "Add expense" is at y 2,135 to 2,252 on A (3 swipes); the "You usually log …
  Add it?" line is in that card only.
- Fix: show the repeat-expense guess as a chip in `TodayPlanCard` (one tap saves it with Undo), keep the card's copy.

### FRC-16: Income has no inference at all
- Severity: Low
- Where: `money.js` income modal, `nudges.js`
- Repro / evidence: a salary is 5 taps and 4 screens every month (`frc-income.mjs`); nothing offers the last
  salary, its day or its account, and nothing suggests the existing monthly repeat (`recurring[]`, which already
  auto-posts).
- Fix: a `usualSalary` guess in nudges.js for a "Salary arrived?" chip on payday, and an offer to make a second
  matching salary a monthly repeat.

---

Counts by severity: Critical 0, High 1, Medium 8, Low 7.
