# First-run audit (FRU)

Auditor: First-Run Auditor, 2026-10-11, build 92, worktree overhaul/2026-10-11.
Method: Playwright over CDP (headless Chrome on :9591) against Vite :5591 / backend :8591. Real UI
signup with a fresh `@example.com` address, 6-digit code read from the backend console mail log,
timezone Asia/Kolkata. Two signups reached the server: one mobile (390x844,
`fru.1791740361128@example.com`) and one desktop (1280x800, `fru.1791740719167@example.com`).
A third mobile attempt was refused client side, before any request, because of FRU-9.
Code read: `scripts/starter-packs.js`, `OnboardingCard` and `ScreenDashboard` in `scripts/dashboard.js`,
`maybeStartFirstRun` / `openFirstRunSetup` / `openStarterPacks` / `applyStarter` / `viewSignup` /
`viewVerify` / `followSystemTheme` / `weeklyReviewDue` in `scripts/app.js`.

Screenshots: `docs/evidence/audit-first-run/` (`m-*` = 390x844, `d-*` = 1280x800). Some mobile Home
shots (m-21 to m-26) render dark: the shared CDP Chrome toggled `prefers-color-scheme` during the
run (another session). That toggle is what exposed FRU-9. To finish the run I muted the app's
color-scheme listener in my context. No other app behaviour was changed.

The first moment of value used here: **the user sees their own plan (habits, a reminder, a goal) on
Home and ticks the first habit**. That is the first time the app gives back something the user did
not type in.

## Timeline (mobile 390x844)

Machine time is wall clock in the harness. It includes about 0.7 s per screenshot, so it is a ceiling
on app latency, not a human figure. Human time is an estimate: 3 s to read a new screen, 1 s per tap,
0.3 s per character typed on a phone, 20 s to switch to the mail app and back for the code.

| # | Screen | Screenshot | Taps (cum.) | Keys (cum.) | Machine s | Human est. s (cum.) | Hesitation / notes |
|---|---|---|---|---|---|---|---|
| 1 | Sign-in ("Welcome back") | m-01-landing.jpg | 0 | 0 | 1.3 | 3 | A first-time visitor is greeted as a returning user. "Create account" is a small link at the bottom right. FRU-1 |
| 2 | Create your account | m-02-signup.jpg | 1 | 0 | 2.3 | 7 | Four fields, including Confirm password next to a reveal eye. Nothing says Name is optional. FRU-6 |
| 3 | Form filled | m-03-signup-filled.jpg | 5 | 63 | 3.3 | 30 | Strength hint "Strong." is fine |
| 4 | Verify your email | m-04-verify.jpg | 6 | 63 | 4.3 | 34 | The app is still out of reach. The user has to leave for the inbox. FRU-5 |
| 5 | Code typed | m-05-verify-filled.jpg | 7 | 69 | 6.4 | 56 | |
| 6 | Setup step 1 of 3: Your timezone | m-06-home-first.jpg | 8 | 69 | 8.9 | 61 | Raw IANA id "Asia/Calcutta". "Looks right" and "Skip" do the same thing. FRU-11 |
| 7 | Setup step 2 of 3: Stay in the loop | m-08-setup-2-notify.jpg | 9 | 69 | +0.8 | 65 | Asks for notification permission before anything exists that could notify. FRU-4 |
| 8 | Setup step 3 of 3: Pick what you'll use | m-09-setup-3-features.jpg | 10 | 69 | +1.5 | 76 | 13 switches, all on, about 8 s of reading. "Growth circle", "AI mentor", "Health data" (web) unexplained. FRU-4, FRU-13 |
| 9 | Home: Getting started (4 steps) + toast "You're all set." | m-11-home-empty.jpg | 11 | 69 | +2.0 | 80 | The toast says set up, the card says "Set up in 4 quick steps". FRU-10. The card floats mid-screen over blank space |
| 10 | Starter packs, nothing chosen | m-13-starter-modal.jpg | 12 | 69 | | 85 | Six chips and an empty list, nothing pre-selected. FRU-3 |
| 11 | Sleep better chosen | m-14-starter-sleep.jpg | 13 | 69 | | 90 | "Screens off by 10:30 pm · 22:15" mixes 12-hour and 24-hour. FRU-12 |
| 12 | Plus Get fit | m-15-starter-sleep-fit.jpg | 14 | 69 | | 94 | Good: the preview shows exactly what will be created |
| 13 | Set it up, then the "Dreamer" achievement modal over the success toast | m-16-home-after-pack.jpg | 15 | 69 | about 2.5 server | 98 | A celebration modal blocks the first look at the new plan. FRU-8 |
| 14 | Home after the pack (top) | m-21-home-loaded.jpg | 16 | 69 | | 101 | The checklist still leads ("2 of 3 done": it was "of 4" a minute ago), then 0% score, Daily brief, mood |
| 15 | Home y=500 to 1500 | m-22, m-23, m-24 | 16 | 69 | | | Empty tasks, a full month calendar, four empty day-detail sections. The new habits are not in sight. FRU-2 |
| 16 | Habit row reached (y about 1970 of a 2433 px page) | m-27-habit-before.jpg | 16 (plus 3 swipes) | 69 | | 106 | |
| 17 | **First habit ticked: streak 1, score 33%** | m-28-habit-done.jpg | 17 | 69 | | **108** | First value. "Your week is ready to review" appears straight away. FRU-7 |
| 18 | Habits tab | m-29-habits-tab.jpg | 18 | | | | "1 freeze left · 1 more each week" and snowflake buttons, unexplained. FRU-13 |
| 19 | Progress tab | m-30-progress-tab.jpg | 19 | | | | Mostly "Not enough data yet — keep logging." Acceptable |
| 20 | Buddy tab | m-31-buddy-tab.jpg | 20 | | | | Three starter prompts: good |

