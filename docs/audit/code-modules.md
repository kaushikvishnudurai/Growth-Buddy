# Code review: frontend feature modules (CRM)

Scope: money.js, money-core.js, money-home.js, calendar.js, recurrence.js, notes.js, notes-core.js,
goals.js, goal-milestones.js, goal-tasks.js, timer.js, timer-math.js, report.js, insights.js,
review.js, health.js, health-logic.js, family.js, circle.js, circle-core.js, mentor.js, nudges.js,
day-plan.js, nutrition.js. Worktree overhaul/2026-10-11, build 92.

Baseline: every `scripts/*.test.mjs` passes (31 suites, incl. 75 shared recurrence cases).

Repro scripts for CRM-1 to CRM-4 pin the clock the same way `money-calc.test.mjs` does and import
the real modules. They are in the session scratchpad (`chal.mjs`, `subs.mjs`); the code is quoted
below so each finding can be checked without them.

### CRM-1: A finished "Cut <tag> 15% this month" challenge is judged against the wrong months, and reads as won on the 1st of the next month
- Severity: Medium
- Where: scripts/money.js:challengeProgress (kind 'reduce'); also feeds `badges` ("Challenge Champ")
- Repro / evidence: Food was 5,000 in September and 9,000 in October. The user starts "Cut Food 15%
  this month" on 5 Oct, so `openChallenge` sets end = 2026-10-31. With the clock pinned to 1 Nov:
  `challengeProgress(m, {kind:'reduce', scope:'food', pct:15, start:'2026-10-05', end:'2026-10-31'})`
  returns `{ state: 'won', pct: 0, detail: '₹0 now · aim ≤ ₹7,650' }`. October went up 80%, yet the
  challenge reads as won, the target shown is 85% of October (the challenge month itself), and the
  Challenge Champ badge turns on.
- Cause: the 'reduce' branch always compares *this* calendar month against *last* calendar month
  (`thisMonthPrefix()` / `lastMonthPrefix()`) and never reads `ch.start` / `ch.end`. Once the month
  rolls over, "this month" is the next month's near-empty first day and "last month" is the
  challenge month. Before that, on the end day itself, `today > end` is false, so an over-target
  challenge stays 'active' rather than 'broken'. In practice it can never come out broken.
- Fix: in money.js `challengeProgress`, take the challenge month from `ch.start.slice(0, 7)`:
  measure spend over `ch.start`..`min(today, ch.end)`, or that whole month, against the month before
  `ch.start`. Decide won/broken once `today > ch.end`. Add a case to `money-calc.test.mjs` with the
  clock on the day after the end.

### CRM-2: "Save" and "Log every expense" challenges never end, and restart their count each month
- Severity: Medium
- Where: scripts/money.js:challengeProgress (kinds 'save', 'logdays'); openChallenge `make`
- Repro / evidence: Same pinned 1 Nov clock. A 'save' challenge (1,000, 5 Oct to 31 Oct) returns
  `{ state: 'active', detail: '₹0 of ₹1,000 saved' }`. A 'logdays' challenge (30 days, 20 Oct to
  31 Oct) returns `{ state: 'active', detail: '0 of 30 days logged' }`. Both ended a day earlier and
  will stay "active" in the Coach tab for good, counting the new month as if it were theirs.
  Separately, the preset "Log every expense · 30 days" (`days: 30`) gets `end` = the last day of the
  current month, so its target of 30 logged days is out of reach in any 28/29/30-day month, and in
  any month where it starts after the 2nd.
- Cause: 'save' reads `setAsideThisMonth(money)` and 'logdays' reads `distinctLogDaysThisMonth(money)`.
  Both are calendar-month figures that ignore `ch.start` / `ch.end`. Neither branch can return
  anything except 'won' or 'active', and `make()` caps the end date at month end whatever `p.days`
  says.
- Fix: in money.js, count over `ch.start`..`min(today, ch.end)` (`setAsideInRange`, and
  `loggedDays` over that range). Once `today > ch.end`, return 'won' or 'broken'. For 'logdays',
  either set `end = start + days - 1` in `make()` or use `target = min(days, totalDays)`.

### CRM-3: A daily spending cap challenge shows as won from the first minute of its only day
- Severity: Low
- Where: scripts/money.js:challengeProgress (kind 'cap')
- Repro / evidence: "Spend under ₹500 today" (`days: 1`, start = end = today). In the morning, with
  nothing spent yet, the state is `'won'` (repro: `cap, morning of its only day ... won`). The trophy
  and the Challenge Champ badge appear before the day is over, then disappear if a spend over the cap
  is logged later that day.
