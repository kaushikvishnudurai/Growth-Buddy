# styles/app.css — app styles (7156 lines)

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
| 762 | Notification bell |
| 864 | Mentor chat |
| 1058 | Search modal (Find someone) |
| 1159 | Circle (person rows + status pills) |
| 1228 | Focus screen |
| 1414 | Feature on/off rows |
| 1439 | Settings: Account pane |
| 1470 | Loading splash (quote of the day) |
| 1533 | Report screen |
| 1631 | Insights |
| 1671 | Circle challenges + leaderboard |
| 1798 | Mentor prompt chips |
| 2035 | Color picker (habit customize) |
| 2062 | List rows |
| 2091 | Dashboard blocks — `.gb-dash-main` / `.gb-dash-side`, stack on phones |
| 2924 | Goals screen |
| 3031 | Enhanced goal card UI |
| 3106 | Tasks scrollable list |
| 3225 | **Calendar screen** (large) |
| 4032 | Delete-scope modal |
| 4094 | Focus stats card |
| 4868 | **Laptop / desktop layout (≥1024px)** |
| 5070 | Goal day-tracker progress bar |
| 5139 | Fitness × Sleep insight card |
| 5177 | Responsive improvements — tablet + desktop widths |
| 5192 | Desktop content-screen layout |
| 5269 | Small phones (≤380px) |
| 5304 | WhatsApp reminders |
| 5406 | Profile Settings modal |
| 5581 | WhatsApp OTP verification |
| 5653 | **Family tab & AI meal planner** (+ polish at 6119) |
| 6449 | Streak freeze / protection |
| 6559 | Report — trends drill-down |
| 6642 | Achievements gallery |
| 6811 | Goal milestones / sub-tasks |
| 6909 | Offline-first PWA — connectivity banner |
| 6925 | Accessibility — skip link, focus-visible, reduced motion |
| 6964 | Bottom nav — "More" overflow sheet |
| 7059 | Settings — Home screen customizer |
| 7123 | Settings — Display (text size preview) |

## Editing rules

- Colors come from tokens (`var(--coral-500)`, `var(--leaf-50)`, …) — no raw hex here.
- Responsive breakpoints are grouped at 4853 / 5193 / 5270, **not** inline per component. Put media
  queries there so the phone-first base stays readable.
- Modal markup is fixed (`.gb-modal-overlay > .gb-modal[role=dialog]`) because `scripts/a11y.js`
  keys off it for focus trapping. Don't restyle it into a different structure.
