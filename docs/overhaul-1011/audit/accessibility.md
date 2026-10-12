# Accessibility audit (WCAG 2.2 AA), 2026-10-11

Build 92, branch overhaul/2026-10-11. Seeded accounts from `e2e/seed.mjs`. Playwright over CDP (localhost:9591)
against Vite on localhost:5591. Browser timezone was set to UTC so the timezone offer did not cover the screens.

## Method

- **axe-core 4.14** (jsDelivr, injected with `addScriptTag`; nothing added to package.json), tags wcag2a/aa,
  wcag21a/aa, wcag22aa and best-practice. It ran on 15 screens (home, calendar, money, notes, goals, report, focus,
  food, family, circle, health, mentor, habits, achievements, summary). Each screen ran at 1280x800 and at 390x844,
  in light and in dark (60 runs).
  It also ran on 12 dialogs (quick add, log food, custom water, new goal, add expense, custom focus, find people,
  note sheet, edit reminder, settings, Buddy chats, timezone offer), at both widths and in both themes.
  Raw results: `docs/evidence/audit-a11y/axe-screens.json`, `axe-dialogs.json`.
- **Keyboard:** a Tab walk on every screen, which recorded the focus order, the computed focus ring and the position
  of each stop. Also: Enter and Space on custom controls, Escape on every dialog and header panel, focus return after
  a dialog closes, the skip link, and the More sheet on phone.
- **Screen-reader semantics:** `locator.ariaSnapshot()` on 14 screens, the live regions (`#gb-sr-status` and
  `#gb-sr-alert`) after a toast, the login error association, and the form labels in every dialog.
- **Display checks:**
  - 320 px reflow.
  - 200% browser zoom (640x400 CSS px).
  - Root font size at 200% on phone, which is what Android font scale does inside the Capacitor WebView.
  - The Settings "Larger" text size (125%).
  - WCAG 1.4.12 text spacing.
  - `prefers-reduced-motion`.
  - Target size (2.5.8, with the spacing exception computed).
  - Focus not obscured under the sticky header and the bottom nav (2.4.11).

## What passes (no finding)

- **Skip link:** it is the first Tab stop and moves focus to `#gb-main`.
- **Modals** (`scripts/a11y.js`): focus moves in, Tab is trapped, Escape closes every modal tested, and focus returns
  to the trigger, or to its re-rendered replacement. Every dialog has `role=dialog`, `aria-modal=true` and an
  `aria-label`.
- **Focus ring:** every button, link and tab has a visible ring (`--ring`, coral-600 in light and coral-400 in dark).
- **Icon-only buttons:** all are named. axe found no unnamed button, link or field on any screen or dialog.
- **Page titles:** each screen sets its own `<title>` ("Calendar · Growth Buddy").
- **Toasts:** they announce through persistent polite and assertive regions, which `announce()` in app.js keeps out of
  the re-rendered tree.
- **Field errors:** the login error sets `aria-invalid` and `aria-describedby` and moves focus to the field. Dialog
  field errors (`fieldError` in gb-kit.js) do the same.
- **Reflow and zoom:** no horizontal overflow or clipping on any screen at 320 px or at 200% browser zoom.
- **Text spacing:** the 1.4.12 overrides cause only the Circle overflow that A11-2 already covers.
- **Reduced motion:** the global kill switch (`styles/app.css`, `prefers-reduced-motion: reduce`) holds. Under
  emulation there are no animations or transitions longer than 0.02 s.
- **Target size (2.5.8):** no failures. The undersized targets are the goal milestone check (20x20), the milestone
  input (18 px tall), "Set a daily focus goal" (17 px tall) and the freeze chip (22 px tall). All four pass on the
  spacing exception: the nearest target is 22 px or more from their centre.
- **Focus not obscured (2.4.11):** a phone Tab walk on 7 screens found no stop hidden under the header or the nav.

---