Desktop (1280x800) follows the same route in 16 taps. Screenshots `d-01` to `d-15`. Notable: the
Home checklist sits alone in the middle of a wide canvas (d-09). After the pack, the habit sits at
y=1119, below the calendar and the empty day detail in the right column (d-13, d-15). The sidebar
lists 13 destinations from minute one.

**Totals (mobile):** about 108 s and 17 taps (69 keystrokes, 3 swipes) from landing to the first value
moment. About 47 s of that falls after the code is accepted. Signup and verification take about 61 s
on their own, before the app has shown anything. Against a target of value within 30 s, the app is
roughly 3.5 times over overall, and about 1.5 times over even counting only from inside the app.

## Compared with strong onboarding patterns

| Pattern | Growth Buddy today |
|---|---|
| Say what the product does before asking for anything | No. The first screen is a returning-user sign-in (FRU-1) |
| Value inside 30 s | About 108 s overall, about 47 s after verify (table above) |
| Show a finished result first, then let the user adjust | Partly. The starter-pack preview is exactly the adjust step, but it opens empty, sits behind 3 setup steps, and the result lands below the fold (FRU-2, FRU-3) |
| Ask for permissions in context, after value | No. Notifications come at setup step 2, before any reminder exists (FRU-4) |
| Defer account friction | No. Email verification gates entry and the form asks for the password twice (FRU-5, FRU-6) |
| Progressive disclosure | No. 13 feature switches in setup and about 10 Home widgets, most of them empty (FRU-2, FRU-4) |
| One clear celebration at the right moment | The "Dreamer" modal fires on setup, not on an act. The weekly-review nudge fires on day 1 (FRU-7, FRU-8) |

Good already: the starter-pack preview (lists each item, switch off what doesn't fit, one tap
writes it all), the empty Today's tasks card with an "Add your first task" button, Buddy's starter
prompts, the password hint, value carry-over on auth errors (`renderAuth`), and the OTP boxes.

## Findings

### FRU-1: First screen greets a new visitor as a returning user, with no description of the product
- Severity: High
- Where: `scripts/app.js:viewSignin` (`authShell('Welcome back', 'Your habits, streaks and reminders are where you left them.', …)`), both viewports
- Repro / evidence: open http://localhost:5591/ in a fresh context. The only screen reads "Welcome back … where you left them". The way in for a new user is a small "Create account" text link at the bottom right. m-01-landing.jpg, d-01-landing.jpg
- Cause: the sign-in view is the default auth mode for everyone. Nothing tells a first-time visitor what the app is.
- Fix: default the auth view to signup when no `gb.session` or email hint exists, or use a neutral title ("Growth Buddy") with one line of value proposition ("Habits, reminders, money and goals in one place") and two equal buttons (Create account / Sign in). Touches `viewSignin` and the default `authMode` in `scripts/app.js` (state init near the `// Auth flow:` comment).

