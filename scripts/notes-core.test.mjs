// node scripts/notes-core.test.mjs — Notes' pure rules (notes-core.js).
import assert from 'node:assert/strict';
import {
  LABEL_MAX,
  LABEL_LEN,
  parseLabels,
  validateLabels,
  labelsInUse,
  hasLabel,
  compareNotes,
  sortKeyOf,
  queryWords,
  matchesAll,
  splitHighlights,
  snippetAround,
  searchKey,
  createSearchCache,
  OFFLINE_BODY_MAX,
  offlineCopy,
  readOfflineCopy,
  offlineKey,
  trashDaysLeft,
} from './notes-core.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('ok   ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + err.message);
  }
}

/* ---- labels: must agree with NoteLabelsTest ---- */
test('labels trim, collapse, split on commas and dedupe ignoring case', () => {
  assert.deepEqual(parseLabels(['  Big   ideas ', 'work,WORK', '', null, 'big ideas']), [
    'Big ideas',
    'work',
  ]);
  assert.deepEqual(parseLabels('a, b ,,a'), ['a', 'b']);
  assert.deepEqual(parseLabels(null), []);
});

test('30 characters and 10 labels fit; one more of either does not', () => {
  assert.equal(validateLabels(['x'.repeat(LABEL_LEN)]), null);
  assert.match(validateLabels(['x'.repeat(LABEL_LEN + 1)]), /30 characters/);
  const ten = Array.from({ length: LABEL_MAX }, (_, i) => 'l' + i);
  assert.equal(validateLabels(ten), null);
  assert.match(validateLabels([...ten, 'l10']), /10 labels/);
});

test('labels in use: each once, A to Z, first spelling', () => {
  const notes = [{ labels: ['work', 'Zoo'] }, { labels: ['Work', 'apple'] }, {}];
  assert.deepEqual(labelsInUse(notes), ['apple', 'work', 'Zoo']);
  assert.ok(hasLabel({ labels: ['Work'] }, 'work'));
  assert.ok(!hasLabel({ labels: [] }, 'work'));
  assert.ok(hasLabel({}, null), 'no filter matches everything');
});

/* ---- sort ---- */
const n = (id, o) => Object.assign({ id }, o);
const order = (list, key) =>
  list
    .slice()
    .sort(compareNotes(key))
    .map((x) => x.id);
const list = [
  n('a', { title: 'banana', createdAt: '2026-01-03', updatedAt: '2026-02-01' }),
  n('b', { title: 'Apple', createdAt: '2026-01-01', updatedAt: '2026-02-03' }),
  n('c', { title: '', createdAt: '2026-01-02', updatedAt: '2026-02-02' }),
  n('p', { title: 'zed', pinned: true, createdAt: '2025-01-01', updatedAt: '2025-01-01' }),
];

test('pinned first, then the chosen order', () => {
  assert.deepEqual(order(list, 'updated'), ['p', 'b', 'c', 'a']);
  assert.deepEqual(order(list, 'created'), ['p', 'a', 'c', 'b']);
  assert.deepEqual(order(list, 'title'), ['p', 'b', 'a', 'c'], 'untitled last, case ignored');
});

test('title sort is numeric-aware and an unknown sort key falls back to updated', () => {
  const t = [n('x', { title: 'Note 10' }), n('y', { title: 'Note 9' })];
  assert.deepEqual(order(t, 'title'), ['y', 'x']);
  assert.equal(sortKeyOf('bogus'), 'updated');
  assert.equal(sortKeyOf('created'), 'created');
});

/* ---- search + highlight ---- */
test('query words lowercase and every one must match', () => {
  assert.deepEqual(queryWords('  Milk  EGGS '), ['milk', 'eggs']);
  assert.ok(matchesAll('buy milk and eggs', ['milk', 'eggs']));
  assert.ok(!matchesAll('buy milk', ['milk', 'eggs']));
});

