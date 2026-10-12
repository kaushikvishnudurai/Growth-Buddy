# Roadmap: the ideas not in this build (2026-10-12)

Everything from `docs/IDEAS.md` that is not in the top 8, in priority order. Full specs, input counts,
exists-already notes and Playwright sketches are in IDEAS.md under the same I-number. Score = impact x 2
- effort - input (input: lower is better).

| # | ID | Idea | Score | Why it waits | Blocked on |
|---|---|---|---|---|---|
| R-01 | I-09 | Instant onboarding under 30 s | 6 | It is the onboarding fix agent's own list (FRU-1..14, FRS-1..6) | That agent porting `feat/ov-onboard` |
| R-02 | I-10 | Habit form fills itself from the name | 5 | FRS-6 is a fixer finding; small once onboarding merges | Onboarding fixer |
| R-03 | I-12 | Day-1 value from the phone's history | 5 | Native only; Playwright cannot verify it | Native agent, a device run |
| R-04 | I-13 | Bank feed live + one-tap review inbox | 5 | Inert without credentials | **User decision**: Setu production, cost |
| R-05 | I-16 | Focus in one tap | 4 | Cheap; `feat/ov-ux-flows` F06/F13 already built it | Social fixer (timer.js) |
| R-06 | I-28 | Offline you can see and trust | 3 | Shell fixer is in the outbox now | Shell fixer |
| R-07 | I-17 | The weekly review writes itself | 3 | Social fixer owns review.js | Social fixer |
| R-08 | I-25 | Fresh-start prompts | 3 | Lands in `one-thing.js` after W1 | W1 |
| R-09 | I-15 | Share target + launcher shortcuts (port) | 3 | Touches `vite.config.js` (perf) and the mobile project | Perf + native agents |
| R-10 | I-11 | WhatsApp reply to log | 3 | Only reaches users with WhatsApp connected | **User decision**: prod WhatsApp number |
| R-11 | I-18 | Circles and families start themselves | 3 | Social fixer owns circle.js / family.js | Social fixer |
| R-12 | I-19 | Goal steps drafted for you | 3 | Small, free-standing; next wave | none |
| R-13 | I-29 | Projection plus a default | 3 | Builds on `main`'s Outlook card + W7 | W7 |
| R-14 | I-20 | One notification budget across modules | 3 | Backend across five schedulers | **User decision**: changes default delivery |
| R-15 | I-21 | Split a bill, settle by UPI | 3 | Needs a share-link decision | **User decision**: public share page |
| R-16 | I-24 | Hindi and Tamil | 3 | Mostly string moves; translation is the cost | **User decision**: translator / reviewer |
| R-17 | I-32 | Undo for Money | 2 | Money's ledger diff needs its own hold; after W6 and W7 | W6, W7 |
| R-18 | I-23 | Android home-screen widgets | 3 | Kotlin AppWidget + a widget token | Native agent |
| R-19 | I-14 | Import from other apps (port) | 2 | Built on `feat/ov-import`; worth a port after Money and Calendar settle | W7, capture fixer |
| R-20 | I-26 | Bulk actions | 2 | W4's "Move all to tomorrow" covers the most common case first | W4 |
| R-21 | I-27 | Routines | 2 | Wait for W1 to show whether one-tap habit rows are enough | W1 |
| R-22 | I-31 | Notification controls in the bell | 2 | Fix-sized (FRS-15) | Shell fixer |
| R-23 | I-22 | Two-way Google Calendar sync | 1 | Effort 5, OAuth verification | **User decision**: Google OAuth, privacy |
| R-24 | I-30 | Honest habit timelines | 1 | Low impact alone | none |

## Spec summaries

**R-01 Instant onboarding (I-09).** Neutral first screen with two equal buttons, one password, the code
submits itself, no timezone step when zones match, a pre-selected starter pack, push at the first timed
save, no celebration modal for pack-written items, Home opened on what was created. Landing to first
habit ticked: 17 taps / ~108 s to 6 taps / ~26 s. Port `feat/ov-onboard` 656c9f2; deferring email
verification (FRU-5) is a separate security decision.

**R-02 Habit form fills itself (I-10).** The name sets category, icon, Build/Break and a reminder time
from keywords; templates carry the starter packs' times; colour, cadence, auto-tick and tone fold
under "More options". 6 taps / 8 decisions to 3 taps / 2 decisions. `openHabitForm`,
`HABIT_TEMPLATES`, a pure `suggestHabit` in `nudges.js`.