### FRU-2: After the starter pack, the habits it created sit about 1,900 px down Home, below about eight empty widgets
- Severity: High
- Where: `scripts/dashboard.js:ScreenDashboard` (widget order from `HOME_WIDGETS` / `homeLayout`), 390x844 and 1280x800
- Repro / evidence: new account → Pick a goal → Sleep better + Get fit → Set it up → Nice!. Measured on #gb-main: `scrollHeight 2433, clientHeight 681, "Habit streaks" heading at 1917, first "Mark as done" at 1968`. Above it sit the checklist, a 0% score, Daily brief, the mood card, Sleep/Mood "Log" tiles, empty Today's tasks, a full month calendar and the day detail ("No tasks due", "No completed tasks", "No food logged"). Desktop: the habit is at y=1119 in the right column. m-21 to m-25, m-27, d-13, d-14
- Cause: `ScreenDashboard` swaps to the single-card checklist only while `!started`. Once anything exists, the full default layout renders, and every widget shows its own empty state, in fixed order.
- Fix: while the account is young (for example while the onboarding card is still shown), render the items the pack just created right under the checklist: the habit list first, then today's reminder, then goals. Hide widgets with no data (calendar day detail, food, money, Sleep/Mood tiles) until they have some. Touches `ScreenDashboard` in `scripts/dashboard.js`. `applyStarter` could set a one-shot flag that makes Home scroll the habits block into view.

### FRU-3: Starter packs open empty and sit behind the setup wizard, so the "finished result first" moment arrives late
- Severity: Medium
- Where: `scripts/app.js:openStarterPacks`, `maybeStartFirstRun`, `scripts/dashboard.js:OnboardingCard`
- Repro / evidence: after verify, three setup steps come first (m-06, m-08, m-09). Then a checklist (m-11). Then a modal whose chips are all off with an empty list below (m-13). The user sees a concrete plan only at about 90 s.
- Cause: the first-run wizard (`openFirstRunSetup`) runs before Home, and `openStarterPacks` starts with `picked = new Set()`.
- Fix: open the starter-pack picker as the first thing a new account sees, in place of the wizard's features step. Pre-select one pack (or ask a single "What do you want to work on?" question) so the preview list is already filled. One tap on "Set it up" then gives the finished plan, and the user adjusts from there. Touches `openFirstRunSetup` (replace `featuresStep` with the pack picker) and `openStarterPacks` (accept a default pack id).

### FRU-4: The setup wizard asks for notification permission and 13 feature choices before the user has anything
- Severity: Medium
- Where: `scripts/app.js:openFirstRunSetup` (`notifyStep`, `featuresStep`), both viewports
- Repro / evidence: step 2 "Stay in the loop" asks for notifications before any reminder exists (m-08). Step 3 lists 13 switches, all on, including "Health data" on the web, where it cannot work (m-09). None of the three steps shows anything of value. Their copy ends with "You're all set." while nothing is set up.
- Cause: the wizard order is fixed: `[timezoneStep, notifyStep, featuresStep]`.
- Fix: drop the wizard's notify step on web and ask in context instead, when the first reminder or habit reminder is created. `applyStarter` creates both, which makes it the natural point: after "Set it up", offer "Turn on reminders for these?". Move the features list out of first run (Settings › Layout already has it). Fold the timezone check into a silent auto-set with a toast when the zones match, which `syncDeviceTimezone` already supports. Touches `openFirstRunSetup` and `applyStarter` in `scripts/app.js`.

### FRU-5: Email verification gates the first use of the app
- Severity: Medium
- Where: `scripts/app.js:viewSignup` → `viewVerify`, backend `/api/auth/signup` + `/api/auth/verify`
- Repro / evidence: after "Create account" the user must leave for the mail app and come back with a 6-digit code before seeing anything (m-04, m-05). That is about 22 s of the 61 s spent before the app appears.
- Cause: signup issues no session until `/api/auth/verify` succeeds.
- Fix (product decision): let the account in straight away with a limited session and a persistent "Verify your email" banner, and require verification only for the actions that need a confirmed address (password reset, sharing, Circle invites, after N days). If the gate stays, keep it but run the starter-pack picker before it, held in memory and written after verify. Touches `AuthService` (session before verification) and `viewSignup`/`viewVerify`. Flag for the orchestrator: security trade-off.

