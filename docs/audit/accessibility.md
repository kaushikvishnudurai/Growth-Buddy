# Accessibility audit (WCAG 2.2 AA)

Static review of `scripts/` and `styles/` on `feat/overhaul`. Nothing was run in a browser. Contrast
ratios come from the resolver in `scripts/contrast.test.mjs`, which composites translucent tints over
`--surface`, applied to pairs the test does not cover. `node scripts/contrast.test.mjs` passes (60 pairs).

What already holds and is not repeated below: no clickable `div`/`span` without `activate()` (`Card`'s
`onClick` has no callers); every icon-only `h('button')` has an `aria-label`; every `<img>` has `alt`
(note photos are editable); skip link, `role=main`, `nav[aria-label=Primary]` and one `h1` per screen
are in place; toasts go through `announce()` (status/alert regions); the global
`prefers-reduced-motion` switch is in `app.css`, and every JS smooth scroll checks it; there is no
drag-only or swipe-only action (Home reorder uses buttons, the calendar grid has arrow keys); the
44px `::before` hit-area rule covers the small icon buttons.

| ID | Title | Severity | WCAG | Effort |
|---|---|---|---|---|
| A11Y-01 | Off switches, unchecked checks and field borders under 3:1 | High | 1.4.11 | M |
| A11Y-02 | Focus indicators drawn in `--brand` (2.8:1), not `--ring` | High | 1.4.11, 2.4.7 | S |
| A11Y-03 | Small text under 4.5:1 in the light theme | High | 1.4.3 | S |
| A11Y-04 | `<html lang>` is set to the device locale while every string is English | High | 3.1.1 | S |
| A11Y-05 | Small text under 4.5:1 in the dark theme only | Medium | 1.4.3 | S |
| A11Y-06 | Content text dimmed with `opacity` falls to 2-3.9:1 | Medium | 1.4.3 | S |
| A11Y-07 | The bell's unread count is hidden by its `aria-label` | Medium | 1.3.1, 4.1.2 | S |
| A11Y-08 | Async results that never reach a live region | Medium | 4.1.3 | M |
| A11Y-09 | Dialog fields a11y.js cannot name, and fields named only by placeholder | Medium | 1.3.1, 3.3.2, 4.1.2 | S |
| A11Y-10 | Card and section titles that look like headings but are `div`s | Medium | 1.3.1, 2.4.6 | M |
| A11Y-11 | Sticky bars can cover the focused control | Medium | 2.4.11 | S |
| A11Y-12 | The password reveal cannot be reached by keyboard | Low | 2.1.1 | S |
| A11Y-13 | Accessible name does not contain the visible label | Low | 2.5.3 | S |
| A11Y-14 | Food photo "Remove item" button is named by the glyph "✕" | Low | 4.1.2 | S |
| A11Y-15 | Personal-data fields without `autocomplete` | Low | 1.3.5 | S |
| A11Y-16 | Tabs and radio groups miss their keyboard model and panel links | Low | 1.3.1, 4.1.2 | M |

Count: 4 High, 7 Medium, 5 Low.

---

## A11Y-01: Off switches, unchecked checks and field borders under 3:1
- **Severity:** High. **WCAG:** 1.4.11 Non-text Contrast. **Effort:** M
- **Where:** `styles/app.css` `.gb-switch`, `.gb-check`, `.gb-input` (shared by every form,
  `.gb-msg-input` too), `.gb-goal-ms-check`.
- **Failure:** An off switch is a `--surface-3` track on `--surface`: **1.17:1** light, 1.23 dark,
  and its white knob sits on that same pale track. In the light theme the off switch is close to
  invisible, so the user cannot tell it is a control or that it is off. The unchecked habit/task
  `.gb-check` and `.gb-goal-ms-check` are outlined in `--border-strong`: 1.52:1 on `--surface`. Every
  text field's only boundary is `1.5px --border-strong` on a `--surface-2` fill: 1.40:1 (and
  `--surface-2` itself is 1.08:1 against the card).
