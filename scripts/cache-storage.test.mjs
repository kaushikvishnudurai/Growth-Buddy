/* Run: node scripts/cache-storage.test.mjs

   Writes to one key must land in the order they were made. The focus timer's
   Reset does set-then-remove; unordered, the put landed last and the session
   the user threw away came back on reload. The fake Cache API below makes a
   put slower than a delete, which is exactly the race. */
import assert from 'node:assert/strict';

const store = new Map();
const later = (ms, fn) => new Promise((r) => setTimeout(() => r(fn()), ms));
globalThis.caches = {
  open: async () => ({
    put: (url, res) => res.text().then((v) => later(20, () => store.set(url, v))),
    delete: (url) => later(1, () => store.delete(url)),
    keys: async () => [...store.keys()].map((url) => ({ url })),
    match: async (req) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
  }),
  delete: async () => store.clear(),
};

const { CacheStorage } = await import('./cache-storage.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

CacheStorage.setItem('gb.timer', 'running');
CacheStorage.removeItem('gb.timer');
await wait(60);
assert.equal(store.size, 0, 'set then remove ends removed');

CacheStorage.removeItem('gb.x');
CacheStorage.setItem('gb.x', 'a');
CacheStorage.setItem('gb.x', 'b');
await wait(80);
assert.deepEqual([...store.values()], ['b'], 'last write wins');

// The cookie is stored URI-encoded: a session whose slim JSON is ~3 KB encodes
// past 4 KB. It must still leave a cookie boot can sign in from, not none.
const { cookieValue } = await import('./cache-storage.js');
const big = { id: 'u1', displayName: 'Ana', timezone: 'Asia/Kolkata', features: { money: false }, uiPrefs: { blob: '{"a":1}'.repeat(300) } };
assert.ok(JSON.stringify(big).length < 3500, 'raw JSON is under the old raw-length check');
const c = cookieValue('gb.session', JSON.stringify(big));
assert.ok(c && encodeURIComponent(c).length <= 3500, 'encoded cookie fits');
assert.deepEqual(JSON.parse(c), { id: 'u1', displayName: 'Ana', timezone: 'Asia/Kolkata', features: { money: false } });
const small = { id: 'u2', uiPrefs: { theme: 'dark' } };
assert.deepEqual(JSON.parse(cookieValue('gb.session', JSON.stringify(small))), small, 'a session that fits keeps uiPrefs');
assert.equal(cookieValue('gb.apiBase', '"'.repeat(1500)), null, 'any key: the encoded length decides');

// Two tabs, two module instances, two in-memory maps. An op queued in one tab
// used to be written over by the other tab's next whole-array write.
const { CacheStorage: tabB } = await import('./cache-storage.js?tab=b');
const { createOutbox } = await import('./outbox.js');
const key = () => 'gb.outbox.u1';
const boxA = createOutbox(CacheStorage, key);
const boxB = createOutbox(tabB, key);
boxA.enqueue({ id: 'op-a', method: 'POST', path: '/api/tasks', body: {} });
await wait(10);
boxB.enqueue({ id: 'op-b', method: 'POST', path: '/api/tasks', body: {} });
await wait(10);
assert.deepEqual(boxA.list().map((x) => x.id), ['op-a', 'op-b'], "tab A sees tab B's op");
assert.deepEqual(boxB.list().map((x) => x.id), ['op-a', 'op-b'], "tab B kept tab A's op");
boxA.remove('op-a');
await wait(10);
assert.deepEqual(boxB.list().map((x) => x.id), ['op-b'], 'a remove reaches the other tab');
CacheStorage.setItem('gb.money.u1.water', '[1]');
CacheStorage.setItem('gb.money.u1.pending', '{}');
CacheStorage.setItem('gb.timer', 'tab-a-only');
await wait(10);
assert.equal(tabB.getItem('gb.money.u1.water'), '[1]', 'the water queue is shared');
assert.equal(tabB.getItem('gb.money.u1.pending'), '{}', "Money's pending ledger is shared");
assert.equal(tabB.getItem('gb.timer'), null, 'other keys stay per tab');
CacheStorage.removeItem('gb.money.u1.water');
await wait(10);
assert.equal(tabB.getItem('gb.money.u1.water'), null);

console.log('cache-storage: ok');
