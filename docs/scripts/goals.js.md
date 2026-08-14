# scripts/goals.js — Goals screen (690 lines)

Exports `ScreenGoals` (~491).

Horizons: `short_term` / `mid_term` / `long_term`, labelled by `HORIZON_LABEL` (7) and coloured by
`HORIZON_META` (13) — leaf / sun / iris ramps respectively. Goals arrive from the backend grouped
into sections by horizon; per-goal *progress* (day tracker + milestones) lives **client-side** in
app.js (`loadGoalProgress` / `updateGoalProgress`), while goals and their actions are server-owned
(`/api/goals`, `/api/goals/{id}/actions`, `/api/goals/{id}/progress`).

| Fn | Line | What |
|---|---|---|
| `fmtDate(value)` | 19 | `YYYY-MM-DD` → locale date, "No target date" when empty |
| `openGoalModal({...})` | 38 | add/edit modal shell |
| `confirmInModal({...})` | 95 | in-place confirm (no nested modal) |
| `openEditProgress(goal, progress, onUpdateProgress)` | 105 | progress editor |
| `GoalProgressBar({goal, progress, onUpdateProgress})` | 161 | day-tracker bar |
| `milestoneStats(progress)` | 243 | done/total counts |
| `GoalMilestones({goal, progress, onUpdateProgress})` | 249 | sub-task list |
| `ActionRow(goal, action, onEditAction, onDeleteAction)` | 335 | one goal action |
| `GoalRow(...)` | 382 | the goal card (largest component) |
| `ScreenGoals({...})` | 491 | sections by horizon + add flow |

Styles: `app.css` §"Goals screen" (~2717), §"Enhanced goal card UI" (~2824),
§"Goal day-tracker progress bar" (~4824), §"Goal milestones / sub-tasks" (~6520).
