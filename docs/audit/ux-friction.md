# UX friction audit: minimum input, maximum outcome

Branch `feat/overhaul`, static reading only (2026-10-11). Every count was traced through the code
on a phone layout (bottom nav: Home, Habits, Buddy, Progress; everything else is under More).

**How the counts work.** A tap is any press, including Enter or submit, an OS permission prompt and
a native time picker (counted as 2: set and OK). Keystrokes inside a field are not counted. A field is
one the user has to fill from scratch; a prefilled field they only accept is not counted.

**What is out of scope.** `feat/life-plan` already adds the Home Quick add bar, the "One thing today"
card, the goal picker as step 1 of first-run setup, sleep and water prefills, measured-habit "same as
last time" and the one camera button. Nothing below repeats those. The "after" column assumes that
branch is merged, plus the change named in that row.

## Flow table

| Flow | Taps now | Fields now | Taps after | Fields after | Change |
|---|---|---|---|---|---|
| Sign up to first useful Home | 10 | 5 | 4 | 4 | Skip the timezone step when it matches, drop the features step, ask for push at the first reminder instead, auto-submit the OTP, drop Confirm password (F01, F02, F03, F04, F20) |
| Add a task (due today) | 6 | 2 | 3 | 1 | Today / Tomorrow / Pick chips in place of the bare `datetime-local` (F12) |
| Add a task (no date) | 2 | 1 | 2 | 1 | Already minimal; "Add another" for a run of tasks (F17) |
| Add a habit | 2 | 1 | 2 | 1 | Already minimal (template chip: 3 taps, 0 fields); offer the reminder after saving instead of in the form (F18) |
| Tick a habit | 1 | 0 | 1 | 0 | None; measured-habit prefill is on life-plan |
| Log water | 3 | 0 | 1 | 0 | The Daily brief's "N% water" chip becomes a +250 ml button (F07) |
| Log a meal (recent food) | 5 | 0 | 4 | 0 | A recent or favourite chip logs at once, with Undo (F10) |
| Log a meal (typed) | 4 | 1 | 4 | 1 | None beyond F10; photo path is on life-plan |
| Log an expense | 2 (3 at or above 1,000) | 1 | 2 | 1 | The reflection sheet becomes a toast action, not an automatic modal (F11) |
| Add a reminder | 7 | 2 | 3 | 1 | + then Reminder opens a sheet with the text focused and the time read from the words, instead of moving to Calendar (F05) |
| Start focus on a task | 2 | 0 | 1 | 0 | The task row's timer button starts the clock (F06) |
| Write a note | 4 | 1 | 3 | 1 | + then Note opens Notes with the composer already open and focused (F09) |
| Set a budget | 4 | about 7 (one per tag) | 4 | 0 | Prefill each tag from the last 30 days of spend with the existing `budgetsFrom` (F04) |
| Plan meals for the family (first time) | 8 | 6 + one per grocery | 4 | 0 | "Plan for just me" from the empty state, and seed groceries from the pantry (F14, F15) |
| Plan meals for the family (again) | 4 | 0 | 4 | 0 | None; groceries already carry over from the last plan |
| Join a circle | 4 (link: 1) | 0 (code: 1) | 4 (link: 1) | 0 | Taps are fine; add the post-join next step (see Next-step moments) |
| Ask Buddy something | 2 | 1 | 2 | 1 | None for asking; acting on a reply's chip goes 2 to 1 (F19) |

### How each "now" count breaks down

- **Sign up to Home.** Sign-in is the default view, so: "Create account" link (1). Email, Name,
  Password, Confirm (4 fields). Create account (2). 6-digit code (field 5). Verify (3). First-run
  setup: timezone "Looks right" (4), "Turn on notifications" (5) plus the OS prompt (6), features
  "Done" (7). Home then shows only the `OnboardingCard`: "Pick a goal" (8), a chip (9), "Set it up"
  (10). Signup already sends `Intl...timeZone` (`viewSignup`), so the timezone step asks something
  the server already holds. When the two match it is a confirmation screen with nothing to decide.
  Life-plan moves the goal picker into setup but keeps the timezone, push and features steps.
