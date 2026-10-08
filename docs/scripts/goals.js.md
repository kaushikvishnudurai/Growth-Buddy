# scripts/goals.js — Goals screen (690 lines)

Exports `ScreenGoals` (~491).

Horizons: `short_term` / `mid_term` / `long_term`, labelled by `HORIZON_LABEL` (7) and coloured by
`HORIZON_META` (13) — leaf / sun / iris ramps respectively. Goals arrive from the backend grouped
into sections by horizon; per-goal *progress* (day tracker + milestones) lives **client-side** in
app.js (`loadGoalProgress` / `updateGoalProgress`), while goals and their actions are server-owned
(`/api/goals`, `/api/goals/{id}/actions`, `/api/goals/{id}/progress`).

| Fn | Line | What |
|---|---|---|
| `fmtDate(value)` | 18 | `YYYY-MM-DD` → locale date, "No target date" when empty |
| `openGoalModal({...})` | 39 | add/edit modal shell |
| `confirmInModal({...})` | 43 | in-place confirm (no nested modal) |
| `openEditProgress(goal, progress, onUpdateProgress)` | 53 | progress editor |
| `GoalProgressBar({goal, progress, onUpdateProgress})` | 109 | day-tracker bar; "Log a day" is the outlined `.gb-goal-day-btn` |
| `milestoneStats(progress)` | 191 | done/total counts |
| `GoalMilestones({goal, progress, onUpdateProgress})` | 197 | sub-task list; the add field is a `.gb-affix` with a round + inside it (`.gb-goal-ms-addbtn`) |
| `ActionRow(goal, action, onEditAction, onDeleteAction)` | 292 | one goal action |
| `GoalRow(...)` | 339 | the goal card (largest component). Its trash icon calls `onDeleteGoal` directly; app.js routes that through `confirmDelete`, and `toggleGoal` there guards a double tap and toasts its own failure |
| `ScreenGoals({...})` | 448 | sections by horizon + add flow. `openCreateGoal` (inside it): title as the headline field, horizon as three buttons with a hint (`HORIZON_HINT`), then an optional why, and target date + "Track daily N days" side by side (`.gb-form-pair`, shared with Log food) |

Styles: `app.css` §"Goals screen" (~2717), §"Enhanced goal card UI" (~2824),
§"Goal day-tracker progress bar" (~4824), §"Goal milestones / sub-tasks" (~6520).
