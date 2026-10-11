// Plain-assert check for undo-queue.js. Run: node scripts/undo-queue.test.mjs
import assert from 'node:assert/strict';
import { createUndoQueue } from './undo-queue.js';

// A hand-cranked clock: timers fire only when tick() passes them.
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => (timers.set(next, { fn, at: t + ms }), next++),
    clearTimer: (h) => timers.delete(h),
    tick(ms) {
      t += ms;
      for (const [h, x] of [...timers]) if (x.at <= t) timers.delete(h), x.fn();
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

function rig(opts = {}) {
  const clock = fakeClock();
  const errors = [];
  const q = createUndoQueue({ ms: 6000, ...clock, onError: (err) => errors.push(err.message), ...opts });
  const list = ['a', 'b', 'c'];
  const sent = [];
  const settled = [];
  const del = (name, fail) => {
    let at = -1;
    return q.schedule({
      remove: () => {
        const i = list.indexOf(name);
        if (i < 0) return;
        at = i;
        list.splice(i, 1);
      },
      restore: () => list.splice(Math.min(at, list.length), 0, name),
      commit: async () => {
        sent.push(name);
        if (fail) throw new Error('Could not delete.');
      },
      settled: () => settled.push(name),
    });
  };
  return { q, clock, list, sent, settled, errors, del };
}

// schedule: gone at once, nothing sent until the window passes
{
  const r = rig();
  r.del('b');
  assert.deepEqual(r.list, ['a', 'c']);
  r.clock.tick(5999);
  assert.deepEqual(r.sent, []);
  r.clock.tick(1);
  await settle();
  assert.deepEqual(r.sent, ['b']);
  assert.deepEqual(r.settled, ['b']);
  assert.equal(r.q.size(), 0);
}

// undo: back where it was, never sent, and its timer is gone
{
  const r = rig();
  const id = r.del('b');
  assert.equal(r.q.undo(id), true);
  assert.deepEqual(r.list, ['a', 'b', 'c']);
  r.clock.tick(10000);
  await settle();
  assert.deepEqual(r.sent, []);
  assert.equal(r.q.undo(id), false); // a second Undo is a no-op
}

// several pending: each undoable on its own
{
  const r = rig();
  r.del('a');
  const idC = r.del('c');
  assert.deepEqual(r.list, ['b']);
  r.q.undo(idC);
  assert.deepEqual(r.list, ['b', 'c']);
  r.clock.tick(6000);
  await settle();
  assert.deepEqual(r.sent, ['a']);
  assert.deepEqual(r.list, ['b', 'c']);
}

// flush: everything sent now, synchronously up to the request
{
  const r = rig();
  r.del('a');
  r.del('b');
  const p = r.q.flush();
  assert.deepEqual(r.sent, ['a', 'b']); // already out before the await
  await p;
  assert.equal(r.q.size(), 0);
  r.clock.tick(6000);
  await settle();
  assert.deepEqual(r.sent, ['a', 'b']); // not twice
}

// commit failure: the item comes back and the error is handed on
{
  const r = rig();
  r.del('b', true);
  r.clock.tick(6000);
  await settle();
  assert.deepEqual(r.list, ['a', 'b', 'c']);
  assert.deepEqual(r.errors, ['Could not delete.']);
}

// hold / release: the window pauses, and gets a little time back
{
  const r = rig();
  r.del('b');
  r.clock.tick(5000);
  r.q.hold();
  r.clock.tick(60000);
  await settle();
  assert.deepEqual(r.sent, []);
  r.q.release(1500);
  r.clock.tick(1499);
  await settle();
  assert.deepEqual(r.sent, []);
  r.clock.tick(1);
  await settle();
  assert.deepEqual(r.sent, ['b']);
}

// scheduled while held: waits for the release
{
  const r = rig();
  r.q.hold();
  r.del('a');
  r.clock.tick(60000);
  await settle();
  assert.deepEqual(r.sent, []);
  r.q.release();
  r.clock.tick(6000);
  await settle();
  assert.deepEqual(r.sent, ['a']);
}

// reapply: a reload that brought the item back loses it again
{
  const r = rig();
  r.del('b');
  r.list.splice(1, 0, 'b');
  r.q.reapply();
  assert.deepEqual(r.list, ['a', 'c']);
}

// clear: nothing sent, nothing restored
{
  const r = rig();
  r.del('b');
  r.q.clear();
  r.clock.tick(6000);
  await settle();
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.list, ['a', 'c']);
}

console.log('undo-queue: ok');
