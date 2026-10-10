# scripts/share-card.js — shareable story card

Draws a 1080×1920 (9:16) PNG on a canvas and hands it to the OS share sheet — where Instagram's
"Add to story" lives (there is no web API that posts to Instagram directly; the sheet also gives
WhatsApp status, Snapchat and the photo library for free). No dependencies, works offline. Used by
Report (`report.js`, e.g. the month review from `review.js` `monthReview`) and Money (`money.js`,
which also runs `_demo` on DEV boot).

## Exports

| Export | What |
|---|---|
| `renderStoryCard(card)` | → PNG blob. `card = {eyebrow, headline, sub, stats: [{label, value}] (≤3), note (≤3 wrapped lines), footer}` |
| `shareStoryCard(card, {filename, title})` | → `'shared'｜'saved'｜'unsupported'`. Native path first, then `navigator.share({files})`, then a download (`'saved'`). `'unsupported'` = the canvas failed. **A dismissed sheet counts as `'shared'`** (web `AbortError`, native "Share canceled") — the platform doesn't say otherwise |
| `_demo()` | DEV self-check: wrap/fit never overflow, three stats + three note lines clear the footer, brand row clears Instagram's chrome |

## Layout

Constants `W`, `H`, `PAD`, `BRAND_Y`, `EYEBROW_Y`, `FOOTER_UP`: Instagram overlays its controls on
the top and bottom ~250 px, so everything readable sits between `BRAND_Y` (300) and
`H - FOOTER_UP`. Order: brand row (logo on a white rounded tile, `loadLogo` — same-origin
`/icons/icon-192.png` so the canvas stays untainted and `toBlob` works; never rejects), eyebrow,
headline, sub, stats panel, note, footer. Fonts: `DISPLAY` (Bricolage Grotesque), `BODY` (Hanken Grotesk).

| Fn | What |
|---|---|
| `wrap(ctx, text, maxW)` | word wrap at the current font |
| `fit(ctx, text, maxW)` | cut with an ellipsis. **Every single-line text goes through it**; a stat's label gets the width its value leaves (value capped at 60% of the row) |
| `roundRect(ctx, …)` | `ctx.roundRect` or an `arcTo` fallback — older WebViews threw on it and the share button just failed |

## Traps

- **Canvas text does not trigger font loading.** An `@font-face` never painted in the DOM stays
  unloaded and `fillText` silently falls back to Helvetica; `document.fonts.ready` alone resolves
  over faces nobody asked for. `renderStoryCard` calls `document.fonts.load()` per family/weight first.
- `canShare({files})` is the only honest test — Android WebView and desktop Firefox have
  `navigator.share` but reject files.
- **Inside Capacitor** (`shareNatively`): WebView `canShare({files})` is false, so the PNG is written
  with `nativePlugin('Filesystem').writeFile` (bare base64, `directory: 'CACHE'`) and the `file://`
  URI handed to `nativePlugin('Share').share({files: [uri]})`. A missing/failed plugin → `null` →
  falls through to the download. Needs **`@capacitor/share` + `@capacitor/filesystem` installed in
  `../Growth-Buddy-Mobile`** (`npm i`, `npx cap sync`); without them the app still just downloads.
  The proxy from `nativePlugin` exists either way, so "missing" is only a rejected call — hence the `try`s.
