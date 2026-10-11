# UI / design audit (UID)

Build 92, branch overhaul/2026-10-11. Seeded account (e2e/seed.mjs), Playwright over CDP (localhost:9591).

Coverage: 15 screens (home, habits, food, health, goals, calendar, notes, money, report, focus, circle,
family, mentor, achievements, summary) plus 10 dialogs/panels (quick add, log food, new goal, add expense,
find someone, note editor, edit reminder, edit habit, settings, notification panel), each at 390x844 and
1440x900, light and dark, premium skin on and off: 279 screenshots in `docs/evidence/audit-ui-design/`,
named `<screen>-<width>-<theme>-<premium>.jpg` (`-b` = scrolled one screen down; `dlg-<name>-...` = dialog).
Theme and skin were set the way the app sets them (the `gb.theme` / `gb.premium` cookies), and every shot
was checked afterwards for the right `data-theme` / `data-premium`. Each frame was also probed for
horizontal overflow, the font families actually rendered, and text under 4.5:1 (3:1 for large text)
against its composited background.

Clean: no horizontal overflow, no console error or 4xx/5xx in any of the 8 combinations.
`node scripts/tokens.test.mjs` passes (3352 var() refs, none missing, no raw hex outside the allowlist).
`node scripts/contrast.test.mjs` passes (60 token pairs, both themes). Every finding below is outside what
those two tests can see.

Test-environment note (not an app bug): the shared headless Chrome's `prefers-color-scheme` changes under
other sessions, and the app follows it live (`followSystemTheme`) until a theme is picked. A first run
without the `gb.theme` cookie produced light-mode shots that were dark. Screenshot scripts on this stack
should set the cookie, not rely on `colorScheme` emulation.

### UID-1: Edit habit dialog prints "null" twice in its history panel
- Severity: High
- Where: scripts/app.js:habitHistoryPanel (paint); Habits > Edit habit, every viewport and theme
- Repro / evidence: Habits, tap the pencil on "Morning run". The history block shows the literal text
  `null` under the grid and again under the hint line. `docs/evidence/audit-ui-design/crop-edit-habit-null.jpg`,
  `dlg-edit-habit-390-light-off.jpg`, `dlg-edit-habit-390-dark-off.jpg`, `dlg-edit-habit-1440-dark-on.jpg`.
- Cause: `panel.replaceChildren(..., openState ? dayPopover(...) : null, ..., notes.length ? h(...) : null)`.
  DOM `replaceChildren` / `append` stringify `null` into a text node (unlike `h()`, which drops it). Both
  conditionals are null in the common case (no day open, no notes). Same pattern in
  scripts/calendar.js:toneSelect (`addCustomTone ? h('option', ...) : null` inside `sel.replaceChildren`),
  where the stray text sits inside a `<select>` and is not painted, but still lands in `textContent`.
- Fix: filter the arguments, e.g. `panel.replaceChildren(...[a, b, c].filter(Boolean))`, in both
  scripts/app.js:habitHistoryPanel and scripts/calendar.js:toneSelect.

### UID-2: Priority, horizon and tag pills stay light pastel in dark mode (and Medium is 3.5:1 in both)
- Severity: High
- Where: scripts/dashboard.js:PRIORITY, scripts/goals.js (horizon pills), scripts/calendar.js (tag
  palette), scripts/money-core.js (category palette), scripts/gb-kit.js (icon chip tones); Home, Goals,
  Calendar, Money, dark mode
- Repro / evidence: dark mode, Home > Today's tasks: "High" and "Medium" are bright cream pills on the dark
  card, "Low" next to them is dark (it uses `--surface-3`, which is themed). Goals "Short term" and the
  Calendar "Personal" tag do the same. `crop-priority-pills-dark.jpg`, `home-390-dark-off-b.jpg`,
  `goals-390-dark-off.jpg`, `dlg-edit-reminder-390-dark-off.jpg`. Computed in dark: High
  bg rgb(255,244,235) / fg rgb(190,74,10); Medium bg rgb(255,247,224) / fg rgb(185,117,5) = 3.5:1 (fails
  4.5:1 at 12.5px, in light mode too); Short term bg rgb(233,251,240); Personal bg rgb(238,235,255).
