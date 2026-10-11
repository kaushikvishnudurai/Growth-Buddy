# I-03 command palette: inputs before vs after

Counted on build 95 (before) and this branch (after) with the seeded QA account.
"Field" means a text box you type into; typing a word counts once.

| Flow | Before | After |
|---|---|---|
| Open a note named "Ideas for the trip" (phone) | More, Notes, search icon, type, tap card: 4 taps, 1 field, 2 screens | Search button, type "trip", tap the result: 2 taps, 1 field |
| Open a note named "Ideas for the trip" (desktop) | Notes in the sidebar, find the card (scroll or search), click it: 2-3 clicks, 0-1 field | Ctrl/Cmd+K, type "trip", Enter: 1 chord, 1 field, 1 key |
| Go to Money (desktop) | 1 click in the sidebar (mouse) | `g` `m`: 2 keys; or Ctrl+K, "mon", Enter |
| Go to Calendar (phone, Calendar in More) | More, Calendar: 2 taps | Search, "cal", tap: 2 taps, 1 field (no gain on a phone; the win is the keyboard) |
| Find a reminder ("Call mom", repeats daily) | More, Calendar, page the month to find the day, tap the day: 3+ taps | Ctrl+K, "call", Enter: opens Calendar on its next day |
| Edit a task by name | Find the row on Home or Tasks, tap the pencil: 1-2 taps after scrolling | Ctrl+K, a word, Enter: Edit task opens |
| Edit an expense from 3 weeks ago | Money, scroll the ledger (or open its search, type), tap the row: 3+ taps | Ctrl+K, a word of its note, Enter: the expense form opens |
| Log "need to buy oat milk" from another screen | Home (or +), type in Quick add, Log it, Log it in the preview: 3 taps, 1 field | Ctrl+K, type, Enter, Log it: 1 chord, 1 field, 1 key, 1 tap (same preview, same writes) |
| Change the theme (desktop) | Avatar, Settings, Display, pick Dark: 4 clicks | Ctrl+K, "dark", Enter: 1 chord, 1 field, 1 key |
| Open Settings > Alerts | Avatar, Settings, Alerts: 3 clicks | Ctrl+K, "alerts", Enter |
| Repeat a recent pick | as above | Ctrl+K, Enter: it is first under Recent (kept in `ui_prefs.paletteRecent`, so it follows the account) |

Evidence: `e2e/palette.spec.mjs` (desktop + mobile; the reminder, theme and Alerts rows are its "one line" test), screenshots in this folder
(`open-empty`, `go-money`, `find-note`, `quick-add-row`, `quick-add-preview`, `shortcuts`,
`header-button-desktop`, `header-button-mobile`).
