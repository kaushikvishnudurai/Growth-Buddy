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
| Bottom nav — incl. the shell's signature: the active tab's sprout (`.gb-nav-tab.is-active::before/::after`, the logo's coral + sun leaves above the icon; grows only on `.is-sprouting`; `--sprout-lift` places it, the landscape rail overrides it; hidden on premium's floating pill) and `.gb-nav-brand` (the sidebar wordmark, ≥1024px only) |
| Habit / task check |
| Login |
| Notification bell — incl. the header links (`.gb-notif-link`: Mark all read / Clear read), filter chips (`.gb-notif-chips`, `.gb-notif-chip.is-on`) and `.gb-notif-more` (Load older) |
| Mentor chat — incl. the boot skeleton (`.gb-msg-skel`, two-class selectors so they beat `.gb-skel-line`). On desktop `.gb-mentor` needs `width: 100%` beside its `max-width`: it is a flex item in a column container, and auto inline margins opt an item out of stretch, so the screen collapsed to fit-content (392px at 1512px wide) |
| Search modal (Find someone) |
| Circle (person rows + status pills) |
| Focus screen |
| Feature on/off rows |
| Settings: Account pane |
| Settings: your own notification sounds (`.gb-sounds`, rows, the recording panel) |
| Settings: Reminders (`.gb-remset-*`: the lead/snooze pickers, quick add, the list), the toast's action button (`.gb-toast-action`), the bell card's Snooze (`.gb-notif-snooze`) |
| Dropdowns: every `select.gb-input` — one line, ellipsised; under `@supports (appearance: base-select)` (current Chrome / Android WebView) the open list is the app's own popover (`::picker(select)`, tinted `option:checked`, `::checkmark`), elsewhere the native list. Then the six-tab `.gb-segnav` tightening under 420px. Last in the file |
| Loading splash (quote of the day) |
| Report screen |
| Insights |
| Circle screen: blocks, the seat ring (`.gb-seat-ring`, `.gb-seat.is-lit/.is-ash/.is-private/.is-me/.is-cheered`, sized in container units), the nudge line, challenges + the quiet board, the empty ring, and the ≥760px two-column card |
| Mentor prompt chips |
| Color picker (habit customize) |
| List rows |
| Dashboard blocks — one `.gb-dash-block` list; ≥1024px flows it into two columns (`.gb-dash--single`) |
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
| **Family tab & AI meal planner** — includes the day rail (`.gb-family-rail`, `.gb-family-stop`) and a `pointer: coarse` 44px block that must stay LAST in the section (same-specificity rules it raises sit above it) |
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
| Notes: the page (inside the Notes views block: margin rule on cards, opener and editor, reading measure, headline title, 660px sheet) |
| Goals: the trail (after the milestone edit row: numbered stops on one path, Next stop, mono counts, horizon reach line) |
| Health screen (`.gb-health-*`: header row, the "Last night" band (`.gb-health-track`, `.gb-health-lastbar.is-growing`, `.gb-health-night` fading by `--age`), tile grids with SVG traces (`.gb-health-trace`), the history sheet (`.gb-health-sheet`, chart axes, rows) and the log form (`.gb-health-valrow`); a `pointer: coarse` block that must stay LAST in the section), then the habit form's `.gb-habit-link-target` — last in the file |

## Editing rules

- Form controls get the page font from one reset at the top (`button, input, select, textarea
  { font: inherit }`). Don't add `font: inherit` / `font-family: inherit` per class; the three left
  (`.gb-rem-notes-input`, `.gb-rem-defaults-link`, plus `.gb-circle-presets .gb-chip`) override a
  sibling class's size or weight and say so.
- Dim a "locked" / "other month" / "muted" thing by fading its icon or bar, never by `opacity` on
  text: fg3 is already the 4.5:1 floor, and opacity took it to 2.5-3:1.
- Text fields keep the global `:focus-visible` ring; `.gb-input:focus` only moves the border to
  `--ring`. Don't add `outline: none` to a field.
