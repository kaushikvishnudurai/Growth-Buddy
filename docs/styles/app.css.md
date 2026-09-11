# styles/app.css — app styles (7076 lines)

Consumes tokens from `tokens.css`. Mobile-first: full-screen on phones, an iPhone-style frame on
desktop, sidebar + multi-column grid at ≥1024px. Money has its own file (`money.css`).

Class convention: `gb-<area>-<element>`; state modifiers `is-over` / `is-near` / `is-accepted`;
buttons `gb-btn--primary|secondary|soft|success|compact`.

## Section index (grep these banner titles)

| Line | Section |
|---|---|
| 33 | Page chrome (desktop only) |
| 52 | App container — phone fills viewport, inner `.gb-scroll` handles overflow |
| 69 | Scroll region |
| 80 | App header |
| 153 | Avatar |
| 171 | Section title |
| 197 | **Card — no padding by design; content insets itself** |
| 207 | Buttons |
| 318 | Chips / pills |
| 336 | Icon chip |
| 347 | Bottom nav |
| 426 | Habit / task check |
| 465 | Login |
| 673 | Notification bell |
| 775 | Mentor chat |
| 969 | Search modal (Find someone) |
| 1070 | Circle (person rows + status pills) |
| 1139 | Focus screen |
| 1325 | Feature on/off rows |
| 1350 | Settings: Account pane |
| 1381 | Loading splash (quote of the day) |
| 1444 | Report screen |
| 1542 | Insights |
| 1582 | Circle challenges + leaderboard |
| 1709 | Mentor prompt chips |
| 1946 | Color picker (habit customize) |
| 1973 | List rows |
| 2002 | Dashboard blocks — `.gb-dash-main` / `.gb-dash-side`, stack on phones |
| 2835 | Goals screen |
| 2942 | Enhanced goal card UI |
| 3017 | Tasks scrollable list |
| 3136 | **Calendar screen** (large) |
| 3943 | Delete-scope modal |
| 4005 | Focus stats card |
| 4779 | **Laptop / desktop layout (≥1024px)** |
| 4981 | Goal day-tracker progress bar |
| 5050 | Fitness × Sleep insight card |
| 5088 | Responsive improvements — tablet + desktop widths |
| 5103 | Desktop content-screen layout |
| 5180 | Small phones (≤380px) |
| 5215 | WhatsApp reminders |
| 5317 | Profile Settings modal |
| 5492 | WhatsApp OTP verification |
| 5574 | **Family tab & AI meal planner** (+ polish at 6119) |
| 6370 | Streak freeze / protection |
| 6480 | Report — trends drill-down |
| 6563 | Achievements gallery |
| 6732 | Goal milestones / sub-tasks |
| 6830 | Offline-first PWA — connectivity banner |
| 6846 | Accessibility — skip link, focus-visible, reduced motion |
| 6885 | Bottom nav — "More" overflow sheet |
| 6980 | Settings — Home screen customizer |
| 7044 | Settings — Display (text size preview) |

## Editing rules

- Colors come from tokens (`var(--coral-500)`, `var(--leaf-50)`, …) — no raw hex here.
- Responsive breakpoints are grouped at 4764 / 5104 / 5181, **not** inline per component. Put media
  queries there so the phone-first base stays readable.
- Modal markup is fixed (`.gb-modal-overlay > .gb-modal[role=dialog]`) because `scripts/a11y.js`
  keys off it for focus trapping. Don't restyle it into a different structure.
