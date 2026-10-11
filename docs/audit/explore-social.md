# Explore: Family, Growth Circle + Mentorship, Buddy, Report + Insights, Focus (EXF)

Run 2026-10-11/12 against the overhaul stack (Vite :5591, backend :8591, Chrome CDP :9591), Playwright
`connectOverCDP` from scratchpad scripts. Viewports 1280x800 and 390x844. Accounts: four seeded
(`a` renamed Kavya Menon, `b` renamed Ravi Shankar, `f` focus/Buddy, `m` theme repro) and one `--empty`.
Two-sided flows used `a` and `b` in two contexts at the same time.
Screenshots: `docs/evidence/audit-explore-social/`.

How to read the percentages: the steps I drove through the UI for that feature, and how many did what they
should, end to end, including after a reload. Steps I could not drive are counted as not working and listed.

| Feature | Measured completion | Evidence |
|---|---|---|
| Family: members (add, validation, edit, food profile, birthday reminder button) | 5/5 = 100% | `f-add-panel.jpg`, `f-members-after-add.jpg`; edit 62 to 64 kg and the reload kept it |
| Family: invite a registered user, accept on the other account | 3/3 = 100% | `f-b-invite.jpg`, `f-b-joined.jpg`; A's list moved from "Invite pending" to "Account linked" with no reload |
| Family: chores (add, assign, due, repeat, tick, reminder) | 5/5 = 100% | `f-chores-added.jpg`, `f-chore-reminder.jpg`; still there after reload |
| Family: Today plan (AI generate, save menu, Saved list) | 3/3 = 100% | `f-today-generated.jpg`; "Monday senior menu" listed under Saved |
| Family: weekly plan (AI generate) | 1/1, see EXF-12 | `f-weekly-generated.jpg` |
| Family: pantry, shopping (add, from plan, total) | 4/5 = 80% | `f-pantry.jpg`, `f-shopping.jpg`; "From the pantry" showed no visible result (nothing was marked low); Share/Print not driven |
| Family: view state survives normal use | fails, see EXF-1 | `th-family-after-theme-flip.jpg` |
| Circle: create (validation, private), browse, join with code (wrong and right, lower case) | 6/6 = 100% | `c-new-circle-dialog.jpg`, `c-circle-created.jpg`, `c-b-joined.jpg` |
| Circle: posts, kudos, replies, delete offer | 4/5 = 80% | `c-a-reply.jpg`; a new post does not reach other members until they reload (EXF-8) |
| Circle: challenge, seat cheer, members sheet, leave | 4/5 = 80% | `c-challenge-dialog.jpg`, `c-a-challenge.jpg`, `c-a-members.jpg`; members-sheet cheer is refused (EXF-6) |
| Mentorship: search, invite with note, cancel, accept, chat both ways + live, agreement, nudge, progress sheet, This week, bell | 10/11 = 91% | `c-a-search.jpg`, `c-b-request.jpg`, `c-b-accepted.jpg`, `c-b-chat.jpg`, `c-b-progress.jpg`, `c-a-bell.jpg`; picking the right person among same-name users fails (EXF-9) |
| Buddy chat (chips, typed, second message queued while streaming, threads, new chat, reload) | 6/6 = 100% | `b-chip-reply.jpg`, `b-typed-reply.jpg`. The AI gateway answered during this run, so the no-AI fallback path was not reachable |
| Report + Insights (render seeded + empty, ranges, pixel toggles, records, insight dismiss offered) | 5/8 = 63% | `r-390-scrolled-left.jpg` (EXF-2), stale focus (EXF-3), 0/0 days scored as 0% (EXF-4). Share my month gave no visible result in headless Chrome, not counted either way |
| Focus timer (custom 0 refused, 1 min accepted, start, survives navigation, tab title countdown, completes, posted, stats update, after reload, on Report) | 8/10 = 80% | `t-running.jpg`, `t-finished.jpg`, `t-report-after.jpg`; cycle lost on reload (EXF-5), not on Report straight away (EXF-3) |

Overflow sweep (scroll width of the page and of `#gb-main`/`.gb-scroll` against the viewport) at 390 and 1280 for
family, circle, mentor, report, focus, seeded and empty: everything is clean except Report at 390 (EXF-2). The
Family section strip is wider than the screen on purpose (it scrolls inside its own strip).

Console and network: across every run the only errors were (a) the expected 400 from a wrong circle code and
the expected 429 from EXF-6, and (b) `GET /api/score/range` 404 on every Report open, which is a stack issue, not
the product (see Environment notes).

---