**R-03 Day-1 value from history (I-12).** On the first native sign-in, backfill 14 days of steps and
sleep through `POST /api/health/sync`, so Home, the sleep check-in and Insights start with data. 0
inputs beyond the health permission.

**R-04 Bank feed live (I-13).** Set Setu credentials, confirm `BankFeedClient` against the sandbox, add
a "To review" inbox for rows the keyword table defaulted, and remember a merchant's category.
Typing every expense becomes one consent plus a tap per unknown merchant.

**R-05 Focus in one tap (I-16).** Home Focus action and long-press on + start the last length and sound
on the first open task; the sprint that ends on a task offers "Mark it done?". 3 taps to 1.

**R-06 Offline you can see (I-28).** "3 changes waiting" chip from the outbox, and a review list for the
outbox's `conflicts` and `dropped` ops so a refused write is never silent.

**R-07 Weekly review writes itself (I-17).** Lower rungs in `weeklyWinsDraft`, the focus prefilled, the
focus shown on Home with "Make it a habit", the weekly digest on by default for new accounts, "This week
so far" from day 3. 4 taps / 2 fields to 2 taps / 0 fields.

**R-08 Fresh-start prompts (I-25).** Mondays, the 1st, the birthday and the first open after a gap get a
one-thing card offering one goal or pack, framed as a new start.

**R-09 Share target and shortcuts (I-15).** Port `feat/ov-pwa` 3b51874: manifest shortcuts, a share
target routed through the camera router or Quick add, and the same as Android launcher shortcuts.

**R-10 WhatsApp reply to log (I-11).** The parser already runs on inbound texts; add "Reply DONE" to
habit reminders, make DONE tick the newest habit message's habit, send a welcome with three examples on
verify, and show them in Settings.

**R-11 Circles and families start themselves (I-18).** Create a circle, get the share sheet and a running
7-day sprint; join, get the shared goal as a habit in one tap; family relationship from the name, "Save
and add another", and the day's meal plan made when the tab opens (AI cost decision; favourites are the
fallback).

**R-12 Goal steps drafted (I-19).** Pre-ticked milestones from a keyword template table, horizon from the
date; an AI suggestion later with the table as fallback. 11 taps / 5 fields to 4 taps / 1 field.

**R-13 Projection plus a default (I-29).** The Outlook savings pace gets one button that creates a monthly
savings goal or recurring transfer at the projected amount.

**R-14 One notification budget (I-20).** A shared cap of 1-2 proactive prompts a day across water, habit
nudges, digest, bills and circles, skipped when the app was opened, decaying when ignored; user-set
reminders exempt.

**R-15 Split a bill (I-21).** "Split" on any expense creates lent transfers per person (the loans model
exists), with `upi://pay` links and an optional share link for people without the app.

**R-16 Hindi and Tamil (I-24).** A language picker writing `uiPrefs.locale` and the core screens'
strings moved to `t()` with `hi` and `ta` catalogs.

**R-17 Undo for Money (I-32).** Ledger deletes held out of `ledgerDiff` for the undo window, so a remote
merge mid-window cannot bring the row back; extends W6 to Money's twelve delete paths.

**R-18 Android widgets (I-23).** Today's habits with a tick, +250 ml, Add expense, through a widget-scoped
token.

**R-19 Import from other apps (I-14).** Port `feat/ov-import` dcdf87a: Money CSV with format detection
and duplicate unticking, Calendar `.ics` with the RRULE subset, EXDATE and VALARM.

**R-20 Bulk actions (I-26).** Long-press select for tasks and expenses: move, done, re-tag, delete with
Undo.

**R-21 Routines (I-27).** A bundle row that ticks several habits at once; a recurring automation such as
"every Sunday make the meal plan".

**R-22 Notification controls in the bell (I-31).** A gear in the bell header and a per-row "Mute
<kind>". 6 taps to 1-2.

**R-23 Google Calendar sync (I-22).** Read Google events into Calendar and Plan my day; optionally write
reminders back.

**R-24 Honest habit timelines (I-30).** Habit strength as a curve towards automatic (median 59-66 days),
small milestone moments instead of modals.
