# styles/app.css — app styles (6952 lines)

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
| 148 | Avatar |
| 166 | Section title |
| 192 | **Card — no padding by design; content insets itself** |
| 202 | Buttons |
| 311 | Chips / pills |
| 329 | Icon chip |
| 340 | Bottom nav |
| 419 | Habit / task check |
| 458 | Login |
| 587 | Notification bell |
| 689 | Mentor chat |
| 874 | Search modal (Find someone) |
| 975 | Circle (person rows + status pills) |
| 1033 | Focus screen |
| 1219 | Feature on/off rows |
| 1244 | Settings: Account pane |
| 1275 | Loading splash (quote of the day) |
| 1338 | Report screen |
| 1436 | Insights |
| 1476 | Circle challenges + leaderboard |
| 1603 | Mentor prompt chips |
| 1840 | Color picker (habit customize) |
| 1867 | List rows |
| 1896 | Dashboard blocks — `.gb-dash-main` / `.gb-dash-side`, stack on phones |
| 2717 | Goals screen |
| 2824 | Enhanced goal card UI |
| 2899 | Tasks scrollable list |
| 3010 | **Calendar screen** (large) |
| 3797 | Delete-scope modal |
| 3859 | Focus stats card |
| 4622 | **Laptop / desktop layout (≥1024px)** |
| 4824 | Goal day-tracker progress bar |
| 4893 | Fitness × Sleep insight card |
| 4931 | Responsive improvements — tablet + desktop widths |
| 4942 | Desktop content-screen layout |
| 5019 | Small phones (≤380px) |
| 5054 | WhatsApp reminders |
| 5156 | Profile Settings modal |
| 5323 | WhatsApp OTP verification |
| 5409 | **Family tab & AI meal planner** (+ polish at 6040) |
| 6158 | Streak freeze / protection |
| 6268 | Report — trends drill-down |
| 6351 | Achievements gallery |
| 6520 | Goal milestones / sub-tasks |
| 6618 | Offline-first PWA — connectivity banner |
| 6634 | Accessibility — skip link, focus-visible, reduced motion |
| 6673 | Bottom nav — "More" overflow sheet |
| 6751 | Settings — Home screen customizer |
| 6816 | Integration card (Settings → Account → Integrations) |

## Editing rules

- Colors come from tokens (`var(--coral-500)`, `var(--leaf-50)`, …) — no raw hex here.
- Responsive breakpoints are grouped at 4622 / 4931 / 5019, **not** inline per component. Put media
  queries there so the phone-first base stays readable.
- Modal markup is fixed (`.gb-modal-overlay > .gb-modal[role=dialog]`) because `scripts/a11y.js`
  keys off it for focus trapping. Don't restyle it into a different structure.
