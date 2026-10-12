# Responsive and cross-device audit (build 88, static read)

Scope: `styles/*.css`, the layout parts of `scripts/gb-kit.js` / `app.js`, and the Capacitor config in
`../Growth-Buddy-Mobile`. Static reading only. Nothing was run or measured on a device, so pixel
figures are worked out from the CSS. Re-measure them in `scripts/ui-audit.mjs` before fixing.
QA-09 (landscape) is already known. R-03, R-04 and R-19 are new defects in the rail that fixed it.

## Breakpoint inventory

| Kind | Values in use |
|---|---|
| `max-width` | 359, 360, 380, 400, 420, 460, 480, 520, 540 (money.css), 640 (mini-calendar.css), 1023, 1023.98 |
| `min-width` | 480 (+ `min-height: 560`, phone frame 440px), 560 (frame widens to 600px; trend/achievement grids), 620 (family grids), 640 (notes columns), 760 (circle card), 1024 (sidebar desktop) |
| other | `orientation: landscape and max-height: 500px and max-width: 1023.98px` (rail), `pointer: coarse` x5, `hover: hover` x84, one `@container` (seat ring) |

Gaps and contradictions:

- **Viewport queries do not match the frame width.** Between 480 and 1023px the app is a 440 or 600px
  frame, but every component query still reads the viewport width (R-02).
- **360 and 359 are used as if they were the same breakpoint.** The header and nav block uses
  `max-width: 360px`, which includes 360. The rules written for a 320px phone use 359. As a result,
  the most common Android width is treated as a small phone (R-07).
- **1023 and 1023.98 are mixed.** The toast rule `max-width: 1023px` (in the toast section) and
  every other rule's `1023.98px` disagree for fractional widths between 1023 and 1024 (R-22).
- **Some height bands have no layout of their own.** Between 500 and 560px tall at under 1024 wide,
  there is neither the frame nor the rail, so the app stays full-screen with the bottom nav (acceptable).
  At 1024px wide and up there is no height breakpoint at all (R-01).
- **The px breakpoints ignore the user's text size.** Media queries in px or em are unaffected by
  Settings > Display text size (R-06).

## Findings (most severe first)

### R-01: The desktop sidebar is clipped on laptop-height windows, hiding the last nav destinations
- **Severity:** High. **Effort:** S.
- **Where:** `styles/app.css`, Laptop / desktop layout (>=1024px): `.gb-nav`, `.gb-nav-wrap`, `.gb-nav-tab--overflow { display: flex }`.
- **Failure:** On desktop every destination is shown inline: 12 tabs at `min-height: 48px`, plus 4px gaps and 28px top/bottom padding, which comes to about 676px. `.gb-nav` has no `overflow`, and `.gb-app` is `overflow: hidden`. On a 1366x768 laptop the viewport is roughly 620-660px tall (taskbar, tabs, bookmarks bar), so Circle and Family are cut off and cannot be reached from the nav.
- **Fix:** At >=1024px, add `.gb-nav { overflow-y: auto; overscroll-behavior: contain; }`. Optionally, below about 720px tall, tighten `.gb-nav-tab` to 40px with padding 8px.

### R-02: Phone-frame widths are styled by viewport media queries, so the wrong rules fire
- **Severity:** Medium. **Effort:** M.
- **Where:** `styles/app.css` frame rules (`@media (min-width: 480px) and (max-width: 1023.98px) and (min-height: 560px)` -> `.gb-app { max-width: 440px }`, and the 560px rule -> 600px). The component queries that disagree with them: `.gb-conn-tools` (<=480), `.gb-focus-card` stacking (<=460), `.gb-cal-toolbar` / `.gb-search-modal` (<=520), `.gb-money-tab` (money.css <=540), `.gb-circle-card` (>=760), `.gb-mini-cal-day` (mini-calendar.css <=640).
- **Failure:** At 540x720 (Surface Duo, or a split-screen tablet) the frame is 440px wide, but none of the <=480/<=520/<=540 rules apply. The Circle connection tools wrap "This week" onto its own line (the bug the <=480 rule was written to fix), and the Money tabs revert to their wide style. At 768x1024 (iPad mini portrait) the frame is 600px wide, but `.gb-circle-card` goes two-column at >=760. The challenge column is then about 200px wide beside a 340px ring.
- **Fix:** Put `container-type: inline-size` on `.gb-app` and change these component queries to `@container`. Container queries measure the frame itself, so the 440/600 special cases go away.

