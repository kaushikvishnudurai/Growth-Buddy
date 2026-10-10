/* Node check for the focus timer's arithmetic.

   `node scripts/timer.test.mjs`

   The traps: a session that ended while the app was killed must be counted
   exactly once (and only for the account that ran it), and one still running
   must come back with the clock, not with what the ring last said. */

import assert from 'node:assert/strict';
import {
  remainingFrom,
  restoredSession,
  stripTitle,
  titleWith,
  afterSession,
  cycleLabel,
  sprintNumber,
  goalMinutes,
  goalProgress,
  barLayout,
} from './timer-math.js';

const NOW = 1_800_000_000_000;

/* ---- the clock ---- */
assert.equal(remainingFrom(NOW + 1500 * 1000, NOW), 1500);
assert.equal(remainingFrom(NOW + 1001, NOW), 2, 'rounds up, so 0 only when it is over');
assert.equal(remainingFrom(NOW - 5000, NOW), 0);

/* ---- restore ---- */
const run = { owner: 'u1', mode: 'focus', durationSec: 1500, running: true, endsAt: NOW + 600 * 1000 };
assert.deepEqual(restoredSession(run, NOW, 'u1'), {
  action: 'resume',
  mode: 'focus',
  durationSec: 1500,
  endsAt: NOW + 600 * 1000,
});
assert.deepEqual(restoredSession({ ...run, endsAt: NOW - 1 }, NOW, 'u1'), {
  action: 'finish',
  mode: 'focus',
  durationSec: 1500,
});
assert.equal(restoredSession(run, NOW, 'u2').action, 'none', "another account's session is dropped");
assert.equal(restoredSession({ ...run, endsAt: NOW + 99 * 3600 * 1000 }, NOW, 'u1').action, 'none');
assert.equal(restoredSession({ ...run, durationSec: 0 }, NOW, 'u1').action, 'none');
assert.equal(restoredSession({ ...run, durationSec: 7 * 3600 }, NOW, 'u1').action, 'none');
assert.equal(restoredSession(null, NOW, 'u1').action, 'none');
assert.equal(restoredSession('junk', NOW, 'u1').action, 'none');
assert.deepEqual(
  restoredSession({ owner: 'u1', mode: 'break', durationSec: 300, running: false, remainingSec: 120 }, NOW, 'u1'),
  { action: 'paused', mode: 'break', durationSec: 300, remainingSec: 120 }
);
assert.equal(
  restoredSession({ owner: 'u1', mode: 'focus', durationSec: 300, running: false, remainingSec: 300 * 2 }, NOW, 'u1')
    .action,
  'none'
);
assert.equal(restoredSession({ ...run, mode: 'nap' }, NOW, 'u1').mode, 'focus');

/* ---- the tab title ---- */
assert.equal(titleWith('12:34', 'focus', 'Timer · Growth Buddy'), '12:34 focus · Timer · Growth Buddy');
assert.equal(
  titleWith('12:33', 'focus', '12:34 focus · Timer · Growth Buddy'),
  '12:33 focus · Timer · Growth Buddy',
  'never stacks prefixes'
);
assert.equal(stripTitle('104:59 break · Home · Growth Buddy'), 'Home · Growth Buddy');
assert.equal(stripTitle('Home · Growth Buddy'), 'Home · Growth Buddy');

/* ---- the cycle: four sprints, the fourth break is the long one ---- */
let c = 0;
const seen = [];
for (let i = 0; i < 8; i++) {
  assert.equal(cycleLabel('focus', c), 'Sprint ' + ((i % 4) + 1) + ' of 4');
  const brk = afterSession('focus', c, 50);
  seen.push(brk.mins);
  assert.equal(brk.mode, 'break');
  c = brk.cycleDone;
  const back = afterSession('break', c, 50);
  assert.equal(back.mode, 'focus');
  assert.equal(back.mins, 50, 'a break lines the last sprint length back up');
  c = back.cycleDone;
}
assert.deepEqual(seen, [5, 5, 5, 15, 5, 5, 5, 15]);
assert.equal(afterSession('focus', 3, 25).suggest, 'Four sprints done. Take a 15-minute break?');
assert.equal(cycleLabel('break', 4), 'Long break');
assert.equal(cycleLabel('break', 2), 'Break · 2 of 4 done');
assert.equal(afterSession('break', 4, 25).cycleDone, 0, 'the long break ends the cycle');
assert.equal(afterSession('break', 4, 25).suggest, 'Break over. Ready for sprint 1 of 4?');
// The long break skipped: the next sprint run is sprint 1 of a new cycle, with a short break.
assert.equal(sprintNumber(4), 1);
assert.deepEqual(
  [afterSession('focus', 4, 25).cycleDone, afterSession('focus', 4, 25).mins],
  [1, 5]
);
assert.equal(sprintNumber('junk'), 1);
assert.equal(afterSession('break', 1, 0).mins, 25, 'no last length: the default sprint');

/* ---- the daily goal ---- */
assert.equal(goalMinutes(undefined), 0, 'off by default');
assert.equal(goalMinutes('60'), 60);
assert.equal(goalMinutes(-3), 0);
assert.equal(goalMinutes(9999), 720);
assert.equal(goalProgress(30, 60), 0.5);
assert.equal(goalProgress(90, 60), 1);
assert.equal(goalProgress(30, 0), 0);

/* ---- the history chart ---- */
const lay = barLayout([0, 30, 60], 300, 100, 120);
assert.equal(lay.max, 120, 'the goal stays on the chart');
assert.equal(lay.bars[0].h, 0);
assert.equal(lay.bars[1].h, 25);
assert.equal(lay.bars[2].y, 50);
assert.equal(barLayout([1], 10, 100, 0).bars[0].h >= 2, true, 'a minute still shows');
assert.equal(barLayout([], 300, 100, 0).bars.length, 0);

console.log('timer.test.mjs: all assertions passed');