### FRU-6: Signup asks for the password twice and does not mark Name optional
- Severity: Low
- Where: `scripts/app.js:viewSignup`
- Repro / evidence: four fields (Email, Name, Password, Confirm password) for 63 keystrokes on a phone (m-02, m-03). The password field already has a reveal eye, which covers what the confirm field protects against. Name has no "(optional)" label, though `submit` accepts an empty name.
- Cause: `pw2Input` plus the `pw2Input.value !== password` check.
- Fix: remove the confirm field (keep the eye) and label Name "Name (optional)" or ask for it later. The OTP step already confirms the address, and password reset exists. Touches `viewSignup`.

### FRU-7: "Your week is ready to review" appears minutes after signup, as soon as one habit is ticked
- Severity: Low
- Where: `scripts/app.js:weeklyReviewDue`, `weeklyReviewNudge`; both viewports, on Sat/Sun/Mon
- Repro / evidence: Sunday 2026-10-11. New account → starter pack → tick "Screens off by 10:30 pm". The Home text immediately starts with "Your week is ready to review" (m-28 run log, d-15 run log). The comment on `weeklyReviewDue` says this nudge used to greet brand-new accounts and was meant to stop.
- Cause: the guard counts `s.topStreak > 0 || s.avgScore > 0`, and a single tick on day 1 sets both.
- Fix: also require activity on at least 3 of the last 7 days (`weeklyReviewStats` already computes from `byDate`; count days with `score > 0`), or an account at least 3 days old (`state.user.createdAt`). Touches `weeklyReviewDue`.

### FRU-8: An achievement modal ("Dreamer") interrupts the first look at the plan the user just made
- Severity: Low
- Where: Home after `applyStarter`; achievement unlock modal
- Repro / evidence: "Set it up" → the toast "Added 6 things. You're set up." is immediately covered by a full modal "ACHIEVEMENT UNLOCKED Dreamer, Create your first goal · Bronze, Nice!" with confetti (m-16, d-12). The goal was created by the pack, not by the user.
- Cause: the achievement checker fires on the first goal however it was created.
- Fix: suppress achievement modals for items written by `applyStarter` (pass a flag, or mark achievements seen inside the starter flow), and keep celebrations for user acts such as the first habit tick. Touches `applyStarter` and the achievement trigger in `scripts/app.js`.

### FRU-9: A system theme change during sign-in or sign-up wipes everything typed in the form
- Severity: Medium
- Where: `scripts/app.js:followSystemTheme` (the `change` listener calls `render()`)
- Repro / evidence: on the Create account screen, fill Email and Name, then flip the OS or browser color scheme. All four inputs come back empty. Pressing Create account then shows "Enter your email to create the account." Instrumented run (a `replaceChildren` hook): `SCHEME CHANGE dark=true … WIPE 2 filled inputs … at render (app.js:15689) at MediaQueryList.<anonymous> (app.js:324)`. The same thing emptied the OTP field in the first run (code typed, then "Enter the 6-digit code (must be exactly 6 digits)."). On phones this happens when automatic dark mode switches at sunset, or when the user toggles it in the control centre during signup.
- Cause: auth views are rebuilt from scratch by `render()`. `renderAuth()` exists to carry input values across a re-render, but the theme listener calls plain `render()`.
- Fix: in `followSystemTheme`, call `state.user ? render() : renderAuth()`. A theme flip only needs `applyTheme` (CSS tokens follow `data-theme`), so `render()` may not be needed at all. Touches `followSystemTheme` in `scripts/app.js`.

### FRU-10: Contradictory status copy: "You're all set" over a checklist that says set up is 0 of 4, which then becomes "2 of 3"
- Severity: Low
- Where: `scripts/app.js:openFirstRunSetup` (`next` → `toastSuccess('You’re all set.')`), `scripts/dashboard.js:OnboardingCard`
- Repro / evidence: the wizard ends with the toast "You're all set." on top of "Getting started, Set up in 4 quick steps" (m-11, d-09). After one pack the card reads "2 of 3 done" (m-21, d-13): the denominator dropped from 4 to 3 because the mood step is removed once `started && wellnessShown`. "Pick a goal" and "Add your first habit" both tick off on `habits.length > 0`, so one action ticks two steps. The pack toast then also says "You're set up." while the card still asks for a task.
- Cause: three independent "done" messages. Step membership in `OnboardingCard` depends on `started`.
- Fix: drop the wizard's closing toast. Keep the step list fixed for the card's lifetime (decide `onAddMood` once, when the card first shows). Give "Pick a goal" its own done flag (for example `uiPrefs.starterUsed`, set in `applyStarter`). Change the pack toast to say what was added ("Added 3 habits, 1 reminder, 2 goals."). Touches `openFirstRunSetup`, `OnboardingCard`, `ScreenDashboard`, `openStarterPacks`.