- **Task.** Home "Today's tasks" + Add (1), title, Add task or Enter (2; `submitOnEnter`). A due
  date is a bare `datetime-local`: about 4 more taps on a phone. Priority defaults to Medium. The
  + sheet's subtitle says "A to-do for today", but no date is set.
- **Habit.** Home "Habit streaks" + Add (1), name, Add habit (2). The form also shows Build/Break,
  templates, Category, Color, Cadence, Daily reminder and Tone, all optional. Category is asked
  even though a template sets it.
- **Water.** Water is not on Home. More (1), Food (2), +250 (3). The Daily brief shows "42% water"
  as a `span` that does nothing when tapped (`TodayPlanCard`). Life-plan's One thing card only offers
  water when the user is 250 ml or more behind pace.
- **Meal.** More (1), Food (2), Log food (3), name, Add food (4). The slot defaults from the hour
  and the amount is optional. A recent or favourite chip fills the form but still needs Add food
  (5 taps, 0 fields).
- **Expense.** Home Money card "Add expense" (1), amount, Add (2). Tag is predicted, the account is
  the last one used, and the date is today. The defaults are good. At or above
  `settings.reflectThreshold` (default 1,000) a "Quick reflection" modal opens by itself
  (`openExpenseModal`, 220 ms later): one more tap to dismiss, three fields to fill.
- **Reminder.** + (1), Reminder (2) runs `calToday(); setScreen('calendar')`, so the user leaves
  where they were and lands on the month grid. Tap the text field (3), type, tap Time (4), native
  picker (5, 6), Add reminder (7). Time starts empty; the "Usual time" chip helps only when there is
  history. Settings › Reminders already has a compact quick add (text, date, time, mic) that is
  never offered from +.
- **Focus.** Task row timer button (1; `startFocusOn`) opens Focus with the task picked, then Start
  (2). `focusAutoStart` already exists for Quick add's "start a focus" and is not set here.
- **Note.** + (1), Note (2) goes to `setScreen('notes')`. The composer stays collapsed "until
  tapped" (3). Type, Save (4).
- **Budget.** More (1), Money (2), the health card's "Set budgets" fix (3), one blank field per tag,
  Save budgets (4). `starter-packs.js` `budgetsFrom` already works out realistic limits from 30 days
  of real spend, but only the starter-pack flow uses it.
- **Family plan.** More (1), Family (2), "Add your first member" (3), "Create a profile" (4), then
  name, relationship, DOB, diet, height and weight (6 fields), Save (5), the Plan tab (6), then type
  each grocery or Scan (7), Generate (8). The server makes the user's own "self" row from their
  profile when the family is first created (`FamilyService.resolveOrCreateFamily`), but only once
  some other person is added. A solo cook has no way to reach the planner. "Available groceries"
  starts from the last plan's list, never from the pantry, although the weekly plan has a "use
  pantry" checkbox.
- **Circle.** More (1), Circle (2), Browse (3), Join (4); by code, one more tap and a field; an
  invite link joins in one tap (`joinFromLink`). After joining, the user sees a toast and nothing
  else.
- **Buddy.** Buddy tab (1), type, Enter (2). The three suggestion buttons show only on an empty
  thread. An action chip on a reply opens a confirm sheet (`openActionSheet`) whose fields are
  already filled, then Save: 2 taps.

### Where the app asks for what it already knows

| Asked | Already known from | Where |
|---|---|---|
| Timezone (first-run step 1, or 2 on life-plan) | sent at signup from the device | `openFirstRunSetup` › `timezoneStep` |
| Currency (silently `₹` for everyone, changed only in Customise) | device locale and account timezone | `money-core.js` `CUR`, `emptyMoney().settings.currency` |
| Your own name, DOB, height, weight, diet for a family plan | Profile (`u.dob`, `heightCm`, `weightKg`, `dietPreference`) | `family.js` `emptyState` forces "Add your first member" |
| Budget per tag, from blank | 30 days of tagged expenses | `money.js` `openSetBudgets` vs `starter-packs.js` `budgetsFrom` |
| Groceries for today's plan | Pantry items | `family.js` `plannerSection` (`model.ingredients` only from the last plan) |
| Reminder time, from blank | the time typed in the words ("call mom at 6") | `calendar.js` `buildForm` |
| Password, twice | the reveal eye on the first field | `viewSignup` |
| "Which features do you use?" | everything is on by default (opt-out) | `featuresStep` |

