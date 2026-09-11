# scripts/gb-kit.js — UI primitives (701 lines)

Every screen builds DOM from these. Element-returning factories, no framework, no virtual DOM.

## The two you use constantly

- **`h(tag, attrs, ...children)`** (18) — hyperscript. Children may be strings, numbers, nodes,
  arrays, or `null`/`false` (skipped, which is why conditional children read as `cond ? node : null`).
  `attrs`: `class`, `style` (object), `onclick`/`on*` handlers, anything else set as an attribute.
- **`Icon(name, {size, sw, color, style, className})`** (113) — renders `<span.gb-icon><svg>`.
  `sw` is stroke-width. **The name must exist in `scripts/icons.js`** or nothing renders.

## Components

| Export | Line | Notes |
|---|---|---|
| `activate(fn)` | 71 | spread into attrs to make a non-button keyboard-operable (click + Enter/Space + role) |
| `plural(count, singular, pluralForm)` | 88 | |
| `refreshIcons()` | 99 | re-scan for icon placeholders after injecting DOM |
| `DOMAIN` | 136 | domain → color map (`habit`, `fitness`, `study`, `journal`) |
| `IconChip({domain, icon, size, iconSize})` | 147 | |
| `Pill({icon, label, bg, fg, dot, style})` | 160 | |
| `Card({children, style, className, onClick})` | 174 | **has no padding of its own** — content insets itself |
| `SectionTitle({title, action, onAction})` | 185 | |
| `ProgressRing({value, size, stroke, color, children})` | 195 | SVG ring; children go in the middle |
| `Check({done, onToggle, color})` | 254 | habit/task toggle |
| `Avatar({...})` | 277 | |
| `BottomNav({active, onNav, onMore, features, moreOpen, layout})` | 414 | |
| `moreSections(overflow, active, onNav)` | 389 | Body of the "More" sheet: ungrouped items first, then one headed grid per `NAV_GROUPS` entry that still has members. Preserves the user's own order within a group. |
| `NAV_CATALOG` / `resolveNavLayout(saved)` | 352 / 371 | `NAV_PRIMARY` + `NAV_OVERFLOW`, `NAV_MAX_PRIMARY = 5`. `resolveNavLayout` reconciles a saved layout against the catalog and drops entries whose feature is off (`navFeatureOn`) |
| `NAV_GROUPS` | 343 | Headings for the "More" sheet. Every catalog entry carries a `group` (`plan` / `track` / `people`); an entry with none renders ungrouped and first. |
| `confirmDialog({title, message, confirmLabel, cancelLabel, danger})` | 466 | returns a promise |
| `Logo({size, radius, alive})` | 537 | theme-aware inline SVG. `alive: true` returns the same mark as the header's live seedling — adds `.gb-sprout`, drops the img role, and leaves `display` to CSS (an inline value would leak it into the classic skin). |
| `AppHeader({...})` | 602 | Three actions only — quick add, notifications, avatar. Theme and the premium skin were icon buttons here; they're preferences, not daily actions, and live in Settings → Display. Always renders `Logo({alive:true})` as its first child; CSS decides whether it shows, so the skin stays a stylesheet. |
| `CrashCard(onRetry)` | 639 | render-error fallback |

## Notes

- Top of file shims `window.lucide.createIcons` over the icon **subset** so the old call shape keeps
  working off-CDN; `timer.js` relies on it too.
- Adding a nav destination = `NAV_CATALOG` here **and** a `SCREENS` entry in `app.js`. Give it a
  `group` too, or it lands ungrouped at the top of the "More" sheet.
