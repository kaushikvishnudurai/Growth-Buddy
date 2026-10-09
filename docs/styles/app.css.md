# styles/app.css — app styles

Consumes tokens from `tokens.css`. Mobile-first: full-screen on phones, an iPhone-style frame on
desktop, sidebar + multi-column grid at ≥1024px. Money has its own file (`money.css`).

Class convention: `gb-<area>-<element>`; state modifiers `is-over` / `is-near` / `is-accepted`;
buttons `gb-btn--primary|secondary|soft|success|compact`.

## Section index (grep these banner titles)

| Section |
|---|
| Page chrome (desktop only) |
| App container — phone fills viewport, inner `.gb-scroll` handles overflow |
| Scroll region |
| App header |
| Avatar |
| Section title |
| **Card — no padding by design; content insets itself** |
| Buttons |
| Chips / pills |
| Icon chip |
| Bottom nav |
| Habit / task check |
| Login |
| Notification bell |
| Mentor chat — incl. the boot skeleton (`.gb-msg-skel`, two-class selectors so they beat `.gb-skel-line`). On desktop `.gb-mentor` needs `width: 100%` beside its `max-width`: it is a flex item in a column container, and auto inline margins opt an item out of stretch, so the screen collapsed to fit-content (392px at 1512px wide) |
| Search modal (Find someone) |
| Circle (person rows + status pills) |
| Focus screen |
| Feature on/off rows |
| Settings: Account pane |
| Loading splash (quote of the day) |
| Report screen |
| Insights |
| Circle challenges + leaderboard |
| Mentor prompt chips |
| Color picker (habit customize) |
| List rows |
| Dashboard blocks — `.gb-dash-main` / `.gb-dash-side`, stack on phones |
| Goals screen |
| Enhanced goal card UI |
| Tasks scrollable list |
| **Calendar screen** (large) |
| Delete-scope modal |
| Focus stats card |
| **Laptop / desktop layout (≥1024px)** |
| Goal day-tracker progress bar |
| Fitness × Sleep insight card |
| Responsive improvements — tablet + desktop widths |
| Desktop content-screen layout |
| Small phones (≤380px) |
| WhatsApp reminders |
| Profile Settings modal |
| WhatsApp OTP verification |
| **Family tab & AI meal planner** (+ polish at 6119) |
| Streak freeze / protection |
| Report — trends drill-down |
| Achievements gallery |
| Goal milestones / sub-tasks |
| Offline-first PWA — connectivity banner |
| Accessibility — skip link, focus-visible, reduced motion |
| Bottom nav — "More" overflow sheet |
| Settings — Home screen customizer |
| Settings — Display (text size preview) |
| Notes — composer, editor (photos: develop-in animation, drop zone, picked ring), cards with a photo cover |

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
