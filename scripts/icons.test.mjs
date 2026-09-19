/* Every icon the app asks for must be registered in scripts/icons.js.

   `icons.js` is a hand-kept subset — the full lucide set is ~600 kB — and it
   registers PascalCase identifiers while the app asks for kebab-case names.
   Miss one and it renders as NOTHING: no error, no console warning, no empty
   box. The UI audit can't see it either, because a missing icon is neither an
   overflow nor a console error. Three shipped that way in one sitting (`bike`,
   `footprints`, `refresh-cw`) before this check existed.

   Run: node scripts/icons.test.mjs */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const root = path.join(import.meta.dirname, '..');
const reg = readFileSync(path.join(root, 'scripts/icons.js'), 'utf8');
const registered = new Set([...reg.matchAll(/^\s*([A-Z][A-Za-z0-9]*),\s*$/gm)].map((m) => m[1]));
const pascal = (kebab) => kebab.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

const used = new Map();
for (const f of readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.js'))) {
  if (f === 'icons.js') continue;
  const text = readFileSync(path.join(root, 'scripts', f), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const re of [/Icon\(\s*['"]([a-z0-9-]+)['"]/g, /icon:\s*['"]([a-z0-9-]+)['"]/g, /data-lucide=['"]([a-z0-9-]+)['"]/g]) {
      for (const m of line.matchAll(re)) {
        if (!used.has(m[1])) used.set(m[1], []);
        used.get(m[1]).push(`${f}:${i + 1}`);
      }
    }
  });
}
const missing = [...used].filter(([name]) => !registered.has(pascal(name)));
if (missing.length) {
  console.error('icons used but NOT registered in scripts/icons.js — they render as nothing:');
  for (const [n, where] of missing) {
    console.error(`  ${n}  (add ${pascal(n)})  ← ${where.slice(0, 3).join(', ')}`);
  }
  process.exit(1);
}
console.log(`icons.test.mjs: ${used.size} icons used, all ${registered.size} registrations resolve`);
