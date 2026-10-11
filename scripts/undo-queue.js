/* =====================================================================
   Growth Buddy — Undo queue (DOM-free)
   A delete that waits: schedule() takes the item off the screen at once, and
   its real request (commit) goes only when the window passes. undo() puts it
   back and nothing is sent. flush() sends every pending one now (the page is
   going away, or the user is signing out). A commit that fails puts the item
   back and hands the error to onError. hold() / release() pause and resume
   every window, for a toast stack that is being hovered or focused.

   entry: { remove(), restore(), commit() -> Promise, settled?() }
   remove() must be safe to run again: reapply() re-runs it after a list is
   reloaded from a server that still has the item.
   ===================================================================== */

export function createUndoQueue({
  ms = 6000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  onError = () => {},
} = {}) {
  const pending = new Map(); // id -> { entry, handle, due } running, or { entry, left } held
  let seq = 0;
  let held = false;

  function arm(id, wait) {
    const p = pending.get(id);
    if (held) {
      p.left = wait;
      return;
    }
    p.handle = setTimer(() => commit(id), wait);
    p.due = now() + wait;
  }

  // Out of the queue for good: no timer, and the toast it owns can go.
  function take(id) {
    const p = pending.get(id);
    if (!p) return null;
    clearTimer(p.handle);
    pending.delete(id);
    if (p.entry.settled) p.entry.settled();
    return p.entry;
  }

  async function commit(id) {
    const e = take(id);
    if (!e) return;
    try {
      await e.commit();
    } catch (err) {
      e.restore();
      onError(err, e);
    }
  }

  return {
    schedule(entry) {
      const id = ++seq;
      pending.set(id, { entry });
      entry.remove();
      arm(id, ms);
      return id;
    },
    undo(id) {
      const e = take(id);
      if (!e) return false;
      e.restore();
      return true;
    },
    commit,
    /* Every request leaves before this returns (each commit runs up to its
       first await synchronously), so a caller can clear the token right after. */
    flush() {
      return Promise.all([...pending.keys()].map(commit));
    },
    /* Forget everything, sending nothing and restoring nothing: the session
       that owned these is already gone. */
    clear() {
      for (const p of pending.values()) clearTimer(p.handle);
      pending.clear();
    },
    reapply() {
      for (const p of pending.values()) p.entry.remove();
    },
    has: (id) => pending.has(id),
    size: () => pending.size,
    hold() {
      if (held) return;
      held = true;
      const t = now();
      for (const p of pending.values()) {
        clearTimer(p.handle);
        p.left = Math.max(0, p.due - t);
      }
    },
    // A little time back after letting go, as the toasts get.
    release(grace = 1500) {
      if (!held) return;
      held = false;
      for (const [id, p] of pending) arm(id, Math.max(p.left, grace));
    },
  };
}
