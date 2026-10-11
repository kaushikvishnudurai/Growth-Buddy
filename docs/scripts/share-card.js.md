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
| `shareStoryCard(card, {filename, title})` | → `'shared'｜'saved'｜'unsupported'`: renders, then `native.js` `saveFile` (native share sheet, else `navigator.share({files})`, else a download = `'saved'`). `'unsupported'` = the canvas failed; **rejects** when the app could not write or share the file. **A dismissed sheet counts as `'shared'`** |
| `_demo()` | DEV self-check: wrap/fit never overflow, three stats + three note lines clear the footer, brand row clears Instagram's chrome |

## Layout

Constants `W`, `H`, `PAD`, `BRAND_Y`, `EYEBROW_Y`, `FOOTER_UP`: Instagram overlays its controls on
the top and bottom ~250 px, so everything readable sits between `BRAND_Y` (300) and
`H - FOOTER_UP`. Order: brand row (logo on a white rounded tile, `loadLogo` — same-origin
`/icons/icon-192.png` so the canvas stays untainted and `toBlob` works; never rejects), eyebrow,
headline, sub, stats panel, note, footer. **No stats** (the streak was the headline and the month's only number): no panel, and the headline block and note move down by half a full panel so the card is not blank below. Fonts: `DISPLAY` (Bricolage Grotesque), `BODY` (Hanken Grotesk).

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
- **Inside Capacitor**: WebView `canShare({files})` is false and a blob download is dropped, so the PNG
  goes through `native.js` `saveFile` (Filesystem cache dir + Share sheet). See docs/scripts/native.js.md.
