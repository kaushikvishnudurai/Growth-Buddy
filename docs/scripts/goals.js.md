# scripts/goals.js — Goals screen

Exports `ScreenGoals`.

Horizons: `short_term` / `mid_term` / `long_term`, labelled by `HORIZON_LABEL` (7) and coloured by
`HORIZON_META` (13) — leaf / sun / iris ramps respectively. Goals arrive from the backend grouped
into sections by horizon; per-goal *progress* (day tracker + milestones) lives **client-side** in
app.js (`loadGoalProgress` / `updateGoalProgress`), while goals and their actions are server-owned
(`/api/goals`, `/api/goals/{id}/actions`, `/api/goals/{id}/progress`).

| Fn | What |
|---|---|
| `fmtDate(value)` | `YYYY-MM-DD` → locale date, "No target date" when empty |
| `openGoalModal({...})` | add/edit modal shell |
| `confirmInModal({...})` | in-place confirm (no nested modal) |
| `openEditProgress(goal, progress, onUpdateProgress)` | progress editor |
| `GoalProgressBar({goal, progress, onUpdateProgress})` | day-tracker bar; "Log a day" is the outlined `.gb-goal-day-btn` |
| `milestoneStats(progress)` | done/total counts |
| `GoalMilestones({goal, progress, onUpdateProgress})` | sub-task list; the add field is a `.gb-affix` with a round + inside it (`.gb-goal-ms-addbtn`) |
| `ActionRow(goal, action, onEditAction, onDeleteAction)` | one goal action |
| `GoalRow(...)` | the goal card (largest component). Its trash icon calls `onDeleteGoal` directly; app.js routes that through `confirmDelete`, and `toggleGoal` there guards a double tap and toasts its own failure |
| `ScreenGoals({...})` | sections by horizon + add flow. `openCreateGoal` (inside it): title as the headline field, horizon as three buttons with a hint (`HORIZON_HINT`), then an optional why, and target date + "Track daily N days" side by side (`.gb-form-pair`, shared with Log food) |

Styles: `app.css` §"Goals screen", §"Enhanced goal card UI",
§"Goal day-tracker progress bar", §"Goal milestones / sub-tasks".
