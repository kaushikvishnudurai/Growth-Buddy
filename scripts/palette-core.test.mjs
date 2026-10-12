// node scripts/palette-core.test.mjs — the command palette's ranking (palette-core.js).
import assert from 'node:assert/strict';
import { fold, matchScore, rankItems, groupRanked, emptyResults, pushRecent, RECENT_MAX } from './palette-core.js';

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

const it = (key, kind, label, alt) => ({ key, kind, label, alt });

test('fold drops case, diacritics and extra space', () => {
  assert.equal(fold('  Café   RÉSUMÉ '), 'cafe resume');
  assert.equal(fold(null), '');
});

test('prefix > word start > substring > none', () => {
  const x = it('t:1', 'task', 'Buy oat milk');
  assert.equal(matchScore(x, 'buy'), 3);
  assert.equal(matchScore(x, 'oat'), 2);
  assert.equal(matchScore(x, 'ilk'), 1);
  assert.equal(matchScore(x, 'bread'), 0);
  assert.equal(matchScore(x, ''), 0);
});

test('diacritic- and case-insensitive both ways', () => {
  assert.equal(matchScore(it('n:1', 'note', 'Crème brûlée recipe'), 'CREME'), 3);
  assert.equal(matchScore(it('n:2', 'note', 'Creme brulee'), 'brûlée'), 2);
});

test('every word of a multi-word query must match, scored as a substring at best', () => {
  const x = it('t:1', 'task', 'Buy oat milk');
  assert.equal(matchScore(x, 'milk buy'), 1);
  assert.equal(matchScore(x, 'milk bread'), 0);
});

test('alternates count: Report found as "progress"', () => {
  assert.equal(matchScore(it('s:report', 'screen', 'Report', ['Progress']), 'prog'), 3);
});

test('rank: score first, then kind order, then recency, then label', () => {
  const items = [
    it('note:1', 'note', 'Water plants'),
    it('act:water', 'action', 'Log water 250 ml'),
    it('task:1', 'task', 'Call about the water bill'),
    it('habit:1', 'habit', 'Water'),
    it('habit:2', 'habit', 'Watercolour'),
  ];
  const keys = rankItems(items, 'water').map((i) => i.key);
  // Prefix matches (two habits, the note) beat the word-start action and task;
  // within a score kind order decides, and the two habits fall to label order.
  assert.deepEqual(keys, ['habit:1', 'habit:2', 'note:1', 'act:water', 'task:1']);
});

test('rank ties broken by recency (newest pick first)', () => {
  const items = [it('task:a', 'task', 'Report draft'), it('task:b', 'task', 'Report review')];
  assert.deepEqual(rankItems(items, 'report').map((i) => i.key), ['task:a', 'task:b']);
  assert.deepEqual(rankItems(items, 'report', ['task:b']).map((i) => i.key), ['task:b', 'task:a']);
});

test('groups sit where their best item ranked, capped per group', () => {
  const ranked = [
    it('task:1', 'task', 'a'),
    it('action:1', 'action', 'b'),
    it('task:2', 'task', 'c'),
    it('task:3', 'task', 'd'),
  ];
  const g = groupRanked(ranked, 2);
  assert.deepEqual(g.map((x) => x.kind), ['task', 'action']);
  assert.deepEqual(g[0].items.map((x) => x.key), ['task:1', 'task:2']);
});

test('empty query: live recent picks, then actions not already shown', () => {
  const items = [
    it('act:a', 'action', 'A'),
    it('act:b', 'action', 'B'),
    it('task:1', 'task', 'T'),
  ];
  const g = emptyResults(items, ['task:1', 'gone:9', 'act:a']);
  assert.deepEqual(g.map((x) => x.kind), ['recent', 'action']);
  assert.deepEqual(g[0].items.map((x) => x.key), ['task:1', 'act:a']);
  assert.deepEqual(g[1].items.map((x) => x.key), ['act:b']);
  assert.deepEqual(emptyResults(items, []).map((x) => x.kind), ['action']);
});

test('pushRecent: newest first, deduped, capped', () => {
  let r = [];
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) r = pushRecent(r, k);
  assert.equal(r.length, RECENT_MAX);
  assert.deepEqual(r, ['f', 'e', 'd', 'c', 'b']);
  assert.deepEqual(pushRecent(r, 'c'), ['c', 'f', 'e', 'd', 'b']);
  assert.deepEqual(pushRecent(null, 'x'), ['x']);
  assert.deepEqual(pushRecent(['y', 3, null], 'x'), ['x', 'y']);
});

if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nall passed');
