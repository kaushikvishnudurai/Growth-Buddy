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
| `shareStoryCard(card, {filename, title})` | → `'shared'｜'saved'｜'unavailable'｜'unsupported'`. Draws, then hands the PNG to `offerFile` (`scripts/save-file.js`): native path, `navigator.share({files})`, a download (`'saved'`), or in the app `'unavailable'` (already toasted). `'unsupported'` = the canvas failed. **A dismissed sheet counts as `'shared'`** (web `AbortError`, native "Share canceled") — the platform doesn't say otherwise |
| (file hand-off) | `shareStoryCard` ends in `offerFile` from `save-file.js`, the one ladder every export uses: native Filesystem + Share in the app when those plugins are present, then `navigator.share({files})`, then a download; in the app with neither, a toast offering the website (`'unavailable'`). Callers toast "downloading" only on `'saved'` |
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
- **Inside Capacitor** (`shareNatively`, now in `save-file.js`): WebView `canShare({files})` is false, so the PNG is written
  with `nativePlugin('Filesystem').writeFile` (bare base64, `directory: 'CACHE'`) and the `file://`
  URI handed to `nativePlugin('Share').share({files: [uri]})`. A missing/failed plugin → `null` →
  next rung. Needs **`@capacitor/share` + `@capacitor/filesystem` installed in
  `../Growth-Buddy-Mobile`** (`npm i`, `npx cap sync`); without them (today) the WebView's
  `<a download>` does nothing, so `offerFile` says "Saving files isn't available in the app yet" with
  an "Open website" button instead of a download toast that lied.
  The proxy from `nativePlugin` exists either way, so "missing" is only a rejected call — hence the `try`s.