- Cause: `state = broken ? 'broken' : today >= end ? 'won' : 'active'`. The 'nospend' branch uses
  `today > end`, which is the correct test.
- Fix: change it to `today > end` in money.js, to match 'nospend'.

### CRM-4: A new subscription whose due day has already passed this month shows as overdue at once
- Severity: Medium
- Where: scripts/money.js:openSubscription onPrimary (the "Add subscription" modal) → `upcomingSubs`,
  `forecast`; scripts/day-plan.js:billsToday
- Repro / evidence: On 20 Oct, add Netflix, 649, due day 5. Most people add a bill they have already
  paid this month. The stored row has no `paidFor`. Pinned to 20 Oct:
  `upcomingSubs` → `[{ name: 'Netflix', overdue: true, inDays: -15 }]` ("overdue · was due 15 days
  ago"), `forecast().committed` → 649 (projected spend inflated by a bill that is already paid), and
  Plan my day → `{ title: 'Pay Netflix', detail: '649 · overdue' }`. The only way to clear it is
  "Mark as paid", which books a second 649 expense dated today on top of the one the user may already
  have logged.
- Cause: the add path writes `{id, name, amount, dueDay, category, usesPerMonth?, createdAt}` and
  never sets `paidFor`. Every reader treats `(paidFor || '') < thisMonth` with a passed due day as
  overdue.
- Fix: in the add modal (money.js, `m.subscriptions.unshift({...})`), when `dueDay` has already
  passed this month, either set `paidFor: thisMonthPrefix()` or ask with one checkbox ("Already paid
  for <Month>", default on) and set it only when ticked. Setting it books nothing, and `paidFor` is
  forward-only on both sides, so a WhatsApp "Mark as paid" still works next month.

### CRM-5: Circle post replies: a reply sent while the list loads disappears, and Delete has no in-flight guard
- Severity: Low
- Where: scripts/circle.js, the replies box inside the post card (`sendReply`, `paint`, the
  `api.listComments(...).then` loader, the reply delete button)
- Repro / evidence (code path): the composer (`field`, `sendBtn`) goes into the box at the same
  moment `api.listComments` is fired. If a reply is sent before that GET resolves,
  `rows = rows.concat(created)` paints it, and then the loader runs `rows = list || []`, which
  replaces it with the list fetched before the reply existed. The reply is saved on the server but
  missing on screen until the box is reopened, so the user may send it again. The reply delete
  `onclick` has no `disabled` guard, unlike every other button in this file (posts, cheers, join,
  invite all have one). A double tap sends two DELETEs, and the second one's failure toasts "Could
  not delete that reply." after the row has gone. It also deletes on one tap with no confirm, while
  a post delete asks first.
- Cause: the loader assigns instead of merging, and the delete button has no busy state.
- Fix: in circle.js, merge by id in the loader
  (`rows = list.concat(rows.filter(r => !list.some(x => x.id === r.id)))`) or keep `field` disabled
  until the first load settles. On delete, set `e.currentTarget.disabled = true` before the await and
  re-enable it in the catch.

## Checked and found sound (no finding)

- notes.js `sanitize`: allow-list over an inert DOMParser document. Foreign-namespace (SVG/MathML)
  elements have lowercase `tagName`, so they never match `ALLOWED` and are unwrapped. Text is
  re-escaped under its HTML parent, `href` and `src` are allow-listed, and `data-` values are
  emptied. Every `innerHTML` write in the scoped modules goes through `sanitize` or is a read. No
  other HTML sinks exist in these modules.
- Listeners and leaks: `gb:circle-changed`, `gb:family-changed` and `gb:mentorship-message` retire
  themselves. The notes `selectionchange` listener is removed on blur. Object URLs are revoked. The
  timer clears its interval on every exit path. The ambient-sound graph is stopped and disconnected
  on stop and swap, and the fallback chime closes its AudioContext.
- Double submit: reminder add (`addingReminder`), reminder edit, notes save and pin, circle
  posts/cheers/join/invite, mentor send/new chat, and Money modals (`openModal` busy state) are all
  guarded.
- Stale responses: mentor `load` (thread id check), money advice (`adviceSeq`), family sections
  (per-section loaders that catch, deferred paint while typing), and notes composer draft
  (`draftTouched`) are handled.
- Recurrence (`recurrence.js`): end-of-month clamp, nth/last weekday, Monday-based week intervals,
  count via a memoised scan, DST-proof UTC day numbers. Covered by the shared cases.
- Timer: wall-clock `endsAt`, finish drops the stored session before the POST, restore of a session
  that ended while away counts it once.
