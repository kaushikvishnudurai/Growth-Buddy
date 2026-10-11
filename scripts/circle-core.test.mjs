// node scripts/circle-core.test.mjs
import assert from 'node:assert/strict';
import {
  standingLine,
  winLines,
  inviteLink,
  inviteFromHash,
  CHALLENGE_TEMPLATES,
} from './circle-core.js';

const unit = (n) => n + (n === 1 ? ' check-in' : ' check-ins');
const board = [
  { userId: 'a', name: 'Priya', value: 9, rank: 1 },
  { userId: 'me', name: 'Me', value: 6, rank: 2 },
  { userId: 'c', name: 'Ravi', value: 2, rank: 3 },
];
assert.equal(standingLine(board, 'me', unit, false), "You're #2, 3 check-ins behind Priya.");
assert.equal(standingLine(board, 'a', unit, false), 'You lead by 3 check-ins.');
assert.equal(standingLine(board, 'c', unit, false), "You're #3, 4 check-ins behind Me.");
assert.equal(standingLine(board, 'me', unit, true), 'Priya won with 9 check-ins.');
assert.equal(standingLine(board, 'a', unit, true), 'You won with 9 check-ins.');
const tie = [
  { userId: 'a', name: 'Priya', value: 4, rank: 1 },
  { userId: 'me', name: 'Me', value: 4, rank: 1 },
];
assert.equal(standingLine(tie, 'me', unit, false), 'Tied for first. One more puts you ahead.');
assert.equal(
  standingLine(tie, 'me', unit, true),
  'Priya and You tied for the win with 4 check-ins.'
);
assert.equal(
  standingLine([{ userId: 'me', value: 0, rank: 1 }], 'me', unit, false),
  null,
  'alone: nothing to say'
);
assert.equal(standingLine([], 'me', unit, false), null);
assert.equal(
  standingLine([{ userId: 'a', name: 'P', value: 0, rank: 1 }], 'me', unit, true),
  'Ended with no score on the board.'
);

const wins = winLines({
  today: '2026-10-11',
  habits: [
    { name: 'Read', streak: 12, doneToday: true },
    { name: 'Run', streak: 3, doneToday: true },
    { name: 'No sugar', kind: 'quit', streak: 40, doneToday: true },
  ],
  goals: [
    { title: 'Run a 10k', completed: true, completedAt: '2026-10-08T10:00:00Z' },
    { title: 'Old goal', completed: true, completedAt: '2026-01-01T10:00:00Z' },
  ],
});
assert.deepEqual(wins, [
  'Day 12 of Read in a row.',
  'Day 3 of Run in a row.',
  'Goal done: Run a 10k.',
  'Every habit ticked today, all 2.',
]);
assert.deepEqual(winLines({}), []);

assert.equal(
  inviteLink('https://x.app/#/circle', { id: 'u1', joinCode: 'K7M2QX9P' }),
  'https://x.app/#/circle?join=K7M2QX9P'
);
assert.equal(inviteLink('https://x.app/', { id: 'u1' }), 'https://x.app/#/circle?circle=u1');
assert.deepEqual(inviteFromHash('#/circle?join=k7m2qx9p'), { code: 'K7M2QX9P' });
assert.deepEqual(inviteFromHash('#/circle?circle=u1'), { id: 'u1' });
assert.equal(inviteFromHash('#/circle'), null);
assert.ok(CHALLENGE_TEMPLATES.every((t) => t.days >= 1 && t.days <= 90 && t.title.length <= 120));
console.log('circle-core: ok');
