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

console.log(
  `tokens.test.mjs: ${used.length} bare var() references, ${defined.size} tokens defined, none missing`
);