### EXF-1: A system light/dark switch rebuilds Family, Circle and the other self-owned screens, losing tabs and half-typed forms
- Severity: Medium
- Where: `scripts/app.js:followSystemTheme`; seen on Family (1280), also applies to Circle, Money and Buddy
- Repro / evidence: account with no theme picked (the default). Family, Add your first member, Create a profile,
  type "Paati" in Name. Flip the OS appearance (Playwright `page.emulateMedia({ colorScheme: 'dark' })`). The
  panel is gone and the screen is back at "Build your family"; the name is lost
  (`th-family-after-theme-flip.jpg`, script output `before: Add family member | name= Paati` /
  `after flip: Build your family | name= none`). With a tab open (Chores, Today, Shopping) the screen snaps back
  to Members. A stack captured at the remount: `render (app.js) <- MediaQueryList.<anonymous> (app.js:324)`
  then `ScreenFamily -> load -> paint`. Real triggers: phone auto dark mode at sunset, macOS "Auto" appearance.
  On the shared test Chrome the scheme flipped every few seconds, which is how this surfaced.
- Cause: the `change` listener calls `applyTheme(state.theme)` and then a blind `render()`. Family and Circle are
  in `SELF_LOADING_SCREENS` and lose their local view state on any `render()`. `loadQuote` and
  `loadSecondaryData` already avoid exactly this; this listener does not.
- Fix: in `followSystemTheme` (app.js), keep `applyTheme(...)` (the tokens re-skin everything through CSS) and drop the
  `render()`, or call it only when `!SELF_LOADING_SCREENS.has(state.screen)` and the screen is not money or mentor.
  If a JS-drawn chart needs the new colours, repaint that screen alone (e.g. `repaintReport()` on report).

### EXF-2: Report scrolls sideways on a phone
- Severity: High
- Where: Report, 390x844 (seeded and empty accounts); `styles/app.css` `.gb-sr-only`; `scripts/report.js` `trendChart` tables
- Repro / evidence: open Report at 390 wide. `.gb-scroll` has `scrollWidth` 627 against `clientWidth` 390, and
  setting `scrollLeft = 200` sticks: the whole Report slides left with the cards cut off
  (`r-390-scrolled-left.jpg`). Measured elements: `.gb-sr-only` tables 594 px and 587 px wide.
- Cause: the screen-reader data tables are `<table class="gb-sr-only">`. `.gb-sr-only` sets `width: 1px` and
  `clip-path`, but a table never shrinks below its content's minimum width, and `white-space: nowrap` makes that
  the full row. The clipped table still adds scroll area. The UI audit misses it because it checks the document's
  scroll width, not the inner scroller's.
- Fix: in `styles/app.css`, after `.gb-sr-only`, add `table.gb-sr-only { display: block; }`. Or put the table
  inside a `div.gb-sr-only` in `report.js`. Also add `margin: -1px; border: 0; padding: 0` to match the usual
  pattern. Then have `scripts/ui-audit.mjs` check the `.gb-scroll` element's `scrollWidth`, not only the document's.

### EXF-3: A finished focus session does not show on Report until the 10-minute insight cache expires
- Severity: Medium
- Where: `scripts/app.js:focusProps` (`onFocusSession`), `loadInsightHistory`
- Repro / evidence: Focus, Custom 1 minute, Start; open Report while it runs, then come back when it ends
  (the session posts: `GET /api/focus/sessions?days=7` -> `[{"durationSec":60,...}]`). Report straight after
  shows Personal records with only "Longest streak" (`t-report-after.jpg`). The same account's Report, opened
  more than ten minutes later, shows "1 min Best focus day" (`r-share.jpg`). Report's Today card has no focus
  tile at all, so for a new user this record is the only trace of the session. Compare needs 14 days.
- Cause: `loadInsightHistory` returns early when `Date.now() - insightHistoryAt < 600000`. `onFocusSession`
  posts the session but never resets `insightHistoryAt`. The feature-toggle path does reset it.
- Fix: in `focusProps().onFocusSession`, `saved.then(() => { insightHistoryAt = 0; })` alongside
  `autoTickFocusHabits`. Optionally add a "Focus" tile (minutes today, from `/api/focus/stats`) to Report's
  Today card in `report.js`.