## Ranked findings

| ID | Title | Severity | Effort | File + symbol | Change |
|---|---|---|---|---|---|
| F01 | Timezone step confirms a zone the server already has | High | S | `scripts/app.js` `openFirstRunSetup` › `timezoneStep` | Leave `timezoneStep` out of `steps` when `!differs`. Signup already sent the device zone, so for nearly every new user the step has nothing to decide. |
| F02 | Features step asks the user to turn off what is already on | High | S | `scripts/app.js` `openFirstRunSetup` › `featuresStep` | Drop it from first-run. Settings › Layout keeps the same `featureSwitchRow`s, and with life-plan's goal step the packs already choose what shows. |
| F03 | Push permission is asked before the user has anything to be reminded of | Medium | M | `scripts/app.js` `notifyStep`, `addReminder`, `createHabit` | Call `enablePushFlow` the first time a timed reminder or a habit `reminderTime` is saved and push is off. Remove `notifyStep`. That cuts 2 setup taps, and the ask comes when the answer is obvious. |
| F04 | Budgets start blank although the app can suggest them | High | S | `scripts/money.js` `openSetBudgets`; `scripts/starter-packs.js` `budgetsFrom` | Export `budgetsFrom` and use its amounts as each empty tag's starting value (marked "suggested"), so Save accepts them. About 7 fields drop to 0. |
| F05 | "Reminder" moves the user to Calendar and asks for time from scratch | High | M | `scripts/app.js` `openAddSheet` (`key: 'reminder'`), `reminderSettingsPane` | Open the Settings › Reminders quick add (text, date today, time, mic) as a sheet with the text focused. If Time is empty on Enter, run the text through `parseQuickAdd`'s reminder intent to fill it. 7 taps drop to 3. |
| F06 | Focus from a task row stops on a Start button | High | S | `scripts/app.js` `startFocusOn` | Also set `focusAutoStart = true` when called from a task row; `ScreenFocus` already starts on it and won't override a running session. 2 taps drop to 1. |
| F07 | Daily brief's water chip shows the gap but cannot close it | Medium | S | `scripts/dashboard.js` `TodayPlanCard` | Render the "N% water" chip as a button that calls `onQuickAddWater(250)` (pass the prop from `SCREENS.home`). Water from Home goes from 3 taps to 1 at any time of day, not only when One thing picks it. |
| F08 | Currency is `₹` for every account | Medium | S | `scripts/money-core.js` `CUR`, `emptyMoney` | Seed `settings.currency` once from the device region (`new Intl.Locale(navigator.language).maximize().region`, then a short region-to-symbol table, with `₹` as the fallback). A non-India user stops seeing wrong amounts everywhere until they find Customise. |
| F09 | + then Note lands on a collapsed composer | Medium | S | `scripts/app.js` `openAddSheet` (`key: 'note'`); `scripts/notes.js` `ScreenNotes` composer | Pass an `openComposer` flag through `SCREENS.notes` so the composer mounts open and focused. 4 taps drop to 3. |
| F10 | Recent and favourite food chips fill a form instead of logging | Medium | S | `scripts/app.js` `openAddFood` (recent and favourite chips) | A tap on a chip calls `logFoodEntry` with the chip's name, grams and kcal and the current slot, then closes with an Undo toast (`toast.action`). Long-press or "Edit" keeps today's fill-the-form path. |
| F11 | Expenses at or above 1,000 open a reflection modal on their own | Medium | S | `scripts/money.js` `openExpenseModal` › `onPrimary` | Replace the timed `openReflection` with `toast.action('Expense added.', 'Reflect', ...)`. The data is still one tap away, and the logging flow stays 2 taps. |
| F12 | A due date costs a full date-time picker | Medium | S | `scripts/app.js` `taskForm` | Above `dueInput`, add Today / Tomorrow / Pick chips (Today = end of the local day). Leave the default as no date, so nothing turns overdue by itself. A task due today drops from 6 taps to 3. |
| F13 | Focus session ends without offering to finish its task | Medium | S | `scripts/timer.js` `finish`; `scripts/app.js` focus props | When a focus session linked to `T.link.taskId` ends, toast 'Mark "<title>" done?' and run `toggleTask` through a new prop. This closes the loop the timer button opened. |
| F14 | Today's meal plan ignores the pantry | Medium | M | `scripts/family.js` `plannerSection` (`model.ingredients`) | When `model.ingredients` is empty, seed it from in-stock, non-expired `model.pantryItems` (already loaded by `load()`), the way the weekly plan's pantry checkbox works. Typing groceries goes to 0 fields. |
| F15 | A solo cook cannot reach the meal planner | Medium | M | `scripts/family.js` `emptyState`; `FamilyService.resolveOrCreateFamily` | Add "Plan meals for just me" next to "Add your first member". It creates the family, whose self row is copied from Profile, and opens the Plan tab. The first plan drops from 8 taps and 6+ fields to 4 and 0. |
| F16 | Goal saved, then nothing | Low | S | `scripts/app.js` `createGoal` | Replace "Goal saved." with `toast.action('Goal saved.', 'Add first task', () => openAddTask(goal))`. `taskForm` already takes `presetGoalId`. |
| F17 | Adding several tasks reopens the sheet each time | Low | S | `scripts/app.js` `openAddTask` | After Add task, clear the title and keep the sheet open on Shift+Enter, or add a secondary "Add another". Three tasks drop from 6 taps to 4. |
| F18 | New habit without a reminder gets no reminder offer | Low | S | `scripts/app.js` `openHabitForm` › `onPrimary` (create path) | When `reminderInput` is empty, toast "Remind me at HH:MM?" with `suggestReminderTime` (habit-stats.js) and save it with `updateHabit` on tap. The form's picker becomes optional input the user rarely needs. |
| F19 | Buddy's action chips open a sheet that is already filled | Low | S | `scripts/mentor.js` `openActionSheet` | For task and habit chips, save at once through `api.act.*` and show an Undo toast. Keep the sheet for reminders, so a past time is still refused under its field. 2 taps drop to 1. |
| F20 | Signup asks for the password twice and makes the user tap Verify | Low | S | `scripts/app.js` `viewSignup`, `viewVerify` | Drop Confirm password, since `passwordField`'s reveal covers typos; reset still exists. In `viewVerify`, call `submit()` on the `input` that brings the code to 6 digits (paste and `one-time-code` autofill). |

