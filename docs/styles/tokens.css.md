# styles/tokens.css — design tokens (359 lines)

Single source of truth for color, type, spacing, radius, shadow, motion. **Nothing else should
declare a raw hex.** Fonts: Bricolage Grotesque (display) + Hanken Grotesk (body/UI), self-hosted
via `@fontsource` — plus Space Mono for `--font-mono`.

| Line | Section |
|---|---|
| 1–161 | primitives (color ramps, type scale, spacing, radii, shadows, motion) |
| 162 | **LIGHT THEME** — `:root, [data-theme="light"]` |
| 223 | **DARK THEME** — `[data-theme="dark"]` (sets `color-scheme: dark`) |
| 276 | **SEMANTIC TYPOGRAPHY ROLES** — apply as classes (`.gb-display`, `.gb-h1`, …) |

## Token groups

- **Color ramps** (`-50` → `-900`, though most stop at `-700`): `coral` (the brand ramp, full 50–900),
  `leaf`, `sun`, `iris`, `sky`, `bloom`.
- **Semantic color:** `--bg`, `--bg-subtle`, `--fg1` / `--fg2` / `--fg3`, `--border`, `--border-strong`,
  `--ring`, `--nav-bg`.
- **Brand:** `--brand`, `--brand-hover`, `--brand-press`, `--brand-edge`, `--brand-soft`,
  `--brand-soft-fg`, `--fg-on-brand`, `--shadow-brand`.
- **Status:** `--success`, `--warning`, `--danger`, `--info`. All but `--danger` also have
  `-soft` / `-soft-fg` variants; `--danger` is text-only (the two error lines in `app.css`).
- **AI accent:** `--ai`, `--ai-soft`, `--ai-soft-fg`, `--hairline-ai` — used for Buddy/AI surfaces.
- **Type:** `--font-display`, `--font-body`, `--font-mono`; `--leading-tight|snug|normal|relaxed`.
- **Shape:** `--radius-sm|md|lg|xl|2xl|3xl|pill`.
- **Elevation:** `--shadow-xs|sm|md|lg`.
- **Motion:** `--dur-fast|base|slow`, `--ease-standard|out|bounce`.

## Rules

- Both themes must define every semantic token. Adding one → add it in **both** blocks (162 and 223),
  or dark mode silently falls back to the light value.
- The theme switch flips `data-theme` on the root; `scripts/app.js` `toggleTheme()` / `loadTheme()`
  own that, and the choice persists through `CacheStorage`.
- Ramp steps that don't exist (e.g. `--leaf-900`) will render as an invalid value, not a fallback —
  check the list above before using a step.