### A11-1: The bell and avatar panels empty themselves on any re-render while aria-expanded stays "true"
- Severity: Medium
- Where: app.js `render()` / `repaintOverlays()` / gb-kit.js `Header`. All screens, both viewports.
- Repro / evidence:
  1. On Home, focus the bell and press Enter, then Escape, four times. The panel opens and closes each time.
  2. On the fifth Enter, `aria-expanded="true"` is set but `#gb-notif-slot` is empty and no panel is drawn.
  3. The next Enter "closes" the invisible panel, so the user has to press the key twice to see notifications.
  Logged sequence: `Enter {"pop":false,"slot":0,"exp":"true"}`. Screenshot: `docs/evidence/audit-a11y/bell-expanded-empty.jpg`
  shows the bell in its pressed state with no panel. A screen-reader user hears "expanded" over nothing.
- Cause: `render()` rebuilds the header, and gb-kit `Header` creates `#gb-notif-slot` and `#gb-profile-slot` empty.
  Only `repaintOverlays()` (and `paintOutboxChip` for the profile slot) fills them. `render()` keeps `state.notifOpen`
  and calls `syncHeaderExpanded()`, which writes `aria-expanded="true"`, but it never refills the slots. So any
  background render while a panel is open wipes the panel: a data load, a poll, or a checkAchievements repaint. 4.1.2
  (state does not match what is shown).
- Fix: at the end of `render()` in app.js, fill the two slots the way `repaintOverlays()` does. Pass
  `notificationDropdown()` and `profileDropdown()` into the slots after `root.replaceChildren(app)`. The other option
  is to close both panels (`state.notifOpen = state.profileOpen = false`) when a render is not one the panel asked for.
  One shared helper, `fillHeaderSlots()`, called from both `render()` and `repaintOverlays()`, covers every caller.

### A11-2: At 200% text, phone screens clip controls, overlap tabs and break titles mid-word
- Severity: Medium
- Where: 390x844 with the root font size at 200%. This is the Android system font scale inside the Capacitor
  WebView, and iOS large text. The screens are Calendar, Money, Habits and Circle. Circle also overflows at the app's
  own Settings > Text size "Larger" (125%).
- Repro / evidence: `document.documentElement.style.fontSize='200%'` on each screen, then a check for elements past
  the viewport's right edge.
  - `text200-calendar.jpg`: the title breaks as "Calenda / r", and the "Today" button is cut off at the right edge.
  - `text200-money.jpg`: the Overview, Spending, Income and Coach tabs overprint each other ("OverviewSpendingIncome").
  - `text200-habits.jpg`: the "+ Add" button is cut off.
  - `text200-circle.jpg`: "New circle" is pushed off screen.
  - `larger-circle.jpg`: "New circle" overflows by a few px at 125%.
  - `#gb-main` scrolls horizontally on Calendar, Money, Food, Circle and Habits.
  - Browser zoom at 200% (640 px) and 320 px reflow are both clean, so desktop users are fine. The failure is the
    mobile text-scale path, which is the one the app's audience uses (1.4.4, 1.4.10).
- Cause: the section-title rows are single-line flex rows with nowrap buttons: `.gb-challenges-actions`, the Habits
  title row with Reorder and Add, and the calendar month header with Today and Set routine. The Money tab strip has no
  wrap or scroll. Screen titles use a large display size with no `overflow-wrap`/`hyphens` rule.
- Fix: in styles/app.css, let these rows wrap (`flex-wrap: wrap` on the section title and action rows). Make the
  Money tab strip (`styles/money.css`, `.gb-money-tab` container) scroll horizontally or wrap. Give the screen title
  `overflow-wrap: anywhere` and a `clamp()` size that does not grow past the header at large root sizes.

### A11-3: Every "sun" pill (Medium priority, mid-term goal, reward, calendar tag) is 3.49:1
- Severity: Medium
- Where: dashboard.js `PRIORITY.Medium`, goals.js `mid_term`, gb-kit.js `reward`, calendar.js tag `softFg`,
  money-core.js. Home at 390x844 shows it on the task row "Medium" pill. It fails in both themes.
- Repro / evidence: axe color-contrast on phone Home, light and dark: `.gb-row:nth-child(3) .gb-pill`, fg `#b97505` on
  bg `#fff7e0`, 3.49:1, 12.5 px bold (needs 4.5:1). The dark theme shows the same light-yellow pill, because the raw
  `--sun-*` tokens have no dark values. 1.4.3.