### R-03: Landscape iPhone ignores the right safe-area inset
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` `.gb-head` (padding `... 20px ...`), screen gutters (`--gutter`), `.gb-toast-stack` (`right: 14px`), and the landscape block (`@media (orientation: landscape) and (max-height: 500px) ...`). No rule anywhere reads `env(safe-area-inset-right)`.
- **Failure:** iOS reports matching left and right insets in landscape (about 47-59px). The rail pads the left side only. With the phone rotated so the sensor housing is on the right (iPhone 15, 852x393), the bell and avatar sit 20px from the edge, under the housing and the rounded corner. Toasts at `right: 14px` sit there too. The landscape More panel (`top: 0; bottom: 0`) has no bottom padding for the home indicator.
- **Fix:** In the landscape block, add `padding-right: max(20px, env(safe-area-inset-right))` to `.gb-head` and `#gb-main`. Give `.gb-toast-stack` `right: calc(14px + env(safe-area-inset-right, 0px))`. Give `.gb-more-sheet` `padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px))`.

### R-04: The premium skin breaks the landscape rail
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/premium.css` section 4 `@media (max-width: 1023.98px) { html[data-premium='on'] .gb-nav { margin; padding; border; border-radius } }` against the landscape block in `styles/app.css` (`.gb-nav, html[data-premium='on'] .gb-nav`).
- **Failure:** The two selectors have equal specificity (0,2,1), and premium.css loads last (index.html), so its margin `0 10px calc(10px + inset)`, padding `8px 6px 10px`, full border and 3xl radius win in landscape. The rail floats as a rounded pill 10px off the edges and loses `padding-left: env(safe-area-inset-left)`. On a notched iPhone in landscape, its icons shift into the notch. The `html[data-premium]` selector app.css added for this case has no effect.
- **Fix:** Exclude the landscape case in premium.css (`@media (max-width: 1023.98px) and not ((orientation: landscape) and (max-height: 500px))`). Alternatively, raise the rail selector to `html[data-premium] .gb-app .gb-nav`.

### R-05: Settings tab bar overflows at 320px (and at 390px with Larger text)
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` `.gb-segnav-btn` (`white-space: nowrap; min-width: 0`, no overflow handling), `.gb-segnav:has(> .gb-segnav-btn:nth-child(6)) .gb-segnav-btn` (11px), and the 420px tightening. The labels come from `app.js` settings `tabDefs`: Profile / Display / Alerts / Reminders / Layout / Account.
- **Failure:** The six labels need about 280px at 11px bold. At 320px the settings sheet's inner width is about 230-268px (the 420px rule's own comment puts the bar at about 270px at 360px). The labels run out of their buttons and overlap their neighbours. With text size Larger (125%), the same happens on a 390px phone. The comment covers widths only "down to 360px".
- **Fix:** Make `.gb-segnav` `overflow-x: auto; scrollbar-width: none` with `flex: none` buttons below 360px. Alternatively, wrap it into two rows of three.

### R-06: The text-size setting is invisible to every breakpoint
- **Severity:** Medium. **Effort:** M.
- **Where:** `scripts/app.js` `applyTextScale` (sets `html.style.fontSize` to 112.5% / 125%). Every `@media (max-width: ...px)` in `styles/`.
- **Failure:** Every size is in rem, so at 125% a 390px phone lays out like a 312px one. The compact rules (<=380 card padding, <=359 Circle "Browse" label, <=360 header) stay off because px and em media queries ignore the root's inline font size. Long rows and headers run out of space well above 320px for exactly the users who asked for larger type.
- **Fix:** Do this together with R-02. Write the container queries on `.gb-app` in rem (`@container (max-width: 22.5rem)`). Unlike media queries, container-query rem uses the root's computed size, so they follow the text-size setting.

