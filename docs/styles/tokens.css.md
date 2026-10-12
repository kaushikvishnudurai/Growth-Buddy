# styles/tokens.css — design tokens

Single source of truth for color, type, spacing, radius, shadow, motion. **Nothing else should
declare a raw hex.** Fonts: Bricolage Grotesque (display) + Hanken Grotesk (body/UI), self-hosted
via `@fontsource` — plus Space Mono for `--font-mono`. Dropping or renaming a face here: check the
`rel=preload` links in `index.html`, which name three of these files.

| Section |
|---|
| primitives (color ramps, type scale, spacing, radii, shadows, motion, layers) |
| **SCRIMS** — a second theme-independent `:root` block |
| **LIGHT THEME** — `:root, [data-theme="light"]` |
| **DARK THEME** — `[data-theme="dark"]` (sets `color-scheme: dark`) |
| **SEMANTIC TYPOGRAPHY ROLES** — only `.gb-stat` now; the unused `.gb-h1`…`.gb-mono` role classes were removed |

## Token groups

- **Color ramps** (`-50` → `-900`, though most stop at `-700`): `coral` (the brand ramp, full 50–900),
  `leaf`, `sun`, `iris`, `sky` (plus `--sky-800`, text on sky fills only), `bloom`.
- **Semantic color:** `--bg`, `--bg-subtle`, `--fg1` / `--fg2` / `--fg3`, `--border`, `--border-strong`,
  `--control-edge` (the edge of a field, an unchecked check, an off switch: 3:1+ on every canvas;
  `--border-strong` is 1.4:1 and only separates content), `--ring` (focus; coral-600 in light,
  coral-400 in dark; a field's focus is a `--ring` border plus a 35% `--ring` halo), `--nav-bg`.
- **Brand:** `--brand`, `--brand-hover`, `--brand-press`, `--brand-edge`, `--brand-soft`,
  `--brand-soft-fg`, `--fg-on-brand`, `--shadow-brand`, `--brand-ink`, `--brand-fill`,
  `--brand-fill-hover`. **`--brand` (#F97316) is 2.8:1 against white, so it never carries text.**
  Orange text is `--brand-ink`; an orange surface with white text or an icon on it (primary button,
  FAB, active tab, selected day, badge) is `--brand-fill` (coral-700, 5.0:1). `--brand` stays for
  bars, dots and rings. `--brand-hover` is text-only now (coral-800 in light).
- **Status:** `--success`, `--warning`, `--danger`, `--info`. All but `--danger` also have
  `-soft` / `-soft-fg` variants; `--danger` is text-only (brightens in dark). A red surface under
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
  < `--z-sheet` 61 < `--z-modal` 100 < `--z-loader` 150 < `--z-celebrate` 200 < `--z-toast` 300
  < `--z-skip` 2000 < `--z-thinking` 2100 (the AI edge glow). One scale, in the primitives block. A new
  fixed layer picks a slot here, not a fresh number; only a component ordering its own children
  (-1 / 1 / 2) stays literal. Toasts sit above the celebration so an Undo raised under one stays pressable.
- **Scrims:** `--scrim` (dialog overlay, More sheet backdrop) and `--scrim-strong` (the
  celebration, which also blurs). Dark in both themes, so they live outside the theme blocks.
- **Use the scale, not the value.** A literal `8|12|16px` radius or a `0.75rem`-style size equal to
  a token is a bug: premium raises every `--radius-*`, and a type-scale change can't reach a
  literal. Off-scale sizes (0.8125rem and friends) are still literal; there is no token for them yet.

## Rules

- Both themes must define every semantic token. Adding one → add it in **both** blocks (LIGHT THEME
  and DARK THEME banners), or dark mode silently falls back to the light value.
- **Contrast is tested.** `node scripts/contrast.test.mjs` resolves the var() chains in both themes
  (translucent tints composited over `--surface`) and fails on: `--fg1|2|3`, `--brand-ink`,
  `--danger` on `--bg|surface|surface-2` under 4.5:1; white on `--brand-fill(-hover)` /
  `--danger-fill(-hover)` and each `-soft-fg` on its `-soft` under 4.5:1; `--ring` under 3:1.
  Changing a colour token → run it, and retune the token rather than drop the pair. Light `--ring`
  is coral-600 (3.3:1 on surface-2; coral-500 was 2.6) and `--danger-fill` is `#D34247`
  (white 4.53:1; `#E5484D` was 3.9). Not in the test, knowingly: `--brand` (2.8, no text),
  `--surface-3` as a text ground (fg3 is ~4.0-4.2 on it), and the status solids
  (`--warning` 2.4, `--success` 3.5 in light) — they colour icons, so a component using one as
  text should switch to the `-soft-fg` or `--brand-ink`.
- **Components are tested too** (second half of `contrast.test.mjs`). It reads every rule in
  `styles/` and fails on (c) a `background` naming a light ramp step (`-50`/`-100`) with no
  `[data-theme='dark']` twin of the same selector — ramps are not themed, so it stays a pastel
  tile in dark mode (the reminder toast, the food total, the snoozed chips all did); (d) any rule
  setting both `color` and `background` under 4.5:1 in a theme it applies to (3:1 when large, or
  listed in `ICON_ONLY`), dark twins layered on, every gradient stop checked, premium rules merged
  with their base; (e) the `{ bg: 'var(..)', fg: 'var(..)' }` tone maps in `scripts/`. For a tint
  in both themes use a `-soft` / `-soft-fg` pair, or `color-mix(in srgb, var(--<semantic>) N%,
  var(--surface))`. Unresolvable values (glass tokens, url()) are skipped, not guessed.
- Until the user picks a theme, `loadTheme()` follows `prefers-color-scheme` and `followSystemTheme()` tracks it live; a pick (`gb.theme` / `ui_prefs.theme`) wins from then on.
- The theme switch flips `data-theme` on the root; `scripts/app.js` `toggleTheme()` / `loadTheme()`
  own that, and the choice persists through `CacheStorage`.
- Ramp steps that don't exist (e.g. `--leaf-900`) will render as an invalid value, not a fallback —
  check the list above before using a step. **`node scripts/tokens.test.mjs`** now fails the moment
  a bare `var(--x)` names something this file doesn't define: a missing token with no fallback
  voids the entire declaration, which is how the modal lost its entrance animation and three
  surfaces lost their background.
