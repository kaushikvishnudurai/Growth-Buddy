/* A goal progress save refused as stale (409: another device or tab saved
   since this one loaded it). This tab's edits since `base` (the blob it last
   had from the server) put onto `theirs` (the server's blob now): a field is
   ours where we changed it, theirs otherwise. Milestones go by id: ours where
   we changed one, gone where we deleted one, appended where we added one.
   Lazy (app.js putGoalProgress), so none of this is in the boot chunk. */
export function mergeProgress(base, mine, theirs) {
  const b = base || {};
  const m = mine || {};
  const t = theirs || {};
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const out = { ...t };
  for (const k in m) if (k !== 'milestones' && !same(m[k], b[k])) out[k] = m[k];
  const key = (x) => x.id || x.title;
  const byKey = (list) => new Map((list || []).map((x) => [key(x), x]));
  const bm = byKey(b.milestones);
  const mm = byKey(m.milestones);
  const tm = byKey(t.milestones);
  const ms = (t.milestones || [])
    .filter((x) => mm.has(key(x)) || !bm.has(key(x)))
    .map((x) => {
      const ours = mm.get(key(x));
      return ours && !same(ours, bm.get(key(x))) ? ours : x;
    });
  (m.milestones || []).forEach((x) => {
    if (!bm.has(key(x)) && !tm.has(key(x))) ms.push(x);
  });
  if (m.milestones || t.milestones) out.milestones = ms;
  return out;
}

/* A goal's progress PUT with the version this tab last had (If-Match). A 409
   (another device saved since, HOS-2) carries the goal as it is now: our edits
   go onto it and are sent once more. `read` / `write` are the tab's blob; the
   answer's progress and version become the goal's, the base of the next merge. */
export async function putProgress(api, goalId, goal, read, write) {
  const put = (body, version) =>
    api('/api/goals/' + encodeURIComponent(goalId) + '/progress', {
      method: 'PUT',
      headers: version ? { 'If-Match': version } : {},
      body: JSON.stringify(body),
    });
  let saved;
  try {
    saved = await put(read(), goal && goal.progressVersion);
  } catch (err) {
    if (err.status !== 409 || !err.body || !err.body.progressVersion) throw err;
    write(mergeProgress(goal && goal.progress, read(), err.body.progress));
    saved = await put(read(), err.body.progressVersion);
  }
  if (goal && saved) Object.assign(goal, { progress: saved.progress, progressVersion: saved.progressVersion });
}
