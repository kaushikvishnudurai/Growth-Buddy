/* Command palette: ranking and match highlighting, DOM-free (palette.js draws,
   palette-core.test.mjs checks). An item is { key, kind, label, alt?: [string] };
   `key` is stable across sessions ('act:new-task', 'task:<id>'), so the recent
   picks saved in ui_prefs.paletteRecent still find their item after a reload. */

// Group order, and the tie-break between equally good matches.
export const KIND_ORDER = ['action', 'screen', 'task', 'habit', 'goal', 'reminder', 'note', 'expense', 'circle'];
export const RECENT_MAX = 6;

// One character folded: lower case, accents off ("É" -> "e"). Used per char so a
// highlight can map folded positions back onto the original label.
const foldChar = (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Café  Run" -> "cafe run": lower case, accents off, runs of space as one. */
export function fold(s) {
  return Array.from(String(s || ''), foldChar).join('').replace(/\s+/g, ' ').trim();
}

/* 3 the text starts with it, 2 a word does, 1 it is inside, 0 no match. Several
   words that don't match as one phrase still match when each word does ("milk
   buy" finds "Buy oat milk"), as a weak (1) match.
   ponytail: no character-skipping fuzz ("bym" -> "buy milk"); add it if people miss it. */
function scoreText(text, q) {
  if (!text || !q) return 0;
  if (text.startsWith(q)) return 3;
  if ((' ' + text).includes(' ' + q)) return 2;
  if (text.includes(q)) return 1;
  const words = q.split(' ');
  if (words.length < 2) return 0;
  return words.every((w) => scoreText(text, w)) ? 1 : 0;
}

/** Best score of the item's label and its alternates (synonyms) against the query. */
export function matchScore(item, query) {
  const q = fold(query);
  if (!q) return 0;
  return Math.max(scoreText(fold(item.label), q), ...(item.alt || []).map((a) => scoreText(fold(a), q)));
}

const kindRank = (k) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : KIND_ORDER.length);
// recent is newest first; an item never picked sorts after every picked one.
const recencyRank = (recent, key) => (recent.includes(key) ? recent.indexOf(key) : Infinity);

/** Matching items, best first: score, then kind order, then recency, then label. */
export function rankItems(items, query, recent = []) {
  return items
    .map((item) => ({ item, score: matchScore(item, query) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        kindRank(a.item.kind) - kindRank(b.item.kind) ||
        recencyRank(recent, a.item.key) - recencyRank(recent, b.item.key) ||
        fold(a.item.label).localeCompare(fold(b.item.label))
    )
    .map((x) => x.item);
}

/* Ranked items into groups. A group sits where its best item ranked, so a task
   matched on its first letter leads an action that only contains the text. Each
   group keeps at most `perGroup`. */
export function groupRanked(ranked, perGroup = 5) {
  const byKind = new Map();
  for (const item of ranked) {
    if (!byKind.has(item.kind)) byKind.set(item.kind, { kind: item.kind, items: [] });
    const g = byKind.get(item.kind);
    if (g.items.length < perGroup) g.items.push(item);
  }
  return [...byKind.values()];
}

/** The empty query: recent picks that still exist, then the first actions not already listed. */
export function emptyResults(items, recent = [], topActions = 6) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const picks = recent.map((k) => byKey.get(k)).filter(Boolean);
  const actions = items.filter((i) => i.kind === 'action' && !picks.includes(i)).slice(0, topActions);
  return [
    picks.length && { kind: 'recent', items: picks },
    actions.length && { kind: 'action', items: actions },
  ].filter(Boolean);
}

/** A pick moved to the front of the recent list, deduped, capped at RECENT_MAX. */
export function pushRecent(recent, key) {
  const prev = Array.isArray(recent) ? recent.filter((k) => typeof k === 'string' && k !== key) : [];
  return [key, ...prev].slice(0, RECENT_MAX);
}

/* The label cut into [{ text, hit }] runs for drawing: the query as one phrase
   where it occurs, else each of its words. Matching is on the folded label, so
   "cafe" lights "Café"; positions map back through the per-character fold. */
export function highlight(label, query) {
  const chars = Array.from(String(label || ''));
  let folded = '';
  const at = []; // folded index -> original char index
  chars.forEach((c, i) => {
    const f = foldChar(c);
    folded += f;
    for (let k = 0; k < f.length; k++) at.push(i);
  });
  const q = fold(query);
  const hit = new Array(chars.length).fill(false);
  const mark = (needle) => {
    if (!needle) return false;
    // Prefer a word start, the way the score does; else the first occurrence.
    let i = (' ' + folded).indexOf(' ' + needle);
    if (i === -1) i = folded.indexOf(needle);
    if (i === -1) return false;
    for (let k = i; k < i + needle.length; k++) hit[at[k]] = true;
    return true;
  };
  if (!mark(q)) q.split(' ').forEach(mark);
  const runs = [];
  chars.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.hit === hit[i]) last.text += c;
    else runs.push({ text: c, hit: hit[i] });
  });
  return runs;
}
