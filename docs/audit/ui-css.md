# UI / CSS consistency audit (build 88, branch feat/overhaul)

Static read of `styles/*.css`, `index.html` and the JS that builds the markup. No browser was run.
`node scripts/tokens.test.mjs` and `node scripts/contrast.test.mjs` both pass. They check token
definitions and token pairs. They do not check a component that mixes a raw ramp step into its
own background, which is where most of the problems below are. Contrast figures were computed from
the token hex values (WCAG relative luminance, translucent mixes composited over `--surface`).

Severity: 4 High, 9 Medium, 11 Low.

## Findings

### UI-01 Reminder ("info") toast is unreadable in dark mode
- **Severity:** High. **Effort:** S
- **Where:** `styles/app.css` `.gb-toast.is-info`
- **Failure:** background is `color-mix(var(--sky-50) 64%, var(--surface) 36%)`. Ramp steps are not
  re-themed, so in dark mode that is a pale blue tile under `--fg1` (#FBF4EE) text: **2.3:1**. Every
  "reminder is due" toast in dark mode. `.is-success` and `.is-error` have `[data-theme='dark']`
  overrides; `.is-info` was missed.
- **Fix:** add `[data-theme='dark'] .gb-toast.is-info { background: color-mix(in srgb, var(--sky-500) 18%, var(--surface) 82%); }`, the same pattern as `.is-success`.

### UI-02 Food total chip is invisible in dark mode
- **Severity:** High. **Effort:** S
- **Where:** `styles/app.css` `.gb-food-total`
- **Failure:** `background: color-mix(var(--sky-100) 80%, white 20%)` stays light in dark mode while
  `color: var(--info-soft-fg)` flips to `--sky-300`: light blue on near-white, **1.5:1**. The
  day's calorie total in Log food can't be read.
- **Fix:** `background: var(--info-soft);`. It is already themed and is the pair `--info-soft-fg` was tested against.

### UI-03 Snoozed-reminder chips unreadable in dark mode
- **Severity:** High. **Effort:** S
- **Where:** `styles/app.css` `.gb-remset-snoozed`, `.gb-rem-snoozed--btn`
- **Failure:** `background: color-mix(var(--sky-50) 70%, transparent)` gives a pale tile in dark mode
  under `--fg1` / `--fg2` text: **2.0:1** and about 1.4:1. These are the "Snoozed until..." chips in
  Settings > Reminders and on reminder rows.
- **Fix:** swap both to `background: var(--info-soft); color: var(--info-soft-fg);`.

### UI-04 Premium skin's primary button fails text contrast
- **Severity:** High. **Effort:** S
- **Where:** `styles/premium.css` `html[data-premium='on'] .gb-btn--primary`
- **Failure:** the face is `linear-gradient(var(--coral-400), var(--coral-600))` under white
  `--fg-on-brand`: **2.3:1** at the top, 2.8:1 mid (where the label sits), 3.6:1 at the bottom. The
  classic skin moved to `--brand-fill` (coral-700, 5.0:1) for exactly this reason (tokens.css.md).
  Every primary CTA in premium, in both themes, is affected.
- **Fix:** shift the gradient down the ramp: `linear-gradient(180deg, var(--coral-600), var(--coral-800))`
  (or `--brand-fill` to `--brand-fill-hover`), and add the pair to `contrast.test.mjs`.

### UI-05 Premium skin on a landscape phone undoes the icon rail
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/app.css` landscape block (`@media (orientation: landscape) and (max-height: 500px)`),
  selector `.gb-nav, html[data-premium='on'] .gb-nav`, versus `styles/premium.css` section 4
  `@media (max-width: 1023.98px) html[data-premium='on'] .gb-nav`
- **Failure:** both selectors have specificity (0,2,1), both media queries match a landscape phone,
  and `premium.css` loads last (`index.html`). So premium's `margin: 0 10px calc(10px + inset)`,
  `padding: 8px 6px 10px`, `border` shorthand and `border-radius: var(--radius-3xl)` beat the rail's
  `margin: 0`, `padding-left: env(safe-area-inset-left)`, `border-right` and `border-radius: 0`. The
  60px rail becomes a floating 40px-radius pill with gaps around it. Its notch padding is lost, so on
  a phone with a left-side cutout the tab icons sit under the camera.
- **Fix:** move the premium half of that rule into `premium.css` after section 4, inside the same
  landscape media query. Alternatively raise the specificity in app.css (`html[data-premium='on'] .gb-nav-wrap > .gb-nav`).

### UI-06 Text-field focus indicator is nearly invisible
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/app.css` `.gb-input:focus`, `.gb-msg-input:focus`, `.gb-affix:focus-within`;
  `styles/premium.css` `html[data-premium='on'] .gb-input:focus`
- **Failure:** `outline: none` at (0,2,0) beats the global `input:focus-visible` outline at (0,1,1).
  What replaces it is `box-shadow: 0 0 0 3px var(--brand-soft)`, which is coral-50 on `--surface-2`
  (**1.08:1**), plus a `--brand` border (**2.6:1**). Both are under the 3:1 a focus indicator needs.
  A keyboard user can't see which field has focus. `--ring` exists for this.
- **Fix:** make one shared focus rule for the three selectors: `border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 35%, transparent);`.

### UI-07 Switches in the off state are near-invisible
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/app.css` `.gb-switch` (track `--surface-3`), `.gb-wa-toggle` (track `--border`)
- **Failure:** the off-state track against a white card is **1.17:1** (`.gb-switch`) and 1.30:1
  (`.gb-wa-toggle`). In dark mode it is 1.23:1. The white knob on that track is also 1.17:1, so an
  off switch reads as empty space in Settings (water, quiet hours, reflection, feature rows).
- **Fix:** give the off track `background: var(--border-strong)` plus
  `box-shadow: inset 0 0 0 1px var(--fg3)`, or use any token pair at 3:1 or better. Then fold
  `.gb-wa-toggle` into `.gb-switch` (see UI-15).

### UI-08 Hard-coded light ramp surfaces stay light in dark mode
- **Severity:** Medium. **Effort:** M
- **Where:** `styles/app.css`. These selectors have no `[data-theme='dark']` twin: `.gb-kudos.is-on`
  and `.gb-chat-msg.is-mine .gb-chat-bubble` (`--iris-100`), `.gb-freeze-cal .gb-freeze-day.is-missed|is-done|is-frozen`
  (`--coral-100` / `--leaf-100` / `--sky-100`), `.gb-hh-day.is-missed|is-frozen`, `.gb-slip-btn.is-slipped`
  (`--coral-50`), `.gb-goal-progress-done-chip` (`--leaf-50`), and the hovers on `.gb-msg-chip--clear`
  and `.gb-profile-pop-item.is-danger` (`--coral-50`)
- **Failure:** in dark mode your own chat bubbles, active kudos, freeze-calendar days and heatmap
  days show as bright pastel blocks on a dark page. Text stays legible because the ramp is static,
  but it is the brightest thing on screen and doesn't match the rest of the theme.
- **Fix:** swap to the themed semantic pairs (`--ai-soft`/`--ai-soft-fg`,
  `--danger`-tinted `color-mix`, `--success-soft`, `--info-soft`). Extend `tokens.test.mjs` to flag
  `var(--<ramp>-50|100)` used as a `background` outside `tokens.css`.

### UI-09 Slipped-day and missed-day text fails AA in both themes
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/app.css` `.gb-slip-btn.is-slipped` (`--coral-600` on `--coral-50`),
  `.gb-freeze-cal .gb-freeze-day.is-missed` (`--coral-700` on `--coral-100`)
- **Failure:** **3.3:1** and **4.1:1** on 13px bold text. That is the "Slipped" label on a quit
  habit's row and the day numbers of missed days.
- **Fix:** text `var(--coral-800)` on both, or the `-soft` / `-soft-fg` pair once UI-08 lands.

### UI-10 `.gb-btn--icon` is redeclared unscoped, overriding the base variant app-wide
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/app.css`, second `.gb-btn--icon { ... }` block (just after `.gb-input--inline`)
  and its `:hover`
- **Failure:** the base variant (Buttons section) is transparent with a 44px floor. The later global
  redeclaration makes every `.gb-btn--icon` a filled `--surface-3` chip with `min-height: 36px`. The
  tap-target comment says it is "redeclared at 36px in the Log food section", but it isn't scoped.
  Its hover uses an undefined token, `var(--surface-3-hover, rgba(0,0,0,.1))`, so in dark mode the
  hover goes darker and the chip seems to vanish.
- **Fix:** scope the block to the Log food container, or delete it and use a modifier
  (`.gb-btn--icon.is-filled`). Replace the dead token with `color-mix(in srgb, var(--fg1) 8%, var(--surface-3))`.

### UI-11 Premium skin skips goal and note cards
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/premium.css` section 3 styles only `.gb-card` and `.gb-login-card`. `goals.js`
  builds `.gb-goal-card` and `notes.js` builds `.gb-note-card`, neither with `.gb-card`.
- **Failure:** on the lit premium canvas, Goals and Notes show flat opaque cards with classic
  hairlines next to Home's glass cards. `.gb-goal-card` also uses a literal
  `box-shadow: 0 1px 4px rgba(0,0,0,.05)` that disappears entirely in dark mode.
- **Fix:** add both selectors to the premium surface rule. Give `.gb-goal-card` `var(--shadow-sm)`
  (hover `var(--shadow-md)`).

### UI-12 Three icon-button classes; premium makes only one of them round
- **Severity:** Medium. **Effort:** M
- **Where:** `.gb-iconbtn` (42px, header), `.gb-icon-btn` (30px, literal `border-radius: 8px`, 30 JS
  uses), `.gb-btn--icon` (`styles/app.css`); `styles/premium.css` section 5 styles only `.gb-iconbtn`
- **Failure:** in premium, header buttons turn into circular glass while the row-level delete/edit
  buttons stay as 8px squares that don't follow the skin's radius bump (the radius is a literal, not a token).
- **Fix:** keep `.gb-iconbtn` plus a size modifier and retire `.gb-icon-btn`. At minimum, give it
  `border-radius: var(--radius-sm)` and add it to the premium rule.

### UI-13 Sub-11px text on every phone in the Home mini calendar
- **Severity:** Medium. **Effort:** S
- **Where:** `styles/mini-calendar.css` `@media (max-width: 640px)`: `.gb-mini-cal-item-sub`,
  `.gb-mini-cal-pill`, `.gb-mini-cal-total` at 0.625rem (10px), `.gb-mini-cal-day .badge` at
  **0.5625rem (9px)**. In `app.css` there are 10 more selectors at 10 to 10.5px: `.gb-goal-status-chip`,
  `.gb-wa-verified-label`, `.gb-pixels-month`, `.gb-tumbler-col small`, `.gb-katori-in span`,
  `.gb-seat.is-me::after`, `.gb-bell-badge`, `.gb-profile-pop-xp-label`, `.gb-day-pill` (small),
  `.gb-scatter-tick` (literal 10px).
- **Failure:** the smallest token is `--text-2xs` (11px). At 640px and below, which is every phone,
  the reminder subtitles and day totals under Home's calendar render at 10px and the badge count at 9px.
- **Fix:** floor them at `var(--text-2xs)`. Badges keep their size by tightening padding, not the font.

### UI-14 Profile menu "Sign out" is brand orange, not danger red
- **Severity:** Low. **Effort:** S
- **Where:** `styles/app.css` `.gb-profile-pop-item.is-danger` (`var(--coral-600, #e53e3e)`, hover `var(--coral-50, #fff5f5)`)
- **Failure:** the destructive item in the avatar menu is orange, while the same action in Settings
  (`.gb-account-signout.is-danger`) is `--danger` red. The hex fallbacks are dead and contradict the
  tokens (one red, one pink). Hover is a near-white patch in dark mode.
- **Fix:** `color: var(--danger);` with hover `color-mix(in srgb, var(--danger) 10%, var(--surface))`.
  Drop the fallbacks.

### UI-15 Two switch implementations
- **Severity:** Low. **Effort:** S
- **Where:** `.gb-switch` (46px, 20px travel, `--brand-fill` on, `--dur-fast`) versus
  `.gb-wa-toggle` / `.gb-wa-toggle-thumb` (44px, 18px travel, WhatsApp green on, literal `0.18s`,
  literal shadow) in `styles/app.css`. Built by hand 12 times in `app.js`, `goals.js` and `timer.js`;
  gb-kit has no `Switch`.
- **Failure:** the WhatsApp switch in Settings is a different width, colour and speed from the switch
  in the row above it.
- **Fix:** one `Switch({on, label, onToggle})` in gb-kit that emits `.gb-switch`. Use
  `.gb-switch.is-wa` for the green if it is kept.

### UI-16 Premium primary button loses hover and keeps its glow when disabled
- **Severity:** Low. **Effort:** S
- **Where:** `styles/premium.css` `html[data-premium='on'] .gb-btn--primary` and `:active`
- **Failure:** the premium rule (0,2,1) outranks `.gb-btn--primary:hover` (0,2,0), so it gets no
  hover feedback. It also outranks `.gb-btn:disabled { box-shadow: none; transform: none }` (0,2,0),
  so a disabled primary keeps the orange glow and still presses on `:active`.
- **Fix:** add `html[data-premium='on'] .gb-btn--primary:disabled { box-shadow: none; transform: none; }`
  and a hover rule gated on `(hover: hover)` that darkens the gradient.

### UI-17 No z-index scale; stale layer comment; toasts sit under the celebration scrim
- **Severity:** Low. **Effort:** S
- **Where:** the stacking order: `styles/app.css` (20 declarations) and `styles/money.css` (4):
  `-1` (`.gb-btn.is-thinking::after`, money stars glow), `1` (otp field, wa-toggle::before,
  segnav btn, note pin, money tl icon/tape day), `2` (celebrate card), `5` (`.gb-money-tabs`,
  `.gb-family-sectionnav`, `.gb-notes-tools`), `40` `.gb-ptr`, `50` `.gb-notif-pop` /
  `.gb-profile-pop`, `60` `.gb-more-backdrop`, `61` `.gb-more-sheet`, `100` `.gb-modal-overlay`,
  `150` `.gb-food-loader`, `160` `.gb-toast-stack`, `200` `.gb-celebrate`, `2000` `.gb-skip-link`,
  `2100` `body::before/::after`
- **Failure:** toasts above modals and the food loader are correct. But a toast raised while an
  achievement or goal celebration is up (z 200) sits under its blurred scrim, and its Undo can't be
  pressed until the celebration is dismissed. The `body::after` comment says "toasts are 2000"; they are 160.
- **Fix:** add `--z-sticky: 5; --z-header-panel: 50; --z-sheet: 60; --z-modal: 100; --z-loader: 150; --z-celebrate: 200; --z-toast: 300; --z-skip: 2000; --z-top: 2100;`
  to tokens.css and use them. That puts toasts above the celebration. Fix the comment.

### UI-18 Three scrim recipes
- **Severity:** Low. **Effort:** S
- **Where:** `.gb-modal-overlay` (`color-mix(var(--warm-900) 45%)`), `.gb-celebrate`
  (`rgba(20,16,13,.5)` plus a 3px blur), `.gb-more-backdrop` (`rgba(20,16,13,.32)`)
- **Failure:** three different dim levels for "something is over the page". The More sheet barely
  dims, which makes it look like part of the page.
- **Fix:** one `--scrim` token (plus `--scrim-strong` if the celebration needs it) in both theme blocks.

### UI-19 Segmented controls and chips: many parallel implementations
- **Severity:** Low. **Effort:** L
- **Where:** segmented: `.gb-segmented/.gb-seg`, `.gb-segnav`, `.gb-sched-tabs`, `.gb-range-opt`,
  `.gb-nutrient-tabs`, `.gb-money-tabs`. Chips/pills/badges: 35 separate base classes across
  app/money/mini-calendar, including three tag chips (`.gb-tag-pill`, `.gb-tagchip`, `.gb-money-tagchip`)
  and three "done" chips (`.gb-goal-status-chip`, `.gb-goal-progress-done-chip`, `.gb-wa-verified-chip`).
- **Failure:** heights, radii (8px literal, 99px, 999px, `--radius-pill`), font sizes (10 to 13px)
  and active colours differ between tabs that do the same job on different screens.
- **Fix:** collapse the segmented controls onto `.gb-segmented` and the chips onto `.gb-pill` plus
  tone modifiers, a screen at a time. Add a gb-kit `Segmented()`.

### UI-20 Settings section rhythm is set inline, with drift
- **Severity:** Low. **Effort:** S
- **Where:** `scripts/app.js` Settings panes:
  `h('div', { class: 'gb-settings-sec-label', style: { marginTop } })` appears 21 times with
  18px (4), 20px (6) and 22px (11). `gb-field-hint` `marginBottom` appears 21 times with 8, 10, 12 and 14px.
- **Failure:** the gaps between Settings sections visibly differ from pane to pane.
- **Fix:** put `margin-top: var(--space-5)` on `.gb-settings-sec-label` (`:first-child { margin-top: 0 }`)
  and a margin on `.gb-field-hint`, then delete the inline styles.

### UI-21 Toast stack floats mid-screen on a landscape phone
- **Severity:** Low. **Effort:** S
- **Where:** `styles/app.css` `.gb-toast-stack` (`bottom: calc(88px + inset)`). The landscape rail
  block has no toast override.
- **Failure:** with the nav moved to the left rail there is no bottom bar to clear. On a 375px-tall
  viewport the toast sits about a quarter of the way up, over content.
- **Fix:** in the landscape block, `.gb-toast-stack { bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }`.

### UI-22 Literal radii that ignore the premium radius bump
- **Severity:** Low. **Effort:** S
- **Where:** `styles/app.css`: 94 literal radii (excluding `50%` and `inherit`). 17 of them are exact
  token values (`8px` x7, `12px` x7, `16px` x3), and 41 are `999px` / `99px` (for example
  `.gb-settings-level-badge`, `.gb-goal-progress-done-chip`, `.gb-switch`, `.gb-wa-toggle`, `.gb-toast-icon`).
- **Failure:** premium raises every `--radius-*` by 2 to 4px. These elements stay at classic
  corners, so pieces of one component disagree (`.gb-icon-btn` 8px next to `.gb-btn--compact` at `--radius-md`).
- **Fix:** mechanical swap: 8/12/16px to `--radius-sm|md|lg`, 99/999px to `--radius-pill`.

### UI-23 Font sizes almost entirely bypass the type scale
- **Severity:** Low. **Effort:** M
- **Where:** `styles/app.css`: 407 of 455 `font-size` declarations are literals across 25 distinct
  values, against 9 `--text-*` tokens. `styles/mini-calendar.css`: 18 of 18. `money.css` is the model (95 of 99 tokenised).
- **Failure:** off-scale sizes such as 0.84375rem (20 uses), 0.78125rem (19), 0.90625rem,
  0.71875rem and 0.96875rem make adjacent labels a half-pixel apart. A type-scale change can't reach them.
- **Fix:** 202 literals equal a token value exactly, so swap those mechanically first. Then round the
  off-scale values (0.8125rem appears 91 times and earns a `--text-13` token).

### UI-24 Two `:hover` rules not gated on `(hover: hover)`
- **Severity:** Low. **Effort:** S
- **Where:** `styles/app.css` `.gb-insight-dismiss:hover`, `.gb-focus-hist-hit:hover`
- **Failure:** this breaks the file's own rule (app.css.md). After a tap on a phone the control stays
  in its hover colour until something else is tapped.
- **Fix:** wrap each in `@media (hover: hover) { ... }`.

## Token bypass counts

Literal = a raw value where a token exists. Radius excludes `50%` and `inherit`. Spacing is
`padding|margin|gap` lines carrying a non-zero px literal. Hex in app.css includes dead `var()` fallbacks.

| File | font-size literal / total | radius literal / total | box-shadow literal / total | spacing px literal / total | rgba() literals | raw hex | duration literal | z-index |
|---|---|---|---|---|---|---|---|---|
| `app.css` (14,448 lines) | 407 / 455 | 94 / 309 | 63 / 98 | 1142 / 1286 | 26 | 34 | 65 | 20 |
| `mini-calendar.css` | 18 / 18 | 6 / 11 | 1 / 1 | 28 / 29 | 0 | 0 | 1 | 0 |
| `money.css` | 3 / 99 | 3 / 50 | 5 / 7 | 63 / 209 | 1 | 0 | 2 | 4 |
| `premium.css` | 0 / 0 | 1 / 5 | 12 / 12 (skin layers, by design) | 6 / 6 | 59 | 4 | 8 | 0 |

The worst offenders are app.css's spacing (89% literal; `--space-*` is almost unused) and its type
sizes (89% literal). money.css shows the tokenised version is practical.

JS-side bypasses: `app.js` has 118 inline `style: {}` objects (most are spacing, see UI-20).
`Icon(..., { color: '#fff' })` appears 10 times in `family.js`, `mentor.js`, `goals.js` and
`gb-kit.js`; `currentColor` on a `--fg-on-brand` parent would cover them.
