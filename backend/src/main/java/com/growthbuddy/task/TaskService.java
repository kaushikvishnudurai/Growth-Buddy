package com.growthbuddy.task;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
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

    public TaskService(TaskRepository repo, TaskHistoryRepository historyRepo, ProgressService progress) {
        this.repo = repo;
        this.historyRepo = historyRepo;
        this.progress = progress;
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
        if (req.dueAt() != null) {
            t.setDueAt(req.dueAt());
        }
        if (req.done() != null) {
            setDone(t, req.done());
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

    private boolean escalateOverduePriority(Task t) {
        if (t.isDone() || t.getDueAt() == null || !t.getDueAt().isBefore(Instant.now())) {
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