### R-07: The 360px breakpoint hides the bottom-nav labels on the most common Android width
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` `@media (max-width: 360px)` (header/nav block) -> `.gb-nav-tab span { display: none }`. `scripts/gb-kit.js` `BottomNav` comment: "Below 360px .gb-nav-tab span is display:none".
- **Failure:** `max-width: 360px` includes 360. Galaxy S/A-series phones (360x780/800) therefore get an icon-only nav and the tightened header. The rules written for small phones use 359 to leave 360 out (`.gb-circle-browse-label`, `.gb-cal-card`). Five tabs with labels fit at 360 (the bar is 344px of content, about 69px per tab).
- **Fix:** Change that block to `max-width: 359px`, which matches the comment and the other small-phone rules.

### R-08: Chat and search sheets are sized in `vh`, so they do not shrink above the keyboard
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` `.gb-chat-log { max-height: min(52vh, 460px) }`, `.gb-search-results { max-height: 46vh }` (50vh at <=520), `.gb-editor { max-height: 45dvh }`. `scripts/circle.js` mentorship chat (`gb-chat-sheet`, which has no CSS of its own) focuses the input on open.
- **Failure:** `openOverlay` pins the overlay to the visual viewport, but these inner boxes stay a fixed share of the full screen. On an iPhone SE (667 tall, about 300px visible with the keyboard up), the chat sheet is about 530px: header, a 347px log, composer and Close. The field is scrolled into view and the newest messages are scrolled out, so you cannot read the conversation while typing. The `.gb-editor` comment ("dvh tracks the on-screen keyboard") is wrong: dvh tracks only the URL bar.
- **Fix:** Make `.gb-chat-sheet` (and `.gb-search-modal`) `display: flex; flex-direction: column`. Give the log or result list `flex: 1 1 auto; min-height: 0; max-height: none`. They then shrink with the pinned sheet. Correct the editor comment.

### R-09: The keyboard pin goes stale when iOS pans the visual viewport
- **Severity:** Medium. **Effort:** S.
- **Where:** `scripts/gb-kit.js` `openOverlay` -> `fitViewport`, which is registered only with `vv.addEventListener('resize', ...)`.
- **Failure:** iOS Safari changes `visualViewport.offsetTop` without a resize when it scrolls a focused field into view, or when the user drags while the keyboard is up. The overlay keeps the `top` captured at the last resize, so the sheet sits too high (its header off-screen) or leaves a band of page showing under it.
- **Fix:** Also add `vv.addEventListener('scroll', fitViewport)`, and remove it in `close()` next to the resize listener.

### R-10: The phone frame shrinks to fit its content, so the nav jumps between screens
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` tablet frame rule: `.gb-app { height: auto; min-height: 0; max-height: min(900px, ...) }`.
- **Failure:** With `height: auto`, the frame is only as tall as its content. At 768x1024, a sparse screen is much shorter than Home: an empty Notes or Goals, the lazy skeleton, or Buddy (whose `flex: 1` has no definite height to fill, so the composer sits right under the last message). The vertically centred frame, and with it the bottom nav, moves up and down the page on every tab switch.
- **Fix:** Give the frame a fixed height, `height: min(900px, calc(100dvh - 2 * clamp(20px, 4vh, 40px)))`, instead of `height: auto`.

### R-11: Wide screens: some screens are centred, others pinned left, and the header spans everything
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` Desktop content-screen layout: the `:where(.gb-scroll) > :where(.gb-rise:not(.gb-goals):not(.gb-mentor))` fallback (`max-width: 900px; margin-left: 40px`). The screens with their own centred caps: `.gb-dash--single` 1600, `.gb-cal` / `.gb-summary-page` 1180, `.gb-goals` 940, `.gb-notes` 900, `.gb-mentor` 800, `.gb-focus` 640. The rest (Habits, Food, Money, Family, Report, Circle, Achievements) use the fallback.
- **Failure:** At 1920 the content starts at x=40 on Money and at about x=386 on Notes. At 3840 the difference is about 1300px, so the content jumps sideways on every nav change. `.gb-head` is uncapped, so the greeting sits at the far left and the bell at the far right, about 3500px apart, above a 900px column.
- **Fix:** Pick one rule. Either `margin-inline: auto` in the fallback, or left-align the capped screens. Then cap `.gb-head`'s inner row to the same `max-width`.

