# Content, empty-state and placeholder audit (CNT)

Build 92, branch overhaul/2026-10-11. Runtime pass: a fresh `--empty` account, 390x844, Playwright over
CDP (http://localhost:9591), Vite on :5591. Screenshots: `docs/evidence/audit-content/`.

Method:
- Static: grep of `scripts/`, `styles/`, `index.html` for TODO/FIXME/XXX, "coming soon", lorem,
  mock/demo/dummy/fake data, `console.log`, toast-only or no-op handlers, emoji (U+1F300-1FAFF,
  U+2600-27BF, escaped forms), and every user-facing toast/error string.
- Empty: every screen in `SCREENS`, Money's four tabs, Notes Archived/Trash, Calendar Week, Circle
  Browse and Find someone, bell panel, More sheet, Quick add, profile popover, all six Settings panes,
  the first-run sheet, and Home with the Getting Started card dismissed (`empty-*.jpg`, `settings-*.jpg`,
  `firstrun-step*.jpg`).
- Loading: every `/api/**` request held for 3 s and a screenshot taken 350 ms after navigation
  (`loading-*-350ms.jpg`); boot held for 4 s (`boot-*.jpg`).
- Error: one endpoint per screen aborted with `route.abort('internetdisconnected')`. For boot-loaded data
  (tasks, habits, reminders, money, goals) this was done on a fresh load; for lazily loaded screens it was
  done after boot (`error-*.jpg`).

Clean results (no finding):
- No TODO/FIXME/XXX/"coming soon"/lorem anywhere in shipped code. No mock or demo data reaches
  production: `_demo()` in app.js, money.js and share-card.js and their `console.log('... self-check ran')`
  run only under `import.meta.env.DEV`. The one shipped `console.log` is the deliberate build banner
  (`[gb] build`, CLAUDE.md).
- No dead buttons were found. The handlers that only toast "not available" are real capability checks
  (voice input, push support).
- Every loading state exists. Family, Health, Circle, Notes and Report show skeletons, Focus shows
  "Loading…" and dashes, Summary shows a step list, and boot shows the quote card. Nothing was blank
  for more than 300 ms.
- Most empty states say what the screen is for and give one action: Habits, Family, Circle, Notes (all
  three tabs), Goals, Money (all tabs), Health, Buddy, Food, Calendar, Home after dismissal.
- Load errors on Home, Habits, Calendar and Family show a full-screen card with a Try again button. Notes,
  Circle, Focus, Summary and Buddy show an inline error with a retry.

Note on screenshots: some appear dark. Other sessions share this Chrome and change its color-scheme
emulation, and the app follows the system theme. That is not an app finding. On
`settings-alerts-object-object.jpg` the yellow highlight was added by the audit script.

---

### CNT-1: Settings > Alerts prints "[object Object]" in place of the "Keep read notifications for" picker
- Severity: High
- Where: scripts/app.js:keepReadPicker (called from the Alerts pane in the settings modal); every viewport
- Repro / evidence: Avatar > Settings > Alerts, then scroll to "KEEP READ NOTIFICATIONS FOR". The pane
  shows the literal text `[object Object]` and no control, so the setting cannot be changed. Screenshot:
  `docs/evidence/audit-content/settings-alerts-object-object.jpg`.
- Cause: `segmented()` returns `{ node, get }`. Every other caller uses `.node` (text size at ~7257,
  notify sound at ~9612, `leadPicker.node`/`snoozePicker.node`). `keepReadPicker()` returns the object
  itself, and `h()` turns it into a string. Introduced in 80b7b5b (build 74).
- Fix: in scripts/app.js `keepReadPicker`, return `segmented(...).node`. One word.

### CNT-2: A failed Money load still shows "Let's start small. Add your first expense"
- Severity: Medium
- Where: Money screen (scripts/app.js loadSecondaryData; scripts/money.js Overview), 390x844
- Repro / evidence: Abort `GET /api/money` on boot and open Money. An 8-second toast says "Couldn't load
  your money." with Retry. The page underneath shows the full first-run empty state: "₹0 spent today",
  "Let's start small. Add your first expense...", "Set balances", "Nothing scored yet". When the toast
  goes, nothing on the page says the data failed to load. A user with real expenses is told they have
  none. `error-money.jpg`, `error-money-after-toast.jpg`.
- Cause: `loadSecondaryData` catches to null and raises only a transient toast. `state.money` keeps the
  default empty document, and the screen cannot tell "no data" from "not loaded". The data itself is
  protected: `putDocIfChanged` treats a missing ETag as a conflict and merges before writing.
- Fix: record which wave-2 parts failed, e.g. `state.loadFailed = new Set(missed)` in
  `loadSecondaryData`. Money (and Home's Money card) should then render an inline "Couldn't load your
  money" card with Retry in place of the empty-state copy.

### CNT-3: A failed Goals load leaves a bare header with no goals, no empty state and no error once the toast goes
- Severity: Medium
- Where: Goals screen (scripts/goals.js; scripts/app.js loadSecondaryData), 390x844
- Repro / evidence: Abort `GET /api/goals` on boot and open Goals. After the 8-second toast, the page
  shows only "Goal activities / New goal / Set short, mid or long-term goals..." The three term sections
  are missing, there is no message, and there is no retry. `error-goals.jpg`,
  `error-goals-after-toast.jpg`.
- Cause: same as CNT-2. `state.goals` stays empty, and the toast is the only error surface.
- Fix: when goals failed (same `loadFailed` flag), render an inline error card with Retry that calls
  `loadSecondaryData()`.

### CNT-4: A failed Health load shows "Nothing logged for today yet" and invites a first reading
- Severity: Medium
- Where: scripts/app.js:loadHealthReadings; Health screen, 390x844
- Repro / evidence: Abort `GET /api/health/readings?days=90` and open Health. A toast says "No connection.
  Check your internet and try again." (no retry button). The page shows the empty state "Nothing logged
  for today yet", "No sleep logged for last night", and "Your ledger... Start with one". After the toast,
  the screen says the user has no readings. `error-health.jpg`.
- Cause: the catch sets `health.readings = []` when there was no earlier copy, which is the same value as
  a real empty account.
- Fix: in `loadHealthReadings`, set `health.error = true` (and leave `readings` null) on failure. The
  Health screen should then show an error card with Retry that calls `loadHealthReadings()` in place of
  the ledger.

### CNT-5: The same feature has two or three names across nav, header, Settings and first-run setup
- Severity: Medium
- Where: scripts/gb-kit.js:NAV_CATALOG (nav labels), scripts/app.js:SCREENS headerName,
  scripts/app.js:FEATURE_DEFS (Settings > Layout and first-run step 3), scripts/app.js:SCREEN_LABEL
  (voice "open X" replies)
- Repro / evidence (nav / header / feature toggle / voice label):
  - report: "Progress" / "Progress" / "Report" / "Report"
  - focus: "Timer" / "Timer" / "Focus timer" / "Focus"
  - mentor: "Buddy" / "Buddy" (subtitle "Your AI mentor") / "AI mentor" / "Buddy"
  - circle: "Circle" / "Growth Circle" / "Growth circle" (lower-case c) / "Circle"
  - money: "Money" / "Money Buddy" / "Money Buddy" / "Money"
  - summary: header "Summary", voice "Food summary"

  The Circle toggle's description, "Connect with mentors", describes Mentorship, not circles (circles
  are small habit groups). A new user sees "Report", "Focus timer" and "AI mentor" in first-run step 3
  (`firstrun-step3.jpg`), then finds no tab with those names (`empty-more.jpg`).
- Cause: three label tables kept by hand.
- Fix: choose one name per feature (the nav names are what users see most: Progress, Timer, Buddy,
  Circle). Use it in `FEATURE_DEFS[].label` and `SCREEN_LABEL`, keeping the longer name only as a
  description. Change the circle description to "Small groups that keep one habit together". Files:
  scripts/app.js, scripts/gb-kit.js.

### CNT-6: "Weekly review" means two different things, and the Report card calls it "Weekly reflection"
- Severity: Low
- Where: profile popover "Weekly review" (scripts/app.js profileDropdown), Money > Spending "Weekly review"
  (scripts/money.js), Report "Weekly reflection" (scripts/report.js)
- Repro / evidence: `account-panel.jpg` shows Weekly review (the life reflection).
  `empty-money-spending.jpg` shows Weekly review (spending recap). `empty-report.jpg` shows Weekly
  reflection.
- Fix: rename Money's section to "This week's spending" (or "Money week"). Use one name, "Weekly review",
  for the reflection in both the popover and Report.

### CNT-7: "Log out" in the profile popover, "Sign out" in Settings
- Severity: Low
- Where: scripts/app.js profileDropdown vs the Account pane ("Sign out", "Sign out any device")
- Repro / evidence: `account-panel.jpg` vs `settings-account.jpg`.
- Fix: use "Sign out" in the popover. That matches the Account pane and the sessions list.

### CNT-8: Emoji in UI copy: a shield on quit-habit rows
- Severity: Low
- Where: scripts/app.js:quitHabitLabel: `'Breaking · 🛡 ' + n + ' days clean'`
- Repro / evidence: static. Every quit habit that was kept today renders its sub-line from this. The user
  allows emoji only for the streak fire and country flags (both present and allowed: app.js ~13145 and
  the WhatsApp country list).
- Fix: drop the glyph (`'Breaking · ' + n + ' days clean'`), or use `Icon('shield')` beside the text
  if a mark is wanted.

### CNT-9: A raw "✕" glyph is used as the remove button in the food-photo item list
- Severity: Low
- Where: scripts/app.js, the photo-estimate items list (the button with `title: 'Remove item'`, ~5645)
- Repro / evidence: static. Everywhere else, close and remove buttons use `Icon('x')`. This button
  renders a font glyph with no `aria-label` (only `title`).
- Fix: `Icon('x', { size: 16 })` plus `'aria-label': 'Remove item'`.

### CNT-10: Developer jargon in user-facing errors: "VAPID keys", "OTP"
- Severity: Low
- Where: scripts/app.js:enablePushFlow ("Push isn't set up on the server yet (no VAPID keys)."),
  WhatsApp verify ("Could not send OTP")
- Repro / evidence: static. The first appears whenever `enablePush` returns `'unconfigured'`, i.e. on
  any server deployed without keys. The second is the fallback shown when the WhatsApp send fails.
- Fix: "Notifications aren't available right now. Try again later." and "Couldn't send the code. Check
  the number and try again." Log the technical cause to the console.

### CNT-11: "Could not" and "Couldn't" are mixed, often on the same screen
- Severity: Low
- Where: about 60 "Could not ..." strings and about 15 "Couldn't ..." strings across scripts/app.js,
  timer.js, mentor.js, circle.js, notes.js, family.js
- Repro / evidence: Focus says "Couldn't load your focus stats." Notes says "Could not load your notes."
  Wave 2 says "Couldn't load your goals." The Health fallback is "Could not load your health readings."
  `error-focus.jpg`, `error-notes.jpg`.
- Fix: settle on "Couldn't" (the friendlier tone the newer strings use) with a sed pass. Also use one
  load-error title: the full-screen card says "That didn't go through" (scripts/gb-kit.js ~1212), which
  reads like a failed submit, not a failed load. "Couldn't load this" would fit both cases.

### CNT-12: Money copy hard-codes ₹ and ignores the user's currency setting
- Severity: Low
- Where: scripts/money.js challenge presets ("Spend under ₹500 today", "Save ₹1,000 this month", ~724
  and ~732), the search help text (~1122 and ~1150: 'expenses over ₹500'), and the amount placeholder
  (~1969, `placeholder: '₹'`)
- Repro / evidence: static. `money-core.js` `applyCurrency` makes `cur` follow `settings.currency`, and
  amounts render with it, but these strings are literals. A user who set "$" still sees ₹ in challenges
  and hints.
- Fix: build these strings with the live `cur` binding (`'Spend under ' + cur + '500 today'`) and set the
  placeholder from `cur`.

### CNT-13: The empty account gets praise and averages it has not earned
- Severity: Low
- Where: scripts/money.js weekly motivation fallback ("Every expense you log makes next week clearer.
  Proud of you for showing up."); scripts/report.js trend cards ("0% avg over 1 day" under "Not enough
  data yet — keep logging."); scripts/dashboard.js ~645 reflection line ("food log ready when needed")
- Repro / evidence: `empty-money-spending.jpg`, `empty-report.jpg`, with zero expenses and zero days
  logged.
- Fix: when `total === 0 && streak === 0`, use "Log your first expense and this week's recap starts
  here." Hide the "avg over" line when `s.count < 2` (the card already says there isn't enough data).
  Change the reflection line to "No food logged today".

### CNT-14: CSS turns the Home wellness tiles into Title Case ("Hours Slept", "How You Feel")
- Severity: Low
- Where: styles/app.css `.gb-wellness-label, .gb-wellness-tile small { text-transform: capitalize }`
  (and `.gb-wellness-tile strong`), source strings in scripts/dashboard.js WellnessCard
- Repro / evidence: Home with the Getting Started card dismissed reads "Sleep / Log / Hours Slept" and
  "Mood / Log / How You Feel" (`empty-home-dismissed.jpg`). The rest of the app uses sentence case.
- Fix: remove `text-transform: capitalize` from `.gb-wellness-tile small`. The labels are already
  written the way they should read. Keep it on `strong` only if mood values arrive in lower case.

### CNT-15: An offline tab that opens a screen not yet loaded reloads itself onto the browser's offline page
- Severity: Low
- Where: scripts/app.js:lazyScreen catch (`isStaleChunkError` → `location.reload()`)
- Repro / evidence: Boot, go offline (`context.setOffline(true)`), then open Notes or Family. The tab
  reloads and lands on Chrome's "No internet" page (`offline-notes.jpg`). In production the service
  worker precaches every chunk (`globPatterns` in vite.config.js), so this needs a first visit before
  the service worker is active, or an evicted cache. That is rare, but it loses the whole app.
- Cause: a failed chunk import while offline matches `isStaleChunkError`, and the one-time reload runs.
- Fix: in the catch, `if (!navigator.onLine)`, skip the reload and show the CrashCard (or an "You're
  offline, this screen opens when you're back" card) with retry.

### CNT-16: Opening one screen fetches its data two or three times
- Severity: Low
- Where: Family, Circle, Focus, Notes on first open
- Repro / evidence: requests recorded on one hash change after boot:
  - Family: each of 10 `/api/family/*` GETs twice.
  - Circle: `/api/circles/mine` and both `/api/mentorship/requests/*` three times.
  - Focus: `/api/focus/stats` and `/api/focus/history?days=30` twice.
  - Notes: `/api/notes`, `/api/notes/counts` and `/api/notes/draft` two or three times.
  This is wasted bandwidth on a phone and a second chance for a slow request to repaint over the first.
  Not a content issue; it is reported because it showed up in the loading-state capture.
- Cause: not traced. The pattern fits a screen built once by the lazy placeholder swap and again by a
  later `render()`.
- Fix: have each screen's loader take the existing in-flight-promise guard that `loadInsightHistory`
  already uses (`insightReq`), or gate on a per-screen "loaded at" stamp.

---

Counts: Critical 0, High 1, Medium 4, Low 11.