- Cause: the call sites use `var(--sun-700)` on `var(--sun-50)`. tokens.css already notes "sun-700 is 3.7:1 on
  white" and defines `--warning-soft-fg: #9A6104` (light) / `var(--sun-300)` (dark) for exactly this case.
- Fix: swap `--sun-700`/`--sun-50` for `--warning-soft-fg`/`--warning-soft` in the five files above. That fixes both
  themes.

### A11-4: Calendar days outside the month drop to about 3:1
- Severity: Medium
- Where: styles/app.css `.gb-cal-day.is-other-month` (opacity 0.72), styles/mini-calendar.css
  `.gb-mini-cal-day.is-other-month` (opacity 0.75). Calendar and Home, both viewports and both themes.
- Repro / evidence: axe color-contrast. Mini calendar: `#9e9286` on `#fff`, 3.03:1 (light); `#796c63` on `#211a16`,
  3.38:1 (dark). Month grid: `#a2978a` on `#fff`, 2.86:1 (light); 3.18:1 (dark). These are operable buttons
  (Sep 27–30, Nov 1–7), so the inactive-component exception does not apply. 1.4.3.
- Fix: drop the opacity and keep `color: var(--fg3)`. fg3 is already tuned to 4.5:1 on bg, surface and surface-2.

### A11-5: Locked achievement tiles are 2.9:1
- Severity: Medium
- Where: styles/app.css `.gb-ach-tile.is-locked { opacity: 0.72 }`. Achievements, both viewports and both themes:
  24 nodes on desktop, 18 on phone.
- Repro / evidence: axe on `.gb-ach-desc`, `.gb-ach-tier` and `.gb-ach-progress-label` ("Reach Level 3 · Bronze",
  "1 / 3"): `#a2968a` on `#fffefe`, 2.87:1 (light); `#74685f` on `#1e1714`, 3.27:1 (dark). The text is information
  ("Reach Level 8"), not a disabled control. 1.4.3.
- Fix: show the locked state by greying the icon and the progress bar, not by fading the whole tile. Remove the tile
  opacity, or limit it to `.gb-ach-icon`.

### A11-6: Unchecked task/habit circles and text-field borders are 1.5:1 against the card
- Severity: Medium
- Where: styles/app.css `.gb-check` (border `--border-strong`) and `.gb-input` (border `--border-strong`). Home,
  Habits, every dialog, both themes.
- Repro / evidence: computed styles. The unchecked `.gb-check` border `#dfcfc1` on `#fff` is 1.52:1, and its fill
  `#f4ece5` is 1.17:1. In dark the border `#4a3b32` on `#211a16` is 1.60:1. The `.gb-input` border is 1.52:1 (light)
  and 1.60:1 (dark), and the input fill differs from the card by 1.08:1. The empty checkbox circle is the only visual
  sign of the control that completes a task. 1.4.11 needs 3:1.
- Fix: add a `--control-border` token to tokens.css at about 3:1 on surface. In light, something near `#9C8B7D`; in
  dark, near `#7A6A5F`. Use it for `.gb-check:not(.is-done)` and `.gb-input`. Keep `--border-strong` for decorative
  dividers.

### A11-7: Text inputs remove the focus outline; what is left is a 1 px border change at 2.8:1
- Severity: Medium
- Where: styles/app.css `.gb-input:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft) }`.
  Every input, select and textarea in the app, light theme.
- Repro / evidence: Notes search, focused in light. The border goes from `#dfcfc1` to `#f97316`; `#f97316` on the
  white card is 2.80:1. The 3 px halo `#fff4eb` is 1.06:1 and is effectively invisible.
  `docs/evidence/audit-a11y/input-focus-light.jpg`. `.gb-input:focus` (0,2,0) beats the global
  `input:focus-visible` outline (0,1,1), so inputs never get the `--ring` outline that buttons get. Dark is fine
  (coral on near-black). 1.4.11 (focus indicator contrast); 2.4.7 just passes.
- Fix: keep the global ring for inputs. Change the rule to `.gb-input:focus-visible { outline: 2px solid var(--ring);
  outline-offset: 1px }`, or set `border-color: var(--ring)` (coral-600, 3.3:1) at 2 px width.

