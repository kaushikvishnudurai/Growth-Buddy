/* =====================================================================
   Growth Buddy — a goal's linked tasks, as data. No DOM, so
   `node scripts/goal-tasks.test.mjs` can check it; goals.js draws and
   app.js (`effectiveGoalProgress`) feeds the result in.
   A task belongs to a goal by its `goalId` (tasks.goal_id). The live ones are
   `state.tasks`; a finished one the midnight sweep cleared is gone from there,
   so the goal's `clearedTaskCount` (from the server) adds it back to both
   numbers — otherwise "Tasks: 3/5" would read "0/2" every morning.
   ===================================================================== */

/** `{ done, total, open }` for one goal: `open` is its unfinished live tasks. */
export function goalTaskStats(goal, tasks) {
  const id = goal && goal.id;
  const cleared = Math.max(0, Number((goal && goal.clearedTaskCount) || 0));
  const mine = id ? (tasks || []).filter((t) => t && t.goalId === id) : [];
  const open = mine.filter((t) => !t.done);
  return { done: mine.length - open.length + cleared, total: mine.length + cleared, open };
}

/**
 * What the goal's work bar shows: milestones, plus finished linked tasks when
 * the goal's progress blob says `countTasks`. Each milestone and each task is
 * one step, so a goal with 2 milestones and 8 tasks is not half-done because
 * both milestones are. `{ done, total, pct, withTasks }`.
 */
export function combinedGoalProgress(progress, taskStats) {
  const ms = (progress && Array.isArray(progress.milestones) && progress.milestones) || [];
  const msDone = ms.filter((x) => x && x.done).length;
  const withTasks = !!(progress && progress.countTasks) && !!taskStats && taskStats.total > 0;
  const done = msDone + (withTasks ? taskStats.done : 0);
  const total = ms.length + (withTasks ? taskStats.total : 0);
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, withTasks };
}

/**
 * The goal a task tick just finished off: its last open linked task done, the
 * goal itself still open. `before` / `after` are the task lists either side of
 * the tick. Null when nothing was finished off.
 */
export function goalFinishedBy(taskId, before, after, goals) {
  const was = (before || []).find((t) => t && t.id === taskId);
  const now = (after || []).find((t) => t && t.id === taskId);
  if (!was || !now || was.done || !now.done || !now.goalId) return null;
  const goal = (goals || []).find((g) => g && g.id === now.goalId);
  if (!goal || goal.completed) return null;
  return goalTaskStats(goal, after).open.length === 0 ? goal : null;
}