### EXF-4: Days with nothing to score count as 0% days on Report, including days before the account existed
- Severity: Low
- Where: Report trends and Insights; `/api/score/day`, consumed by `loadInsightHistory` (`scores`)
- Repro / evidence: an `--empty` account made on 11 Oct, opened on 12 Oct: "Daily score: 0% avg over 2 days ...
  10 Oct 0%, 11 Oct 0%". 10 Oct is before signup. `GET /api/score/day?date=2026-10-10` answers
  `{"score":0,"tasksTotal":0,"habitsTotal":0}`. On the seeded account the insight reads "Yesterday scored 25%,
  25 points up on the day before, mostly from habits: 1 of 2 done vs 0 of 0" (later run: "vs none due"). It
  is reported as a rise against a day that had nothing in it.
- Cause: a day with `tasksTotal + habitsTotal == 0` is returned and plotted as score 0, not as "not logged".
- Fix: in `ScoreService` (day endpoint), return `score: null` when both totals are 0. Or, in app.js
  `loadInsightHistory`, drop those days before they reach `state.insightHistory.scores`. Then `insights.js`
  stops writing "score rose" insights against them.

### EXF-5: The focus cycle resets to "Sprint 1 of 4" on reload after a sprint finishes
- Severity: Low
- Where: `scripts/timer.js:saveSession`
- Repro / evidence: finish a 1-minute sprint. The screen reads "BREAK 05:00 / BREAK · 1 OF 4 DONE / Sprint 1 of 4
  done. Take your 5-minute break?" (`t-finished.jpg`). Reload: "FOCUS 25:00 / SPRINT 1 OF 4 / Start a study
  sprint.", while the stats still say 1 session today.
- Cause: `saveSession` removes the stored session whenever the clock is idle
  (`!running && remainingSec === durationSec`), and a lined-up break is idle. So `cycle` and the break mode are
  dropped.
- Fix: in `saveSession`, keep the record when `T.cycleDone > 0` or `T.mode !== 'focus'` (store `{mode, cycle,
  durationSec}` with `running: false`). Let `restoredSession` in `timer-math.js` restore an idle record as idle.
  Add a case to `scripts/timer.test.mjs`.

### EXF-6: The Members sheet offers a cheer the server refuses
- Severity: Low
- Where: Circle card ⋯ > Members; `scripts/circle.js:cheerButton`, `openMembers`
- Repro / evidence: cheer Ravi from his seat (the seat turns "Cheered Ravi Shankar today"). Open ⋯ > Members. His
  row still shows "Cheer Ravi Shankar on". Tap it: `POST /api/circles/{id}/members/{userId}/cheer` 429, toast
  "You've already cheered them on today." (`c-a-members.jpg`).
- Cause: `cheerButton` always starts in the "Cheer X on" state and ignores `member.cheeredByMe`, which
  `MemberResponse` carries for this purpose (the seats use it).
- Fix: in `cheerButton`, when `member.cheeredByMe`, render the sent state (`is-sent`, `disabled`,
  aria-label "Cheered X today"). Check that `GET /{id}/members` fills `cheeredByMe`: it has a 4-argument
  constructor that defaults it to false.

### EXF-7: The mentee progress sheet shows habits as raw prompt text
- Severity: Low
- Where: Circle > You mentor > tap the mentee; `scripts/circle.js:showPartnerStatus`, `MentorshipController` (`habitsSummary`)
- Repro / evidence: as the mentor, open the mentee row. Tasks render as a list, but Habits is a grey `<pre>` box
  reading "Habits:\n  - Morning run — not yet today, 1-day streak\n  - Read 20 pages — ..." under a "HABITS"
  heading, so the label appears twice (`c-b-progress.jpg`).
- Cause: the endpoint returns `habits.contextSummary(partnerId)`, the text built for the AI prompt, and the
  client prints it verbatim in `h('pre', ...)`.
- Fix: return the structured lines (`HabitService.StreakLine` already exists for the weekly card) as `habits:
  [{name, streak, doneToday}]` and render them like the task list (a ✓ or ○, name, "n-day streak").

### EXF-8: A new circle post does not reach the other members until they reload
- Severity: Low
- Where: Circle posts feed; `scripts/circle.js:PostsFeed`
- Repro / evidence: A and B both on the circle with posts open. B posts "Ran 5K this morning". A's feed still says
  "No posts yet. Say hello!" after 2 s and stays that way. After a reload it shows. Replies ring the post's
  author, but a post sends nothing to anyone.
- Cause: no push for posts. The screen only listens for `gb:circle-changed`, which carries mentorship events.
- Fix: broadcast a transient `circle_post` frame to the circle's members from `CircleService` on create (the same
  channel `mentorship_message` uses), re-dispatch it in app.js, and have an open `PostsFeed` prepend the post
  (dedupe by id).