### R-12: Touch targets still under 44px that are missing from the overlay list
- **Severity:** Medium. **Effort:** S.
- **Where:** `styles/app.css` `.gb-notif-link` (32px), `.gb-notif-chip` (32px), `.gb-btn.gb-notif-snooze` (32px), `.gb-note-label-opt` (32px), `button.gb-tone-chip` (34px), `.gb-agree-del` (36x36). `styles/money.css` `.gb-money-swatch` (32x32). None of them is in the "Tap targets" `::before` list or has an overlay of its own.
- **Failure:** In the notification panel on a 375px phone, "Mark all read", "Clear read", the filter chips and Snooze are 32px tall pills sitting 4-6px apart. Mis-taps go to the neighbouring control. The same applies to note label suggestions, reminder tone chips and the Money colour swatches.
- **Fix:** Add the six app.css controls to both halves of the "Tap targets" selector list. Give `.gb-money-swatch` the `::after` treatment money.css already uses for its fix pills.

### R-13: Hover-only information that touch users can never see
- **Severity:** Low. **Effort:** S.
- **Where:** `scripts/money.js` badges (`.gb-money-badge`, `title: b.desc`, the only place the unlock rule is shown). `scripts/timer.js` focus history chart (per-day minutes only in an SVG `<title>`, plus an sr-only table). Sound tiles (`title: s.hint`). `styles/app.css` `.gb-agree-del` (`opacity: 0` until `:hover` under `(hover: hover)`).
- **Failure:** On a phone you cannot find out what a locked Money badge needs, or how many minutes a day's bar represents. On a touchscreen laptop, `(hover: hover)` is true (the primary pointer is a mouse), so a finger never reveals the mentorship agreement's delete button.
- **Fix:** Show the badge description under its label, or on tap. Make the chart columns tappable into a readout, as `report.js`'s year grid already does. Use `@media (any-pointer: coarse)` to keep `.gb-agree-del` visible.

### R-14: Three `:hover` rules outside `(hover: hover)` stick after a tap
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-insight-dismiss:hover`, `.gb-focus-hist-hit:hover`, `.gb-family-dish:hover span:first-child`.
- **Failure:** On touch, the tapped insight dismiss stays grey, a tapped history column stays shaded, and a tapped dish stays underlined until you tap somewhere else. This breaks the documented rule in `docs/styles/app.css.md` (every `:hover` behind `(hover: hover)`).
- **Fix:** Wrap each rule in `@media (hover: hover)`.

### R-15: A long email or URL in a toast pushes the close button out of the toast
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-toast-msg { flex: 1 }` (no `min-width: 0`). The global `overflow-wrap: break-word` in `html, body` deliberately leaves min-content alone.
- **Failure:** At 320px the toast is about 294px wide, leaving about 200px for text. A message containing an unbroken 30+ character token (an email address in a code-sent message, a server error with a URL) keeps its min-content width. The close button is pushed past the toast's right edge.
- **Fix:** Use `.gb-toast-msg { min-width: 0; overflow-wrap: anywhere; }`.

### R-16: The notification panel is 70vh, so it runs under Safari's toolbar
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-notif-pop { max-height: 70vh }`.
- **Failure:** In iOS Safari, `vh` is the large viewport. On a 375x667 phone with the toolbar showing (about 550px visible), the panel's top at about 90px plus 467px puts its bottom about 15px under the toolbar. The last notification and "Load older" can never scroll fully into view.
- **Fix:** Use `max-height: min(70dvh, calc(100dvh - 120px))`, keeping 70vh as the fallback line.

### R-17: In frame mode the toast stack is anchored to the viewport and sits across the frame's edge and nav
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-toast-stack { position: fixed; right: 14px; bottom: calc(88px + inset) }`. It is only re-anchored at >=1024px. In the landscape rail there is no bottom nav, but the 88px offset stays.
- **Failure:** At 800x1100 the 600px frame spans x 100-700. The toast spans x 446-786, about 88px from the bottom, so it straddles the frame's right border and covers the right half of its bottom nav (about 40-120px from the bottom). In landscape the toast floats 88px up a 375px-tall screen for no reason.
- **Fix:** In the frame query, centre it: `right: 50%; transform: translateX(50%); bottom: calc(clamp(20px,4vh,40px) + 96px)`. In the landscape block, set `bottom: calc(12px + env(safe-area-inset-bottom))`.

