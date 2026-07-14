package com.growthbuddy.mentor;

import com.growthbuddy.common.CurrentUser;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/mentor")
public class MentorController {

    private final MentorService service;

    public MentorController(MentorService service) {
        this.service = service;
    }

    /** Convenience: the user's default chat (history + thread id) for a single-pane UI. */
    @GetMapping("/chat")
    public ChatResponse chat() {
        MentorThread t = service.defaultThread(CurrentUser.id());
        List<MessageResponse> msgs = service.listMessages(CurrentUser.id(), t.getId());
        return new ChatResponse(t.getId(), msgs);
    }

    @PostMapping("/chat/messages")
    public ReplyResponse postChat(@RequestBody PostMessageRequest req) {
        UUID uid = CurrentUser.id();
        MentorThread t = service.defaultThread(uid);
        return service.postMessage(uid, t.getId(), req);
    }

    @DeleteMapping("/chat/messages")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearChat() {
        service.clearDefaultChat(CurrentUser.id());
    }

    public record ChatResponse(UUID threadId, List<MessageResponse> messages) {}

    @GetMapping("/threads")
    public List<ThreadResponse> threads() {
        return service.listThreads(CurrentUser.id());
    }

    @PostMapping("/threads")
    @ResponseStatus(HttpStatus.CREATED)
    public ThreadResponse createThread(@RequestBody(required = false) CreateThreadRequest req) {
        return service.createThread(CurrentUser.id(), req);
    }

    @GetMapping("/threads/{threadId}/messages")
    public List<MessageResponse> messages(@PathVariable UUID threadId) {
        return service.listMessages(CurrentUser.id(), threadId);
    }

    /** Post a user message and receive the assistant's reply. */
    @PostMapping("/threads/{threadId}/messages")
    public ReplyResponse post(@PathVariable UUID threadId, @RequestBody PostMessageRequest req) {
        return service.postMessage(CurrentUser.id(), threadId, req);
    }

    @DeleteMapping("/threads/{threadId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID threadId) {
        service.deleteThread(CurrentUser.id(), threadId);
    }
}