### EXF-9: Mentorship search cannot tell people with the same name apart
- Severity: Low
- Where: Circle > Find someone; `scripts/circle.js:openSearchModal`, `PersonRow`
- Repro / evidence: with several accounts named "Asha Rao", the list shows identical rows, each "e•••5@example.com ·
  Level 1". Searching by the email's local part answers "No matches." The invite went to the wrong Asha Rao
  (`c-a-search.jpg`). Family's people search takes "name or user ID". This one takes only a name.
- Cause: masked email plus name-only search.
- Fix: accept an exact email (or the user ID, as Family does) in `/api/users/search`, and show the masked email's
  domain plus the first letters of the local part, or the circle you share, so two rows are distinguishable.

### EXF-10: Circle "Load older" shows on a feed or chat with only a few items
- Severity: Low
- Where: Circle posts feed and mentorship chat sheet; `styles/app.css` `.gb-btn`
- Repro / evidence: a circle with 0 or 1 posts shows "Load older" under the list. The chat sheet with 1-3 messages
  shows "Load older" at the top (`c-b-chat.jpg`). Tapping it fetches nothing new.
- Cause: both buttons are created with `hidden: true` and toggled through `.hidden`. But `.gb-btn { display:
  inline-flex }` beats the browser's `[hidden] { display: none }`.
- Fix: one global rule in `styles/app.css`: `.gb-btn[hidden] { display: none; }`. Or `[hidden] { display: none
  !important; }` near the reset. Several files already carry one-off `[hidden]` overrides for the same reason.

### EXF-11: Your family card keeps your old name after you rename your account
- Severity: Low
- Where: Family members; `FamilyService` self-member creation
- Repro / evidence: account `a` was renamed from "Asha Rao" to "Kavya Menon" (`PUT /api/auth/profile`). The invite
  B receives says "Kavya Menon invited you", but the family list shown to both of them still names the owner
  "Asha Rao · Self · Account linked" (`f-b-joined.jpg`).
- Cause: the self member's `name` is a copy of `displayName` taken when the family was created, and a linked
  member's name is never refreshed from the account.
- Fix: for a member linked to a user, return the user's current `displayName` in the family response
  (`FamilyService` mapping), or update linked members' names in `AuthService.updateProfile`.

### EXF-12: The weekly meal plan labels days "Day 1 … Day 7" instead of dates
- Severity: Low
- Where: Family > Weekly; `scripts/family.js:weekDayCard`
- Repro / evidence: Generate weekly plan (7 days). Every card is headed "Day 1", "Day 2" and so on
  (`f-weekly-generated.jpg`). Nothing says which weekday Day 1 is, while Today's plan shows "Mon 12 Oct".
- Cause: `d.label || 'Day ' + (d.day || index + 1)`. The plan carries no label, so the fallback always shows.
- Fix: derive the date from the plan's start (its `createdAt` local day + `index`) with `fmtDay`, e.g. "Mon 12 Oct".
  Or have `FamilyService` set `label` per day.

### EXF-13: Pantry and shopping "Add" do nothing, without a word, when the name is empty
- Severity: Low
- Where: Family > Pantry and Shopping; `scripts/family.js:pantrySection`, `shoppingSection`
- Repro / evidence: read end to end: both `add()` functions start `if (!name) return;`. Chores, in contrast, focuses
  the field, and Add member toasts "Please enter a name." A tap on Add item or Add to list with an empty box gives
  no response.
- Fix: in both, `nameI.focus()` (and optionally `toast.error(null, 'Enter an item first.')`) before returning,
  matching `choresSection`.

---

## Environment notes (not product findings)

- The shared backend (`scratchpad/gb.jar`, built 22:53) has no `GET /api/score/range`. Its `ScoreController.class`
  holds only `/day` and `/today`, although `backend/.../ScoreController.java` declares `@GetMapping("/range")`.
  Every Report or Home insight load therefore logs `404 GET /api/score/range` in this stack. Rebuild the jar before
  trusting Report's year trend or pixels here.
- The AI gateway answered during this run (Buddy streamed real replies; meal plans and weekly plans generated), so
  Buddy's no-AI fallback could not be exercised.
- The shared Chrome is heavily loaded (load average 30-70). Real CDP mouse input never completed, so every
  click and fill went through DOM events (`el.click()`, value setter + input/change). Timings in this report are
  not performance measurements.
- Not driven: Family remove member, leave family, transfer owner, shopping Share/Print, pantry/grocery photo
  scans; Circle delete circle, delete post, transfer owner, the share-link sheet; Share my month's output.
