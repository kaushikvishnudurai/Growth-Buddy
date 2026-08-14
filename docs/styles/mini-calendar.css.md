# styles/mini-calendar.css — mini calendar card (375 lines)

Styles only `MiniCalendarCard` (`scripts/dashboard.js` ~1035), the compact calendar on Home. Split
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

The `--loading` / `--error` / `-retry` states exist because the card fetches per-day food and Google
Calendar events asynchronously (`loadCalendarFoodForDate`, `loadGoogleEventsForMonth`) and must show
a retry affordance rather than an empty day.
