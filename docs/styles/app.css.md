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
| Dropdowns: every `select.gb-input` — one line, ellipsised; under `@supports (appearance: base-select)` (current Chrome / Android WebView) the open list is the app's own popover (`::picker(select)`, tinted `option:checked`, `::checkmark`), elsewhere the native list. Then the six-tab `.gb-segnav` tightening under 420px (the bar itself, in the Profile Settings section, scrolls sideways once the labels no longer fit: 320px, or Largest text at 390). Last in the file |
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
| **Laptop / desktop layout (≥1024px)** — the sidebar `.gb-nav` scrolls (`overflow-y: auto`) when a short window can't fit its twelve tabs; `.gb-head` caps its row at 1180px, centred |
| Goal day-tracker progress bar |
| Fitness × Sleep insight card |
| Responsive improvements — tablet + desktop widths |
| Desktop content-screen layout — the `.gb-rise` fallback (900px) is centred like every capped screen, so content holds one centre line across tabs |
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
| Health screen (`.gb-health` caps at 1080px and centres, like every capped screen, so the 3840 centre line holds; `.gb-health-*`: header row, the "Last night" night columns (`.gb-sleep-chart`, `.gb-sleep-usual` window band, `.gb-sleep-col.is-last`, 7 under 560px), tile grids with SVG traces (`.gb-health-trace`), the history sheet (`.gb-health-sheet`, chart axes, rows) and the log form (`.gb-health-valrow`); a `pointer: coarse` block that must stay LAST in the section), then the habit form's `.gb-habit-link-target` — last in the file |

## Editing rules

- Colors come from tokens — no raw hex here. A tinted surface uses a themed `-soft` / `-soft-fg`
  pair (or `color-mix(in srgb, var(--<semantic>) N%, var(--surface))`), not a raw `-50`/`-100`
  ramp step: ramps don't change with the theme, and `contrast.test.mjs` fails one with no
  `[data-theme='dark']` twin. Content dims by colour (`--fg3`), never `opacity` (that took locked
  badges, settled loans and failed messages to 2-3.9:1).
- Focus rings come from one global `:focus-visible` rule (Accessibility banner: `2px solid var(--ring)`,
  offset 2px) on buttons, links, inputs, `[role=switch|checkbox]` and `[tabindex]`. Don't restate it per
  component; write one only to change the offset/shape, or for an element the list misses (`summary`).
- Focus: `--ring`, never `--brand` (2.8:1). Text fields (`.gb-input`, `.gb-msg-input`, `.gb-affix`,
  the OTP box, an open select) show it as a `--ring` border plus a 35% `--ring` halo; the note
  editor shows it on `.gb-editor-wrap:focus-within`. A control's resting edge (field border,
  unchecked `.gb-check` / `.gb-goal-ms-check` / `.gb-rem-check`, off `.gb-switch` / `.gb-wa-toggle`
  track hairline) is `--control-edge`. `.gb-wa-toggle` shares `.gb-switch`'s geometry and timing.
- `.gb-btn--icon` is the transparent 44px variant; inside the list rows (`.gb-food-item-row`,
  `.gb-water-log-row`, `.gb-sound-row`) it is the filled 36px chip. That block used to be bare
  and overrode the base everywhere. Nothing renders under `--text-2xs` (11px).
- Responsive breakpoints are grouped under the "Laptop / desktop layout", "Responsive improvements"
  and "Small phones" banners, **not** inline per component. Put media queries there so the
  phone-first base stays readable.
- One switch: `.gb-switch` + `.gb-switch-knob` (`role="switch"`, `aria-checked`). WhatsApp's is the
  same switch with `.is-wa` (green when on). One compact pill segmented: `.gb-range-toggle` +
  `.gb-range-opt.is-active` (Report's ranges, Calendar's Day/Week via `.gb-sched-tabs`, which only
  places it). Don't add a third of either.
