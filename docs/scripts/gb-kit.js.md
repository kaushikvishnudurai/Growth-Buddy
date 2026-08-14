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
| `BottomNav({active, onNav, onMore, features, moreOpen, layout})` | 377 | |
| `NAV_CATALOG` / `resolveNavLayout(saved)` | 342 / 361 | `NAV_PRIMARY` + `NAV_OVERFLOW`, `NAV_MAX_PRIMARY = 5`. `resolveNavLayout` reconciles a saved layout against the catalog and drops entries whose feature is off (`navFeatureOn`) |
| `confirmDialog({title, message, confirmLabel, cancelLabel, danger})` | 466 | returns a promise |
| `GOOGLE_G_SVG` | 524 | inline SVG **string** — set via `innerHTML` |
| `Logo({size, radius})` | 532 | theme-aware inline SVG |
| `AppHeader({...})` | 566 | |
| `CrashCard(onRetry)` | 639 | render-error fallback |

## Notes

- Top of file shims `window.lucide.createIcons` over the icon **subset** so the old call shape keeps
  working off-CDN; `timer.js` relies on it too.
- Adding a nav destination = `NAV_CATALOG` here **and** a `SCREENS` entry in `app.js`.
