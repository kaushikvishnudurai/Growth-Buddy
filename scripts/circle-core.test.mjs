// node scripts/circle-core.test.mjs
import assert from 'node:assert/strict';
import {
  standingLine,
  inviteLink,
  inviteFromHash,
  CHALLENGE_TEMPLATES,
  parseAgreement,
  formatAgreement,
} from './circle-core.js';
import { winLines } from './circle-wins.js';

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

// ---- seat ring ----
import { seatLayout, presence, seatOrder, initials, challengeDay } from './circle-core.js';

const four = seatLayout(4);
assert.deepEqual(four[0], { x: 50, y: 10 }, 'first seat at twelve o\'clock');
assert.deepEqual(four[1], { x: 90, y: 50 }, 'then clockwise');
assert.deepEqual(four[2], { x: 50, y: 90 });
assert.equal(seatLayout(0).length, 0);

const roster = [
  { userId: 'a', name: 'Priya Raman', doneToday: 3 },
  { userId: 'me', name: 'Me', doneToday: 0 },
  { userId: 'b', name: 'Arjun', doneToday: 0 },
  { userId: 'c', name: 'Quiet', doneToday: null },
];
const p = presence(roster, 'me');
assert.equal(p.lit, 1);
assert.equal(p.known, 3, 'a private member is unknown, not quiet');
assert.deepEqual(p.quiet.map((m) => m.userId), ['b'], 'you are never in your own cheer list');
assert.equal(p.meIn, false);
assert.deepEqual(seatOrder(roster, 'me').map((m) => m.userId), ['a', 'me', 'b', 'c'], 'lit, then not yet (you first), then private');
assert.deepEqual(
  seatOrder([{ userId: 'x', doneToday: 1 }, { userId: 'me', doneToday: 2 }], 'me').map((m) => m.userId),
  ['me', 'x'],
  'you lead your own group'
);

assert.equal(initials('Priya Raman'), 'PR');
assert.equal(initials('arjun kumar mehta'), 'AM');
assert.equal(initials('QA'), 'Q');
assert.equal(initials('  '), '?');

assert.deepEqual(challengeDay('2026-10-11', '2026-10-17', '2026-10-11'), { day: 1, total: 7 });
assert.deepEqual(challengeDay('2026-10-11', '2026-10-17', '2026-10-17'), { day: 7, total: 7 });
assert.equal(challengeDay('2026-10-11', '2026-10-17', '2026-10-18'), null);
assert.equal(challengeDay('2026-10-11', '2026-10-17', '2026-10-10'), null);
assert.deepEqual(challengeDay('2026-10-28', '2026-11-03', '2026-11-01'), { day: 5, total: 7 }, 'across a month');
console.log('circle-core seat ring: ok');

// The agreement checklist is stored as text; what it must read back the same.
// An agreement written before the checklist is one open item.
assert.deepEqual(parseAgreement('30 min of DSA, 5 days a week'), [
  { done: false, text: '30 min of DSA, 5 days a week' },
]);
assert.deepEqual(parseAgreement(null), []);
assert.deepEqual(parseAgreement('[x] Read\n\n  [ ] Run  \n[X] Ship\n[ ] '), [
  { done: true, text: 'Read' },
  { done: false, text: 'Run' },
  { done: true, text: 'Ship' },
]);
const items = [
  { done: true, text: 'Read' },
  { done: false, text: 'Write [x] tests' },
];
assert.deepEqual(parseAgreement(formatAgreement(items)), items);
assert.equal(formatAgreement([]), '');
console.log('circle-core agreement: ok');
