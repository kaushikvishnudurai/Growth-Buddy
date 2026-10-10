/* =====================================================================
   Growth Buddy — offline outbox
   The most common writes (task create / toggle / delete, a habit tick, a
   one-off reminder, a text note) made with no connection are kept here and
   replayed, oldest first, when it comes back. DOM-free so node can test it
   (scripts/outbox.test.mjs); app.js owns the instance, the optimistic paint
   and the toasts.

   An op is { id, method, path, body, kind, createdAt, idemKey } plus, optionally:
     tempId     — a create: the `tmp-…` id the optimistic row wears. When the
                  POST lands, every later queued op naming it is rewritten to
                  the server's id (path and body), and flush() reports the pair.
     toggleKey  — a self-inverse change ("tick habit 7 on 2026-10-10"). A second
                  op with the same key cancels the queued first: two taps are no
                  change at all.
     local      — the optimistic item itself, so a reload can paint it again.

   Collapse rules, applied at enqueue (never to the op being sent right now):
     • same toggleKey queued        → both go (cancelled)
     • DELETE of a `tmp-…` id       → its create and everything naming it go,
                                      and the delete is not queued (cancelled)
     • DELETE of a real resource    → earlier queued writes to that resource go
                                      (superseded); the delete is queued

   flush(apiFn) sends FIFO and stops at the first op that can't go yet: no
   response at all, a 5xx, or 401 / 408 / 429. A 409 is removed and surfaced in
   `conflicts` (somebody else changed it; the app says so and refetches). Any
   other 4xx is a refusal: dropped, with every queued op naming its temp id,
   and reported in `dropped`.

   Every op carries an `idemKey`, minted at enqueue and stored with it, sent as
   the `Idempotency-Key` header on every attempt. A POST that landed but whose
   answer was lost is answered again by the server (IdempotencyFilter), not
   run twice. The one 409 that is NOT a conflict — `code:
   idempotency_in_progress`, the first attempt still running — is "later".
   ===================================================================== */

const TEMP_RE = /tmp-[a-z0-9]+(?:-[a-z0-9]+)*/i;

let seq = 0;
export function tempId() {
  return 'tmp-' + Date.now().toString(36) + '-' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
}
export const isTempId = (id) => typeof id === 'string' && id.startsWith('tmp-');

/* An Idempotency-Key: [A-Za-z0-9_-], at most 64. randomUUID is missing outside a
   secure context (the dev server opened by LAN IP), hence the fallback. */
export function newIdemKey() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return tempId().replace('tmp-', 'idem-');
}

/* Keep trying later, or give up on it. */
function retryable(err) {
  const s = err && err.status;
  if (s === 409 && err.code === 'idempotency_in_progress') return true;
  return !s || s >= 500 || s === 401 || s === 408 || s === 429;
}

const basePath = (p) => String(p || '').split('?')[0];
const mentions = (op, id) =>
  String(op.path || '').includes(id) || (typeof op.body === 'string' && op.body.includes(id));
const swap = (s, from, to) => (typeof s === 'string' ? s.split(from).join(to) : s);

/**
 * @param storage  getItem / setItem / removeItem (CacheStorage in the app)
 * @param keyFn    () => the per-user storage key, e.g. 'gb.outbox.<uid>'
 */
