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
import { readFileSync } from 'node:fs';
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
  // focus indicator
  ...CANVASES.map((bg) => ['--ring', bg, UI]),
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
