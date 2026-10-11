// node scripts/gen-brand-images.mjs — the brand images in public/, drawn from
// the logomark, the brand fonts and the brand colours by a headless Chrome:
//   og-image.png            1200x630 link preview (index.html / privacy.html og:image)
//   icons/badge-96.png      push badge: the seedling alone, white on transparent
//   splash/<w>x<h>.png      iOS launch images (index.html apple-touch-startup-image)
//   favicon.ico             favicon-32.png wrapped as an ICO (PNG inside, Vista+)
// Needs a Chrome with --remote-debugging-port (GB_E2E_CDP, default
// http://127.0.0.1:9223). Re-run after a change to the logomark or the tagline.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const CDP = process.env.GB_E2E_CDP || 'http://127.0.0.1:9223';

// The iOS screens index.html lists, portrait, in device pixels.
const SPLASH_SIZES = [
  [1290, 2796],
  [1179, 2556],
  [1284, 2778],
  [1170, 2532],
  [1125, 2436],
  [828, 1792],
  [750, 1334],
];

const font = (pkg, file) =>
  'data:font/woff2;base64,' +
  readFileSync(join(ROOT, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64');
const FONTS = `
@font-face { font-family: 'Bricolage Grotesque'; font-weight: 800; src: url(${font('bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Hanken Grotesk'; font-weight: 500; src: url(${font('hanken-grotesk', 'hanken-grotesk-latin-500-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Hanken Grotesk'; font-weight: 700; src: url(${font('hanken-grotesk', 'hanken-grotesk-latin-700-normal.woff2')}) format('woff2'); }`;

const LOGO = readFileSync(join(PUB, 'logomark.svg'), 'utf8');
// The seedling without its tile, one colour: the badge is an alpha mask.
const SEEDLING_MONO = `<svg viewBox="14 10 36 42" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 48V30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <path d="M32 33C24 33 17.5 27 18.5 17.5C28 16.5 34 23 32 33Z" fill="#fff"/>
  <path d="M32 30C40 30 46.5 24 45.5 14.5C36 13.5 30 20 32 30Z" fill="#fff"/></svg>`;
// Brand tokens (styles/tokens.css): coral-500, coral-700, coral-50, warm-25, fg1, fg2, iris-50.
const C = { brand: '#F97316', ink: '#BE4A0A', soft: '#FFF4EB', bg: '#FFFCFA', fg1: '#1E1713', fg2: '#6B5C50' };

const OG = `<!doctype html><html><head><style>${FONTS}
html, body { margin: 0; width: 1200px; height: 630px; }
body { display: flex; align-items: center; gap: 64px; padding: 0 96px; box-sizing: border-box;
  background: radial-gradient(90% 120% at 0% 0%, ${C.soft} 0%, transparent 60%),
    radial-gradient(80% 110% at 100% 100%, #EFEBFF 0%, transparent 55%), ${C.bg};
  font-family: 'Hanken Grotesk', sans-serif; color: ${C.fg1}; }
.mark { width: 260px; height: 260px; flex: none; filter: drop-shadow(0 18px 40px rgba(249,115,22,.35)); }
.mark svg { width: 100%; height: 100%; }
h1 { margin: 0; font: 800 96px/1 'Bricolage Grotesque', sans-serif; letter-spacing: -0.03em; }
p { margin: 22px 0 0; font-size: 36px; line-height: 1.3; font-weight: 500; color: ${C.fg2}; max-width: 640px; }
.chips { display: flex; gap: 12px; margin-top: 34px; flex-wrap: wrap; }
.chips span { font-weight: 700; font-size: 24px; padding: 10px 20px; border-radius: 999px; background: ${C.soft}; color: ${C.ink}; }
</style></head><body>
<div class="mark">${LOGO}</div>
<div><h1>Growth Buddy</h1>
<p>Your friendly accountability app for habits, tasks, fitness and growth.</p>
<div class="chips"><span>Habits</span><span>Tasks</span><span>Water</span><span>Money</span><span>Circle</span></div></div>
</body></html>`;

const splash = (w, h) => `<!doctype html><html><head><style>
html, body { margin: 0; width: ${w}px; height: ${h}px; background: ${C.brand}; }
body { display: grid; place-items: center; }
svg { width: ${Math.round(w * 0.34)}px; height: ${Math.round(w * 0.34)}px; }
</style></head><body>${LOGO}</body></html>`;

const badge = `<!doctype html><html><head><style>
html, body { margin: 0; width: 96px; height: 96px; background: transparent; }
svg { width: 96px; height: 96px; display: block; }
</style></head><body>${SEEDLING_MONO}</body></html>`;

async function shot(page, html, w, h, file, transparent = false) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: 'png', omitBackground: transparent });
  console.log('wrote', file.replace(ROOT + '/', ''));
}

/** A one-image ICO holding a PNG as-is (6-byte header + 16-byte entry). */
function pngToIco(png) {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(w >= 256 ? 0 : w, 6);
  head.writeUInt8(h >= 256 ? 0 : h, 7);
  head.writeUInt8(0, 8); // no palette
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); // colour planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18); // data offset
  return Buffer.concat([head, png]);
}

const ico = pngToIco(readFileSync(join(PUB, 'favicon-32.png')));
writeFileSync(join(PUB, 'favicon.ico'), ico);
console.log('wrote public/favicon.ico');

const browser = await puppeteer.connect({ browserURL: CDP });
const page = await browser.newPage();
try {
  await shot(page, OG, 1200, 630, join(PUB, 'og-image.png'));
  await shot(page, badge, 96, 96, join(PUB, 'icons/badge-96.png'), true);
  for (const [w, h] of SPLASH_SIZES) await shot(page, splash(w, h), w, h, join(PUB, 'splash', `${w}x${h}.png`));
} finally {
  await page.close();
  browser.disconnect();
}
