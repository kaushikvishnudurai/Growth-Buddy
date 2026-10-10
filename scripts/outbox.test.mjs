/* Run: node scripts/outbox.test.mjs

   The offline outbox holds writes the server has not seen. An op lost here is a
   tick, a task or a note the user made and will never get; an op sent twice or
   out of order undoes one. Ordering, collapse, temp-id rewrite, the 4xx drop and
   the network stop are each pinned. */
import assert from 'node:assert/strict';
import { createOutbox, tempId, isTempId } from './outbox.js';

/* CacheStorage's surface: synchronous get/set/remove of strings. */
function memStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}
const netErr = () => new Error('No connection.');
const httpErr = (status, message = 'nope') => Object.assign(new Error(message), { status });

/* api mock: answers by a handler, records every call. */
function mockApi(handler) {
  const calls = [];
  const fn = async (path, opts) => {
    calls.push({ path, method: opts.method, body: opts.body, idemKey: (opts.headers || {})['Idempotency-Key'] });
    return handler(path, opts, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const fresh = (user = 'u1') => {
  const s = memStorage();
  return { s, ob: createOutbox(s, () => 'gb.outbox.' + user) };
};

// Temp ids look like temp ids, and are unique.
{
  const a = tempId();
  const b = tempId();
  assert.ok(isTempId(a) && isTempId(b) && a !== b);
  assert.equal(isTempId('42'), false);
}

// Persisted under the per-user key; an empty queue removes the key.
{
  const { s, ob } = fresh('u7');
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'a' }, kind: 'task.create' });
  assert.ok(s.m.has('gb.outbox.u7'));
  assert.equal(ob.size(), 1);
  assert.equal(typeof ob.list()[0].body, 'string'); // bodies stored as the JSON that will be sent
  ob.remove(ob.list()[0].id);
  assert.equal(s.m.has('gb.outbox.u7'), false);
}

// FIFO: sent in the order they were made.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/1/toggle', toggleKey: 'task:1' });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/2' });
  ob.enqueue({ method: 'POST', path: '/api/notes', body: { title: 'n' } });
  const api = mockApi(() => ({}));
  const out = await ob.flush(api);
  assert.deepEqual(
    api.calls.map((c) => c.method + ' ' + c.path),
    ['PATCH /api/tasks/1/toggle', 'DELETE /api/tasks/2', 'POST /api/notes']
  );
  assert.equal(out.sent.length, 3);
  assert.equal(ob.size(), 0);
}

// Two toggles of the same habit on the same day cancel; a different day doesn't.
{
  const { ob } = fresh();
  assert.equal(ob.enqueue({ method: 'POST', path: '/api/habits/7/checkin', toggleKey: 'habit:7:2026-10-10' }), 'queued');
  assert.equal(ob.enqueue({ method: 'POST', path: '/api/habits/7/checkin', toggleKey: 'habit:7:2026-10-10' }), 'cancelled');
  assert.equal(ob.size(), 0);
  ob.enqueue({ method: 'POST', path: '/api/habits/7/checkin', toggleKey: 'habit:7:2026-10-09' });
  ob.enqueue({ method: 'POST', path: '/api/habits/7/checkin', toggleKey: 'habit:7:2026-10-10' });
  assert.equal(ob.size(), 2);
  // A third tap is one op again.
  ob.enqueue({ method: 'POST', path: '/api/habits/7/checkin', toggleKey: 'habit:7:2026-10-10' });
  assert.equal(ob.size(), 1);
}

// Create then delete of a temp id cancels both, and anything else naming it.
{
  const { ob } = fresh();
  const t = tempId();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'x' }, tempId: t, kind: 'task.create' });
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/' + t + '/toggle', toggleKey: 'task:' + t });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/99' }); // unrelated, stays
  assert.equal(ob.enqueue({ method: 'DELETE', path: '/api/tasks/' + t }), 'cancelled');
  assert.deepEqual(ob.list().map((x) => x.path), ['/api/tasks/99']);
}