export function createOutbox(storage, keyFn) {
  let sendingId = null; // the op whose request is out right now
  let flushing = null;
  const idMap = new Map(); // temp id -> server id, for ops queued while their create was out

  function list() {
    try {
      const raw = storage.getItem(keyFn());
      const q = raw ? JSON.parse(raw) : [];
      return Array.isArray(q) ? q.filter((x) => x && x.id && x.method && x.path) : [];
    } catch (_) {
      return [];
    }
  }
  function store(q) {
    try {
      if (q.length) storage.setItem(keyFn(), JSON.stringify(q));
      else storage.removeItem(keyFn());
    } catch (_) {
      /* the in-memory copy (CacheStorage's map) still has it this session */
    }
  }
  function remove(id) {
    store(list().filter((x) => x.id !== id));
  }
  function clear() {
    store([]);
    idMap.clear();
  }

  /** Returns 'queued' | 'cancelled' (nothing left to send) | 'superseded' (queued, older ops dropped). */
  function enqueue(input) {
    const op = {
      id: input.id || tempId().replace('tmp-', 'op-'),
      method: String(input.method || 'POST').toUpperCase(),
      path: input.path,
      body: input.body == null ? null : typeof input.body === 'string' ? input.body : JSON.stringify(input.body),
      kind: input.kind || 'write',
      createdAt: input.createdAt || new Date().toISOString(),
      idemKey: input.idemKey || newIdemKey(),
    };
    if (input.tempId) op.tempId = input.tempId;
    if (input.toggleKey) op.toggleKey = input.toggleKey;
    if (input.local !== undefined) op.local = input.local;
    // A temp id whose create has already landed: talk about the real one.
    idMap.forEach((real, tmp) => {
      op.path = swap(op.path, tmp, real);
      op.body = swap(op.body, tmp, real);
      if (op.toggleKey) op.toggleKey = swap(op.toggleKey, tmp, real);
    });
    let q = list();
    if (q.some((x) => x.id === op.id)) return 'queued';
    const idle = (x) => x.id !== sendingId;

    if (op.toggleKey) {
      const twin = q.find((x) => idle(x) && x.toggleKey === op.toggleKey);
      if (twin) {
        store(q.filter((x) => x !== twin));
        return 'cancelled';
      }
    }
    if (op.method === 'DELETE') {
      const m = op.path.match(TEMP_RE);
      const create = m && q.find((x) => x.tempId === m[0]);
      if (create && idle(create)) {
        store(q.filter((x) => !(x === create || (idle(x) && mentions(x, m[0])))));
        return 'cancelled';
      }
      const base = basePath(op.path);
      const before = q.length;
      q = q.filter((x) => {
        if (!idle(x) || x.tempId) return true;
        const b = basePath(x.path);
        return !(b === base || b.startsWith(base + '/'));
      });
      store(q.concat(op));
      return q.length < before ? 'superseded' : 'queued';
    }
    store(q.concat(op));
    return 'queued';
  }

  async function run(apiFn) {
    const out = { sent: [], dropped: [], conflicts: [], idMap: {}, stopped: false };
    for (;;) {
      let op = list()[0];
      if (!op) break;
      if (!op.idemKey) {
        // Queued before ops carried one: mint it once and keep it, so the next
        // attempt sends the same key.
        op = { ...op, idemKey: newIdemKey() };
        const key = op.idemKey;
        store(list().map((x) => (x.id === op.id ? { ...x, idemKey: key } : x)));
      }
      sendingId = op.id;
      let res;
      try {
        const opts = { method: op.method, headers: { 'Idempotency-Key': op.idemKey } };
        if (op.body != null) opts.body = op.body;
        res = await apiFn(op.path, opts);
      } catch (err) {
        sendingId = null;
        if (retryable(err)) {
          out.stopped = true;
          break;
        }
        const gone = [op];
        if (op.tempId) list().forEach((x) => x !== op && x.id !== op.id && mentions(x, op.tempId) && gone.push(x));
        const ids = new Set(gone.map((x) => x.id));
        store(list().filter((x) => !ids.has(x.id)));
        const report = { op, status: err.status, message: err.message };
        if (err.status === 409) out.conflicts.push(report);
        else out.dropped.push(report);
        gone.slice(1).forEach((x) => out.dropped.push({ op: x, status: err.status, message: err.message }));
        continue;
      }
      sendingId = null;
      let rest = list().filter((x) => x.id !== op.id);
      if (op.tempId && res && res.id != null) {
        const real = String(res.id);
        idMap.set(op.tempId, real);
        out.idMap[op.tempId] = real;
        rest = rest.map((x) =>
          mentions(x, op.tempId) || (x.toggleKey && x.toggleKey.includes(op.tempId))
            ? {
                ...x,
                path: swap(x.path, op.tempId, real),
                body: swap(x.body, op.tempId, real),
                ...(x.toggleKey ? { toggleKey: swap(x.toggleKey, op.tempId, real) } : {}),
              }
            : x
        );
      }
      store(rest);
      out.sent.push({ op, result: res });
    }
    return out;
  }

  /** Single-flight: a second call while one is running gets the same promise. */
  function flush(apiFn) {
    if (!flushing) {
      flushing = run(apiFn).finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  return { enqueue, list, remove, clear, flush, size: () => list().length };
}