- **Fix:** Give the off track and unchecked rings a token at 3:1 or more (for example a new
  `--control-edge` near `--fg3`, which is 4.5:1), and add it to `PAIRS` in `contrast.test.mjs`
  so the test catches the next regression. Field borders can use the same token.

## A11Y-02: Focus indicators drawn in `--brand` (2.8:1), not `--ring`
- **Severity:** High. **WCAG:** 1.4.11, 2.4.7 Focus Visible. **Effort:** S
- **Where:** `styles/app.css` global fallback `a:focus-visible, button:focus-visible, … [tabindex]:focus-visible`
  (after `#gb-main:focus`); 12 component rules: money.css `.gb-money-bar-col`, `.gb-money-account`,
  `.gb-money-health-fix`, `.gb-money-exp-edit`, `.gb-money-quick-amt`; app.css
  `.gb-nutrient-tabs button`, `.gb-food-level`/`.gb-split-legend > button`/`.gb-food-week-col`,
  `.gb-food-recent-chip`, `.gb-food-row-edit`, `.gb-food-star`/`.gb-water-drink`/`.gb-water-suggest`,
  `.gb-rem-check`, `.gb-rule-day`. Also `.gb-input:focus` and `.gb-msg-input:focus`
  (`outline: none` plus a `--brand` border and a `--brand-soft` halo); `.gb-editor:focus`
  (`outline: none`, nothing replaces it, so the note body shows only a caret).
- **Failure:** `--brand` is 2.80:1 on `--surface` and 2.59:1 on `--surface-2` in light. The
  `--brand-soft` halo is 1.08:1. tokens.css.md says `--ring` exists for exactly this (3.58:1) and 47
  other rules use it. Any control without its own rule falls back to the 2.8:1 ring, and
  `.gb-input:focus` (0,2,0) beats `input:focus-visible` (0,1,1), so every text field gets the
  brand border, never the ring.
- **Fix:** `sed` the 13 `outline: 2px solid var(--brand)` to `var(--ring)`. In `.gb-input:focus` and
  `.gb-msg-input:focus` set `border-color: var(--ring)`. Add `.gb-editor-wrap:focus-within { border-color: var(--ring) }`.

## A11Y-03: Small text under 4.5:1 in the light theme
- **Severity:** High. **WCAG:** 1.4.3 Contrast (Minimum). **Effort:** S
- **Where / failure (7 rules):**
  - `.gb-notif-link` ("Mark all read" and the other header actions, 0.75rem/700) and `.gb-notif-more`
    (0.8125rem): `color: var(--brand)`, 2.80:1. tokens.css.md says `--brand` "never carries text".
  - `.gb-bell-badge`: white on `--coral-500`, **2.80:1** at 0.656rem.
  - `.gb-agree-count.is-all` (circle.js agreement count): `--success`, 3.47:1.
  - `.gb-slip-btn.is-slipped` (app.js habit row): `--coral-600` on `--coral-50`, 3.30:1.
  - `.gb-freeze-cal .gb-freeze-day.is-missed`: `--coral-700` on `--coral-100`, 4.10:1. `.is-done`:
    `--leaf-700` on `--leaf-100`, 4.40:1. Raw ramps, so the same in both themes.
  - `.gb-challenge-badge`: `--fg3` on `--surface-3`, 4.20:1 (4.01 dark). This is the ground the
    docs call out as "not a text ground".
- **Fix:** `--brand` becomes `--brand-ink`; the bell badge uses `--brand-fill` (5.0:1); success text
  uses `--success-soft-fg`; the freeze/slip chips use the `-soft`/`-soft-fg` token pairs (which the
  test already covers); the challenge badge uses `--fg2` (5.49:1 on surface-3).

