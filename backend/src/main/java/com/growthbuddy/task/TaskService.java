package com.growthbuddy.task;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.goal.GoalService;
import com.growthbuddy.user.ProgressService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TaskService {

    private final TaskRepository repo;
    private final TaskHistoryRepository historyRepo;
    private final ProgressService progress;
    private final GoalService goals;

    public TaskService(TaskRepository repo, TaskHistoryRepository historyRepo, ProgressService progress,
            GoalService goals) {
        this.repo = repo;
        this.historyRepo = historyRepo;
        this.progress = progress;
        this.goals = goals;
    }

    /**
     * The goal a task may be put on: one of the user's own. Someone else's goal
     * (or a deleted one) answers like a missing one, so ids can't be probed.
     */
    UUID ownGoal(UUID userId, UUID goalId) {
        if (goalId != null && !goals.ownsGoal(userId, goalId)) {
            throw ApiException.notFound("Goal");
        }
        return goalId;
    }

    @Transactional(readOnly = true)
    public List<TaskResponse> list(UUID userId) {
        List<Task> tasks = repo.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
        boolean changed = false;
        for (Task t : tasks) {
            changed = escalateOverduePriority(t) || changed;
        }
        if (changed) {
            repo.saveAll(tasks);
        }
        return tasks.stream().map(t -> responseFor(userId, t)).toList();
    }

    @Transactional
    public TaskResponse create(UUID userId, CreateTaskRequest req) {
        Task t = new Task();
        t.setUserId(userId);
        t.setTitle(req.title().trim());
        t.setNotes(req.notes());
        t.setPriority(req.priority() != null ? req.priority() : Priority.Medium);
        t.setDueAt(req.dueAt());
        t.setGoalId(ownGoal(userId, req.goalId()));
        escalateOverduePriority(t);
        return responseFor(userId, repo.save(t));
    }

    @Transactional
    public TaskResponse update(UUID userId, UUID id, UpdateTaskRequest req) {
        Task t = require(userId, id);
        if (req.title() != null) {
            t.setTitle(req.title().trim());
        }
        if (req.notes() != null) {
            t.setNotes(req.notes());
        }
        if (req.priority() != null) {
            t.setPriority(req.priority());
        }
        Instant oldDue = t.getDueAt();
        t.setDueAt(resolveDueAt(oldDue, req.dueAt(), req.clearDueAt()));
        if (isPush(oldDue, t.getDueAt())) {
            t.setPushCount(t.getPushCount() + 1);
        }
        if (req.done() != null) {
            setDone(t, req.done());
        }
        if (req.paused() != null) {
            t.setPaused(req.paused());
        }
        if (Boolean.TRUE.equals(req.clearGoal())) {
            t.setGoalId(null);
        } else if (req.goalId() != null) {
            t.setGoalId(ownGoal(userId, req.goalId()));
        }
        escalateOverduePriority(t);
        return responseFor(userId, repo.save(t));
    }

    @Transactional
    public TaskResponse toggle(UUID userId, UUID id) {
        Task t = require(userId, id);
        setDone(t, !t.isDone());
        escalateOverduePriority(t);
        return responseFor(userId, repo.save(t));
    }

    @Transactional(readOnly = true)
    public List<TaskHistoryResponse> history(UUID userId, UUID id) {
        require(userId, id);
        return historyRepo.findByUserIdAndTaskIdOrderByChangedAtDesc(userId, id)
                .stream().map(TaskHistoryResponse::from).toList();
    }

    @Transactional
    public void delete(UUID userId, UUID id) {
        Task t = require(userId, id);
        t.setDeletedAt(Instant.now());
        // Off its goal too: a soft-deleted task that is done and still linked
        // reads as one the midnight sweep cleared, which the goal counts.
        t.setGoalId(null);
        repo.save(t);
        historyRepo.deleteByUserIdAndTaskId(userId, id);
    }

    private void setDone(Task t, boolean done) {
        boolean wasDone = t.isDone();
        t.setDone(done);
        Instant now = Instant.now();
        t.setDoneAt(done ? now : null);
        if (!wasDone && done) {
            TaskHistory h = new TaskHistory();
            h.setUserId(t.getUserId());
            h.setTaskId(t.getId());
            h.setChangedAt(now);
            h.setPriority((t.getPriority() != null ? t.getPriority() : Priority.Medium).name());
            h.setDueAt(t.getDueAt());
            historyRepo.save(h);
            progress.awardTaskCompletion(t.getUserId());
        }
    }

    /**
     * Which due date an update lands on. An explicit clear wins, a supplied
     * value is taken, and no value at all leaves the current one — the "null
     * means leave it alone" rule the rest of {@link UpdateTaskRequest} follows.
     */
    /**
     * A due date moved later counts as a push. ponytail: "later by 12h or more"
     * rather than "a later day in the user's zone", so this needs no clock; a
     * morning task moved to the evening counts too. Inject UserClock if that matters.
     */
    static boolean isPush(Instant before, Instant after) {
        return before != null && after != null && !after.isBefore(before.plus(Duration.ofHours(12)));
    }

    /** Tasks ticked off in the last {@code days}, swept ones included: what Insights times. */
    @Transactional(readOnly = true)
    public List<FinishedTask> finished(UUID userId, int days) {
        Instant since = Instant.now().minus(Duration.ofDays(Math.max(1, Math.min(days, 180))));
        return repo.findByUserIdAndDoneAtAfter(userId, since).stream()
                .map(t -> new FinishedTask(t.getPriority(), t.getCreatedAt(), t.getDoneAt()))
                .toList();
    }

    static Instant resolveDueAt(Instant current, Instant requested, Boolean clear) {
        if (Boolean.TRUE.equals(clear)) {
            return null;
        }
        return requested != null ? requested : current;
    }

    private boolean escalateOverduePriority(Task t) {
        if (t.isDone() || t.isPaused() || t.getDueAt() == null || !t.getDueAt().isBefore(Instant.now())) {
            return false;
        }
        if (t.getPriority() == Priority.High) {
            return false;
        }
        t.setPriority(Priority.High);
        return true;
    }

    private TaskResponse responseFor(UUID userId, Task t) {
        List<TaskHistory> history = historyRepo.findByUserIdAndTaskIdOrderByChangedAtDesc(userId, t.getId());
        Instant lastCompletedAt = history.isEmpty() ? null : history.get(0).getChangedAt();
        return TaskResponse.from(t, history.size(), lastCompletedAt);
    }

    private Task require(UUID userId, UUID id) {
        return repo.findByIdAndUserIdAndDeletedAtIsNull(id, userId)
                .orElseThrow(() -> ApiException.notFound("Task"));
    }
}
