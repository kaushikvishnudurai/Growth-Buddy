# Research and gap analysis

This builds on `research/low-input-high-output.md` (branch `feat/life-plan`, October 2026), which
already covers 22 competitor apps, the behavioural-science evidence and a ranked list of ten things to
build next. That work isn't repeated here. This file adds two things it doesn't have: what users of
competing apps complain about, and a gap analysis against what Growth Buddy actually ships today.

## 1. What users complain about

| Complaint | Where | What it means here |
|---|---|---|
| Juggling five or six apps (habits, mood, money, focus, journal) is the reason people give up. Consolidated apps market exactly this | HabitGenius, Day Ledger launches; r/HabitTrackerApp via [GummySearch](https://gummysearch.com/r/HabitTrackerApp/), [Product Hunt](https://www.producthunt.com/products/day-ledger) | Growth Buddy's core advantage already exists. Breadth makes finding things a problem, though: no global search, no keyboard way in |
| Habit-tracker complaints fall into five groups: streak data lost after a reinstall or sync, paywalls mid-flow, gamification fatigue, habits that don't fit real life, and notifications that either spam or go silent | [unstar.app 2026 roundup](https://unstar.app/blog/streaks-habitica-way-of-life-strides-habit-tracking-apps-ranked-2026) | Streaks live on the server and there's no paywall, so those two are covered. Notifications are the open risk: five modules prompt independently |
| Users want one weekly view that pulls habits, spending and tasks together, so they don't have to cross-reference modules by hand | same | Report's Insights + the weekly review do this. Keep it in the "already ahead" column |
| Habitica: the RPG layer is friction for non-gamers; the mobile app lags the web one | [habi.app](https://habi.app/insights/habitica-alternatives/) | Keep gamification light (XP, badges, seedling). Web/app parity matters (see `docs/audit/parity.md`) |
| Sunsama: the daily planning ritual "grew into a twenty-minute chore"; skip it for a few days and the app gathers dust; price | [Morgen](https://www.morgen.so/blog-posts/sunsama-vs-motion), [Ellie](https://ellieplanner.com/comparisons/sunsama-alternative) | Plan my day is one tap with a finished draft. Good. Never make it a required ritual |
| Todoist: Today shows everything due, with no cap, so the user has to triage | [super-productivity](https://super-productivity.com/blog/) | Home's top-3 sort plus the "one thing" card (life-plan) already addresses this |
| Axio (Walnut): ads and spam calls after the pivot to lending; adding expenses one by one is tedious, and users ask for bulk entry | [Yellow Slice review](https://www.yellowslice.in/blog/axio-app-review-by-yellow-slice-how-to-make-it-better), [Finny](https://getfinny.app/blog/sms-expense-tracking-app) | Bank feed (AA) and receipt scan cover passive capture. There's no bulk import: a user switching from another tracker re-types their history or starts from zero |

## 2. Gap analysis

### Where Growth Buddy is already ahead

- **One app, one sentence.** Quick add logs 13 kinds of thing from one line, works without AI and
  from WhatsApp. No competitor in the sweep does this across this many modules.
- **India-first money.** Account Aggregator bank feed, UPI-style narration parsing, INR defaults,
  WhatsApp bill reminders with a Mark-as-paid button.
- **Forgiving streaks** (freezes, rest days, weekly cadences), server-held so a reinstall loses
  nothing.
- **Family + social** (meal planner, chores, Circle challenges, mentorship) inside the same app as
  personal tracking. The single-purpose apps can't do this.
- **No paywall on any low-input path.**

### What the best products do that Growth Buddy doesn't

Verified against the code on `main` (build 88). Items the life-plan research already lists are marked
"(LP #n)" and left to that branch.

| Gap | Best-in-class | Growth Buddy today | Evidence in code |
|---|---|---|---|
| Universal search + command palette | Linear, Notion, Todoist (Ctrl+K), Raycast | None. Each screen has its own search (Notes) or none | no `metaKey`/`ctrlKey` handler outside two Ctrl+Enter send boxes |
| Keyboard shortcuts | Todoist (`q` quick add), Gmail-style `g h` navigation | None | same |
| Undo instead of "Are you sure?" | Gmail, Todoist, Things: act at once, Undo toast for a few seconds | Notes and Family shopping/chores have Undo. Tasks delete with no way back; habits, goals, water, food and reminders ask a confirm dialog first | `toast.action` used 4 times; `confirmDelete` / `confirmDialog` 19 times |
| Bulk import of history | Copilot, Monarch (CSV import), Loop Habit Tracker (backup import) | Money exports CSV. Nothing imports | `ledgerCsv` export only |
| One notification budget | Duolingo bandit, Apple Vitals | Each module schedules its own | (LP #1) |
| If-then habit cue | evidence base | no field | (LP #2) |
| Comeback reward, no failure state | Milkman megastudy, Finch | freezes exist; no comeback moment | (LP #3, #4) |
| Pause a whole module | Epstein lapse-resume research | features can be switched off in Settings, which hides data | (LP #9) |
| Installable PWA polish | Linear, Things web | manifest has no `id`, `shortcuts` or screenshots; locks `orientation: portrait` though the app now supports landscape | `vite.config.js` manifest |
| Link previews | every consumer site | no Open Graph or Twitter tags, so a shared Circle invite link previews as a bare URL | `index.html` |

### Where Growth Buddy can beat them

1. **Ctrl+K that reaches every module at once**: search across tasks, habits, goals, notes,
   reminders and settings, and run actions ("add task ...", "log water", "dark mode", "go to Money")
   from the same box, falling through to Quick add when nothing matches. Single-purpose apps can only
   search themselves. This one has 15 modules to search.
2. **Undo everywhere**, so moving fast is safe. Deleting is immediate and reversible for 5 seconds,
   on every entity, through one shared path instead of 19 confirm dialogs.
3. **Switching cost to zero**: import a Money CSV (from another tracker or a bank statement export)
   in one step, with the same category guesser the app already uses.
4. **Shareable invites that look like something**: Open Graph tags so a Circle invite posted in a
   WhatsApp group shows a card, not a URL. Cheap, and it drives the social loop.

These four don't overlap with `feat/life-plan`, so they make the core of Phase 4 in this pass (see
`docs/ROADMAP.md` for the ranking).
