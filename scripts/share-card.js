/* =====================================================================
   Growth Buddy — shareable story card

   Draws a 1080×1920 (9:16) PNG on a canvas and hands it to the OS share
   sheet, where Instagram offers "Add to story". There is no web API that
   posts to Instagram directly — the share sheet is the whole mechanism,
   and it is also why this works for WhatsApp status, Snapchat and the
   photo library at no extra cost.

   Canvas, `toBlob` and the Web Share API are all platform features; this
   file adds no dependency and works offline.
   ===================================================================== */

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
    ctx.roundRect(PAD, BRAND_Y, 92, 92, 26);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD + 10, BRAND_Y + 10, 72, 72, 20);
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
  ctx.fillText(String(card.eyebrow || '').toUpperCase(), PAD, EYEBROW_Y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 148px ' + DISPLAY;
  ctx.fillText(card.headline || '', PAD, EYEBROW_Y + 160);

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '500 46px ' + BODY;
  ctx.fillText(card.sub || '', PAD, EYEBROW_Y + 230);

  // ---- stats panel ----
  const stats = (card.stats || []).slice(0, 3);
  const panelY = EYEBROW_Y + 340;
  const rowH = 132;
  const panelH = stats.length * rowH + 48;
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.roundRect(PAD, panelY, W - PAD * 2, panelH, 44);
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
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.font = '500 44px ' + BODY;
    ctx.textAlign = 'left';
    ctx.fillText(s.label, PAD + 48, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 52px ' + DISPLAY;
    ctx.textAlign = 'right';
    ctx.fillText(s.value, W - PAD - 48, y);
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
  ctx.fillText(card.footer || '', PAD, H - FOOTER_UP);

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

  // canShare({files}) is the only honest test — Android WebView and desktop
  // Firefox have navigator.share but reject files.
  // ponytail: inside the Capacitor wrapper this is usually false, so the app
  // falls back to a download. Swap in @capacitor/share (Filesystem URI) there
  // if the native share sheet is worth the plugin.
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
  const panelH = 3 * 132 + 48;
  const noteEnd = EYEBROW_Y + 340 + panelH + 120 + 68 * 2;
  a(noteEnd < H - FOOTER_UP, 'three stats + three note lines clear the footer');
  a(BRAND_Y > 250, 'the brand row clears Instagram\'s top chrome');
  a(EYEBROW_Y > BRAND_Y + 92, 'the eyebrow clears the brand row');
  console.log('[share-card] self-check ran');
}