### FRU-11: Timezone step shows a raw IANA id ("Asia/Calcutta") and two buttons that do the same thing
- Severity: Low
- Where: `scripts/app.js:openFirstRunSetup` → `timezoneStep`
- Repro / evidence: m-06, d-06. "This device Asia/Calcutta / Your account Asia/Calcutta / They match." Primary "Looks right" and secondary "Skip" both just call `next()` when the zones match.
- Cause: `zoneRow` prints `deviceZone()` verbatim. `onPrimary` is null when `!differs`.
- Fix: when the zones match, skip the step entirely. When they differ, show a readable name and offset via `Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'long' })` (for example "India Standard Time, GMT+5:30"). Touches `timezoneStep`.

### FRU-12: Starter-pack habit names hardcode 12-hour times next to 24-hour reminder times
- Severity: Low
- Where: `scripts/starter-packs.js:PACKS` (`'Screens off by 10:30 pm'`), rendered by `starterRow`
- Repro / evidence: on a 24-hour device the preview reads "Screens off by 10:30 pm · 22:15" (m-14, d-11), and the habit keeps that name for good.
- Cause: the time is part of the habit's name string. `formatTime` formats only `reminderTime`.
- Fix: name it "Screens off before bed" (the reminder time already carries the clock), or build the name with `formatTime('22:30')` at plan time. Touches `scripts/starter-packs.js`.

### FRU-13: Jargon and unexplained labels a new user meets in the first two minutes
- Severity: Low
- Where: several screens, 390x844
- Repro / evidence:
  - Habits tab: "1 freeze left · 1 more each week", plus snowflake buttons on each habit with no visible label (m-29).
  - Setup step 3: "Growth circle, Connect with mentors", "AI mentor", "Money Buddy", "Report, Progress overview, reflection & milestones" (the tab is called Progress) (m-09).
  - Home: "SCORE 0%" with no definition (m-21); Sleep/Mood tiles whose headline value is the word "Log", with Title Case hints "Hours Slept", "How You Feel" (m-21); calendar legend "Free" (d-13).
  - Day detail: "No tasks due on this day.", "No completed tasks on this day.", "No food logged for this day." are empty states with no next action (m-24, d-15).
- Cause: copy written for an existing user.
- Fix: for the streak freeze, one line on first sight ("Miss a day? A freeze keeps your streak. You get 1 a week."). Rename "Report" to "Progress" in `FEATURE_DEFS`. Give the score a tooltip ("share of today's habits and tasks done"). Make the Sleep/Mood tiles read "Log sleep" / "Log mood". Hide empty day-detail sections, or give each an "Add" link. Touches `FEATURE_DEFS` (app.js), the habits header in the habits screen code, `ScreenDashboard`'s wellness and calendar blocks (dashboard.js).

### FRU-14: "Save money" pack quietly drops its budget on a new account
- Severity: Low
- Where: `scripts/starter-packs.js:budgetsFrom`
- Repro / evidence (code path): `budgetsFrom` returns `[]` when there are no expenses in the last 30 days, so for a brand-new account the "Save money" preview lists only "Log every expense" and "Spend less than last month". There is no budget and no word about why. That goal also has nothing to compare against on day 1.
- Cause: deliberate (comment: "a made-up one is a target the user never chose"), but the user is never told.
- Fix: when no budget can be planned, add a preview row that cannot be ticked: "Budget: we'll suggest one after 2 weeks of expenses". Retitle the goal "Track spending for a month" for accounts with no history. Touches `planStarter`/`starterRow`.

## Severity counts

Critical 0, High 2, Medium 4, Low 8 (14 findings).

Top 5:
1. FRU-2 (High): the habits the starter pack creates land about 1,900 px down a 2,433 px Home, under eight empty widgets.
2. FRU-1 (High): the first screen says "Welcome back" to a new visitor and never says what the app does.
3. FRU-3 (Medium): the finished-plan moment comes about 90 s in: three setup steps, a checklist, then a pack picker with nothing selected.
4. FRU-9 (Medium): a system light/dark switch during signup wipes every typed field (`followSystemTheme` calls `render()` instead of `renderAuth()`).
5. FRU-4 (Medium): the setup wizard asks for notification permission and 13 feature switches before the user has anything.