### A11-8: Note cards are `<article role="button">` with a Pin button inside
- Severity: Medium
- Where: notes.js note card (`h('article', { class: 'gb-note-card', role: 'button', tabindex: '0' ... })`). Notes,
  both viewports.
- Repro / evidence: axe `nested-interactive` (4.1.2) and `aria-allowed-role` on every card. A button cannot contain
  another control: screen readers flatten the card to "Ideas for the trip, button" and the Pin button inside is not
  announced as a separate control in browse mode. The card's name is only the title, so the body preview is not
  exposed either (axe `label-content-name-mismatch`). Enter and Space do open the card (verified).
- Fix: make the card a plain `<article>` with its title in a real `<button class="gb-note-open">`. Use a
  pseudo-element to stretch that button over the card, so a click anywhere still opens it. Keep Pin as a sibling
  button. That drops the custom `onkeydown` and the `e.target.closest('button')` guard.

### A11-9: With the notifications panel open, the next Tab goes to Account, not into the panel
- Severity: Low
- Where: gb-kit.js `Header`. The slot order puts `#gb-notif-slot` after the avatar button. Home, desktop and phone.
- Repro / evidence: Tab to the bell and press Space; the panel opens. Press Tab and focus lands on "Account". A second
  Tab enters the panel. DOM order: bell (button index 1), avatar (2), first panel button (3). 2.4.3.
- Fix: in gb-kit.js `Header`, put `#gb-notif-slot` directly after the bell button and `#gb-profile-slot` after the
  avatar. Both are absolutely positioned, so the layout does not change.

### A11-10: Mini-calendar days do not expose today or the selected day, and label past days "free"
- Severity: Low
- Where: dashboard.js mini calendar cells (`gb-mini-cal-day`). Home, both viewports.
- Repro / evidence: the ariaSnapshot of Home shows 42 buttons such as `"Sun, October 11, 1 item, 1 repeating
  reminder"`, with no `[pressed]` and no "today". The selected day is shown by `.is-selected` colour only. The big
  Calendar does say "today" and `[pressed]`. Past days are labelled "free" even though the visual "free" ring is
  only drawn for `key >= today` (`isFree`). The grid also costs 42 Tab stops between the task list and the habits.
  1.3.1 / 4.1.2.
- Fix: in dashboard.js, add `'aria-pressed': String(key === selectedDate)` and `'aria-current': key === today ?
  'date' : null`, and append ", today" to the label as calendar.js does. Use `isFree` for the "free" wording. Roving
  tabindex with arrow keys is the upgrade path for the 42 stops.

### A11-11: Visual section titles are not headings, and screens skip from h1 to h3
- Severity: Low
- Where:
  - Section titles that are plain divs: dashboard.js `gb-water-title` ("Water tracker", "Food calories") and
    timer.js `gb-score-heading` ("Your focus").
  - Screens where the h1 is followed directly by h3 section titles: Home, Money, Goals, Report, Habits, Mentor and
    Achievements (`.gb-sectiontitle > h3`).
  - The Habits heading reads "Your habits1 of 2 done today", with no space (app.js Habits screen title).
- Repro / evidence:
  - Food's ariaSnapshot has only `heading "Food" [level=1]`; "Water tracker" is plain text.
  - axe reports `heading-order` on 7 screens.
  - The Habits heading is visible as "Your habits 1/2", but its accessible name has no space after "habits".
  1.3.1.
- Fix: render `gb-water-title` and `gb-score-heading` as `h2`. Make gb-kit.js `SectionTitle` emit `h2`, and change
  the selectors in styles/app.css (`.gb-sectiontitle h3`, `.gb-report .gb-sectiontitle h3`) to
  `.gb-sectiontitle :is(h2, h3)` so the look does not change. Add a space or a separate `<span>` before the count in
  the Habits title.

### A11-12: Accessible names that drop the visible text (Label in Name)
- Severity: Low
- Where:
  - Header avatar: visible "AR", name "Account".
  - Food water buttons: visible "+250ml", name "Add 250 millilitres of water".
  - Summary nutrient bowls (`.gb-katori`) and day columns (`.gb-food-week-col`).
  - Buddy thread button (`.gb-mentor-thread`).
- Repro / evidence: axe `label-content-name-mismatch` (2.5.3) on every screen for the avatar, and on Food, Summary
  and Mentor for the others. A voice-control user who says "click AR" or "click plus 250" gets no match.