### R-18: `.gb-avatar` `!important` at <=360px shrinks every avatar in the app, not just the header's
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `@media (max-width: 360px) { .gb-avatar { width/height: 38px !important; font-size: 0.6875rem !important } }`.
- **Failure:** `Avatar()` sizes itself with inline styles. The Circle profile sheet asks for `size: 64` (`circle.js`, `gb-profile-head`), but at 360px it renders at 38px with 11px initials.
- **Fix:** Scope the rule to `.gb-head-actions .gb-avatar`.

### R-19: In portrait the "More" sheet has no max-height, so it can be clipped at the top
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-more-sheet` (`position: absolute; bottom: 100%`, no `max-height` or `overflow`). Only the landscape block makes it scroll.
- **Failure:** If a user moves most destinations into More (Settings > Layout), it holds 11 items in 5 rows plus 3 headings, about 530px. On a 320x568 phone there are only about 498px above the nav. `.gb-app { overflow: hidden }` cuts off the top row with no way to scroll to it. Large text makes this worse.
- **Fix:** Add `max-height: calc(100dvh - 120px); overflow-y: auto; overscroll-behavior: contain;` to the base rule.

### R-20: The food loader overflows a landscape phone
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-food-loader` (`justify-content: center`, no overflow handling), `.gb-fl-art` (240x250).
- **Failure:** The content is art 260 + title + subtitle + bar + steps + gaps + 48 padding, about 450px. On a 667x375 landscape phone, the title and the step line are pushed past both edges.
- **Fix:** In the landscape block, `.gb-fl-art { transform: scale(0.6); margin: -50px 0; }`, or `height: 150px` with the art scaled.

### R-21: The search sheet is narrower on desktop than on a tablet, and the note editor stays phone-sized
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `.gb-search-modal { max-width: 520px }` (Search modal section) is overridden by the later `@media (min-width: 1024px) { .gb-modal { max-width: 480px } }` (same specificity, later in the file). `.gb-note-modal` declares no width, so it inherits 380px, or 480px at >=1024px.
- **Failure:** Find people is 520px in the iPad frame and 480px on a 2560px monitor. The rich-text note editor is a 480px column on any desktop.
- **Fix:** Use `.gb-modal.gb-search-modal` (raises the specificity). Add `.gb-modal.gb-note-modal { max-width: 640px }` at >=1024px.

### R-22: `max-width: 1023px` against `1023.98px`
- **Severity:** Low. **Effort:** S.
- **Where:** `styles/app.css` `@media (max-width: 1023px) { body:has(.gb-modal-overlay.is-open) .gb-toast-stack { top: ... } }`.
- **Failure:** At fractional widths between 1023 and 1024 (Windows display scaling, browser zoom), the phone layout is active (every other rule uses 1023.98), but toasts stay at the bottom over an open dialog's Save and Cancel.
- **Fix:** Use `max-width: 1023.98px`.

## Not verified (worth a device check)

- **Android 15+ edge-to-edge.** `targetSdkVersion = 36` enforces edge-to-edge, so `StatusBar.setOverlaysWebView({ overlay: false })` / `setBackgroundColor` in `native.js` `applyNativeStatusBar` are documented no-ops on API 35+. Whether the WebView then reports non-zero `env(safe-area-inset-*)` (header and bottom nav clear of the status and gesture bars) depends on the WebView version and Capacitor 8's system-bars handling. Check on a Pixel running Android 15.
- **Page-level composers with the keyboard up in mobile Chrome/Safari** (Buddy `.gb-msg-bar`, Circle composer). These are not overlays, so `fitViewport` doesn't cover them, and the browser's own scroll-into-view is all that keeps them visible.
