# styles/mini-calendar.css — mini calendar card

Styles only `MiniCalendarCard` (`scripts/dashboard.js`), the compact calendar on Home. Split
out of `app.css` because the component is self-contained and app.js repaints it in place
(`rerenderHomeMiniCalendarIfActive`).

Class map — all `gb-mini-cal-*`:

| Group | Classes |
|---|---|
| shell | `-card`, `-header`, `-month`, `-nav-btn` |
| grid | `-grid`, `-dow`, `-dow-cell`, `-day`, `-day-title` |
| day contents | `-items`, `-item`, `-item-main`, `-item-title`, `-item-sub`, `-pill` |
| sections | `-section`, `-section-head`, `-section-title`, `-section-count` |
| states | `-empty`, `-empty--loading`, `-empty--error`, `-retry` |
| legend | `-legend`, `-legend-item` |

The `--loading` / `--error` / `-retry` states exist because the card fetches per-day food
asynchronously (`loadCalendarFoodForDate`) and must show
a retry affordance rather than an empty day.

The `.badge` counts one-off items only (tasks + non-repeating reminders, and `.has-reminders` follows the same count); a day whose only reminders repeat gets `.gb-mini-cal-rep`, a dot, and still reads `.is-free`. A daily reminder used to badge every day ahead.

`.is-today:not(.is-selected)` sits after `.has-tasks` / `.is-free` on purpose: same specificity, and written before them today lost its ring on any day with tasks.
`-nav-btn` is drawn at 32px with a `::before` overlay making the tap target 44px, and has a `:disabled` style (dimmed, no hover or press).
