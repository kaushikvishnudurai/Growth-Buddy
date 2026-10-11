# Friction audit: setup and review flows (FRS)

Guiding rule: low input, high outcome. Every flow below was driven with Playwright over CDP at
390x844 (touch, Asia/Kolkata) against the shared local stack (Vite :5591, backend :8591), each on a
fresh `--empty` account (`e2e/seed.mjs`), except the weekly review, which needs data and used a
seeded account. Sign-up was driven through the real form, with the OTP read from the backend log.
The driver scripts and raw output are in the session scratchpad (`frs/f0*.mjs`). Screenshots are in
`docs/evidence/audit-friction-setup/`.

## How the counts were taken

- **Taps**: every click or tap, including focusing a field and opening a native `<select>` (2 taps).
- **Fields**: inputs the user has to type into.
- **Decisions**: each visible choice the user must read and then accept or change, defaults
  included. A default still costs a glance.
- **Screens**: screens, sheets, dialogs and interrupting overlays crossed, counting the start.
- **Seconds**: an estimate of human time, not the driver's time. The machine's load average was
  26-30 during the run, so driven times (kept in the raw output) ran 3-10x slower than a person and
  measure the box, not the app. The estimate uses a KLM-style model: 1.1 s per tap, 0.3 s per
  typed character, 1.35 s per decision, 0.5 s per screen, plus any real server wait measured
  (the meal plan's 16 s, for example).
- One harness note: the shared headless Chrome leaks other sessions' `emulateMedia` colour-scheme
  flips into every context, which fires the app's system-theme listener and re-renders the app every
  few seconds. The driver mutes that listener so the counts reflect the app, not the neighbours.
  The app behaviour it exposed is real, though, and is filed as FRS-19.

## Summary

| Flow | Taps | Fields | Decisions | Screens | Est. s | Proposed taps / fields / decisions / s |
|---|---|---|---|---|---|---|
| Sign-up to first value | 14 | 5 | 4 | 9 | 45 (+ email wait) | 6 / 4 / 1 / ~26 |
| Create a habit (own name + reminder) | 6 | 2 | 8 | 4 | 26 | 3 / 1 / 2 / 11 |
| Goal with 3 milestones | 11 | 5 | 7 | 6 | 49 | 4 / 1 / 2 / 15 |
| Set a budget (3 categories) | 7 | 3 | 8 | 5 | 25 | 3 / 0-1 / 1 / 8 |
| Recurring bill | 9 | 2-3 | 4 | 6 | 21-23 | 4 / 1 / 1 / 9 |
| Family (2 members) | 16 | 4 | 10 | 9 | 44 | 7 / 2 / 3 / 18 |
| Meal plan for today | 2 | 0 | 2 | 2 | 22 (16 s server) | 0-1 / 0 / 0 / ~16 |
| Create a circle, invite, start a challenge | 11 | 3 | 4 | 8 | ~32 | 4 / 1 / 1 / 12 |
| Join a circle from a link | 0 | 0 | 0 | 1 | 1 | already minimal |
| Request a mentor | 5 | 0-1 | 2 | 5 | ~12 | 2 / 0 / 1 / 5 |
| Start a focus session | 3 | 0 | 3 | 3 | 9 | 1 / 0 / 0 / 2 |
| Read the weekly report / insights | 1 + scroll | 0 | 0 | 2 | ~6, but empty for 7 days | 0 (pushed) / 0 / 0 |
| Weekly review | 4 | 2 | 2 | 3 | 24 | 2 / 0 / 1 / 6 |
| Notification settings (quiet hours + mute one kind) | 6 | 0 | 4 | 5 | 15 | 2 / 0 / 1 / 5 |

---

## Flow 1: Sign-up to first useful screen

Path driven: sign-in screen, Create account, form (email, name, password, confirm), Create account,
verify screen, OTP, Verify and continue, the first-run sheet (timezone, push, features), Home's
"Set up in 4 quick steps" card, "Pick a goal, we set it up", one pack (Get fit), Set it up.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before: to the verify screen | 6 | 4 | 0 | 3 | 30 |
| Before: OTP to Home | 2 | 1 | 0 | 1 | 4 (+ time to find the email) |
| Before: first-run sheet (3 steps) | 3 | 0 | 3 | 3 | 7 |
| Before: starter pack to Home with habits | 3 | 0 | 1 (which goal) | 2 | 5 |
| **Before: total** (measured) | **14** | **5** | **4** | **9** | **45** (67 characters typed) |
| **After** | **6** | **4** | **1** | **4** | **~26** |

Proposal:

1. Drop "Confirm password". The field already has a show/hide toggle (`passwordField`), which is
   the modern replacement. `viewSignup` in `scripts/app.js`. Frontend only. Saves 1 field and about
   15 characters.
2. Submit the OTP when the sixth digit lands. `otpBoxes` / `viewVerify`: call `submit()` from the
   input handler once `digits.length === 6`. Frontend only. Saves 1 tap, and on Android the SMS/email
   autofill then signs in with no tap at all.
3. Make the first-run sheet one step: "What do you want to work on?" with the six starter-pack
   chips and the live preview that `openStarterPacks` already draws. The timezone step is redundant
   because sign-up already sends `Intl...timeZone` (`viewSignup`), so on the device that signed up it
   always reads "They match" and costs a tap for nothing. Keep the silent `syncDeviceTimezone()` for
   the mismatch case. Push moves to the moment it has a reason (the first reminder or habit with a
   time, which the pack just created). The features step can be inferred: switch on the features the
   picked packs write into (`KIND_FEATURE` in `scripts/starter-packs.js`) and leave the rest at
   their defaults. `openFirstRunSetup` and `openStarterPacks` in `scripts/app.js`. Frontend only.
4. Drop the separate "Getting started" checklist for an account that just picked a pack. Home then
   shows the habits, reminders and goal that were created (see FRS-2).

Result: email, name, password, OTP (auto), one chip, Set it up. 6 taps, 4 fields, 1 decision.

## Flow 2: Create a habit

Driven: Habits tab, Add a habit, type "Journal before bed", category Journal, reminder 21:30, Add habit.
The form shows 8 decisions at once: build/break, template or own name, category, auto-tick metric,
colour, cadence, reminder time, tone. The template path is 3 taps (Add, template, Add habit), but a
template sets no reminder time, so the habit never nudges.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before (own name + reminder) | 6 | 2 | 8 | 4 | 26 |
| Before (template) | 3 | 0 | 1 | 2 | 5, with no reminder |
| **After** | **3** | **1** | **2** | **3** | **11** |

Proposal:

1. Infer from the name. The form already does this for the health link (`suggestLink` ->
   `suggestHealthLink(nameInput.value)` in `openHabitForm`). Extend the same input listener to set
   category, icon and a suggested reminder time from keywords: "journal", "read" or "study" to study
   or journal at 21:30, "walk", "run" or "gym" to fitness at 07:00 or 18:00, "no ..." or "quit ..."
   to Break a habit. Frontend only, `scripts/app.js` `openHabitForm`.
2. Give `HABIT_TEMPLATES` the same `reminderTime` values the starter packs use (`PACKS` in
   `scripts/starter-packs.js` already has Read 20 min at 21:30 and Walk 8k at 18:00). One data
   change; a template then gives a complete habit in 3 taps.
3. Fold colour, cadence (default daily), auto-tick and tone under a "More options" disclosure. The
   form opens on name, Build/Break and the reminder time. Frontend only.

## Flow 3: Goal with milestones

Driven: More, Goals, New goal, title, horizon Mid, target date, Save goal, then an "Achievement
unlocked: Dreamer" overlay that must be dismissed (Nice!) before anything else can be tapped, then
three milestones typed one by one into the card's "Add a milestone" field.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before | 11 | 5 | 7 | 6 (incl. the interrupt) | 49 |
| **After** | **4** | **1** | **2** | **3** | **15** |

Proposal:

1. Suggest milestones in the goal form. Add a "Suggested steps" checklist under the title, filled
   from a small template table keyed on the title's words (run / half marathon, save / emergency
   fund, read / books, lose / kg, learn / course), each step pre-ticked, the same live-preview
   pattern as `openStarterPacks`. Saving writes the goal and the ticked milestones in one go. The
   table is frontend-only (`scripts/goals.js` `openGoalForm` plus `goal-milestones.js`). An AI
   suggestion through the existing gateway can come later, with the table as its fallback.
