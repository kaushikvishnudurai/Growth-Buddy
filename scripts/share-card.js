/* =====================================================================
   Growth Buddy — shareable story card

   Draws a 1080×1920 (9:16) PNG on a canvas and hands it to the OS share
   sheet, where Instagram offers "Add to story". There is no web API that
   posts to Instagram directly — the share sheet is the whole mechanism,
   and it is also why this works for WhatsApp status, Snapchat and the
   photo library at no extra cost.

   Canvas, `toBlob` and the Web Share API are all platform features; this
   file adds no dependency and works offline. Inside the Capacitor app the
   PNG goes through @capacitor/filesystem + @capacitor/share instead (both
   installed in ../Growth-Buddy-Mobile, reached via the bridge).
   ===================================================================== */

import { isNative, nativePlugin } from './native.js';

const W = 1080;
const H = 1920;
const PAD = 88;
/* Instagram lays its own controls over the top ~250px and bottom ~250px of a
   story. Everything that has to be readable lives between them. */
const BRAND_Y = 300;
const EYEBROW_Y = 480;
const FOOTER_UP = 250;

const DISPLAY = '"Bricolage Grotesque", "Hanken Grotesk", system-ui, sans-serif';
const BODY = '"Hanken Grotesk", system-ui, -apple-system, sans-serif';

/** Split `text` into lines that fit `maxW` at the current ctx font. */
function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
}

/** `text` cut with an ellipsis to fit `maxW` at the current ctx font. */
function fit(ctx, text, maxW) {
  let t = String(text || '');
  if (maxW <= 0) return '';
  if (ctx.measureText(t).width <= maxW) return t;
  while (t && ctx.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
  return t ? t.trimEnd() + '\u2026' : '';
}

/* A rounded rect path. ctx.roundRect is Chrome 99 / Safari 16 / Firefox 112:
   an older WebView threw on it and the share button just failed. */
function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') return ctx.roundRect(x, y, w, h, r);
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/** The app icon, or null if it can't be read. Never rejects. */
function loadLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // Same-origin, so the canvas stays untainted and toBlob() works.
    img.src = '/icons/icon-192.png';
  });
}

/**
 * Draw the card and return it as a PNG blob (exported so it can be previewed
 * or saved without going through the share sheet).
 *
 * @param {object} card
 * @param {string} card.eyebrow   small caps line above the headline
 * @param {string} card.headline  the one big number
 * @param {string} card.sub       what the headline is
 * @param {{label:string,value:string}[]} card.stats  up to 3 rows
 * @param {string} card.note      one encouraging sentence
 * @param {string} card.footer    small print at the bottom
 */