## A11Y-04: `<html lang>` is set to the device locale while every string is English
- **Severity:** High. **WCAG:** 3.1.1 Language of Page. **Effort:** S
- **Where:** `scripts/i18n.js` `setLocale`, called from `app.js` at module init and again in
  `syncUserSession` (via `localeFromUser`), which falls back to `navigator.languages[0]`.
- **Failure:** `setLocale` writes the result straight into `document.documentElement.lang`. The
  file's own note says "only `en` ships". On a phone set to `ta-IN`, `hi-IN` or `fr-FR`, the page
  claims to be Tamil/Hindi/French while every word on it is English. Screen readers switch to that
  voice and read the English badly or skip it. This audience is likely to have such devices
  (₹, meal plans, "Amma").
- **Fix:** Keep `locale` for `Intl` formatting, but set the attribute from the catalog that was
  actually used: `document.documentElement.lang = catalogFor(locale) ? locale : 'en'`.

## A11Y-05: Small text under 4.5:1 in the dark theme only
- **Severity:** Medium. **WCAG:** 1.4.3. **Effort:** S
- **Where / failure (3 rules):** `.gb-sched-tab.is-on` (calendar Day/Week switch, 0.75rem):
  `--brand-fill` text on `--surface`, 3.41:1. `.gb-sched-stat.is-busy` (calendar.js free/busy stat,
  0.6875rem): `--brand-fill` on `--brand-soft`, 2.72:1. `.gb-sound-tile.is-on` (timer.js ambient
  tile, label 0.75rem): `--iris-500`, 3.53:1. All pass in light. `--brand-fill` is a fill token,
  and this is the dark-theme cost of using it as text.
- **Fix:** Use `--brand-ink` for the two calendar rules and `--ai-soft-fg` (or `--iris-700`/a dark
  twin) for the sound tile; add `['--brand-ink','--brand-soft']` to `PAIRS`.

## A11Y-06: Content text dimmed with `opacity` falls to 2-3.9:1
- **Severity:** Medium. **WCAG:** 1.4.3. **Effort:** S
- **Where (8 rules, none of them disabled controls):** `.gb-badge` (locked achievements, 0.52),
  `money.css .gb-money-badge` (0.55), `.gb-money-exp-row.is-settled` (0.6),
  `.gb-money-rec-row.is-paused` (0.6), `.gb-home-cust-row.is-off` (Settings, Home layout; 0.6, but
  its switch is still live), `.gb-msg-row.is-failed .gb-msg-bubble` (0.6), `.gb-qa-row.is-unknown`
  (0.6), `.gb-freeze-day.is-future` (0.45).
- **Failure:** In light, `--fg2` at 0.6 is 2.66:1, `--fg1` at 0.52 is 3.59:1, `--fg3` at 0.6 is
  2.34:1. In dark, `--fg2` at 0.6 is 3.86:1. The 1.4.3 exemption covers inactive controls, and none
  of these is one: it is the user's own loan history, their failed message, their locked badges.
- **Fix:** Drop the opacity and show the state with `color: var(--fg3)` (4.5:1 or better) plus the
  existing strike-through, icon or label.

## A11Y-07: The bell's unread count is hidden by its `aria-label`
- **Severity:** Medium. **WCAG:** 1.3.1, 4.1.2. **Effort:** S
- **Where:** `scripts/gb-kit.js` `AppHeader` (bell `'aria-label': 'Notifications'`), `scripts/app.js`
  `paintBellBadge`.
- **Failure:** `aria-label` replaces the button's content, so the `.gb-bell-badge` text ("3") is
  never read. A screen-reader user hears "Notifications" with or without unread items. Sighted users
  get the count.
- **Fix:** In `paintBellBadge`, also set
  `bell.setAttribute('aria-label', n ? 'Notifications, ' + text + ' unread' : 'Notifications')`, and
  build the first label the same way in `AppHeader`.