2. Infer the horizon from the target date (under 3 months short, under 12 months mid, else long)
   and drop the Short/Mid/Long control from the form. Frontend only.
3. FRS-3: the first-goal achievement should not block the screen. See below.

## Flow 4: Set a budget

Driven: More, Money, find budgets (an empty account's Overview has no Budgets card; the way in is
"Set budgets" inside the Financial health card near the bottom), Set budgets, type 3 of 6 amounts,
skip 6 rollover checkboxes, Save budgets.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before (3 categories) | 7 | 3 | 8 | 5 | 25 |
| **After** | **3** | **0-1** | **1** | **3** | **8** |

Proposal:

1. Offer suggested amounts in the sheet. With 30 days of spending, prefill from `budgetsFrom`
   in `scripts/starter-packs.js` (10% under each category's spend, already written and tested),
   for every category, not just the top two. With no spending, ask one number ("What can you spend
   a month?", or prefill it from the income the user has logged or set as a repeat) and split it by
   a default ratio across the categories. The user then taps Save. Frontend only, `scripts/money.js`
   (the budgets sheet). A starter pack today adds no budget at all on an empty account, so the
   "Save money" pack writes nothing for money.
2. Put an empty Budgets card on the Overview with a "Set budgets" button, instead of only the one in
   Financial health below the fold (`budgetsSection` in `tabOverview`).
3. Hide the six rollover checkboxes behind one "Roll over unspent money" switch.

## Flow 5: Add a recurring bill

There are two ways in, on two tabs, and neither is labelled "bill". "Add subscription" is on
Spending (needs Mark as paid each month), "Add repeat" is on Income (posts by itself). Rent, a money
out item, lives on the Income tab.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before: Electricity via Add subscription | 9 | 3 | 4 | 6 | 23 |
| Before: Rent via Add repeat (Income tab) | 9 | 2 | 4 | 6 | 21 |
| **After** | **4** | **1** | **1** | **3** | **9** |

Proposal:

1. Tag the bill from its name. `openAddSubscription` defaults the tag to Entertainment and never
   reads the name, so "Electricity" is saved as Entertainment unless the user corrects it.
   `suggestCategory(text, money)` already exists in `scripts/money-core.js` and is used by Add
   expense. Call it on the name's input event. Frontend only (FRS-8).
2. Template chips at the top of the sheet: Rent, Electricity, Phone, Internet, Netflix, SIP, EMI,
   each carrying its tag, kind (auto-post repeat vs pay-and-tick bill) and a default due day. One
   tap fills everything except the amount.
3. Default the due day to today's day of month (the day the user is most likely adding it).
4. Merge the two entry points into one "Bills and repeats" sheet reachable from Spending, with
   "Posts by itself / I mark it paid" as one switch. Frontend only, `scripts/money.js`.
5. Lean on detection: `repeatExpense` in `scripts/nudges.js` already offers "Add it?" on Home for a
   repeating expense. Make that the main path, so a bill is added in 1 tap after the second
   payment. Frontend only.

## Flow 6: Set up a family and a meal plan

Driven: More, Family, Add your first member, chooser (Create a profile / Invite a registered user),
Create a profile, name, relationship (select), date of birth, gender (inferred from relationship,
good), height and weight skipped, Add member. Repeated for a second member. Then the Today tab,
Make a meal plan (all members pre-picked), 16 s for the plan.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before: two members | 16 | 4 | 10 | 9 | 44 |
| Before: today's meal plan | 2 | 0 | 2 | 2 | 22 (16 s server) |
| **After: two members** | **7** | **2** | **3** | **4** | **18** |
| **After: meal plan** | **0-1** | **0** | **0** | **1** | **~16** |

Proposal:

1. Skip the chooser. Open straight on the profile form with a "Have a Growth Buddy account? Invite
   them instead" link. `addChooserPanel` / `addPanel` in `scripts/family.js`. Saves 1 tap and 1
   screen per member.
2. Infer relationship from the name: Amma, Mom, Mummy to Mother; Appa, Dad, Papa to Father;
   Paati, Ammamma, Nani, Dadi to Grandmother; Thatha, Nana, Dada to Grandfather; Akka, Anna,
   Thambi, Thangai to sibling. The relationship select then needs no tap. Gender already follows the
   relationship (`REL_GENDER`). Frontend only.
3. Ask for an age or a birth year instead of a full date of birth; the plan needs the age band.
   Keep the full date as optional for the birthday reminder.
4. "Save and add another" keeps the panel open, so the second member costs no navigation.
5. Generate today's plan when the Today tab opens with members and no plan for today, and show it
   with "Regenerate". Backend needed only as a cost decision (one AI call per family per day, which
   `FamilyService` could also do in a morning job so the plan is ready before the tab opens).

## Flow 7: Create or join a circle, request a mentor

Driven with two accounts. A: More, Circle, New circle, name, shared goal, Create. The new circle
card has no invite prompt; inviting is behind the card's options menu (Options, Share invite link).
Starting a challenge is a further sheet (Start a challenge, pick a template chip, Start). B opened the
invite link while signed in and was joined with no tap. B then asked A for mentoring: Find someone,
a list of every user with name, masked email and level only, Get mentored, an optional note dialog,
Send invite.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before: create circle | 6 | 2 | 2 | 5 | 21 |
| Before: share invite | 2 | 0 | 0 | 1 | 3 |
| Before: start a challenge (template) | 3 | 0 | 2 | 1 | 7 |
| Before: join from link | 0 | 0 | 0 | 1 | 1 |
| Before: request a mentor (from Home) | 5 | 0 | 2 | 5 | 12 |
| **After: create, invite and challenge** | **4** | **1** | **1** | **3** | **12** |
| **After: request a mentor** | **2** | **0** | **1** | **2** | **5** |

Proposal:

1. After Create, open the share sheet straight away and start the default "7-day habit sprint"
   challenge with the circle's shared goal, so a new circle has something to do on day one.
   `newCircle` -> `shareInvite` + `startChallenge` in `scripts/circle.js`. Frontend only; the
   challenge endpoint already exists.
2. Name can default to the shared goal ("Walk 30 minutes club"), so creating takes one field.
3. On join, offer the circle's shared goal as a habit in one tap ("Add 'Walk 30 minutes' to your
   habits?"). Joining today adds nothing to the joiner's habits (verified: `/api/habits` returned
   `[]` for B after joining), so the circle's check-ins have nothing to count. Frontend only, using
   `createHabit`.
4. Mentor discovery: rank people by shared circles first, and show each person's top streak or
   habit on the row, so "who to ask" is not a guess between identical names. Needs the backend
   (`/api/users/browse` ordering and one extra field). Send the request straight from "Get
   mentored" and offer the note as an optional follow-up in the confirmation toast. Frontend for
   the note change, `scripts/circle.js` `PersonRow`.

## Flow 8: Start a focus session

Driven: More, Timer, Start (25 minutes, nothing linked, brown noise).

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before | 3 | 0 | 3 | 3 | 9 |
| **After** | **1** | **0** | **0** | **1** | **2** |

Proposal: a "Focus" quick action on Home (or a long-press on the Quick add button) that starts
the last-used length and sound, linked to the first open task. `startFocusOn` already exists and
Home tasks already carry `onFocusTask`. Frontend only, `scripts/dashboard.js` / `scripts/timer.js`.

## Flow 9: Read the weekly report and insights

Driven on a seeded account: Progress tab (1 tap). The Insights card reads "Log sleep and mood for a
week and patterns show up here. 1 of 7 days logged", and Trends say "Not enough data yet". A new
user gets nothing out of this screen for a week, and the screen must be visited to be seen. The
Progress digest (Settings, Alerts) is Off by default.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before | 1 + scroll | 0 | 0 | 2 | ~6, value after 7 days of 2 logs |
| **After** | **0** | **0** | **0** | **1** (a notification) | **~3** |

Proposal:

1. Default the Progress digest to Weekly, Sunday evening, for new accounts, so the report comes to
   the user. Backend: the default in the user's digest settings (`AuthService` / the digest job).
2. Lower the insight bar: show "This week vs last" from whatever is already logged (habit check-ins,
   tasks, water) from day 3, instead of only sleep and mood correlations after 7 days.
   `scripts/insights.js` / `scripts/review.js` `weekOverWeek`. Frontend only.

## Flow 10: Weekly review

Driven on a seeded account on a Sunday: Home's "Your week is ready to review" nudge, the review
sheet, "What went well?" (empty), "Your one focus for next week", Save review.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before | 4 | 2 | 2 | 3 | 24 |
| **After** | **2** | **0** | **1** | **2** | **6** |

Proposal:

1. Draft the wins from thinner weeks. `weeklyWinsDraft` (`scripts/review.js`) needs a 3-day streak,
   3 water days or a 5-point score rise, so an account in its first weeks gets an empty box and types.
   Add lower rungs: any habit checked N times, any goal action, any mood or sleep log, the best day's
   score. Frontend only.
2. Prefill the focus too: the habit with the lowest completion this week, or the nearest goal's
   next milestone, as a suggestion the user accepts with Save.
3. FRS-12: make the saved focus go somewhere.

## Flow 11: Change notification settings

Driven: avatar, Settings (opens on Profile), Alerts tab, Quiet hours switch (22:00 to 07:00 defaults,
good), scroll to "Notify me about", Money off, Done. The bell's panel has filter chips but no way
into these settings.

| | Taps | Fields | Decisions | Screens | Est. s |
|---|---|---|---|---|---|
| Before | 6 | 0 | 4 | 5 | 15 |
| **After** | **2** | **0** | **1** | **2** | **5** |

Proposal:

1. A settings gear in the bell's panel header that calls `openProfileSettings('notifications')`
   (the function already takes the tab). Frontend only.
2. A "Mute Money notifications" action on each notification row in the bell, writing the same
   per-kind mute as the switch in Alerts (`notifyMuteRows`). 1 tap from the moment the user is
   annoyed.

---

## Findings

### FRS-1: Two onboarding passes, and the first one creates nothing
- Severity: High
- Where: `scripts/app.js` `openFirstRunSetup`, `scripts/dashboard.js` `OnboardingCard`; Home, 390x844
- Repro / evidence: sign up through the form. The first-run sheet runs three steps (timezone, push,
  features), toasts "You're all set.", and Home then shows a second checklist "Set up in 4 quick
  steps" with nothing created yet. The value step ("Pick a goal, we set it up") comes after both.
  Screenshot `f01-home-checklist.jpg`.
- Cause: the setup sheet and the starter packs are separate flows, and the sheet's steps are
  configuration, not content.
- Fix: one step, the starter-pack picker, inside the first-run sheet; infer features from the packs;
  ask for push when the first timed item exists. Files: `scripts/app.js` (`openFirstRunSetup`,
  `openStarterPacks`), `scripts/starter-packs.js`.

### FRS-2: The timezone step always asks a question the sign-up already answered
- Severity: Medium
- Where: `scripts/app.js` `openFirstRunSetup` `timezoneStep`
- Repro / evidence: sign up through the form; step 1 reads "This device Asia/Calcutta, Your
  account Asia/Calcutta. They match." with a "Looks right" button to tap (`f01.out`).
- Cause: `viewSignup` sends `Intl.DateTimeFormat().resolvedOptions().timeZone` with the sign-up, so
  on the same device the zones always match.
- Fix: skip the step when `sameZone(saved, tz)`; keep it only when they differ. `scripts/app.js`.

### FRS-3: The first goal is followed by a blocking achievement overlay
- Severity: Medium
- Where: `scripts/celebrate.js` `show`; Goals, 390x844
- Repro / evidence: on an empty account, save a first goal. "Achievement unlocked: Dreamer" covers
  the screen (`aria-modal`), and the milestone field under it cannot be tapped until "Nice!" is
  pressed. The driver's clicks on the milestone field were intercepted by `.gb-celebrate` until it was
  dismissed.
- Cause: badge unlocks use the full-screen celebration, which is right for finishing a goal but
  interrupts setup.
- Fix: show badge unlocks during setup flows as a toast with confetti, and keep the modal for
  completions. `scripts/celebrate.js`, its callers in `scripts/app.js` (`checkAchievements`).

### FRS-4: OTP does not submit itself on the sixth digit
- Severity: Low
- Where: `scripts/app.js` `otpBoxes` / `viewVerify`
- Repro / evidence: type the 6-digit code; nothing happens until "Verify & continue" is tapped
  (the driver had to tap it). `otpBoxes` has no submit path.
- Fix: call `submit()` when the digits reach 6. `scripts/app.js`.

### FRS-5: Sign-up asks for the password twice
- Severity: Low
- Where: `scripts/app.js` `viewSignup`
- Repro / evidence: the form has Email, Name, Password, Confirm password (`f01-signup-form.jpg`);
  both password fields already have a show toggle.
- Fix: remove the confirm field and keep the toggle. `scripts/app.js`.

### FRS-6: Habit templates and the habit form never set a reminder time
- Severity: Medium
- Where: `scripts/app.js` `HABIT_TEMPLATES`, `openHabitForm`
- Repro / evidence: Add a habit, tap "Read 20 min": name, category and icon fill; the reminder time
  stays empty (`after preset name= Read 20 min time= ` in the driver output). The starter pack for
  the same habit sets 21:30.
- Fix: add `reminderTime` to each template (copy from `PACKS`), and suggest one from the name's
  keywords next to the existing `suggestHealthLink` call. `scripts/app.js`.

### FRS-7: Budgets are reachable only from the Financial health card on an empty account
- Severity: Medium
- Where: `scripts/money.js` `tabOverview` / `budgetsSection`
- Repro / evidence: empty account, Money, Overview: no Budgets card; the only "Set budgets" is in
  Financial health near the bottom (`f04-budgets-sheet.jpg`). The sheet then shows six blank amounts
  and six rollover checkboxes.
- Fix: an empty Budgets card on Overview with suggested amounts (FRS flow 4). `scripts/money.js`.

### FRS-8: A new subscription is tagged Entertainment whatever its name
- Severity: Medium
- Where: `scripts/money.js` `openAddSubscription`
- Repro / evidence: Add subscription, name "Electricity": the tag stays on Entertainment
  (`tagPicker(money, save, { initial: 'entertainment' })`); the driver had to tap Others.
- Cause: the name is never passed to `suggestCategory`, which Add expense and receipts already use.
- Fix: on the name's input event, set the tag from `suggestCategory(name.value, money)` until the
  user picks one. `scripts/money.js`.

### FRS-9: Recurring money has two entry points on two tabs; rent lives under Income
- Severity: Medium
- Where: `scripts/money.js` `openAddSubscription` (Spending tab) and `openRecurring` (Income tab)
- Repro / evidence: a monthly bill can be added as a subscription (Spending) or as a repeat
  (Income, defaults to "Money out"). Neither is called a bill.
- Fix: one "Bills and repeats" sheet with templates and a "Posts by itself / I mark it paid" switch.

### FRS-10: Family asks profile-or-invite before every member and never reads the name
- Severity: Low
- Where: `scripts/family.js` `addChooserPanel`, `memberFormControls`
- Repro / evidence: two members cost 16 taps and 9 screens; "Amma" still needs the relationship
  select opened (it happened to default to Mother; "Appa" needed it).
- Fix: open on the profile form, infer relationship from common names, "Save and add another".

### FRS-11: Joining a circle does not give the joiner its shared goal
- Severity: Medium
- Where: `scripts/circle.js` `joinFromLink` / `joinWithCode`
- Repro / evidence: A creates "Morning Walkers" with shared goal "Walk 30 minutes"; B opens the
  invite link and is joined with no tap (good), but `GET /api/habits` for B returns `[]`, so B has
  nothing to check in and the seat ring never lights.
- Fix: after the join, a one-tap "Add 'Walk 30 minutes' to your habits" through `createHabit`.

### FRS-12: The weekly review's "one focus for next week" is saved and never shown again
- Severity: Medium
- Where: `scripts/app.js` `openWeeklyReview`, `state.weeklyReviews`
- Repro / evidence: save a review with focus "Sleep by 11 every night"; Home does not show it
  (driver: `focus visible anywhere on Home? false`). `prev.focus` is read only to prefill the same
  sheet.
- Fix: show the week's focus on Home under the greeting until the next review, with a one-tap
  "Make it a habit". `scripts/app.js`, `scripts/dashboard.js`.

### FRS-13: The weekly wins draft is empty for a new user's week
- Severity: Low
- Where: `scripts/review.js` `weeklyWinsDraft`
- Repro / evidence: seeded account with a habit streak of 1, a mood log, a sleep log and water;
  "What went well?" opens empty (`drafted wins = ""`).
- Cause: the lowest rung is a 3-day streak, 3 water days or a 5-point rise.
- Fix: add lower rungs (check-ins this week, any goal action, any log). `scripts/review.js`, with a
  case in `scripts/review.test.mjs`.

### FRS-14: Settings › Alerts renders "[object Object]" instead of the keep-read picker
- Severity: High
- Where: `scripts/app.js` notifications pane, `keepReadPicker`
- Repro / evidence: avatar, Settings, Alerts, scroll to "Keep read notifications for": the text
  "[object Object]" shows where the choice should be, and the setting cannot be changed.
  Screenshot `f09-alerts-keepread.jpg`.
- Cause: `keepReadPicker()` returns `segmented(...)`, i.e. `{ node, get }`, and is passed to `h()`
  as a child.
- Fix: `keepReadPicker().node` at the call site (or return `.node` from `keepReadPicker`).
  `scripts/app.js`.

### FRS-15: The bell has no way into notification settings
- Severity: Low
- Where: bell panel (header), `scripts/app.js`
- Repro / evidence: open the bell: the panel has filter chips (All, Reminders, Habits, People,
  Money, System) and no settings entry. Notification settings are avatar, Settings, Alerts.
- Fix: a gear in the panel header calling `openProfileSettings('notifications')`.

### FRS-16: Insights and trends show nothing useful for the first week
- Severity: Medium
- Where: Progress screen, `scripts/insights.js`, `scripts/report.js`
- Repro / evidence: seeded account: "Log sleep and mood for a week and patterns show up here. 1 of
  7 days logged", every trend "Not enough data yet".
- Fix: a "This week vs last" or "So far this week" card from habits, tasks and water from day 3, and
  default the weekly digest on for new accounts.

### FRS-17: Mentor search gives nothing to choose by
- Severity: Low
- Where: `scripts/circle.js` `PersonRow`, `/api/users/browse`
- Repro / evidence: Find someone lists every user as name, masked email and Level 1, unranked; on
  the local stack every row reads "Asha Rao".
- Fix: rank by shared circles, show the person's top habit or streak (needs a backend field).

### FRS-18: A new circle has no first step
- Severity: Low
- Where: `scripts/circle.js` `newCircle`
- Repro / evidence: after Create the card says "No challenge running" and inviting is two taps
  behind the options menu (`f06-circle-created.jpg`).
- Fix: open the share sheet on create and start the default 7-day sprint.

### FRS-19: A system theme change rebuilds Family and Circle and closes open panels
- Severity: Low
- Where: `scripts/app.js` `followSystemTheme`
- Repro / evidence: on Family, open "Add your first member" and let the OS colour scheme flip (in
  this run, the shared Chrome's leaked media emulation did it every few seconds): every flip ran a
  full `render()`, refetched all ten `/api/family/*` endpoints and closed the open panel; the
  driver's clicks failed with "element was detached from the DOM". Stack from the instrumented fetch:
  `ScreenFamily < lazyScreen < render < MediaQueryList change (app.js followSystemTheme)`.
- Cause: `followSystemTheme` calls `render()`, which the code already documents as destructive for
  Family and Circle (see `syncOfflineBanner`).
- Fix: `applyTheme(state.theme)` only. The theme is CSS on `<html>`, so no repaint is needed.
  `scripts/app.js`. A real user meets this at sunset with a panel open; rare, but it loses typing.

---

## Time to first value

**Today:** about 45 s of user effort plus the time to fetch the code from email (typically 20-60 s),
so 65 to 105 s, crossing 9 screens, 14 taps, 5 fields (67 characters) and 4 decisions, before the first habit
exists: sign-up form (4 fields), OTP (1 field and a tap), three setup steps that create nothing,
"You're all set." and then a second checklist, then the starter pack. A user who dismisses the
checklist (its X is the first thing in the card's corner) reaches an empty Home with no value at all.

**Proposed:** about 26 s plus the email wait (and no tap at all on the code where the OS autofills it), 4 screens, 6 taps, 4 fields (email, name,
password, OTP auto-submitted) and 1 decision: sign up, the code signs in by itself, one chip ("Get
fit"), Set it up, and Home opens on two habits with reminders and a 30-day goal. Push permission is
asked the first time one of those reminders is about to ring.
