/* Command palette ranking, DOM-free (palette.js draws it, palette-core.test.mjs
   checks it). An item is { key, kind, label, alt?: [string] }; `key` is stable
   across sessions ('act:new-task', 'task:<id>') so recent picks survive a reload. */

// Group order, and the tie-break between equally good matches.
export const KIND_ORDER = ['action', 'screen', 'task', 'habit', 'goal', 'reminder', 'note'];
export const RECENT_MAX = 5;

/** Lower-case, diacritics off, runs of space as one: "Café  Run" -> "cafe run". */
export function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* 3 prefix, 2 a word starts with it, 1 anywhere inside, 0 no match. A query of
   several words that doesn't match as one phrase still matches when every word
   does ("milk buy" finds "Buy oat milk"), scored as its weakest word.
   ponytail: no character-skipping fuzz ("bym" -> "buy milk"); add it if people miss it. */
function scoreText(text, q) {
  if (!text || !q) return 0;
  if (text.startsWith(q)) return 3;
  if ((' ' + text).includes(' ' + q)) return 2;
  if (text.includes(q)) return 1;
  const words = q.split(' ');
  if (words.length < 2) return 0;
  let min = 3;
  for (const w of words) {
    const s = scoreText(text, w);
    if (!s) return 0;
    if (s < min) min = s;
  }
  return Math.min(min, 1);
}

/** Best score of the item's label and its alternates against the query. */
export function matchScore(item, query) {
  const q = fold(query);
  if (!q) return 0;
  let best = scoreText(fold(item.label), q);
  for (const a of item.alt || []) best = Math.max(best, scoreText(fold(a), q));
  return best;
}

const kindRank = (k) => {
  const i = KIND_ORDER.indexOf(k);
  return i === -1 ? KIND_ORDER.length : i;
};
// recent = newest first; never picked sorts after every picked one.
const recencyRank = (recent, key) => {
  const i = recent.indexOf(key);
  return i === -1 ? Infinity : i;
};

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

/* Ranked items into groups: a group sits where its best item ranked, so a task
   that matched on its first letter leads an action that only contains the text.
   Each group keeps at most `perGroup`. */
export function groupRanked(ranked, perGroup = 6) {
  const groups = [];
  const byKind = new Map();
  for (const item of ranked) {
    let g = byKind.get(item.kind);
    if (!g) {
      g = { kind: item.kind, items: [] };
      byKind.set(item.kind, g);
      groups.push(g);
    }
    if (g.items.length < perGroup) g.items.push(item);
  }
  return groups;
}

/** The empty query: recent picks that still exist, then the top actions not already listed. */
export function emptyResults(items, recent = [], topActions = 6) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const picks = recent.map((k) => byKey.get(k)).filter(Boolean);
  const seen = new Set(picks.map((i) => i.key));
  const actions = items.filter((i) => i.kind === 'action' && !seen.has(i.key)).slice(0, topActions);
  const groups = [];
  if (picks.length) groups.push({ kind: 'recent', items: picks });
  if (actions.length) groups.push({ kind: 'action', items: actions });
  return groups;
}

/** A pick moved to the front of the recent list, deduped, capped at RECENT_MAX. */
export function pushRecent(recent, key) {
  const prev = Array.isArray(recent) ? recent.filter((k) => typeof k === 'string') : [];
  return [key, ...prev.filter((k) => k !== key)].slice(0, RECENT_MAX);
}
