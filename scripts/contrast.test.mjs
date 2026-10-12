/* WCAG contrast of the token pairs the app actually sets text and UI in.

   Parses styles/tokens.css — the primitives :root block, then the light and
   dark theme blocks layered on top, as the cascade does — resolves var()
   chains down to a colour, composites translucent fills (the dark theme's
   *-soft tints) over --surface, and asserts each pair in both themes:
     - text (body, secondary, muted, links, labels on fills): 4.5:1 (1.4.3)
     - UI (the focus ring against what it sits on): 3:1 (1.4.11 / 2.4.13)
   --brand itself is deliberately absent: it is 2.8:1 on white and carries no
   text (bars, dots); orange text is --brand-ink, orange fills --brand-fill.
   --surface-3 is a hover / chip fill and is not a text background here.
   Run: node scripts/contrast.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const css = readFileSync(path.join(import.meta.dirname, '..', 'styles', 'tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

function block(re, label) {
  const m = css.match(re);
  assert.ok(m, `tokens.css has a ${label} block`);
  const out = {};
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}
const primitives = block(/^:root\s*\{([\s\S]*?)\n\}/m, ':root primitives');
const light = { ...primitives, ...block(/:root,\s*\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/, 'light') };
const dark = { ...light, ...block(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/, 'dark') };

function resolve(theme, name, seen = new Set()) {
  assert.ok(!seen.has(name), `var() cycle at ${name}`);
  seen.add(name);
  const v = theme[name];
  assert.ok(v != null, `${name} is not defined`);
  const m = v.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return m ? resolve(theme, m[1], seen) : v;
}

function parse(v) {
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const hx = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(hx.slice(i, i + 2), 16)).concat(1);
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(m, `can't read colour "${v}"`);
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return [p[0], p[1], p[2], p[3] ?? 1];
}

const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const CANVASES = ['--bg', '--surface', '--surface-2'];
const PAIRS = [
  ...['--fg1', '--fg2', '--fg3'].flatMap((fg) => CANVASES.map((bg) => [fg, bg, TEXT])),
  // links and orange text, and their hover
  ...CANVASES.map((bg) => ['--brand-ink', bg, TEXT]),
  ['--brand-hover', '--surface', TEXT],
  ['--brand-hover', '--bg', TEXT],
  // error text
  ...CANVASES.map((bg) => ['--danger', bg, TEXT]),
  // white labels on filled buttons
  ['--fg-on-brand', '--brand-fill', TEXT],
  ['--fg-on-brand', '--brand-fill-hover', TEXT],
  ['--fg-on-brand', '--danger-fill', TEXT],
  ['--fg-on-brand', '--danger-fill-hover', TEXT],
  // tinted chips / pills: ink on its own tint
  ['--brand-soft-fg', '--brand-soft', TEXT],
  ['--success-soft-fg', '--success-soft', TEXT],
  ['--warning-soft-fg', '--warning-soft', TEXT],
  ['--info-soft-fg', '--info-soft', TEXT],
  ['--ai-soft-fg', '--ai-soft', TEXT],
  ['--social-soft-fg', '--social-soft', TEXT],
  ['--brand-ink', '--brand-soft', TEXT],
  // focus indicator
  ...CANVASES.map((bg) => ['--ring', bg, UI]),
  // the edge of a field, an unchecked check, an off switch (1.4.11)
  ...[...CANVASES, '--surface-3'].map((bg) => ['--control-edge', bg, UI]),
];

const failures = [];
for (const [themeName, theme] of [
  ['light', light],
  ['dark', dark],
]) {
  const surface = parse(resolve(theme, '--surface'));
  for (const [fgName, bgName, min] of PAIRS) {
    let bg = parse(resolve(theme, bgName));
    if (bg[3] < 1) bg = over(bg, surface);
    let fg = parse(resolve(theme, fgName));
    if (fg[3] < 1) fg = over(fg, bg);
    const r = ratio(fg, bg);
    if (r < min) failures.push(`${themeName}: ${fgName} on ${bgName} is ${r.toFixed(2)}:1, needs ${min}:1`);
  }
}
assert.deepEqual(failures, [], 'token pairs under WCAG contrast');
console.log(`contrast: ${PAIRS.length * 2} token pairs pass (text ${TEXT}:1, UI ${UI}:1) in light and dark`);

/* Inline styles in JS can't be checked as pairs, so check what they name: a
   ramp's -50 tint is light-only (no dark twin), and every pill / chip / tag
   that used one stayed a pastel block in dark mode. Use the themed *-soft /
   *-soft-fg pair instead. */
