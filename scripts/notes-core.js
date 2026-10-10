/* =====================================================================
   Growth Buddy — Notes' pure rules (no DOM, no imports)
   What notes.js decides without touching the page: labels, sort order,
   search matching + highlight segments, the search-text cache and what the
   offline copy keeps. Pinned by `node scripts/notes-core.test.mjs`.
   ===================================================================== */

/* ---- labels: same rules as NoteLabels.java, which is the enforced copy ---- */
export const LABEL_MAX = 10;
export const LABEL_LEN = 30;

/** A string ("a, b") or a list, as labels: trimmed, spaces collapsed, empties
    and case-insensitive duplicates dropped (the first spelling wins). */
export function parseLabels(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((x) => x !== null && x !== undefined)
    .flatMap((x) => String(x).split(','));
  const seen = new Map();
  for (const p of parts) {
    const label = p.trim().replace(/\s+/g, ' ');
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()];
}

/** The message the server would answer with, or null when the list is fine. */
export function validateLabels(labels) {
  if ((labels || []).some((l) => l.length > LABEL_LEN)) {
    return 'A label can be at most ' + LABEL_LEN + ' characters.';
  }
  if ((labels || []).length > LABEL_MAX) {
    return 'A note can have at most ' + LABEL_MAX + ' labels.';
  }
  return null;
}

/** Every label used across `notes`, once each (ignoring case), A→Z. */
export function labelsInUse(notes) {
  return parseLabels((notes || []).flatMap((n) => n.labels || [])).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

export const hasLabel = (note, label) =>
  !label || (note.labels || []).some((l) => l.toLowerCase() === label.toLowerCase());

/* ---- sort ---- */
export const SORTS = [
  { key: 'updated', label: 'Last edited' },
  { key: 'created', label: 'Date created' },
  { key: 'title', label: 'Title' },
];
export const SORT_PREF_KEY = 'gb.notesSort';
export const sortKeyOf = (v) => (SORTS.some((s) => s.key === v) ? v : 'updated');

const time = (iso) => {
  const t = new Date(iso || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Pinned first whatever the sort; then newest edit / newest created / title
    A→Z (an untitled note after every titled one, newest edit first). */
export function compareNotes(sortKey) {
  const key = sortKeyOf(sortKey);
  return (a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (key === 'title') {
      const ta = (a.title || '').trim();
      const tb = (b.title || '').trim();
      if (!ta !== !tb) return ta ? -1 : 1;
      const byTitle = ta.localeCompare(tb, undefined, { sensitivity: 'base', numeric: true });
      if (byTitle) return byTitle;
    }
    if (key === 'created') {
      const byCreated = time(b.createdAt) - time(a.createdAt);
      if (byCreated) return byCreated;
    }
    return time(b.updatedAt) - time(a.updatedAt);
  };
}

/* ---- search ---- */
export const queryWords = (q) =>
  String(q || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

/** Every word somewhere in `hay` (already lowercased). */
export const matchesAll = (hay, words) => words.every((w) => hay.includes(w));

/**
 * `text` as [{text, hit}] runs, hit = inside a match of any word, ignoring
 * case. Overlapping and touching matches merge into one run. The caller turns
 * hits into <mark> elements and the rest into text nodes — never innerHTML,
 * since `text` is the user's.
 */
export function splitHighlights(text, words) {
  const s = String(text || '');
  const lower = s.toLowerCase();
  const marks = new Array(s.length).fill(false);
  for (const w of words || []) {
    if (!w) continue;
    for (let i = lower.indexOf(w); i !== -1; i = lower.indexOf(w, i + 1)) {
      marks.fill(true, i, i + w.length);
    }
  }
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.text += s[i];
    else out.push({ text: s[i], hit: marks[i] });
  }
  return out;
}

/** A window of `text` around its first match, ellipsised, for a card preview. */
export function snippetAround(text, words, max = 140) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const lower = s.toLowerCase();
  const hits = (words || []).map((w) => lower.indexOf(w)).filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(first - Math.floor(max / 3), s.length - max));
  return (
    (start > 0 ? '…' : '') +
    s.slice(start, start + max).trim() +
    (start + max < s.length ? '…' : '')
  );
}

/** What a cached search text is valid for: the note and the version it read. */
export const searchKey = (note) => note.id + '@' + (note.updatedAt || '');

/**
 * Memo of `compute(note)` per note id, recomputed only when the note's
 * searchKey changes. `prune(ids)` forgets notes no longer listed.
 */
export function createSearchCache(compute) {
  const memo = new Map();
  return {
    get(note) {
      const key = searchKey(note);
      const hit = memo.get(note.id);
      if (hit && hit.key === key) return hit.value;
      const value = compute(note);
      memo.set(note.id, { key, value });
      return value;
    },
    prune(ids) {
      const keep = new Set(ids);
      [...memo.keys()].forEach((id) => keep.has(id) || memo.delete(id));
    },
    get size() {
      return memo.size;
    },
  };
}

/* ---- the offline copy ---- */
export const OFFLINE_BODY_MAX = 200_000;
export const offlineKey = (userId) => 'gb.notesOffline.' + (userId || 'anon');

/* A photo in a note body: sanitize()'s output, so a plain <img ...> whose src
   is base64 — the same shape NoteResponse.listItem cuts out server-side. */
const IMG = /<img\b[^>]*>/gi;

/** The list as it is worth keeping on the device. A body over
    OFFLINE_BODY_MAX (a note opened whole, photos and all) loses its photos
    first, the way the list endpoint trims them; still over, it is dropped and
    flagged, so one note can't push the whole copy out of storage. */
export function offlineCopy(notes, now = new Date()) {
  return {
    savedAt: now.toISOString(),
    notes: (notes || []).map((n) => {
      const body = n.body || '';
      if (body.length <= OFFLINE_BODY_MAX) return n;
      const trimmed = body.replace(IMG, '');
      return trimmed.length <= OFFLINE_BODY_MAX
        ? Object.assign({}, n, { body: trimmed, bodyTrimmed: true })
        : Object.assign({}, n, { body: '', bodyDropped: true });
    }),
  };
}

/** Parse a stored copy; null when absent or unreadable. */
export function readOfflineCopy(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && Array.isArray(v.notes) ? v : null;
  } catch (_) {
    return null;
  }
}

/** Whole days a trashed note has left before the nightly purge (TRASH_DAYS = 30). */
export const TRASH_DAYS = 30;
export function trashDaysLeft(deletedAt, now = Date.now()) {
  const gone = time(deletedAt) + TRASH_DAYS * 86400000;
  return Math.max(0, Math.ceil((gone - now) / 86400000));
}
