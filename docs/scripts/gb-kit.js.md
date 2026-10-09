# scripts/gb-kit.js — UI primitives

Every screen builds DOM from these. Element-returning factories, no framework, no virtual DOM.

## The two you use constantly

- **`h(tag, attrs, ...children)`** (18) — hyperscript. Children may be strings, numbers, nodes,
  arrays, or `null`/`false` (skipped, which is why conditional children read as `cond ? node : null`).
  `attrs`: `class`, `style` (object), `onclick`/`on*` handlers, anything else set as an attribute.
- **`Icon(name, {size, sw, color, style, className})`** (113) — renders `<span.gb-icon><svg>`.
  `sw` is stroke-width. **The name must exist in `scripts/icons.js`** or nothing renders.

## Components

| Export | Notes |
|---|---|
| `activate(fn)` | spread into attrs to make a non-button keyboard-operable (click + Enter/Space + role) |
| `plural(count, singular, pluralForm)` | |
| `refreshIcons()` | re-scan for icon placeholders after injecting DOM |
| `DOMAIN` | domain → color map (`habit`, `fitness`, `study`, `journal`) |
| `IconChip({domain, icon, size, iconSize})` | |
| `Pill({icon, label, bg, fg, dot, style})` | |
| `Card({children, style, className, onClick})` | **has no padding of its own** — content insets itself |
| `SectionTitle({title, action, onAction})` | action is a `<button>` with `onAction`, plain text (a count) without |
| `ProgressRing({value, size, stroke, color, children})` | SVG ring; children go in the middle |
| `Check({done, onToggle, color, label})` | habit/task toggle; pass `label` (the item's name) so each one's aria-label is distinct. Paints the tick + pop itself and calls `onToggle` 400ms later (= `gb-pop`), since `onToggle` re-renders and would destroy the button mid-press |
| `Avatar({...})` | |
| `BottomNav({active, onNav, onMore, features, moreOpen, layout})` | |
| `moreSections(overflow, active, onNav)` | Body of the "More" sheet: ungrouped items first, then one headed grid per `NAV_GROUPS` entry that still has members. Preserves the user's own order within a group. |
| `NAV_CATALOG` / `resolveNavLayout(saved)` | `NAV_PRIMARY` + `NAV_OVERFLOW`, `NAV_MAX_PRIMARY = 5`. `resolveNavLayout` reconciles a saved layout against the catalog and drops entries whose feature is off (`navFeatureOn`) |
| `NAV_GROUPS` | Headings for the "More" sheet. Every catalog entry carries a `group` (`plan` / `track` / `people`); an entry with none renders ungrouped and first. |
| `openOverlay({label, className, role, onClose})` | **the overlay every dialog shares** — backdrop, click-outside, mount, open/close transition, teardown. Returns `{overlay, sheet, close}`; fill `sheet` yourself. Fourteen dialogs used to carry their own copy and disagreed about all of it. Doesn't call `refreshIcons()` (the sheet is empty at that point) — do it after appending. **Back closes the top sheet** (`syncSheetHistory`): while any overlay is open there is one same-URL `{gbSheet}` history entry on top; Android back / browser back pops it and dismisses the top sheet, any other close takes it off. Deferred a tick so close-then-open pairs coalesce and `setScreen`'s pushState lands first. Android's hardware back reaches the same path: a `backButton` listener (via the bridge's `Capacitor.addListener`; `@capacitor/app` is installed in the mobile repo) calls `history.back()`, or minimises at the root. A backdrop click only closes when the press also began on the backdrop (untrusted clicks, i.e. a11y.js's Escape, always close). While a keyboard covers the visual viewport the overlay is pinned to it and the focused field scrolled into view |
| `openModal({title, sub, body, primary, onPrimary, danger, dismiss, modalClass, errorMessage, afterPrimary})` | the ordinary title / body / primary / dismiss layout, built on `openOverlay`. Returns `close`. `app.js`, `money.js` and `goals.js` each had a byte-identical copy; the only real differences were the error wording and whether the app re-rendered, so both are arguments. No `primary` → the dismiss says "Close". Enter in a single-line `<input>` clicks the primary (`submitOnEnter(sheet, btn)`, exported for sheets that build their own footer on `openOverlay`: reminder edit, the note sheet; textareas/contenteditable keep newlines). A save still pending after 300ms swaps the primary to `setThinking(btn, 'Saving')`, undone on failure. A refusal's error toast is dismissed on the sheet's next `input` (`toast.dismiss(id)`; `pushToast` returns the id) |
| `trackOverlay({close})` | a surface that isn't an `openOverlay` sheet (Family's panels) joins the same back stack / `closeOverlays()`. Returns the untrack; call it from the surface's own close |
| `formatTime(value, fallback)` | **the one time formatter.** Takes `'HH:MM'`, `'HH:MM:SS'`, a Date, an ISO string or epoch millis. There were four: two hand-rolled AM/PM copies (calendar, dashboard), a locale-dependent `toLocaleTimeString`, and two places printing the stored `HH:MM` raw — so the same reminder read "7:30 PM" on one screen and "19:30" on another |
| `setTimeFormat(pref)` / `timeFormat()` | the user's choice, always `'12'` or `'24'` — there is no "follow the device". Lives in `ui_prefs.timeFormat`; app.js applies it at module init and in `hydrateUiPrefs` — before anything paints. Anything else (nothing stored, or the retired `'auto'`) resolves through `detectTimeFormat()` on the spot |
| `detectTimeFormat()` | the device's own 12/24 habit, from `Intl.DateTimeFormat().resolvedOptions()`. Used once: on an account's first load `hydrateUiPrefs` writes the answer to `ui_prefs`, and every load after that reads the server's value, so one account is written the same way on two devices with different locales |
| `shakeRefusal(el)` | one head-shake + a short buzz when a surface refuses what it was given |
| `landed(el)` | its success twin: a saved row drops in and settles under a fading brand ring, with one short tap; scrolls it into view first if it landed off-screen |
| `leave(el)` | a deleted row shrinks and fades; returns a promise that resolves once it has gone, so the caller drops it from the list then (400 ms timeout for background tabs) |
| `confirmDialog({title, message, confirmLabel, cancelLabel, danger})` | returns a promise; dismissing any way that isn't the confirm button answers `false` |
| `Logo({size, radius, alive})` | theme-aware inline SVG. `alive: true` returns the same mark as the header's live seedling — adds `.gb-sprout`, drops the img role, and leaves `display` to CSS (an inline value would leak it into the classic skin). |
| `AppHeader({...})` | Three actions only — quick add, notifications, avatar. Theme and the premium skin were icon buttons here; they're preferences, not daily actions, and live in Settings → Display. Always renders `Logo({alive:true})` as its first child; CSS decides whether it shows, so the skin stays a stylesheet. |
| `CrashCard(onRetry)` | render-error fallback |
| `thinkingLabel(text)` / `setThinking(btn, text)` | **every AI wait's button.** `thinkingLabel` is the content (twinkling sparkle, text, three dots) for a button that also carries `.is-thinking`; `setThinking` does both to a live button and returns the undo. The button keeps its colour and gets a light running round its edge: a greyed button with new words read as broken |
| `Thinking(label, steps)` | the panel that stands in for an AI answer: an orb, three steps shown in turn, lines writing in. **Always three steps** (the CSS gives each a third of a 7.5s cycle). `label` is the screen-reader text. While any `.is-thinking` / `.gb-thinking` is in the DOM, `body:has()` runs a bar along the top of the screen and glows its edge: no JS, no counter to leak |

## Notes

- Top of file shims `window.lucide.createIcons` over the icon **subset** so the old call shape keeps
  working off-CDN; `timer.js` relies on it too.
- Adding a nav destination = `NAV_CATALOG` here **and** a `SCREENS` entry in `app.js`. Give it a
  `group` too, or it lands ungrouped at the top of the "More" sheet.
