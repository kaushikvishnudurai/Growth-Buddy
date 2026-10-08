# styles/app.css — app styles (7961 lines)

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
| 795 | Notification bell |
| 897 | Mentor chat — incl. the boot skeleton (`.gb-msg-skel`, two-class selectors so they beat `.gb-skel-line`). On desktop `.gb-mentor` needs `width: 100%` beside its `max-width`: it is a flex item in a column container, and auto inline margins opt an item out of stretch, so the screen collapsed to fit-content (392px at 1512px wide) |
| 1091 | Search modal (Find someone) |
| 1192 | Circle (person rows + status pills) |
| 1261 | Focus screen |
| 1447 | Feature on/off rows |
| 1472 | Settings: Account pane |
| 1503 | Loading splash (quote of the day) |
| 1566 | Report screen |
| 1664 | Insights |
| 1704 | Circle challenges + leaderboard |
| 1831 | Mentor prompt chips |
| 2068 | Color picker (habit customize) |
| 2095 | List rows |
| 2124 | Dashboard blocks — `.gb-dash-main` / `.gb-dash-side`, stack on phones |
| 2957 | Goals screen |
| 3064 | Enhanced goal card UI |
| 3139 | Tasks scrollable list |
| 3258 | **Calendar screen** (large) |
| 4065 | Delete-scope modal |
| 4127 | Focus stats card |
| 4901 | **Laptop / desktop layout (≥1024px)** |
| 5103 | Goal day-tracker progress bar |
| 5172 | Fitness × Sleep insight card |
| 5210 | Responsive improvements — tablet + desktop widths |
| 5225 | Desktop content-screen layout |
| 5302 | Small phones (≤380px) |
| 5337 | WhatsApp reminders |
| 5439 | Profile Settings modal |
| 5614 | WhatsApp OTP verification |
| 5686 | **Family tab & AI meal planner** (+ polish at 6119) |
| 6482 | Streak freeze / protection |
| 6592 | Report — trends drill-down |
| 6675 | Achievements gallery |
| 6844 | Goal milestones / sub-tasks |
| 6942 | Offline-first PWA — connectivity banner |
| 6958 | Accessibility — skip link, focus-visible, reduced motion |
| 6997 | Bottom nav — "More" overflow sheet |
| 7092 | Settings — Home screen customizer |
| 7156 | Settings — Display (text size preview) |
| 8489 | Notes — composer, editor (photos: develop-in animation, drop zone, picked ring), cards with a photo cover |

## Editing rules

- Colors come from tokens (`var(--coral-500)`, `var(--leaf-50)`, …) — no raw hex here.
- Responsive breakpoints are grouped at 4886 / 5226 / 5303, **not** inline per component. Put media
  queries there so the phone-first base stays readable.
- Modal markup comes from `openOverlay` in `gb-kit.js` — don't hand-roll it. It is `.gb-modal-overlay > .gb-modal[role=dialog]` because `scripts/a11y.js`
  keys off it for focus trapping. Don't restyle it into a different structure.
- Every `:hover` rule sits inside `@media (hover: hover)` (nested inside another `@media` where it
  has one): touch screens keep `:hover` after a tap, so a pressed button stayed in its hover colour.
  Split a mixed selector list (`:active, :hover`) rather than wrap the `:active` half too. Every
  `.gb-btn` gets a `scale(0.97)` press; small controls share one `scale(0.96)` rule (grep `.gb-seg:active`).
- A panel or editor that scrolls on its own sets `overscroll-behavior: contain` (`.gb-modal`,
  `.gb-modal-body`, `.gb-notif-pop`, `.gb-editor`), or reaching its end scrolls the page behind.
- A control drawn under 44px joins the "Tap targets" `::before` overlay list (grep the banner)
  rather than growing. Skip any control that already has a `::before` of its own. An overlay is
  clipped by the control's own `overflow: hidden` (why `.gb-msg-chip` has no ellipsis), and two
  controls stacked closer than 44px need their overlays split, not centred (`.gb-home-cust-move`).
- Fixed layers on a phone pad for `env(safe-area-inset-*)` (`index.html` has `viewport-fit=cover`,
  so `100dvh` runs under the notch and home indicator): header, nav, modal overlay, toasts, PTR.
- The tablet phone-frame (both rules) also needs `min-height: 560px`: a landscape phone stays full-screen.
- The tablet phone-frame widens 440 -> 600px at 560px, the lowest viewport breakpoint any grid
  goes two-up at. A new `min-width` grid rule below 560 would split a 440px frame.
