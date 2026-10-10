# scripts/goals.js — Goals screen

Exports `ScreenGoals`.

Horizons: `short_term` / `mid_term` / `long_term`, labelled by `HORIZON_LABEL` and coloured by
`HORIZON_META` — leaf / sun / iris ramps respectively. Goals arrive from the backend grouped
into sections by horizon; per-goal *progress* (day tracker + milestones) lives **client-side** in
app.js (`loadGoalProgress` / `updateGoalProgress`), while goals and their actions are server-owned
(`/api/goals`, `/api/goals/{id}/actions`, `/api/goals/{id}/progress`).

| Fn | What |
|---|---|
| `fmtDate(value)` | `YYYY-MM-DD` → locale date, "No target date" when empty |
| `todayKey()` | today in the **account's** zone (`timezone` prop → module `userZone`), the day the server's `UserClock` checks action dates against; the device date only when no zone is set |
| `daysUntil(dateKey)` / `sortGoals(goals)` | days to a target; open goals first by nearest target (undated last), completed last by `completedAt` |
| `openGoalModal({...})` | modal shell (gb-kit `openModal` with this screen's error wording — no render hook, so app.js handlers render themselves) |
| `confirmInModal({...})` | in-place confirm (no nested modal) |
| `openEditProgress(goal, progress, onUpdateProgress, linkedCount)` | progress editor. With linked habits it offers a switch "Count a day whenever a linked habit was done" → `autoDays: true` + `autoSince` (the goal's `createdAt` day, kept once set); the manual count field hides. Saving a manual count writes `autoDays: false` |
| `GoalProgressBar({goal, progress, onUpdateProgress, linkedCount})` | day-tracker bar. Counting from habits (`autoDays` and links): labelled "from linked habits", no Log a day — `daysFollowed` arrives already counted (app.js `effectiveGoalProgress`, the stored count untouched). Otherwise "Log a day" is the outlined `.gb-goal-day-btn`. **Once a day:** it writes `lastLoggedOn` (and `prevLoggedOn`) into the progress blob; while `lastLoggedOn` is today the button reads "Logged today · Undo" and takes the day back |
| `milestoneStats(progress)` | done/total counts |
| `GoalMilestones({goal, progress, onUpdateProgress})` | sub-task list `[{id, title, done, due?}]`; the add field is a `.gb-affix` with a round + inside it (`.gb-goal-ms-addbtn`). A plain row is check, title (+ a due chip, coral when overdue) and a pencil; the pencil swaps the row in place (no save) for the edit row: name, optional due date, move up / down, delete, cancel, save. Enter saves, Escape cancels. Which row is open is module `editingMs`, so a move (which saves, carrying a typed name with it) re-renders with the row still open. The list edits are `goal-milestones.js` (DOM-free, `node scripts/goal-milestones.test.mjs`) |
| `GoalTasks({goal, progress, tasks, onUpdateProgress, taskOps})` | the card's linked tasks (`tasks.goal_id`): "Tasks: done/total" (`progress.linkedTasks`, from app.js `effectiveGoalProgress` via `goal-tasks.js`), the open ones with a tick (`taskOps.onToggleTask` = app.js `toggleTask`), "Add a task" (`taskOps.onAddTask(goal)` → New task with this goal picked) and the switch "Count finished tasks toward progress" → `countTasks` in the blob. With `countTasks` on, `GoalMilestones`' bar reads "Milestones + tasks" from `progress.work` (`combinedGoalProgress`: one step per milestone and per task) |
| `ActionRow(goal, action, onEditAction, onDeleteAction)` | one goal action |
| `GoalRow(..., linked, taskOps, onFocus)` | the goal card (largest component). `onFocus` (ScreenGoals `onFocusGoal`, app.js `startFocusOn({goalId})`) adds a header timer button on an open goal that opens Focus with the goal picked. `taskOps` (`{onAddTask, onToggleTask}`) feeds `GoalTasks`. `linked` (`{count, month, autoDays}` from app.js `goalHabitSummary`) adds "Linked habits: N check-ins this month". Header pencil → `openGoalForm(goal)` (edit). Target line flags **Overdue** (coral) and "N days left" inside 30 days. "See all N actions" when `actionCount` > the 3 `recentActions` → `openAllActions`. When every milestone, the day tracker and every linked task are done it says so and makes "Mark done" primary (the same suggestion toggleTask's "Mark goal done" toast makes off Goals). Its trash icon calls `onDeleteGoal` directly; app.js routes that through `confirmDelete`, and `toggleGoal` there guards a double tap, toasts its own failure and `celebrate()`s a goal turning done |
| `ScreenGoals({...})` | sections by horizon (sorted by `sortGoals`; completed ones fold into a `<details>` "Completed (n)") + add/edit flow. `openGoalForm(goal?)` (inside it): title as the headline field, horizon as three buttons with a hint (`HORIZON_HINT`), then an optional why, and target date + "Track daily N days" side by side (`.gb-form-pair`, shared with Log food); editing prefills, drops the Track daily field (the tracker has its own pencil) and PUTs via `onUpdateGoal` (`clearTargetDate` for a removed date). Last comes **Linked habits**: a pressed/unpressed chip per habit (`habits` prop); the ids go in the progress blob as `linkedHabitIds` (no schema change), saved only when changed; unlinking all also sets `autoDays: false`. `openAllActions(goal)` lists `onLoadActions(id)` (GET `/api/goals/{id}/actions`) |

Styles: `app.css` §"Goals screen", §"Enhanced goal card UI",
§"Goal day-tracker progress bar", §"Goal milestones / sub-tasks".