const scriptsDir = import.meta.dirname;
const rampTint = /var\(--(coral|sun|leaf|iris|sky|bloom)-50\)/;
const tinted = readdirSync(scriptsDir)
  .filter((f) => f.endsWith('.js'))
  .flatMap((f) =>
    readFileSync(path.join(scriptsDir, f), 'utf8')
      .split('\n')
      .map((l, i) => (rampTint.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null))
      .filter(Boolean)
  );
assert.deepEqual(tinted, [], 'scripts name a light-only ramp tint; use a themed -soft token');
console.log('contrast: no light-only ramp tints in scripts/*.js');

/* ---------------------------------------------------------------------------
   Components, not just tokens. The token pairs above all passed while four
   components failed in dark mode, because each mixed a raw ramp step (which is
   the same colour in both themes) into its own background: the reminder toast
   (sky-50 under light text, 2.3:1), the food total (1.5:1), the snoozed chips.
   So every rule in styles/ is read here, and:
     (c) a background that names a light ramp step (-50 / -100) needs a
         [data-theme='dark'] twin of the same selector, or it stays a pastel
         tile on the dark page;
     (d) a rule that sets both `color` and `background` is held to 4.5:1 in
         each theme it applies to (3:1 when its own font-size is large), with
         its dark twin's declarations layered on in dark;
     (e) the inline tone maps in scripts ({ bg: 'var(..)', fg: 'var(..)' }),
         which no stylesheet sees, are held to the same 4.5:1.
   Values it cannot resolve (gradients, url(), inherit, premium's glass) are
   skipped, not guessed. */

const root = path.join(import.meta.dirname, '..');
const stylesDir = path.join(root, 'styles');
const files = readdirSync(stylesDir).filter((f) => f.endsWith('.css') && f !== 'tokens.css');
const norm = (sel) => sel.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
const DARK = /\[data-theme='dark'\]\s*/;

function rulesOf(file) {
  const text = readFileSync(path.join(stylesDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' ')
  );
  const out = [];
  const stack = []; // preludes of open blocks
  let buf = '';
  let line = 1;
  let start = 1;
  for (const ch of text) {
    if (ch === '\n') line++;
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), decls: {}, line: start });
      buf = '';
    } else if (ch === '}') {
      const b = stack.pop();
      const inKeyframes = stack.some((x) => x.prelude.startsWith('@keyframes'));
      if (b && !b.prelude.startsWith('@') && !inKeyframes) {
        out.push({ file, line: b.line, selectors: b.prelude.split(',').map(norm), decls: b.decls });
      }
      buf = '';
    } else if (ch === ';') {
      const m = buf.match(/^\s*([\w-]+)\s*:\s*([\s\S]+)$/);
      if (m && stack.length) stack[stack.length - 1].decls[m[1].toLowerCase()] = m[2].trim();
      buf = '';
    } else {
      if (!buf.trim()) start = line;
      buf += ch;
    }
  }
  return out;
}
const rules = files.flatMap(rulesOf);