## A11Y-08: Async results that never reach a live region
- **Severity:** Medium. **WCAG:** 4.1.3 Status Messages. **Effort:** M
- **Where / failure:**
  - `money.js` "Ask about your spending": `runSearch` calls `replaceChildren` on `searchOut`, which
    has no live role. Pressing Search or Enter changes nothing a screen reader reports.
  - `family.js` `pantrySection`: `model.pantryScanMsg` ("Scanning…", the result, or the error)
    renders as a plain `<p>`. The meal-plan scan message got `role=status`; this one didn't.
  - `family.js` `.gb-family-scan-msg`, `.gb-family-plan-banner` and `.gb-family-shop-left` do carry
    `role=status`, but `paint()` rebuilds the whole tree with `root.replaceChildren`. A live region
    inserted with its text already in it is not reliably announced (NVDA and JAWS skip it). The
    comment on `announce()` in app.js says the same.
- **Fix:** Route these through the existing `announce(text)` in app.js (export it via `toast.js` the
  way `toast` is), or keep one persistent `aria-live` node outside the repainted subtree. For the
  search, give `searchOut` `role: 'status'` and keep it mounted.

## A11Y-09: Dialog fields a11y.js cannot name, and fields named only by placeholder
- **Severity:** Medium. **WCAG:** 1.3.1, 3.3.2, 4.1.2. **Effort:** S
- **Where / failure:** `a11y.js` `nameFields` names a control only when it is the label's
  `nextElementSibling`, or that sibling's only input. Two Settings fields fail that test:
  - `openProfileSettings` **Timezone**: label, then a `.gb-field-hint`, then the input. The hint
    holds no input, so the field's name falls back to its placeholder, "e.g. Asia/Kolkata".
  - Water reminders **Between**: `waterFrom` and `waterTo` share one row, so neither is named. Both
    are `type=time` with no placeholder, so they have **no accessible name at all**. The Quiet hours
    row right below sets `'aria-label': 'Quiet from'/'Quiet until'`; water is missing the same.
  - Placeholder-only names, where the placeholder disappears on input: food photo item rows
    (`app.js` `renderItemsList`: "Food name", "g"), receipt line items (`money.js`: "Item", the
    currency symbol), and the on-screen Money search input ("e.g. what could I skip?"). The Money
    search sits outside any dialog, so a11y.js never sees it.
- **Fix:** Add `'aria-label'` to `waterFrom`/`waterTo` ("Water reminders from"/"until") and to the
  four placeholder-only inputs. Move the Timezone hint below the input, or tie it with
  `aria-describedby`. The CODEMAP `ponytail:` upgrade path (a real `<label for>`) still applies.