- Settings section rhythm is CSS only: `.gb-settings-sec-label` has `margin-top: var(--space-5)`
  (0 as a pane's first child) and the hint under a section label gets `--space-3` below it. No
  inline `marginTop` / `marginBottom` on either in `app.js`.
- Fixed/sticky layers use the `--z-*` scale and dims the `--scrim*` tokens (`tokens.css.md`); only local 1/2/-1 stacking is a bare number.
- A screen component sized by the width it has uses `@container gb-main (max-width: N rem)`, not a
  viewport query: `#gb-main` is the size container, so the 440/600px tablet frame counts, and rem
  thresholds follow Settings > Display text size (media queries ignore it). Only for things inside
  `#gb-main`; the header, nav, toasts and every overlay sit outside it and keep media queries. Nothing
  `position: fixed` may live inside `#gb-main` (its layout containment would anchor it there).
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
  controls stacked closer than 44px need their overlays split, not centred (`.gb-home-cust-move`);
  side by side, the overlay is the column pitch instead (`.gb-habit-move`, `.gb-goal-ms-tools`).
  The heatmap's editable days (`.gb-hh-day.is-editable`) use the pitch overlay too, plus less panel
  padding at ≤380px, to clear WCAG 2.5.8's 24px from 360px up. Its day popover (`.gb-hh-pop`) sits
  inline under the grid, not floating, so it scrolls with the dialog; recent notes are `.gb-hh-notes`.
  A quit habit's days are `.is-clean` / `.is-slipped`, and its row's tick is `.gb-slip-btn` (44px).
- Fixed layers on a phone pad for `env(safe-area-inset-*)` (`index.html` has `viewport-fit=cover`,
  so `100dvh` runs under the notch and home indicator): header, nav, modal overlay, toasts, PTR.
- Home on desktop is a CSS column flow (`.gb-dash--single`, `column-width: 440px`); `.gb-dash-qa` and `.gb-dash-pin` (Quick add, the one-thing card) are `column-span: all` so they read first. Once laid out, dashboard.js `balanceHome` deals the widgets into `.gb-dash-cols > .gb-dash-col` (as many as CSS made, each block to the shortest): source-order columns can't balance unbreakable blocks. Below 1024px `.gb-dash-cols` is `display: contents`. The habit strip there is an `auto-fill` grid (`minmax(132px, 1fr)`: three a row in a 1280px column). A lone `.gb-wellness-grid` tile spans the row. `.gb-food-screen` caps at `min(1100px, 100% - 80px)` so it keeps a right gutter. A landscape phone tightens Quick add (one row, no hint) and the week-review nudge.
- The tablet phone-frame (both rules) also needs `min-height: 560px`: a landscape phone stays full-screen. Its height is fixed (`min(900px, 100dvh - margins)`), not `auto`: sized to content, the frame and its nav jumped on every tab switch.
- A landscape phone (`orientation: landscape` and `max-height: 500px`, under 1024 wide) turns `.gb-app` into a grid with the nav as a 60px icon rail on the left and the More sheet as a panel beside it; content gets ~85% of the height instead of 71% (QA-09). The header, `#gb-main` and toasts pad for `env(safe-area-inset-right)` there, the More panel for the bottom inset. The premium half of the rail rule is `html[data-premium='on'] .gb-nav-wrap > .gb-nav`, one class heavier than premium.css's floating pill (which loads last and matches too). The same block drops the toast stack to the bottom (no nav to clear) and scales the food loader's art to 0.6.
- The phone frame centres the toast stack on the frame, above its nav. In portrait the More sheet caps at `100dvh - 120px` and scrolls. `.gb-modal.gb-search-modal` / `.gb-modal.gb-note-modal` carry `.gb-modal` so the later desktop `.gb-modal { max-width: 480px }` can't win (search 520; the note editor is main's 660 from 720 up, ~65 characters a line, one rule).
- Every phone-layout `max-width` is `1023.98px`, never `1023px`: fractional widths (zoom, display scaling) fell between the two. The header tightens at <=360 (smaller icon buttons and avatar) but the nav drops its tab labels only at <=359, in a second block: a 360px Galaxy fits five labelled tabs. The <=360 avatar shrink is scoped to `.gb-head-actions`: `Avatar()` sizes itself inline and `!important` beat every other avatar.
- The tablet phone-frame widens 440 -> 600px at 560px, the lowest viewport breakpoint any grid
  goes two-up at. A new `min-width` grid rule below 560 would split a 440px frame.