export async function renderStoryCard(card) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Canvas text does NOT trigger a font download the way DOM text does: an
  // @font-face the page has declared but never painted stays unloaded, and
  // ctx.fillText silently falls back to Helvetica. `document.fonts.ready`
  // alone isn't enough — it resolves happily over faces nobody asked for.
  // Ask for each family/weight by hand first (the size in the shorthand is
  // ignored for loading purposes, only family + weight + style matter).
  if (document.fonts && document.fonts.load) {
    try {
      await Promise.all(
        [
          '800 100px "Bricolage Grotesque"',
          '700 100px "Bricolage Grotesque"',
          '500 100px "Hanken Grotesk"',
          '600 100px "Hanken Grotesk"',
          '700 100px "Hanken Grotesk"',
        ].map((font) => document.fonts.load(font))
      );
      await document.fonts.ready;
    } catch (_) {
      /* draw with whatever is available */
    }
  }

  // Brand gradient + a soft top-right glow so the flat fill has some depth.
  const bg = ctx.createLinearGradient(0, 0, W * 0.6, H);
  bg.addColorStop(0, '#FF8C33');
  bg.addColorStop(0.55, '#F97316');
  bg.addColorStop(1, '#BE4A0A');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, W * 0.9);
  glow.addColorStop(0, 'rgba(255,255,255,0.22)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ---- brand row ----
  const logo = await loadLogo();
  let brandX = PAD;
  if (logo) {
    // The app icon is orange on orange, so it needs something to sit on.
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    roundRect(ctx, PAD, BRAND_Y, 92, 92, 26);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, PAD + 10, BRAND_Y + 10, 72, 72, 20);
    ctx.clip();
    ctx.drawImage(logo, PAD + 10, BRAND_Y + 10, 72, 72);
    ctx.restore();
    brandX = PAD + 124;
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '600 42px ' + BODY;
  ctx.textBaseline = 'middle';
  ctx.fillText('Growth Buddy', brandX, BRAND_Y + 46);

  // ---- headline block ----
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '700 34px ' + BODY;
  ctx.fillText(fit(ctx, String(card.eyebrow || '').toUpperCase(), W - PAD * 2), PAD, EYEBROW_Y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 148px ' + DISPLAY;
  ctx.fillText(fit(ctx, card.headline, W - PAD * 2), PAD, EYEBROW_Y + 160);

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '500 46px ' + BODY;
  ctx.fillText(fit(ctx, card.sub, W - PAD * 2), PAD, EYEBROW_Y + 230);

  // ---- stats panel ----
  const stats = (card.stats || []).slice(0, 3);
  const panelY = EYEBROW_Y + 340;
  const rowH = 132;
  const panelH = stats.length * rowH + 48;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  roundRect(ctx, PAD, panelY, W - PAD * 2, panelH, 44);
  ctx.fill();

  stats.forEach((s, i) => {
    const y = panelY + 24 + rowH * i + rowH / 2;
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD + 44, y - rowH / 2);
      ctx.lineTo(W - PAD - 44, y - rowH / 2);
      ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    // The value keeps its width (up to most of the row); the label gets what is
    // left, less a gap, and is cut with an ellipsis rather than run under it.
    const inner = W - PAD * 2 - 96;
    ctx.font = '700 52px ' + DISPLAY;
    const value = fit(ctx, s.value, inner * 0.6);
    const valueW = ctx.measureText(value).width;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.font = '500 44px ' + BODY;
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, s.label, inner - valueW - 32), PAD + 48, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 52px ' + DISPLAY;
    ctx.textAlign = 'right';
    ctx.fillText(value, W - PAD - 48, y);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // ---- note ----
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = '500 48px ' + BODY;
  let y = panelY + panelH + 120;
  wrap(ctx, card.note, W - PAD * 2)
    .slice(0, 3)
    .forEach((line) => {
      ctx.fillText(line, PAD, y);
      y += 68;
    });

  // ---- footer ----
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = '500 34px ' + BODY;
  ctx.fillText(fit(ctx, card.footer, W - PAD * 2), PAD, H - FOOTER_UP);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Draw the card and offer it to the OS.
 *
 * @returns {Promise<'shared'|'saved'|'unsupported'>} — `shared` when the share
 *   sheet took it (Instagram lives in there), `saved` when the browser can
 *   only download, `unsupported` when the canvas itself failed. Dismissing
 *   the sheet also resolves `shared`; the platform doesn't tell us otherwise.
 */
export async function shareStoryCard(card, { filename = 'growth-buddy.png', title = 'Growth Buddy' } = {}) {
  const blob = await renderStoryCard(card);
  if (!blob) return 'unsupported';
  const file = new File([blob], filename, { type: 'image/png' });

  // Inside the app the WebView's canShare({files}) is false, so the image is
  // written to the cache dir and its file:// URI handed to the native sheet.
  if (isNative()) {
    const native = await shareNatively(blob, filename, title);
    if (native) return native;
  }

  // canShare({files}) is the only honest test — Android WebView and desktop
  // Firefox have navigator.share but reject files.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      // AbortError = the user closed the sheet. Anything else falls through
      // to the download so they still get the image.
      if (err && err.name === 'AbortError') return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** A blob -> its bytes as bare base64 (no data: prefix), for Filesystem.writeFile. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * The Capacitor path: Filesystem.writeFile into the cache directory, then
 * Share.share with that file's URI. Resolves 'shared', or null when either
 * plugin is missing from this APK (or fails) so the caller falls back to the
 * download. `nativePlugin` hands back a proxy whether or not the native class
 * exists, so "missing" only shows up as a rejected call — hence the try.
 */
async function shareNatively(blob, filename, title) {
  const FS = nativePlugin('Filesystem');
  const Share = nativePlugin('Share');
  if (!FS || !Share) return null;
  let uri;
  try {
    const data = await blobToBase64(blob);
    // 'CACHE' is Directory.Cache's value; the enum lives in the plugin package.
    const res = await FS.writeFile({ path: filename, data, directory: 'CACHE' });
    uri = res && res.uri;
  } catch (_) {
    return null;
  }
  if (!uri) return null;
  try {
    await Share.share({ title, files: [uri] });
    return 'shared';
  } catch (err) {
    // A dismissed sheet rejects with "Share canceled" — that is still a share
    // offered, same as the web AbortError. Anything else (UNIMPLEMENTED on an
    // older APK) falls back to the download.
    const msg = String((err && err.message) || err || '');
    return /cancel/i.test(msg) ? 'shared' : null;
  }
}

/* Dev self-check: the layout maths that would silently produce an overlapping
   or off-canvas card, and the wrap that would run text past the edge. */
export function _demo() {
  const a = console.assert;
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = '500 48px sans-serif';
  const lines = wrap(ctx, 'a '.repeat(200).trim(), 400);
  a(lines.length > 1, 'long text wraps');
  a(lines.every((l) => ctx.measureText(l).width <= 400), 'no wrapped line overflows');
  a(wrap(ctx, '', 400).length === 0, 'empty text makes no lines');
  const cut = fit(ctx, 'x'.repeat(200), 300);
  a(cut.endsWith('\u2026') && ctx.measureText(cut).width <= 300, 'a long label is cut to fit');
  a(fit(ctx, 'short', 300) === 'short', 'a label that fits is left alone');
  const panelH = 3 * 132 + 48;
  const noteEnd = EYEBROW_Y + 340 + panelH + 120 + 68 * 2;
  a(noteEnd < H - FOOTER_UP, 'three stats + three note lines clear the footer');
  a(BRAND_Y > 250, 'the brand row clears Instagram\'s top chrome');
  a(EYEBROW_Y > BRAND_Y + 92, 'the eyebrow clears the brand row');
  console.log('[share-card] self-check ran');
}