## A11Y-10: Card and section titles that look like headings but are `div`s
- **Severity:** Medium. **WCAG:** 1.3.1, 2.4.6. **Effort:** M
- **Where (about 43):** `dashboard.js` Home cards: `.gb-water-title` ×3 ("Water tracker", "Food
  calories", "Summary"), `.gb-card-titleline` ×6 ("Milestones", "Goals", "Smart reminders" …),
  `.gb-score-heading`, `.gb-onboard-kicker`, `.gb-coach-kicker`. `timer.js` `.gb-score-heading`
  (the Focus screen has no heading below its `h1`). Settings `.gb-settings-sec-label` ×32.
- **Failure:** These render as headings but are `div`s, so the screen-reader heading list for Home
  holds the `h1` and two `h2`s while about ten cards look titled. Settings, the longest dialog in
  the app, has no headings at all.
- **Fix:** Render them as `h2` (Home, Timer) and `h3` (Settings sections), keeping the class. CSS
  is unchanged as long as the class selectors carry margin/size (reset `margin` once).

## A11Y-11: Sticky bars can cover the focused control
- **Severity:** Medium (static inference, confirm with a Shift+Tab run). **WCAG:** 2.4.11 Focus Not
  Obscured (Minimum). **Effort:** S
- **Where:** `money.css .gb-money-tabs`, `app.css .gb-family-sectionnav`, `.gb-notes-tools`:
  `position: sticky; top: 0; z-index: 5` inside `#gb-main`, and no stylesheet sets `scroll-padding`.
- **Failure:** When focus moves up to a control above the visible area, the browser scrolls it to the
  scroller's top edge, which is directly under the opaque sticky bar. A single-row control such as an
  expense row's edit button or a 44px chip can be hidden completely.
- **Fix:** `.gb-scroll:has(.gb-money-tabs, .gb-family-sectionnav, .gb-notes-tools) { scroll-padding-top: 64px; }`
  (match the tallest bar).

## A11Y-12: The password reveal cannot be reached by keyboard
- **Severity:** Low. **WCAG:** 2.1.1 Keyboard. **Effort:** S
- **Where:** `app.js` `passwordField`: the toggle has `tabindex: '-1'`.
- **Failure:** Showing the password is a feature, and only pointer users can use it. Keyboard and
  switch users must type a password they cannot check, on sign-up, reset and change password.
- **Fix:** Remove `tabindex: '-1'`. The extra Tab stop after the field is the expected pattern.

## A11Y-13: Accessible name does not contain the visible label
- **Severity:** Low. **WCAG:** 2.5.3 Label in Name. **Effort:** S
- **Where (5):** `dashboard.js` water buttons: text "+250 ml" / "+500 ml" / "+750 ml", name "Add
  250 millilitres of water". `mentor.js`: text "Clear chat", name "Clear mentor chat". `goals.js`:
  text "Logged today · Undo", name "Logged today. Undo" (close; the punctuation is harmless).
- **Failure:** A voice-control user who says "click 250 ml" or "click Clear chat" gets no match,
  because the visible words do not appear in that order in the name.
- **Fix:** Start each name with the visible text: "+250 ml, add water"; "Clear chat with mentor" (or
  drop the `aria-label`).

## A11Y-14: Food photo "Remove item" button is named by the glyph "✕"
- **Severity:** Low. **WCAG:** 4.1.2, 1.1.1. **Effort:** S
- **Where:** `app.js` `renderItemsList` (photo estimate rows): `h('button', { title: 'Remove item' }, '✕')`.
- **Failure:** Text content takes precedence over `title`, so the name is "✕" ("multiplication x").
  Every row's button sounds the same, and none says what it removes.
- **Fix:** Use `Icon('x')` and `'aria-label': 'Remove ' + (item.foodName || 'item')`, as the receipt
  rows do.

## A11Y-15: Personal-data fields without `autocomplete`
- **Severity:** Low. **WCAG:** 1.3.5 Identify Input Purpose. **Effort:** S
- **Where (4):** `app.js` `viewSignup` name input, `openProfileSettings` display name and date of
  birth, and the WhatsApp phone `numIn` (`gb-phone-num`; the other phone field at `tel-national`
  has it).
- **Fix:** `autocomplete: 'name'`, `'nickname'`, `'bday'`, `'tel-national'`.

## A11Y-16: Tabs and radio groups miss their keyboard model and panel links
- **Severity:** Low. **WCAG:** 1.3.1, 4.1.2. **Effort:** M
- **Where:** `role=tablist` in `app.js` (the Settings tab strip, `gb-segnav`) and `money.js`
  `tabBar`. `role=radiogroup` in `app.js` `segmented` and 8 more (`calendar.js` ×3,
  `dashboard.js`, `goals.js`, `money.js` ×3). Only one calendar group handles arrow keys.
- **Failure:** The roles promise arrow-key movement and one Tab stop. Here every option is its own
  Tab stop and the arrow keys do nothing. Tabs have no `aria-controls`, and the panes have no
  `role=tabpanel`/`aria-labelledby`. Everything is still operable, so this is a mismatch with the
  ARIA pattern, not a block.
- **Fix:** Use one small roving-tabindex helper in `gb-kit.js` (arrows move and select, Home/End),
  applied in `segmented` and both tab bars, and add `role=tabpanel` + `aria-labelledby` on the panes.
  Alternatively, drop the roles for `aria-pressed` buttons, which already match how they behave.