- Cause: 38 inline styles in JS name raw ramp steps (`var(--sun-50)`, `var(--coral-50)`, `var(--leaf-50)`,
  `var(--iris-50)` ... with `-700` text). Ramps are primitives and have no dark twin, so the pill keeps its
  light-mode colours. `tokens.css` already says why sun-700 fails (`--warning-soft-fg` comment: "sun-700 is
  3.7:1 on white"), and contrast.test.mjs only checks token pairs, not these JS pairs.
- Fix: map the JS palettes to the themed semantic pairs: `--warning-soft` / `--warning-soft-fg` (Medium,
  mid-term, sun tags), `--brand-soft` / `--brand-soft-fg` (High, coral), `--success-soft` /
  `--success-soft-fg` (leaf), `--ai-soft` / `--ai-soft-fg` or `--info-soft` (iris/sky). Where a hue has no
  semantic pair, add `-soft`/`-soft-fg` tokens in both theme blocks of styles/tokens.css. Files:
  scripts/dashboard.js, goals.js, calendar.js, money-core.js, money.js, gb-kit.js, app.js. Optionally extend
  contrast.test.mjs to scan `bg:`/`fg:` pairs in those palette objects.

### UID-3: Many buttons render in Arial instead of Hanken Grotesk
- Severity: Medium
- Where: styles/app.css (no global form-control font reset); Home wellness tiles, Home mini calendar days,
  Home timeline rows, Home money widget head, Report range selector (7 days / 30 days / 90 days / 1 year
  and Score / Mood / Habits), plus every icon button, at all widths
- Repro / evidence: computed `font-family` is `Arial` on `button.gb-wellness-tile` ("Sleep 7.5h Good",
  "Mood Good High Energy"), `button.gb-range-opt`, `button.gb-mini-cal-day`, `button.gb-timeline-row`,
  `button.gb-money-mini-head`, `input.gb-range`. `crop-wellness-arial.jpg`, `home-390-light-off.jpg`,
  `report-390-light-off.jpg`. The probe found Arial text on 44 of 208 frames (home, report, quick add,
  settings, bell).
- Cause: browsers do not inherit `font-family` into `button`/`input`/`select`/`textarea`. The CSS patches
  it per component (43 local `font: inherit` / `font-family: inherit`, one with the comment "it rendered in
  Arial"), so every new button class starts in Arial.
- Fix: one rule near the top of styles/app.css: `button, input, select, textarea { font-family: inherit; }`
  (family only, so components keep their own sizes), then delete the local `font-family: inherit` copies.

### UID-4: Toasts snap in on the classic skin, and vanish without an exit on both skins
- Severity: Medium
- Where: styles/app.css `.gb-toast`; styles/premium.css `gb-toast-in`; scripts/app.js:toastStack,
  dismissToast
- Repro / evidence: the only toast entrance is `html[data-premium='on'] .gb-toast:not(.is-settled)`
  (premium.css). app.css has no animation or transition on `.gb-toast`, so with premium off (the default)
  a toast appears in one frame. On dismiss or timeout, `dismissToast` filters it out of `state.toasts` and
  the next render() drops the node: no fade on either skin, and the stack below jumps.
- Cause: the entrance was written as part of the premium skin; the age-driven `is-settled` machinery in
  toastStack exists for both skins but only premium uses it.
- Fix: move `gb-toast-in` (and its reduced-motion fade) from premium.css into app.css unscoped, keeping
  premium's cascade delays. For the exit, give dismissed toasts a short `is-leaving` state (e.g. keep the
  entry 160ms with an `is-leaving` class that fades and collapses) before removing it in dismissToast.

### UID-5: Desktop screens use five different content insets and widths
- Severity: Medium
- Where: styles/app.css "Desktop content-screen layout" / "Laptop / desktop layout (>=1024px)"; 1440x900
- Repro / evidence: `#gb-main` spans x=248..1440 and the header title starts at x=288 (40px inset) on every
  screen. Content's left/right edge per screen: Home 288/1400, Calendar 294/1394, Summary 274/1414,
  Health 268/1308, Food and Achievements 288/1188, Habits/Money/Report/Focus/Circle/Family 308/1168
  (left-aligned, 272px empty on the right), Goals and Notes 414/1274 (centred, 166px each side).
  So on Report the cards start 20px right of the title, on Health 20px left of it, and on Goals 126px right.
  `report-1440-light-off.jpg`, `goals-1440-light-off.jpg`, `notes-1440-light-off.jpg`,
  `health-1440-light-off.jpg`, `home-1440-light-off.jpg`.
- Cause: per-screen `max-width` + `margin` rules (`.gb-goals { max-width: 940px; margin: 0 auto; padding:
  28px 40px }`, `.gb-mentor { max-width: 800px; margin: 0 auto }`, others left-aligned with their own
  padding) instead of one content column.
- Fix: one desktop rule for the screen wrapper (same `--gutter`-derived inset as the header, one max-width,
  one alignment: left-aligned to the title is the smaller change), and drop the per-screen margin/padding
  overrides in the desktop sections of styles/app.css. Wide screens (Home, Calendar) can opt into a wider
  max-width but should keep the same left edge.

### UID-6: Ticking a task reorders the list in one frame
- Severity: Low
- Where: scripts/dashboard.js (Today's tasks), render() rebuild; Home, all viewports
- Repro / evidence: Home, tick "Renew passport" (second row). 60ms later it is already the last row, struck
  through, and "Plan this week" has jumped up into its place with no movement in between.
  `anim-tick-before-after-60ms.jpg` (left: before, right: 60ms after the tap).
- Cause: render() rebuilds the tree; finished tasks sort to the bottom, and no row has an enter/exit or
  position transition (no FLIP, no View Transition on this path).
- Fix: on the check handler only, wrap the state change + render in `document.startViewTransition` (already
  used by togglePremium in scripts/app.js) with a `view-transition-name` per task row, or delay the re-sort
  ~300ms so the check animation plays in place first. Keep it off under reduced motion.

### UID-7: Orange text drawn with --brand-fill / --brand instead of --brand-ink
- Severity: Low
- Where: styles/app.css `.gb-sched-tab.is-on` and `.gb-sched-stat.is-busy` (`color: var(--brand-fill)`),
  `.gb-circle-cheer.is-sent` and `.gb-note-card.has-cover .gb-note-pin.is-on` (`color: var(--brand)`)
- Repro / evidence: dark mode, Calendar, the selected "Day" tab label measures 3.41:1 (12px). Token doc:
  `--brand` is 2.8:1 and "never carries text"; `--brand-fill` is a surface colour under white text.
  `calendar-390-dark-off.jpg`.
- Fix: `color: var(--brand-ink)` in those four rules (styles/app.css).

### UID-8: Dimming by opacity drops secondary text under 4.5:1
- Severity: Low
- Where: styles/app.css `.gb-ach-tile.is-locked { opacity: 0.72 }`, Focus sound tiles (opacity 0.74),
  calendar and mini-calendar out-of-month day numbers (opacity 0.72-0.75)
- Repro / evidence: probe ratios: Achievements locked tile description / tier / "0 / 10" 2.87:1 light,
  3.21:1 dark (12px); Focus "Brown noise" label 2.5:1 dark, sound hint 2.98:1 light; Calendar out-of-month
  numbers 2.87:1; Home mini calendar 3.03:1. `achievements-390-light-off.jpg`, `focus-390-dark-off.jpg`,
  `calendar-390-light-off.jpg`.
- Cause: `opacity` multiplies already-secondary `--fg3` text.
- Fix: dim the decoration (icon, progress bar, border) with opacity, and set the text to `--fg3` at full
  opacity; for out-of-month days use `--fg3` without opacity. styles/app.css.

### UID-9: Raw rgba() colours bypass the token system
- Severity: Low
- Where: styles/premium.css (shadows `rgba(38,24,16,..)`, glows `rgba(249,115,22,..)` / `rgba(108,92,231,..)`
  / `rgba(255,176,32,..)`, dark backgrounds `#1B1410`, `#17110D`), styles/app.css (water card
  `rgba(17,132,224,..)` x5, `#0f2734`, `#d3f2ff`, `#c6d9e3`, `#d8ecff`, `#7db9df`; three different scrims:
  `.gb-modal-overlay` `color-mix(--warm-900 45%)`, `.gb-more-backdrop` `rgba(20,16,13,0.32)`,
  `.gb-celebrate` `rgba(20,16,13,0.5)`)
- Repro / evidence: `grep -nE "rgba?\(" styles/*.css` outside tokens.css: 79 hits, about 50 not plain
  black/white. tokens.test.mjs only scans `#hex`, and exempts rules under `[data-theme='dark']`, so these
  pass.
- Cause: colour-mix of brand hues written as literal rgb instead of `color-mix(in srgb, var(--coral-500)
  16%, transparent)`.
- Fix: rewrite as `color-mix()` over the ramp tokens; add a `--scrim` token (both themes) and use it on the
  three backdrops; optionally extend tokens.test.mjs to flag `rgba(` with non-0/255 channels.

### UID-10: Type and radius values off the token scale
- Severity: Low
- Where: styles/app.css, styles/money.css
- Repro / evidence: 48 distinct `font-size` values. The scale is 11/12/14/16/18/22/28/36px
  (`--text-2xs`..`--text-h1`), but the most used size, 0.8125rem (13px, 89 uses), is not on it, and there
  are half-pixel sizes: 0.78125rem (12.5px, 19), 0.84375rem (13.5px, 17), 0.90625rem (14.5px, 6),
  0.71875rem (11.5px, 6), 0.65625rem (10.5px, 3), 0.96875rem (15.5px, 2), plus 0.625rem (10px, 6). Radius:
  `--radius-*` is 8/12/16/22/28/36, yet literals 14px (5: `.gb-msg-crisis`, `.gb-chat-bubble`,
  `.gb-freeze-alert`, `.gb-ach-tile`, `.gb-card` at <=380px), 10px (4), 9px (3: `.gb-segnav-thumb/-btn`,
  `.gb-bell-badge`), 24px (2), 6px (3) and `999px`/`99px` beside `--radius-pill` (41). `.gb-modal` also
  switches to `border-radius: 18px` at <=380px.
- Fix: add `--text-13` (or redefine `--text-sm` usage) and fold the half-pixel sizes into the nearest
  step; replace literal radii with the nearest `--radius-*` (14 -> lg, 10/9 -> md or sm, 24 -> xl,
  999px -> pill). Mechanical sed in styles/app.css and styles/money.css; re-run ui-audit for regressions.

### UID-11: A new habit's history block is about 200px of empty space
- Severity: Low
- Where: scripts/app.js:habitHistoryPanel; styles/app.css `.gb-hh-day.is-before { background: transparent }`
- Repro / evidence: Edit habit on a habit created today: 12 weeks of "before this habit started" cells
  are transparent and borderless, so the grid reads as a blank box with one green square at the bottom
  right. `crop-edit-habit-null.jpg`.
- Fix: show only the weeks since the habit started (min 1 week) in `heatmapWeeks`, or give `is-before`
  cells a faint dotted border so the grid shape stays legible.

## Checked and fine
- Dialogs (all 10, every combination): animate in (`transform var(--dur-base) var(--ease-bounce)` +
  overlay fade), carry `--shadow-xl`, scroll inside, fit at 390x844 and 1440x900; 380px phone /
  480px desktop width is consistent.
- Dark mode on the token-driven surfaces (cards, inputs, nav, header, segmented controls, charts) is
  coherent; no dark-on-dark text found apart from UID-2/7/8.
- Premium skin: same layout as classic in all 15 screens at both widths, no overflow; glass nav and
  header logo are consistent across screens.
- Fonts: only Bricolage Grotesque, Hanken Grotesk, Space Mono, plus the Arial leak in UID-3; counts are in
  Space Mono across Home, Report, Health, Money, Achievements, Summary.
- Per-screen signatures (score ring, seat ring, day rail, bank slip, 60-tick dial, jug ticks) are each
  used once.
