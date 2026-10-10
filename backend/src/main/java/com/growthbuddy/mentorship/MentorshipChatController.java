package com.growthbuddy.mentorship;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Inside an accepted link ({@code {id}} is the mentorship request's id, the
 * same one the Connections rows carry). Rules live in {@link MentorshipChatService}.
 */
@RestController
@RequestMapping("/api/mentorship")
public class MentorshipChatController {

    private final MentorshipChatService service;

    public MentorshipChatController(MentorshipChatService service) {
        this.service = service;
    }

    public record NudgeRequest(@NotBlank @Size(max = 8) String kind, @Size(max = 140) String text) {
    }

    public record MessageRequest(@NotBlank @Size(max = 2000) String body) {
    }

    public record AgreementRequest(@Size(max = 500) String text) {
    }

    /** {@code kind}: cheer | nudge. Three a day per sender per link (429 after). */
    @PostMapping("/{id}/nudge")
    @ResponseStatus(HttpStatus.CREATED)
    public MentorshipChatService.MessageDto nudge(@PathVariable UUID id, @Valid @RequestBody NudgeRequest req) {
        return service.nudge(CurrentUser.id(), id, req.kind(), req.text());
    }

    /** Newest 50, oldest first; {@code before} = the oldest createdAt held. */
    @GetMapping("/{id}/messages")
    public List<MentorshipChatService.MessageDto> messages(@PathVariable UUID id,
            @RequestParam(required = false) Instant before) {
        return service.thread(CurrentUser.id(), id, before);
    }

    @PostMapping("/{id}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public MentorshipChatService.MessageDto send(@PathVariable UUID id, @Valid @RequestBody MessageRequest req) {
        return service.send(CurrentUser.id(), id, req.body());
    }

    @PutMapping("/{id}/agreement")
    public MentorshipChatService.AgreementDto agreement(@PathVariable UUID id,
            @Valid @RequestBody AgreementRequest req) {
        return service.setAgreement(CurrentUser.id(), id, req.text());
    }

    /** Mentor only: the mentee's week so far (respects their progress-sharing switch). */
    @GetMapping("/{id}/week")
    public MentorshipChatService.WeekDto week(@PathVariable UUID id) {
        return service.week(CurrentUser.id(), id);
    }
}