test('highlight splits into runs, ignoring case, merging overlaps', () => {
  assert.deepEqual(splitHighlights('Buy MILK now', ['milk']), [
    { text: 'Buy ', hit: false },
    { text: 'MILK', hit: true },
    { text: ' now', hit: false },
  ]);
  assert.deepEqual(splitHighlights('abcd', ['abc', 'bcd']), [{ text: 'abcd', hit: true }]);
  assert.deepEqual(splitHighlights('aaa', ['aa']), [{ text: 'aaa', hit: true }]);
  assert.deepEqual(splitHighlights('', ['x']), []);
  // Markup in the text stays text: the caller builds text nodes from it.
  assert.equal(splitHighlights('<b>x</b>', ['x'])[0].text, '<b>');
});

test('snippet is a window around the first match', () => {
  const long = 'a'.repeat(300) + ' needle ' + 'b'.repeat(300);
  const s = snippetAround(long, ['needle'], 100);
  assert.ok(s.includes('needle'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  assert.ok(s.length <= 102);
  assert.equal(snippetAround('short', ['x']), 'short');
});

/* ---- the search-text cache (the old ponytail at filter) ---- */
test('cache recomputes only when the note version changes', () => {
  let calls = 0;
  const cache = createSearchCache((note) => {
    calls++;
    return note.title.toLowerCase();
  });
  const note = { id: '1', title: 'Hi', updatedAt: 't1' };
  assert.equal(cache.get(note), 'hi');
  assert.equal(cache.get(note), 'hi');
  assert.equal(calls, 1);
  note.title = 'Bye';
  note.updatedAt = 't2';
  assert.equal(cache.get(note), 'bye');
  assert.equal(calls, 2);
  assert.notEqual(searchKey({ id: '1', updatedAt: 't1' }), searchKey({ id: '1', updatedAt: 't2' }));
  cache.prune(['other']);
  assert.equal(cache.size, 0);
});

/* ---- offline copy ---- */
test('offline copy drops only bodies over the cap and round-trips', () => {
  const big = { id: 'b', body: 'x'.repeat(OFFLINE_BODY_MAX + 1) };
  const small = { id: 's', body: '<p>hi</p>' };
  const copy = offlineCopy([big, small], new Date('2026-10-10T00:00:00Z'));
  assert.equal(copy.notes[0].body, '');
  assert.equal(copy.notes[0].bodyDropped, true);
  assert.equal(copy.notes[1], small);
  assert.equal(big.body.length, OFFLINE_BODY_MAX + 1, 'the live note is untouched');
  // A note opened whole keeps its words and loses only its photos.
  const photo = '<img src="data:image/jpeg;base64,' + 'A'.repeat(OFFLINE_BODY_MAX) + '" alt="">';
  const opened = offlineCopy([{ id: 'p', body: '<p>lake</p>' + photo }]).notes[0];
  assert.equal(opened.body, '<p>lake</p>');
  assert.equal(opened.bodyTrimmed, true);
  const back = readOfflineCopy(JSON.stringify(copy));
  assert.equal(back.savedAt, '2026-10-10T00:00:00.000Z');
  assert.equal(readOfflineCopy('not json'), null);
  assert.equal(readOfflineCopy(null), null);
  assert.equal(offlineKey('u1'), 'gb.notesOffline.u1');
  assert.ok(offlineKey('u1').startsWith('gb.'), 'CacheStorage keys carry the gb. prefix');
});

test('trash days left counts down from 30 and stops at 0', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  assert.equal(trashDaysLeft('2026-10-10T00:00:00Z', now), 30);
  assert.equal(trashDaysLeft('2026-09-20T12:00:00Z', now), 11);
  assert.equal(trashDaysLeft('2026-08-01T00:00:00Z', now), 0);
});

if (failures) {
  console.log(failures + ' failing');
  process.exit(1);
}
console.log('notes-core.test.mjs: all passed');
