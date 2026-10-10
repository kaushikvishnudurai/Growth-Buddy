// node scripts/goal-milestones.test.mjs — milestone list edits and habit links (goal-milestones.js).
import assert from 'node:assert/strict';
import {
  moveItem,
  renameMilestone,
  setMilestoneDue,
  milestoneDueState,
  liveLinkedIds,
  progressFraction,
  appendProgressLog,
  withProgressLog,
  needsProgressLog,
  PROGRESS_LOG_MAX,
} from './goal-milestones.js';

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

const ms = () => [
  { id: 'a', title: 'Plan', done: false },
  { id: 'b', title: 'Build', done: false },
  { id: 'c', title: 'Ship', done: true },
];
const ids = (list) => list.map((x) => x.id).join('');

test('move up / down swaps with the neighbour', () => {
  assert.equal(ids(moveItem(ms(), 'b', -1)), 'bac');
  assert.equal(ids(moveItem(ms(), 'b', 1)), 'acb');
});

test('moving past an end, or an unknown id, changes nothing', () => {
  assert.equal(ids(moveItem(ms(), 'a', -1)), 'abc');
  assert.equal(ids(moveItem(ms(), 'c', 1)), 'abc');
  assert.equal(ids(moveItem(ms(), 'zz', 1)), 'abc');
  assert.deepEqual(moveItem(null, 'a', 1), []);
});

test('the list given is left alone (it is the rollback copy)', () => {
  const list = ms();
  moveItem(list, 'a', 1);
  renameMilestone(list, 'a', 'New');
  setMilestoneDue(list, 'a', '2026-10-12');
  assert.equal(ids(list), 'abc');
  assert.equal(list[0].title, 'Plan');
  assert.equal(list[0].due, undefined);
});

test('rename trims; a blank name is refused', () => {
  assert.equal(renameMilestone(ms(), 'b', '  Build v2 ')[1].title, 'Build v2');
  assert.equal(renameMilestone(ms(), 'b', '   ')[1].title, 'Build');
  assert.equal(renameMilestone(ms(), 'b', 'x'.repeat(300))[1].title.length, 160);
});

test('a due date is set, and cleared by a blank', () => {
  const set = setMilestoneDue(ms(), 'a', '2026-10-12');
  assert.equal(set[0].due, '2026-10-12');
  const cleared = setMilestoneDue(set, 'a', '');
  assert.equal('due' in cleared[0], false);
  assert.equal('due' in setMilestoneDue(set, 'a', 'not a date')[0], false);
});

test('due state: overdue, today, soon, later; none once done', () => {
  const today = '2026-10-10';
  assert.equal(milestoneDueState({ due: '2026-10-09' }, today), 'overdue');
  assert.equal(milestoneDueState({ due: today }, today), 'today');
  assert.equal(milestoneDueState({ due: '2026-10-17' }, today), 'soon');
  assert.equal(milestoneDueState({ due: '2026-10-18' }, today), 'later');
  assert.equal(milestoneDueState({ due: '2026-10-09', done: true }, today), null);
  assert.equal(milestoneDueState({}, today), null);
});

test('linked habit ids drop repeats and deleted habits', () => {
  const habits = [{ id: 'h1' }, { id: 'h2' }];
  assert.deepEqual(liveLinkedIds(['h2', 'h1', 'h2', 'gone'], habits), ['h2', 'h1']);
  assert.deepEqual(liveLinkedIds(null, habits), []);
});

test('progress fraction: milestones first, else the day tracker, else none', () => {
  assert.equal(progressFraction({ milestones: ms() }), 1 / 3);
  assert.equal(progressFraction({ durationDays: 10, daysFollowed: 4 }), 0.4);
  assert.equal(progressFraction({ durationDays: 10, daysFollowed: 40 }), 1);
  assert.equal(progressFraction({}), null);
  assert.equal(progressFraction(null), null);
});

test('progress log: one entry per day, the last save wins, sorted', () => {
  let log = appendProgressLog([], '2026-06-02', 20);
  log = appendProgressLog(log, '2026-06-01', 10);
  log = appendProgressLog(log, '2026-06-02', 25);
  assert.deepEqual(log, [
    { date: '2026-06-01', pct: 10 },
    { date: '2026-06-02', pct: 25 },
  ]);
});

test('progress log: capped to the newest entries, junk dropped, input untouched', () => {
  const big = [];
  for (let i = 0; i < PROGRESS_LOG_MAX; i++)
    big.push({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), pct: i });
  const out = appendProgressLog(big.concat({ date: 'bad', pct: 1 }), '2026-12-31', 99);
  assert.equal(out.length, PROGRESS_LOG_MAX);
  assert.equal(out[0].date, '2026-01-02');
  assert.deepEqual(out[out.length - 1], { date: '2026-12-31', pct: 99 });
  assert.equal(big.length, PROGRESS_LOG_MAX);
  assert.equal(appendProgressLog(null, 'x', 5).length, 0, 'a bad date adds nothing');
  assert.equal(appendProgressLog([], '2026-01-01', 150)[0].pct, 100, 'clamped');
});

test('withProgressLog dates the blob; a blob with nothing to measure is left alone', () => {
  const blob = { milestones: ms() };
  const out = withProgressLog(blob, '2026-06-05');
  assert.deepEqual(out.progressLog, [{ date: '2026-06-05', pct: 33.3 }]);
  assert.equal(blob.progressLog, undefined, 'returns a new blob');
  const bare = { linkedHabitIds: ['h'] };
  assert.equal(withProgressLog(bare, '2026-06-05'), bare);
  assert.equal(needsProgressLog(out, '2026-06-05'), false);
  assert.equal(needsProgressLog(out, '2026-06-06'), true);
  const allDone = { ...out, milestones: ms().map((m) => ({ ...m, done: true })) };
  assert.equal(needsProgressLog(allDone, '2026-06-05'), true);
  assert.equal(needsProgressLog(bare, '2026-06-05'), false);
});

if (failures) {
  console.log('\n' + failures + ' failed');
  process.exit(1);
}
console.log('\nall passed');