- Desktop (>=1024px): every screen's content starts under the header title (the header's 40px
  inset); wide screens get a wider `max-width`, never `margin: 0 auto`. The fallback width rule
  (`:where(.gb-scroll) > :where(.gb-rise...)`) pads with `--gutter` and sits at `40px - --gutter`.
  Mentor is the one centred column.
- Toasts enter (`gb-toast-in`) and leave (`.is-leaving`, `gb-toast-out`, held by `dismissToast`
  for `TOAST_OUT_MS`) on both skins; premium.css only adds the cascade delays.
- Colors come from tokens (`var(--coral-500)`, `var(--leaf-50)`, …) — no raw hex here.
- Responsive breakpoints are grouped under the "Laptop / desktop layout", "Responsive improvements"
  and "Small phones" banners, **not** inline per component. Put media queries there so the
  phone-first base stays readable.
- Focus rings come from one global `:focus-visible` rule (Accessibility banner: `2px solid var(--ring)`,
  offset 2px) on buttons, links, inputs, `[role=switch|checkbox]` and `[tabindex]`. Don't restate it per
  component; write one only to change the offset/shape, or for an element the list misses (`summary`).
- Fixed/sticky layers use the `--z-*` scale from `tokens.css`; only local 1/2/-1 stacking is a bare number.
- Modal markup comes from `openOverlay` in `gb-kit.js` — don't hand-roll it. It is `.gb-modal-overlay > .gb-modal[role=dialog]` because `scripts/a11y.js`
  keys off it for focus trapping. Don't restyle it into a different structure.
- Every `:hover` rule sits inside `@media (hover: hover)` (nested inside another `@media` where it
  has one): touch screens keep `:hover` after a tap, so a pressed button stayed in its hover colour.
  Split a mixed selector list (`:active, :hover`) rather than wrap the `:active` half too. Every
  `.gb-btn` gets a `scale(0.97)` press; small controls share one `scale(0.96)` rule (grep `.gb-seg:active`).
- A panel or editor that scrolls on its own sets `overscroll-behavior: contain` (`.gb-modal`,
  `.gb-modal-body`, `.gb-notif-pop`, `.gb-editor`), or reaching its end scrolls the page behind.
- A control drawn under 44px joins the "Tap targets" `::before` overlay list (grep the banner;
  `.gb-rem-check` draws its circle with `::before`, so its 44px is an `::after` with `inset: -6px`)
  rather than growing. Skip any control that already has a `::before` of its own. An overlay is
  clipped by the control's own `overflow: hidden` (why `.gb-msg-chip` has no ellipsis), and two
  controls stacked closer than 44px need their overlays split, not centred (`.gb-home-cust-move`);
  side by side, the overlay is the column pitch instead (`.gb-habit-move`, `.gb-goal-ms-tools`).
  The heatmap's editable days (`.gb-hh-day.is-editable`) use the pitch overlay too, plus less panel
  padding at ≤380px, to clear WCAG 2.5.8's 24px from 360px up. Its day popover (`.gb-hh-pop`) sits
  inline under the grid, not floating, so it scrolls with the dialog; recent notes are `.gb-hh-notes`.
  A quit habit's days are `.is-clean` / `.is-slipped`, and its row's tick is `.gb-slip-btn` (44px).
- Fixed layers on a phone pad for `env(safe-area-inset-*)` (`index.html` has `viewport-fit=cover`,
  so `100dvh` runs under the notch and home indicator): header, nav, modal overlay, toasts, PTR.
- The tablet phone-frame (both rules) also needs `min-height: 560px`: a landscape phone stays full-screen.
- A landscape phone (`orientation: landscape` and `max-height: 500px`, under 1024 wide) turns `.gb-app` into a grid with the nav as a 60px icon rail on the left and the More sheet as a panel beside it; content gets ~85% of the height instead of 71%.
- The tablet phone-frame widens 440 -> 600px at 560px, the lowest viewport breakpoint any grid
  goes two-up at. A new `min-width` grid rule below 560 would split a 440px frame.