// Deleting a real resource supersedes queued writes to it (query string ignored).
{
  const { ob } = fresh();
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/5/toggle', toggleKey: 'task:5' });
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/50/toggle', toggleKey: 'task:50' }); // not task 5
  assert.equal(ob.enqueue({ method: 'DELETE', path: '/api/tasks/5' }), 'superseded');
  assert.deepEqual(ob.list().map((x) => x.method + ' ' + x.path), [
    'PATCH /api/tasks/50/toggle',
    'DELETE /api/tasks/5',
  ]);
  const r = fresh().ob;
  r.enqueue({ method: 'PATCH', path: '/api/reminders/3?scope=all', body: { text: 'a' } });
  r.enqueue({ method: 'DELETE', path: '/api/reminders/3?scope=all' });
  assert.equal(r.size(), 1);
}

// Temp id → server id: later queued ops are rewritten, the map is reported.
{
  const { ob } = fresh();
  const t = tempId();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'x' }, tempId: t });
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/' + t + '/toggle', toggleKey: 'task:' + t });
  const api = mockApi((path) => (path === '/api/tasks' ? { id: 'srv-1' } : {}));
  const out = await ob.flush(api);
  assert.deepEqual(out.idMap, { [t]: 'srv-1' });
  assert.equal(api.calls[1].path, '/api/tasks/srv-1/toggle');
  assert.equal(ob.size(), 0);
}

// An op queued while its create is being sent is not cancelled out from under
// it: the delete waits, and goes out against the server id.
{
  const { ob } = fresh();
  const t = tempId();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'x' }, tempId: t });
  let release;
  const gate = new Promise((r) => (release = r));
  const api = mockApi(async (path) => {
    if (path === '/api/tasks') {
      await gate;
      return { id: 77 };
    }
    return null;
  });
  const p = ob.flush(api);
  await Promise.resolve();
  assert.equal(ob.enqueue({ method: 'DELETE', path: '/api/tasks/' + t }), 'queued');
  release();
  await p;
  // The delete was queued after the flush read the queue head; a second flush sends it.
  if (ob.size()) await ob.flush(api);
  assert.deepEqual(api.calls.map((c) => c.method + ' ' + c.path), ['POST /api/tasks', 'DELETE /api/tasks/77']);
  // And a temp id already mapped is rewritten at enqueue.
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/' + t + '/toggle' });
  assert.equal(ob.list()[0].path, '/api/tasks/77/toggle');
}

// Network error: stop, keep this op and everything behind it, in order.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/1' });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/2' });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/3' });
  const api = mockApi((path) => {
    if (path === '/api/tasks/2') throw netErr();
    return null;
  });
  const out = await ob.flush(api);
  assert.equal(out.stopped, true);
  assert.equal(api.calls.length, 2); // 3 never tried
  assert.deepEqual(ob.list().map((x) => x.path), ['/api/tasks/2', '/api/tasks/3']);
}

// 5xx, 401, 408 and 429 are "later", not "no".
for (const status of [500, 503, 401, 408, 429]) {
  const { ob } = fresh();
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/1' });
  const out = await ob.flush(mockApi(() => {
    throw httpErr(status);
  }));
  assert.equal(out.stopped, true, 'status ' + status);
  assert.equal(ob.size(), 1, 'status ' + status);
}

// A 4xx refusal is dropped and reported; the queue carries on. Ops naming a
// refused create's temp id go with it.
{
  const { ob } = fresh();
  const t = tempId();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: '' }, tempId: t, kind: 'task.create' });
  ob.enqueue({ method: 'PATCH', path: '/api/tasks/' + t + '/toggle', toggleKey: 'task:' + t });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/9' });
  const api = mockApi((path) => {
    if (path === '/api/tasks') throw httpErr(400, 'Give the task a title.');
    return null;
  });
  const out = await ob.flush(api);
  assert.equal(out.stopped, false);
  assert.deepEqual(out.dropped.map((d) => d.op.path), ['/api/tasks', '/api/tasks/' + t + '/toggle']);
  assert.equal(out.dropped[0].message, 'Give the task a title.');
  assert.deepEqual(api.calls.map((c) => c.path), ['/api/tasks', '/api/tasks/9']);
  assert.equal(ob.size(), 0);
}

