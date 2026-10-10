/* Every var(--x) with no fallback must resolve to a real --x.

   This is the check that was missing. `.gb-modal` asked for `var(--dur)` and
   `var(--shadow-xl)`; neither token has ever existed. An undefined var() with
   no fallback makes the whole declaration invalid at computed-value time, so
   the modal's transition was silently dropped — every dialog in the app snapped
   open for as long as that line has been there, and nothing said a word.

   A var() WITH a fallback is fine by definition, so only the bare form is
   flagged. Run: node scripts/tokens.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const cssDir = path.join(root, 'styles');
const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith('.css'));

const defined = new Set();
const used = []; // { name, file, line }

for (const f of cssFiles) {
  const text = readFileSync(path.join(cssDir, f), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    // Bare var(--x) only: var(--x, anything) carries its own answer.
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      used.push({ name: m[1], file: f, line: i + 1 });
    }
  });
}

// Custom properties the app sets from JS (inline styles, theme switches) are
// real definitions too — they just don't live in a stylesheet.
for (const f of readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(path.join(root, 'scripts', f), 'utf8');
  for (const m of text.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(m[1]);
}

const missing = used.filter((u) => !defined.has(u.name));
assert.deepEqual(
  missing.map((m) => `${m.file}:${m.line} var(${m.name})`),
  [],
  'custom properties used with no fallback and never defined'
);

/* (a) Every semantic token the light theme defines, the dark theme defines too.
   A token set only under [data-theme="light"] resolves in dark mode to whatever
   :root says — usually the light value — and the screen goes half-light. */
const tokensCss = readFileSync(path.join(cssDir, 'tokens.css'), 'utf8');
const themeBlock = (name) => {
  const m = tokensCss.match(new RegExp(`\\[data-theme="${name}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `tokens.css has a [data-theme="${name}"] block`);
  return new Set([...m[1].matchAll(/(--[\w-]+)\s*:/g)].map((x) => x[1]));
};
const light = themeBlock('light');
const dark = themeBlock('dark');
assert.deepEqual(
  [...light].filter((t) => !dark.has(t)),
  [],
  'tokens defined for the light theme but not the dark one'
);

/* (b) No new raw hex colour in a stylesheet rule. A literal is the same colour in
   both themes, which is how text ended up dark-on-dark. Exempt: token
   definitions (`--x: #…`), a var() fallback, url(...) (SVG data URIs), rules
   scoped to [data-theme='dark'] (they ARE the dark answer), comments, and the
   allowlist below — colours that are deliberately theme-independent. Add to it
   only with a reason. */
const HEX_ALLOW = new Set([
  'app.css #000', // mask-image / mask-composite stencils: alpha only, never painted
  'app.css #fff', // switch knobs: white on both themes, like the platform control
  'app.css #f45b4b', // first-launch confetti illustration
  'app.css #e0402f',
  'app.css #e59a0e',
]);
const rawHex = [];
for (const f of cssFiles.filter((f) => f !== 'tokens.css')) {
  const text = readFileSync(path.join(cssDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, ' ')
  );
  const stack = [];
  let buf = '';
  text.split('\n').forEach((line, i) => {
    const scope = stack.join(' ');
    if (!/^\s*--[\w-]+\s*:/.test(line) && !/data-theme=['"]dark['"]/.test(scope + buf)) {
      const bare = line
        .replace(/url\([^)]*\)/g, '')
        .replace(/var\(\s*--[\w-]+\s*,\s*#[0-9a-fA-F]+\s*\)/g, '');
      for (const m of bare.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (!HEX_ALLOW.has(`${f} ${m[0].toLowerCase()}`)) rawHex.push(`${f}:${i + 1} ${m[0]}`);
      }
    }
    for (const ch of line) {
      if (ch === '{') {
        stack.push(buf);
        buf = '';
      } else if (ch === '}') {
        stack.pop();
        buf = '';
      } else if (ch === ';') buf = '';
      else buf += ch;
    }
    buf += ' ';
  });
}
assert.deepEqual(rawHex, [], 'raw hex colours outside tokens.css — use a token (styles/tokens.css)');

console.log(
  `tokens.test.mjs: ${used.length} bare var() references, ${defined.size} tokens defined, none missing; ` +
    `${light.size} light tokens all themed for dark; no raw hex outside the allowlist`
);