## Next-step moments the app misses

Each of these is a point where the obvious follow-up is known and the app says only "Saved".

1. **Focus session done on a task**: offer "Mark it done" (F13).
2. **Goal created**: offer "Add the first task" (F16).
3. **Habit created with no reminder**: offer the suggested time (F18).
4. **The 5th expense this month in a tag with no budget**: toast "Set Food to about X a month?" using
   `budgetsFrom`'s figure for that tag (same code as F04).
5. **Joined a circle** (`joinWithCode`, `joinFromLink`): only a toast. Scroll to the new card and,
   when it has no active challenge, offer its first `CHALLENGE_TEMPLATES` pick in one tap.
6. **Signup verified**: the setup sheet ends on "You're all set." With F02 and F03 it ends on the
   goal step, so the first screen after it is a Home that is already set up.
7. **Daily brief chips** ("Sleep not logged", "Mood not logged") are inert spans, as with water. Make
   each one open the matching dialog (`onAddSleep`, `onAddMood`), unless life-plan's One thing card
   is already showing the same ask.

Already handled, so not listed as gaps: a task tick that closes a goal's last task (`suggestGoalDone`),
"Build shopping list" from a meal plan, a note's "Make a task" and "Add a reminder", a task's
"Add a reminder", Food's "Copy yesterday's ...", and the expense dialog's predicted tag and last-used
account.
