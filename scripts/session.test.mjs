/* Run: node scripts/session.test.mjs

   Sign-out is one path (app.js endSession) and this pins what it resets. A
   field missed here is one account's data shown to the next; a late answer that
   lands is the old account's tasks written over the sign-in screen. Also reads
   app.js, settings.js and habit-dialogs.js themselves, so a new `state` field,
   or a sign-out path that skips endSession, fails here instead of on a shared
   phone. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  sessionGen,
  bumpSession,
  isStaleSession,
  sessionEndedError,
  SESSION_ENDED,
  freshUserState,
  DEVICE_STATE,
  USER_CACHES,
  isUserKey,
  bootKey,
  bootSnapshot,
  readBootSnapshot,
  bootFromSnapshot,
} from './session.js';

const empty = {
  wellness: () => ({ w: 1 }),
  money: () => ({ m: 1 }),
  streakFreeze: () => ({}),
  trends: () => ({}),
};
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const app = read('./app.js');
// Settings and the habit dialogs moved out of app.js and write state.* through
// their context object: they are scanned with it.
const src = [app, read('./settings.js'), read('./habit-dialogs.js')].join('\n');

// Generation: an answer captured before a bump is stale; one after is not.
{
  const g = sessionGen();
  assert.equal(isStaleSession(g), false);
  bumpSession();
  assert.equal(isStaleSession(g), true);
  assert.equal(isStaleSession(sessionGen()), false);
  const e = sessionEndedError();
  assert.equal(e.sessionEnded, true);
  assert.equal(e.message, SESSION_ENDED);
}

// Fresh state: new objects every call (a shared [] would be mutated by the next account).
{
  const a = freshUserState(empty);
  const b = freshUserState(empty);
  assert.notEqual(a.tasks, b.tasks);
  assert.notEqual(a.wellness, b.wellness);
  assert.equal(a.user, null);
  assert.deepEqual(a.toasts, []);
}

// Every `state` field app.js has is either reset or deliberately device-level.
{
  const literal = app.slice(
    app.indexOf('\nconst state = {'),
    app.indexOf('\n};', app.indexOf('\nconst state = {'))
  );
  const keys = new Set([...literal.matchAll(/^ {2}([a-zA-Z_]+):/gm)].map((m) => m[1]));
  for (const m of src.matchAll(/\bstate\.([a-zA-Z_]+)\s*(?:=(?!=)|\+\+|--|\+=|-=)/g))
    keys.add(m[1]);
  assert.ok(keys.size > 30, 'parsed the state fields (' + keys.size + ')');
  const reset = new Set(Object.keys(freshUserState(empty)));
  const device = new Set(DEVICE_STATE);
  for (const k of reset) assert.ok(!device.has(k), k + ' is in both lists');
  const missing = [...keys].filter((k) => !reset.has(k) && !device.has(k));
  assert.deepEqual(
    missing,
    [],
    'state fields neither reset by sign-out nor listed as device-level: ' + missing
  );
}

// Both exits go through endSession, and nothing else signs the user out by hand.
{
  const body = (name) => {
    const i = app.indexOf('\nfunction ' + name + '(');
    assert.ok(i >= 0, name + ' exists');
    return app.slice(i, app.indexOf('\n}\n', i));
  };
  assert.match(body('logout'), /endSession\(/);
  assert.match(body('handleAuthExpired'), /endSession\(/);
  const nulls = src.match(/state\.user = null/g) || [];
  assert.equal(nulls.length, 0, 'state.user is only cleared by freshUserState inside endSession');
  assert.ok(
    app.includes('USER_CACHES.map((c) => caches.delete(c))'),
    'endSession deletes USER_CACHES'
  );
  for (const c of USER_CACHES)
    assert.ok(!src.includes("caches.delete('" + c + "')"), c + ' deleted by hand somewhere');
}

// Per-user keys: the account's own, not another id that merely contains it.
{
  assert.equal(isUserKey('gb.money.u1', 'u1'), true);
  assert.equal(isUserKey('gb.trends.u1.2026-10', 'u1'), true);
  assert.equal(isUserKey(bootKey('u1'), 'u1'), true, 'the boot snapshot leaves with the account');
  assert.equal(isUserKey('gb.outbox.u1', 'u1'), true);
  assert.equal(isUserKey('gb.money.u12', 'u1'), false);
  assert.equal(isUserKey('gb.theme', 'u1'), false);
  assert.equal(isUserKey('gb.money.pending.u1', 'u1', 'gb.money.pending.u1'), false, 'kept queue');
  assert.equal(isUserKey('gb.money.u1', ''), false, 'no user, nothing matches');
}

// Boot snapshot round-trip, and refusing junk.
{
  const s = {
    tasks: [{ id: 1 }],
    habits: [],
    reminders: [{ id: 'r' }],
    goals: [],
    score: 42,
    water: { date: 'd' },
    user: { id: 'x' },
  };
  const back = readBootSnapshot(bootSnapshot(s));
  assert.deepEqual(back, {
    tasks: [{ id: 1 }],
    habits: [],
    reminders: [{ id: 'r' }],
    goals: [],
    score: 42,
    water: { date: 'd' },
  });
  assert.equal(readBootSnapshot(null), null);
  assert.equal(readBootSnapshot('{not json'), null);
  assert.equal(readBootSnapshot(JSON.stringify({ tasks: [] })), null, 'partial snapshot');
  assert.equal(readBootSnapshot(JSON.stringify({ ...s, score: 'x', water: 3 })).score, 0);
}

// When the app paints from the snapshot: app only, no response at all.
{
  const net = new Error('No connection.');
  assert.equal(bootFromSnapshot(net, true), true);
  assert.equal(bootFromSnapshot(net, false), false, 'web: the service worker covers it');
  assert.equal(
    bootFromSnapshot(Object.assign(new Error('x'), { status: 503 }), true),
    false,
    '5xx'
  );
  assert.equal(bootFromSnapshot(sessionEndedError(), true), false, 'stale answer');
  assert.equal(bootFromSnapshot(null, true), false);
}

console.log('session: all tests passed');