// A 409 is surfaced as a conflict, not silently dropped with the refusals.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'DELETE', path: '/api/reminders/4?scope=all' });
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/8' });
  const out = await ob.flush(mockApi((path) => {
    if (path.startsWith('/api/reminders')) throw httpErr(409, 'Changed elsewhere.');
    return null;
  }));
  assert.equal(out.conflicts.length, 1);
  assert.equal(out.conflicts[0].status, 409);
  assert.equal(out.dropped.length, 0);
  assert.equal(out.sent.length, 1);
}

// Single-flight: two flushes at once send each op once.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/1' });
  const api = mockApi(async () => null);
  await Promise.all([ob.flush(api), ob.flush(api)]);
  assert.equal(api.calls.length, 1);
}

// Per-user: another account's queue is not this one's.
{
  const s = memStorage();
  let who = 'a';
  const ob = createOutbox(s, () => 'gb.outbox.' + who);
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/1' });
  who = 'b';
  assert.equal(ob.size(), 0);
  who = 'a';
  assert.equal(ob.size(), 1);
}

// Idempotency-Key: minted at enqueue, one per op, and the SAME on every retry —
// a POST that landed but whose answer was lost must be recognised by the server,
// which only works if the second attempt says it is the first one again.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'a' } });
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'a' } });
  const [k1, k2] = ob.list().map((x) => x.idemKey);
  assert.match(k1, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(k1, k2);
  let fail = true;
  const api = mockApi(() => {
    if (fail) throw netErr();
    return { id: 'srv' };
  });
  await ob.flush(api); // answer lost
  fail = false;
  await ob.flush(api);
  assert.deepEqual(api.calls.map((c) => c.idemKey), [k1, k1, k2]);
}

// An op queued before ops had keys gets one on its first send, and keeps it.
{
  const s = memStorage();
  s.setItem('gb.outbox.u1', JSON.stringify([{ id: 'op-old', method: 'DELETE', path: '/api/tasks/1' }]));
  const ob = createOutbox(s, () => 'gb.outbox.u1');
  const api = mockApi(() => {
    throw netErr();
  });
  await ob.flush(api);
  await ob.flush(api);
  assert.ok(api.calls[0].idemKey);
  assert.equal(api.calls[1].idemKey, api.calls[0].idemKey);
  assert.equal(ob.list()[0].idemKey, api.calls[0].idemKey);
}

// "Still in progress" is a 409 that means later, not a conflict to drop.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'a' } });
  const out = await ob.flush(mockApi(() => {
    throw Object.assign(httpErr(409, 'still saving'), { code: 'idempotency_in_progress' });
  }));
  assert.equal(out.stopped, true);
  assert.equal(out.conflicts.length, 0);
  assert.equal(ob.size(), 1);
}

// A 5xx every time: kept for four flushes, dropped on the fifth so the op
// behind it finally goes. The drop is reported like any refusal.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'poison' } });
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'fine' } });
  const api = mockApi((path, opts) => {
    if (JSON.parse(opts.body).title === 'poison') throw httpErr(500, 'boom');
    return { id: 'srv' };
  });
  for (let i = 0; i < 4; i++) {
    const out = await ob.flush(api);
    assert.equal(out.stopped, true);
    assert.equal(ob.size(), 2);
  }
  const out = await ob.flush(api);
  assert.equal(out.dropped.length, 1);
  assert.equal(out.dropped[0].status, 500);
  assert.equal(out.sent.length, 1);
  assert.equal(ob.size(), 0);
}

// A 404 to a replayed DELETE is done, not a refusal: it is already gone.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'DELETE', path: '/api/tasks/9', kind: 'task.delete' });
  const out = await ob.flush(mockApi(() => {
    throw httpErr(404, 'not found');
  }));
  assert.equal(out.dropped.length, 0);
  assert.equal(out.sent.length, 1);
  assert.equal(ob.size(), 0);
}

// A caller's idemKey (the one its live request already sent) is the one kept.
{
  const { ob } = fresh();
  ob.enqueue({ method: 'POST', path: '/api/tasks', body: { title: 'a' }, idemKey: 'live-key-1' });
  assert.equal(ob.list()[0].idemKey, 'live-key-1');
}

// Garbage in storage is an empty queue, not a crash.
{
  const s = memStorage();
  s.setItem('gb.outbox.u1', '{not json');
  assert.deepEqual(createOutbox(s, () => 'gb.outbox.u1').list(), []);
}

console.log('outbox: all tests passed');
