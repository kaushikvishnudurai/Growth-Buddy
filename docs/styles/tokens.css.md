# styles/tokens.css — design tokens

Single source of truth for color, type, spacing, radius, shadow, motion. **Nothing else should
declare a raw hex.** Fonts: Bricolage Grotesque (display) + Hanken Grotesk (body/UI), self-hosted
via `@fontsource` — plus Space Mono for `--font-mono`. Hanken is one variable latin file
(`@fontsource-variable`, its own `@font-face` in tokens.css, `font-weight: 400 800` so a 900 still draws as 800).

| Section |
|---|
| primitives (color ramps, type scale, spacing, radii, shadows, motion, layers) |
| **LIGHT THEME** — `:root, [data-theme="light"]` |
| **DARK THEME** — `[data-theme="dark"]` (sets `color-scheme: dark`) |
| **SEMANTIC TYPOGRAPHY ROLES** — only `.gb-stat` now; the unused `.gb-h1`…`.gb-mono` role classes were removed |

## Token groups

- **Color ramps** (`-50` → `-900`, though most stop at `-700`): `coral` (the brand ramp, full 50–900),
  `leaf`, `sun`, `iris`, `sky` (plus `--sky-800`, text on sky fills only), `bloom`.
- **Semantic color:** `--bg`, `--bg-subtle`, `--fg1` / `--fg2` / `--fg3`, `--border`, `--border-strong`,
  `--control-border` (the edge of a text field or an unchecked tick: 3:1 on surface / surface-2;
  `--border-strong` is 1.5:1 and is for dividers only), `--ring` (focus; coral-600 in light,
  coral-400 in dark), `--scrim` (the dim behind every overlay: dialogs, the More sheet, the
  celebration), `--nav-bg`.
- **Brand:** `--brand`, `--brand-hover`, `--brand-press`, `--brand-edge`, `--brand-soft`,
  `--brand-soft-fg`, `--fg-on-brand`, `--shadow-brand`, `--brand-ink`, `--brand-fill`,
  `--brand-fill-hover`. **`--brand` (#F97316) is 2.8:1 against white, so it never carries text.**
  Orange text is `--brand-ink`; an orange surface with white text or an icon on it (primary button,
  FAB, active tab, selected day, badge) is `--brand-fill` (coral-700, 5.0:1). `--brand` stays for
  bars, dots and rings. `--brand-hover` is text-only now (coral-800 in light).
- **Status:** `--success`, `--warning`, `--danger`, `--info`. All but `--danger` also have
  `-soft` / `-soft-fg` variants (as do `--brand`, `--ai` and `--social`): **a tinted pill, chip or tag
  is always one of these pairs, never a ramp step** — `var(--sun-50)` has no dark twin, so every
  priority / horizon / tag / category pill that named one stayed a pastel block in dark mode; `--danger` is text-only (brightens in dark). A red surface under
  white text is `--danger-fill` / `--danger-fill-hover` instead (same in both themes —
  `.gb-btn--danger`, the live mic). `node scripts/tokens.test.mjs` fails on a light token with no
  dark twin, and on a raw hex in a stylesheet rule outside its allowlist.
- **AI accent:** `--ai`, `--ai-soft`, `--ai-soft-fg`, `--hairline-ai` — used for Buddy/AI surfaces.
- **Type:** `--font-display`, `--font-body`, `--font-mono`; `--leading-tight|snug|normal|relaxed`.
- **Layout:** `--gutter` — every screen's side margin (20px; 16px at ≤460px, set in `app.css`).
  A screen's outer wrapper pads with it and nothing inside adds more, or tabs shift sideways.
- **Shape:** `--radius-sm|md|lg|xl|2xl|3xl|pill`.
- **Elevation:** `--shadow-xs|sm|md|lg|xl`. `xl` is the overlay tier — dialogs and the two header
  panels, which sit above a dimmed page. Three surfaces were already naming it before it existed.
- **Motion:** `--dur-fast|base|slow`, `--ease-standard|out|bounce`.
- **Layers:** `--z-sticky` 5 < `--z-ptr` 40 < `--z-popover` 50 (bell/profile) < `--z-sheet-backdrop` 60
  < `--z-sheet` 61 < `--z-modal` 100 < `--z-loader` 150 < `--z-toast` 160 < `--z-celebrate` 200
  < `--z-skip` 2000 < `--z-thinking` 2100. A new fixed layer picks a slot here, not a fresh number.

## Rules

- Both themes must define every semantic token. Adding one → add it in **both** blocks (LIGHT THEME
  and DARK THEME banners), or dark mode silently falls back to the light value.
- **Contrast is tested.** `node scripts/contrast.test.mjs` resolves the var() chains in both themes
  (translucent tints composited over `--surface`) and fails on: `--fg1|2|3`, `--brand-ink`,
  `--danger` on `--bg|surface|surface-2` under 4.5:1; white on `--brand-fill(-hover)` /
  `--danger-fill(-hover)` and each `-soft-fg` on its `-soft` under 4.5:1; `--ring` and
  `--control-border` under 3:1. It also fails on any `var(--<ramp>-50)` named in `scripts/*.js`
  (inline styles can't be checked as pairs, so it checks what they name).
  Changing a colour token → run it, and retune the token rather than drop the pair. Light `--ring`
  is coral-600 (3.3:1 on surface-2; coral-500 was 2.6) and `--danger-fill` is `#D34247`
  (white 4.53:1; `#E5484D` was 3.9). Not in the test, knowingly: `--brand` (2.8, no text),
  `--surface-3` as a text ground (fg3 is ~4.0-4.2 on it), and the status solids
  (`--warning` 2.4, `--success` 3.5 in light) — they colour icons, so a component using one as
  text should switch to the `-soft-fg` or `--brand-ink`.
- Until the user picks a theme, `loadTheme()` follows `prefers-color-scheme` and `followSystemTheme()` tracks it live; a pick (`gb.theme` / `ui_prefs.theme`) wins from then on.
- The theme switch flips `data-theme` on the root; `scripts/app.js` `toggleTheme()` / `loadTheme()`
  own that, and the choice persists through `CacheStorage`.
- Ramp steps that don't exist (e.g. `--leaf-900`) will render as an invalid value, not a fallback —
  check the list above before using a step. **`node scripts/tokens.test.mjs`** now fails the moment
  a bare `var(--x)` names something this file doesn't define: a missing token with no fallback
  voids the entire declaration, which is how the modal lost its entrance animation and three
  surfaces lost their background.
