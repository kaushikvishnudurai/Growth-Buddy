# Roadmap

Phase 4 of the overhaul: each idea gets a spec (problem, the input it needs, the outcome, the effort),
ranked by impact over effort. The built ones are in `feat/overhaul`; the rest are below, in order.
Ideas the parallel `feat/life-plan` branch owns (its `research/low-input-high-output.md` section 5)
are listed once at the end and not re-specified.

Effort: S = under a day, M = a few days, L = a week or more.

## Built in this pass

| # | Idea | Problem | Input | Outcome | Effort | Branch |
|---|---|---|---|---|---|---|
| 1 | Command palette (Ctrl/Cmd+K, `/`, header button) | 15 modules, no global search: finding a task, note or setting meant knowing which screen holds it | a few letters | jumps straight to the item, screen or action; anything else becomes a Quick add sentence | M | `ov-palette` |
| 2 | Keyboard shortcuts (`n`, `g h/c/m/n/r/s`, `?`) | desktop users had no keyboard path | one key | new task or any main screen without the mouse | S | `ov-palette` |
| 3 | Undo instead of "Are you sure?" | deletes were either permanent with no warning (tasks) or behind a dialog (habits, goals, water, food, reminders) | none | the delete happens at once and is reversible for 6 s; one shared queue, flushed on sign-out and page hide | M | `ov-undo` |
| 4 | Money CSV import | switching from another tracker meant retyping history | one file or a paste | bank statements and other apps' exports read (Indian number formats, day-first dates, debit/credit columns), duplicates left out, categories guessed | M | `ov-import` |
| 5 | Calendar .ics import | same, for calendars | one file | Google/Apple/Outlook events become reminders, repeats and alerts included | M | `ov-import` |
| 6 | Update-available prompt | a deploy never reached an open or installed app | one tap | "A new version is ready" with Reload | S | `ov-pwa` |
| 7 | Link previews | a Circle invite pasted in WhatsApp showed a bare URL | none | a branded card (Open Graph + Twitter, 1200x630 image) | S | `ov-pwa` |
| 8 | Home-screen shortcuts + share target | logging from outside the app took several taps | long-press the icon, or Share to Growth Buddy | Log water / Add task / Start focus / Quick add from the icon; shared text lands in the Quick add preview | S | `ov-pwa` |
| 9 | One-tap Daily brief chips | "13% water", "Sleep not logged" said what was missing and did nothing | one tap | +250 ml, or the sleep / mood dialog | S | `ov-ux-flows` |
| 10 | Reminder from + in one sentence | + Reminder jumped to Calendar and asked for everything | one sentence | "remind me at 6 to call mom" saved, time read from the words (7 taps to 3) | M | `ov-ux-flows` |
| 11 | Focus that starts, and finishes the task | starting focus on a task stopped on a Start button; ending it said nothing about the task | none | the clock starts from the row; at the end, "Mark it done?" | S | `ov-ux-flows` |
| 12 | Due chips, Add another, habit reminder offer, goal's first task | each was one more picker or one more trip | one tap | Today / Tomorrow chips (6 taps to 3), batch task entry (6 to 4), "Remind you at 19:00?" after a new habit | S | `ov-ux-flows` |
| 13 | Budgets from your own spending | Set budgets started blank, one field per tag | none | each tag prefilled 10% under the last 30 days; the 5th expense in an unbudgeted tag offers one | S | `ov-ux-modules` |
| 14 | Currency from the device's region | every account started in rupees | none | the local symbol on first use; a currency the user set always wins | S | `ov-ux-modules` |
| 15 | Plan meals for just me | a solo cook couldn't reach the meal planner without inventing a family | one tap | a one-person household from the profile, straight to Today's plan | S | `ov-ux-modules` |
| 16 | One-tap Buddy actions, circle's first challenge | Buddy's suggestions opened a filled form; joining a circle ended at a toast | one tap | saved with Undo; the joined circle offers its first 7-day challenge | S | `ov-ux-modules` |
| 17 | Shorter sign-up | 9 taps and 5 fields to a set-up Home | email, name, password, code | 4 taps, 4 fields: no confirm password, the code submits itself, no timezone / features / notifications steps; push is asked at the first timed reminder | S | `ov-onboard` (on top of `feat/life-plan`) |

## Next, ranked

| # | Idea | Problem | Input | Outcome | Effort |
|---|---|---|---|---|---|
| 1 | Undo in Money | Money's 12 delete paths still confirm first. It saves through its own ledger diff, pending queue and cross-device merge, so "don't save yet" isn't enough: a merge during the window would bring the row back | none | the same 6 s Undo as everywhere else | M |
| 2 | Save files inside the app | exports (data, .ics, CSV, story card) can't save in the Capacitor app yet and say so | none | add `@capacitor/filesystem` + `@capacitor/share` to `../Growth-Buddy-Mobile`; `save-file.js` already has the rung waiting for them | S |
| 3 | Apply the native patch | permissions, camera/photo usage strings (iOS crashes on the first photo without them), deep-link intent filter, notification icon, backup rules | none | `git apply docs/mobile-native-changes.patch` in the mobile repo once its pending work is committed, then `assetlinks.json` / AASA with the release key and Team ID | S |
| 4 | Languages | only English ships; `t()` covers a handful of strings; no picker | one choice in Settings | move strings to `i18n.js` catalogs screen by screen, then a Settings picker writing `uiPrefs.locale` | L |
| 5 | Steps and sleep from the phone | the Steps auto-tick waits on a health plugin that isn't installed | one permission | `@capgo/capacitor-health` in the mobile app; the web side already degrades cleanly | M |
| 6 | Currency saved on first use | the region currency is filled in on load but only reaches the server with the next Money save, so WhatsApp messages still say rupees until then | none | save it once from app.js's money load path | S |
| 7 | Import past calendar events | the server refuses a reminder dated before yesterday, so an .ics import leaves past one-offs out | none | allow past one-offs for imports only (a flag on POST), or keep leaving them out | S |
| 8 | Expired pantry items in the meal-plan prompt | the server sends expired items to the model with the rest | none | filter by expiry in `appendAvailableLines` | S |
| 9 | Settings "Delete all" reminders asks twice | it now leads to an undoable delete, so the second tap is redundant | one tap fewer | drop the two-tap guard | S |
| 10 | Score ring after a delete | the ring keeps the old value until the deferred DELETE is sent | none | recompute locally when the item leaves the list | S |
| 11 | Enforce the CSP | Report-Only, now with a report endpoint | none | watch the `[csp]` log for a week, then `CSP_ENFORCE=true` | S |
| 12 | Android 15 status-bar strip | edge-to-edge ignores the in-app theme for the strip behind the status bar | none | a small native change in MainActivity | S |

## Owned by `feat/life-plan`

From its research, section 5, not re-specified here: one notification budget across modules, an
if-then cue at habit creation, rewarding the comeback, no failure states, bridging the wait for the
first insight, fresh-start prompts, projection plus a one-tap default, day-1 value from history,
pausing a module, and honest habit timelines.
