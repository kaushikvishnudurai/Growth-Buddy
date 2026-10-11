// node scripts/palette-core.test.mjs — the command palette's ranking and highlight.
import assert from 'node:assert/strict';
import {
  fold,
  matchScore,
  rankItems,
  groupRanked,
  emptyResults,
  pushRecent,
  highlight,
  RECENT_MAX,
} from './palette-core.js';

assert.equal(fold('  Café   Run '), 'cafe run');
assert.equal(fold(null), '');

const it = (key, kind, label, alt) => ({ key, kind, label, alt });

// Prefix beats word start beats substring; alternates count.
assert.equal(matchScore(it('a', 'task', 'Money talk'), 'mon'), 3);
assert.equal(matchScore(it('a', 'task', 'Pay money'), 'mon'), 2);
assert.equal(matchScore(it('a', 'task', 'Lemonade'), 'mon'), 1);
assert.equal(matchScore(it('a', 'task', 'Walk'), 'mon'), 0);
assert.equal(matchScore(it('a', 'screen', 'Report', ['Progress']), 'prog'), 3);
assert.equal(matchScore(it('a', 'task', 'Buy oat milk'), 'milk buy'), 1, 'every word, any order');
assert.equal(matchScore(it('a', 'task', 'Buy oat milk'), 'milk tea'), 0);
assert.equal(matchScore(it('a', 'note', 'Résumé draft'), 'resume'), 3, 'accents fold');
assert.equal(matchScore(it('a', 'task', 'x'), '   '), 0, 'empty query matches nothing');

// Ranking: score first, then kind order, then recency, then label.
const items = [
  it('task:1', 'task', 'Lemon money'),
  it('screen:money', 'screen', 'Money'),
  it('act:exp', 'action', 'New expense', ['money', 'spent']),
  it('note:1', 'note', 'Money ideas'),
  it('note:2', 'note', 'Money goals'),
];
const ranked = rankItems(items, 'mon').map((x) => x.key);
assert.deepEqual(ranked, ['act:exp', 'screen:money', 'note:2', 'note:1', 'task:1']);
// A recent pick wins a tie inside its kind.
assert.deepEqual(rankItems(items, 'mon', ['note:1']).map((x) => x.key).slice(2, 4), ['note:1', 'note:2']);

// Groups follow the first item of each kind, capped per group.
const groups = groupRanked(rankItems(items, 'mon'), 1);
assert.deepEqual(groups.map((g) => g.kind), ['action', 'screen', 'note', 'task']);
assert.equal(groups[2].items.length, 1);

// Empty query: recent (still existing) then actions not already shown.
const empty = emptyResults(items, ['note:1', 'gone:9']);
assert.deepEqual(empty.map((g) => g.kind), ['recent', 'action']);
assert.deepEqual(empty[0].items.map((x) => x.key), ['note:1']);
assert.deepEqual(emptyResults(items, ['act:exp']).map((g) => g.kind), ['recent'], 'the only action is already in Recent');
assert.deepEqual(emptyResults([], []), []);

// Recent: newest first, deduped, capped, junk dropped.
assert.deepEqual(pushRecent(['b', 'a'], 'a'), ['a', 'b']);
assert.deepEqual(pushRecent(null, 'a'), ['a']);
assert.deepEqual(pushRecent([1, 'x'], 'a'), ['a', 'x']);
assert.equal(pushRecent('abcdefghij'.split(''), 'z').length, RECENT_MAX);

// Highlight: runs that rebuild the label, the hit on the match.
const hl = (label, q) => highlight(label, q).map((r) => (r.hit ? '[' + r.text + ']' : r.text)).join('');
assert.equal(hl('Ideas for the trip', 'trip'), 'Ideas for the [trip]');
assert.equal(hl('Money', 'mon'), '[Mon]ey');
assert.equal(hl('Lemon money', 'mon'), 'Lemon [mon]ey', 'a word start before an earlier substring');
assert.equal(hl('Lemonade', 'mon'), 'Le[mon]ade');
assert.equal(hl('Buy oat milk', 'milk buy'), '[Buy] oat [milk]');
assert.equal(hl('Café run', 'cafe'), '[Café] run', 'accents fold and map back');
assert.equal(hl('Walk', 'xyz'), 'Walk');
assert.equal(hl('Walk', ''), 'Walk');

console.log('palette-core: all checks passed');