- Fix: begin each `aria-label` with the visible text. Examples: `'AR, account'` (or drop the aria-label and add
  visually hidden text), and `'+250 ml, add water'`.

### A11-13: Buddy chats: the active thread's date is 3.96:1
- Severity: Low
- Where: styles/app.css `.gb-thread-date` (color `--fg3`) on the selected thread row. Buddy > Your chats with Buddy
  dialog, desktop, both themes.
- Repro / evidence: axe on the dialog: `.gb-thread-date` "11/10/2026", `#96877c` on `#412716`, 3.96:1, 12 px. 1.4.3.
- Fix: on the active row (`[aria-current="true"] .gb-thread-date`), use `--fg2`, or the same ink as the row title.

### A11-14: Home score ring SVG is exposed as an unnamed image
- Severity: Low
- Where: dashboard.js score ring card, a 92 px `<svg>` with no `aria-hidden` and no name. Home.
- Repro / evidence: the ariaSnapshot shows a bare `- img` right after the weekly-review button. The adjacent text
  ("25% SCORE Keep it going 0/3 tasks") already carries the value. 1.1.1.
- Fix: add `aria-hidden="true"` to the ring `<svg>`. Or move the `25% score` text into its `aria-label` with
  `role="img"`, and hide the duplicate text.

### A11-15: The focus trap does not pull back focus that is already outside the dialog
- Severity: Low
- Where: scripts/a11y.js `initA11y` keydown handler, Tab branch.
- Repro / evidence: the forward-Tab branch only wraps when `active === last`. Shift+Tab re-enters the dialog from
  outside (`!overlay.contains(active)`), but forward Tab does not. In a run where focus sat on the bell while the
  timezone offer dialog opened, the next Tab went to "Account" and then into the page behind the dialog. The
  background is also not `inert`, so a screen reader's virtual cursor can leave a dialog. 2.4.3.
- Fix: in a11y.js, add `if (!overlay.contains(active)) { e.preventDefault(); first.focus(); return; }` before the
  wrap checks. Optionally set `inert` on `#gb-app`'s children (except the overlay) while a modal is open, and remove
  it on close.

### A11-16: Undo toasts disappear after 6 s and sit before the main content in focus order
- Severity: Low
- Where: app.js `registerToast({ action: ... pushToast(message, 'info', 6000, ...) })`. Used by note delete and
  archive (notes.js) and by shopping and chore removal (family.js).
- Repro / evidence (code read end to end): the toast is held while hovered or focused (`onfocusin: holdToasts`).
  `#gb-toast-slot` is rendered between the header and `#gb-main`. A keyboard user who just deleted a note from inside
  main has to Shift+Tab back past the main content's start to reach "Undo" before 6 s pass. Deleted notes go to
  Trash, so data is recoverable there, but the family shopping Undo is the only quick restore. 2.2.1.
- Fix: keep action toasts until they are dismissed, or give them at least 10 s and a keyboard path. For example,
  move focus to the Undo button when the toast comes from a keyboard activation, or bind Ctrl/Cmd+Z to the latest
  action toast.

### A11-17: Sign-up name field has no autocomplete
- Severity: Low
- Where: app.js auth view, "Create account" form, the `type="text"` name input. Desktop and phone.
- Repro / evidence: on the signup form the inputs report email `autocomplete=username`, name `autocomplete=null`,
  and both password fields `autocomplete=new-password`. 1.3.5 (Identify Input Purpose).
- Fix: add `autocomplete="name"` to the name input. Optionally use `autocomplete="email"` on the signup email field.

### A11-18: Signed-out screens have no main landmark
- Severity: Low
- Where: app.js `authShell` (sign in, create account). Both viewports and both themes.
- Repro / evidence: axe `landmark-one-main` and `region` (7 to 10 nodes): the h1, intro text and form are outside any
  landmark. A screen-reader user cannot jump to the form by landmark. 1.3.1 (best practice).
- Fix: wrap the auth card in `<main>` (or add `role="main"`) in `authShell`.

## Counts

Critical 0, High 0, Medium 8 (A11-1 to A11-8), Low 10 (A11-9 to A11-18).