// Custom properties the stylesheets define themselves (e.g. WhatsApp's green).
for (const r of rules) {
  for (const [k, v] of Object.entries(r.decls)) {
    if (!k.startsWith('--')) continue;
    if (r.selectors.includes(':root')) light[k] = dark[k] = dark[k] ?? v;
    if (r.selectors.includes("[data-theme='dark']")) dark[k] = v;
  }
}

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
function evalColor(theme, v, depth = 0) {
  if (v == null || depth > 20) return null;
  v = v.replace(/\s*!important$/, '').trim();
  if (NAMED[v]) return NAMED[v];
  if (/^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^rgba?\(/i.test(v)) return parse(v);
  let m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (m) return theme[m[1]] != null ? evalColor(theme, theme[m[1]], depth + 1) : evalColor(theme, m[2], depth + 1);
  m = v.match(/^color-mix\(\s*in srgb\s*,([\s\S]+)\)$/);
  if (m) {
    // Split on the top-level comma.
    let d = 0;
    let cut = -1;
    for (let i = 0; i < m[1].length; i++) {
      const c = m[1][i];
      if (c === '(') d++;
      else if (c === ')') d--;
      else if (c === ',' && d === 0) cut = i;
    }
    if (cut < 0) return null;
    const part = (s) => {
      const x = s.trim().match(/^([\s\S]*?)(?:\s+([\d.]+)%)?$/);
      return { c: evalColor(theme, x[1], depth + 1), p: x[2] != null ? Number(x[2]) : null };
    };
    const a = part(m[1].slice(0, cut));
    const b = part(m[1].slice(cut + 1));
    if (!a.c || !b.c) return null;
    let pa = a.p ?? (b.p != null ? 100 - b.p : 50);
    let pb = b.p ?? 100 - pa;
    const sum = pa + pb;
    pa /= sum;
    pb /= sum;
    // Premultiplied mix, as the spec does.
    const al = a.c[3] * pa + b.c[3] * pb;
    if (al === 0) return [0, 0, 0, 0];
    const ch = [0, 1, 2].map((i) => (a.c[i] * a.c[3] * pa + b.c[i] * b.c[3] * pb) / al);
    return ch.concat(al);
  }
  return null;
}
const bgOf = (d) => d['background-color'] ?? d.background;
const remPx = (v) => {
  const m = String(v || '').match(/^([\d.]+)(rem|px)$/);
  if (m) return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
  const t = String(v || '').match(/^var\(\s*(--text-[\w-]+)\s*\)$/);
  return t && primitives[t[1]] ? remPx(primitives[t[1]]) : null;
};
const isLarge = (d) => {
  const px = remPx(d['font-size']);
  const bold = Number(d['font-weight']) >= 700;
  return px != null && (px >= 24 || (bold && px >= 18.66));
};

// Dark twins: "[data-theme='dark'] .x" (and premium's) index by ".x".
const darkTwins = new Map();
for (const r of rules) {
  for (const sel of r.selectors) {
    if (!DARK.test(sel)) continue;
    const base = norm(sel.replace(/html\[data-premium='on'\]\[data-theme='dark'\]\s*/, "html[data-premium='on'] ").replace(DARK, ''));
    if (!darkTwins.has(base)) darkTwins.set(base, {});
    Object.assign(darkTwins.get(base), r.decls);
  }
}

/* Light ramp steps used as a surface on purpose, each with its reason. */
const RAMP_BG_ALLOW = new Set([
  '.gb-water-add--custom', // painted over by [data-theme='dark'] .gb-water-add (same element)
]);
const RAMP = /var\(--(coral|leaf|sun|iris|sky|bloom)-(50|100)\b/;
const rampBg = [];
for (const r of rules) {
  const bg = bgOf(r.decls);
  if (!bg || !RAMP.test(bg)) continue;
  for (const sel of r.selectors) {
    if (DARK.test(sel) || RAMP_BG_ALLOW.has(sel)) continue;
    const twin = darkTwins.get(sel);
    if (!twin || !bgOf(twin)) rampBg.push(`${r.file}:${r.line} ${sel} { background: ${bg} } has no [data-theme='dark'] twin`);
  }
}
assert.deepEqual(rampBg, [], 'light ramp steps used as a background with no dark-theme answer — use a -soft token');

/* Icon-only controls and marks: no text, so 3:1 (WCAG 1.4.11) is the bar. */
const ICON_ONLY = new Set([
  '.gb-check.is-done',
  '.gb-ach-check',
  '.gb-goal-ms-addbtn',
  '.gb-sound-play.is-on',
  '.gb-toast.is-error .gb-toast-icon',
  '.gb-toast.is-success .gb-toast-icon',
  '.gb-toast.is-error .gb-toast-close:hover',
  '.gb-toast.is-success .gb-toast-close:hover',
  '.gb-food-item-row .gb-btn--icon:hover',
  '.gb-water-log-row .gb-btn--icon:hover',
  '.gb-sound-row .gb-btn--icon:hover',
  'scripts/gb-kit.js', // DOMAINS: IconChip tiles
]);
/* Pairs the selector-level reading gets wrong, each with its reason. */
const PAIR_ALLOW = new Set([
  '.gb-water-add--custom', // dark: [data-theme='dark'] .gb-water-add sets its colour (#d8ecff)
]);
const pairFails = [];
let pairCount = 0;
// A gradient face is as good as its worst stop (the premium primary button's
// coral-400 top was 2.3:1 under its label).
function topLevel(args) {
  const out = [];
  let d = 0;
  let cur = '';
  for (const c of args) {
    if (c === '(') d++;
    if (c === ')') d--;
    if (c === ',' && d === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  return out.concat(cur.trim());
}
function stopsOf(v) {
  const m = String(v || '').match(/^linear-gradient\(([\s\S]+)\)$/);
  if (!m) return null;
  return topLevel(m[1])
    .filter((a) => !/^(to |[\d.]+deg)/.test(a))
    .map((a) => a.replace(/\s+[\d.]+%$/, ''));
}
function checkPair(where, decls, theme, themeName) {
  const stops = stopsOf(bgOf(decls));
  if (stops) {
    for (const st of stops) checkPair(where, { ...decls, background: st }, theme, themeName);
    return;
  }
  const surface = parse(resolve(theme, '--surface'));
  let bg = evalColor(theme, bgOf(decls));
  let fg = evalColor(theme, decls.color);
  // A transparent colour hides a glyph on purpose; a transparent background
  // means the real one is the parent's, which a selector can't tell us.
  if (!bg || !fg || fg[3] === 0 || bg[3] === 0) return;
  if (bg[3] < 1) bg = over(bg, surface);
  if (fg[3] < 1) fg = over(fg, bg);
  const key = where.split(' ').slice(1).join(' ');
  const icon = ICON_ONLY.has(key) || ICON_ONLY.has(where.split(':')[0]);
  const min = isLarge(decls) || icon ? UI : TEXT;
  const r = ratio(fg, bg);
  pairCount++;
  if (r < min && !PAIR_ALLOW.has(key))
    pairFails.push(`${themeName}: ${where} is ${r.toFixed(2)}:1, needs ${min}:1`);
}
const PREMIUM = /^html\[data-premium='on'\]\s*/;
const declsFor = (sel) =>
  rules.filter((r) => r.selectors.includes(sel)).reduce((a, r) => ({ ...a, ...r.decls }), {});
for (const r of rules) {
  for (const sel of r.selectors) {
    const where = `${r.file}:${r.line} ${sel}`;
    if (/data-theme='light'/.test(sel)) continue;
    if (DARK.test(sel)) continue; // checked below, layered on its base
    // A premium-skin rule restyles the face; the label colour is the base rule's.
    const decls = PREMIUM.test(sel) ? { ...declsFor(norm(sel.replace(PREMIUM, ''))), ...r.decls } : r.decls;
    if (!decls.color || !bgOf(decls)) continue;
    checkPair(where, decls, light, 'light');
    const twin = darkTwins.get(sel);
    checkPair(where, { ...decls, ...(twin || {}) }, dark, 'dark');
  }
}
for (const [base, decls] of darkTwins) {
  const all = { ...declsFor(base), ...decls };
  if (!(decls.color || bgOf(decls)) || !all.color || !bgOf(all)) continue;
  checkPair(`dark twin ${base}`, all, dark, 'dark');
}

// (e) inline tone maps in scripts.
for (const f of readdirSync(path.join(root, 'scripts')).filter((x) => x.endsWith('.js'))) {
  const text = readFileSync(path.join(root, 'scripts', f), 'utf8');
  for (const m of text.matchAll(/\{\s*bg:\s*'(var\(--[\w-]+\))',\s*fg:\s*'(var\(--[\w-]+\))'/g)) {
    const line = text.slice(0, m.index).split('\n').length;
    for (const [theme, name] of [
      [light, 'light'],
      [dark, 'dark'],
    ]) {
      checkPair(`scripts/${f}:${line} bg ${m[1]} fg ${m[2]}`, { background: m[1], color: m[2] }, theme, name);
    }
  }
}
assert.deepEqual(pairFails, [], 'component colour pairs under WCAG contrast');
console.log(
  `contrast: ${rules.length} rules read; no light ramp surface without a dark twin; ${pairCount} component pairs pass`
);
