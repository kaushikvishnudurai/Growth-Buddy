package com.growthbuddy.mentorship;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.task.Task;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/mentorship")
public class MentorshipController {

    private final MentorshipService service;
    private final UserRepository users;
    private final TaskRepository tasks;
    private final HabitService habits;

    public MentorshipController(MentorshipService service,
                                UserRepository users,
                                TaskRepository tasks,
                                HabitService habits) {
        this.service = service;
        this.users = users;
        this.tasks = tasks;
        this.habits = habits;
    }

    public record CreateRequest(
            @NotNull UUID toUserId,
            @NotBlank String direction,
            @Size(max = 500) String note) {}

    @PostMapping("/requests")
    @ResponseStatus(HttpStatus.CREATED)
    public MentorshipService.RequestDto create(@Valid @RequestBody CreateRequest req) {
        Direction d = "offer".equalsIgnoreCase(req.direction()) ? Direction.offer : Direction.request;
        return service.create(CurrentUser.id(), req.toUserId(), d, req.note());
    }

    @PostMapping("/requests/{id}/accept")
    public MentorshipService.RequestDto accept(@PathVariable UUID id) {
        return service.respond(CurrentUser.id(), id, true);
    }

    @PostMapping("/requests/{id}/reject")
    public MentorshipService.RequestDto reject(@PathVariable UUID id) {
        return service.respond(CurrentUser.id(), id, false);
    }

    /** Cancel an existing connection. Either side can call this. */
    @PostMapping("/requests/{id}/revoke")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable UUID id) {
        service.revoke(CurrentUser.id(), id);
    }

    @GetMapping("/requests/incoming")
    public List<MentorshipService.RequestDto> incoming() {
        return service.incoming(CurrentUser.id());
    }

    @GetMapping("/requests/outgoing")
    public List<MentorshipService.RequestDto> outgoing() {
        return service.outgoing(CurrentUser.id());
    }

    /**
     * Snapshot of a connected partner's tasks + habit completion. Only
     * accessible when the caller is already in an accepted relationship
     * with the partner (either as mentor or mentee), so it doubles as a
     * peer-progress window and a private accountability view.
     */
    @GetMapping("/connections/{partnerId}/status")
    public Map<String, Object> partnerStatus(@PathVariable UUID partnerId) {
        UUID me = CurrentUser.id();
        MentorshipService.Relationship rel = service.relationship(me, partnerId);
        if (!"mentoring".equals(rel.state()) && !"mentee".equals(rel.state())) {
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                    "You're not connected with this person.");
        }
        User u = users.findById(partnerId).orElseThrow(() -> ApiException.notFound("User"));

        List<Task> partnerTasks = tasks.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(partnerId);
        long done = partnerTasks.stream().filter(Task::isDone).count();
        List<Map<String, Object>> taskJson = partnerTasks.stream()
                .map(t -> Map.<String, Object>of(
                        "title", t.getTitle(),
                        "done", t.isDone(),
                        "priority", t.getPriority() == null ? "Medium" : t.getPriority().name()))
                .toList();

        return Map.of(
                "id", u.getId(),
                "displayName", u.getDisplayName(),
                "level", u.getLevel(),
                "xpTotal", u.getXpTotal(),
                "relationship", rel.state(),
                "tasksDone", done,
                "tasksTotal", partnerTasks.size(),
                "tasks", taskJson,
                "habitsSummary", habits.contextSummary(partnerId)
        );
    }
}
