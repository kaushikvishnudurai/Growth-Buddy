package com.growthbuddy.mentor;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import jakarta.annotation.PreDestroy;
import jakarta.validation.Valid;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/mentor")
public class MentorController {

    private static final Logger log = LoggerFactory.getLogger(MentorController.class);

    /** Longer than the gateway's 45 s header timeout plus a 500-token reply. */
    static final long STREAM_TIMEOUT_MS = 120_000L;

    private final MentorService service;

    /**
     * Streamed replies run here, off the request thread, so a Tomcat worker is
     * not parked for the length of a reply. Bounded both ways: 16 at once, 32
     * waiting, and past that the send is refused with a 503 rather than queued
     * without end. Daemon threads, so a stuck read never holds up shutdown.
     */
    private final ExecutorService streams = newStreamPool();

    public MentorController(MentorService service) {
        this.service = service;
    }

    /**
     * Core = max: a ThreadPoolExecutor only grows past its core size once the
     * queue is FULL, so a core of 2 would have run two replies and queued the
     * rest. Idle threads still time out.
     */
    private static ExecutorService newStreamPool() {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(16, 16, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(32), r -> {
                    Thread t = new Thread(r, "buddy-stream");
                    t.setDaemon(true);
                    return t;
                });
        pool.allowCoreThreadTimeOut(true);
        return pool;
    }

    @PreDestroy
    void shutdownStreams() {
        streams.shutdownNow();
    }

    /** Convenience: the user's default chat (history + thread id) for a single-pane UI. */
    @GetMapping("/chat")
    public ChatResponse chat() {
        MentorThread t = service.defaultThread(CurrentUser.id());
        List<MessageResponse> msgs = service.listMessages(CurrentUser.id(), t.getId());
        return new ChatResponse(t.getId(), msgs);
    }

    @PostMapping("/chat/messages")
    public ReplyResponse postChat(@Valid @RequestBody PostMessageRequest req) {
        UUID uid = CurrentUser.id();
        MentorThread t = service.defaultThread(uid);
        return service.postMessage(uid, t.getId(), req);
    }

    /**
     * {@link #postChat} as Server-Sent Events: {@code delta {text}} as the words
     * arrive, then {@code done {message, userMessage}} with the saved reply, or
     * {@code error {status, message}}. A 429 from the AI budget is an
     * {@code error} event before any delta; the interceptor's own 429 is a plain
     * JSON 429 before the stream opens. No {@code produces}: a 400/404 thrown
     * before the stream opens must still render as JSON.
     */
    @PostMapping("/chat/messages/stream")
    public ResponseEntity<SseEmitter> streamChat(@Valid @RequestBody PostMessageRequest req) {
        UUID uid = CurrentUser.id();
        MentorThread t = service.defaultThread(uid);
        return stream(uid, t.getId(), req);
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
    public ThreadResponse createThread(@Valid @RequestBody(required = false) CreateThreadRequest req) {
        return service.createThread(CurrentUser.id(), req);
    }

    @GetMapping("/threads/{threadId}/messages")
    public List<MessageResponse> messages(@PathVariable UUID threadId) {
        return service.listMessages(CurrentUser.id(), threadId);
    }

    /** Rename. No model call, so not in the AI rate-limit list. */
    @PatchMapping("/threads/{threadId}")
    public ThreadResponse rename(@PathVariable UUID threadId, @Valid @RequestBody RenameThreadRequest req) {
        return service.renameThread(CurrentUser.id(), threadId, req);
    }

    /** Empty one thread and keep it: "Clear chat" on whichever thread is open. */
    @DeleteMapping("/threads/{threadId}/messages")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearThread(@PathVariable UUID threadId) {
        service.clearThread(CurrentUser.id(), threadId);
    }

    /** Post a user message and receive the assistant's reply. */
    @PostMapping("/threads/{threadId}/messages")
    public ReplyResponse post(@PathVariable UUID threadId, @Valid @RequestBody PostMessageRequest req) {
        return service.postMessage(CurrentUser.id(), threadId, req);
    }

    /** {@link #post} streamed; see {@link #streamChat}. */
    @PostMapping("/threads/{threadId}/messages/stream")
    public ResponseEntity<SseEmitter> streamThread(@PathVariable UUID threadId, @Valid @RequestBody PostMessageRequest req) {
        return stream(CurrentUser.id(), threadId, req);
    }

    private ResponseEntity<SseEmitter> stream(UUID uid, UUID threadId, PostMessageRequest req) {
        MentorService.StreamStart start = service.beginStream(uid, threadId, req);
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        AtomicBoolean gone = new AtomicBoolean();
        emitter.onCompletion(() -> gone.set(true));
        emitter.onError(e -> gone.set(true));
        emitter.onTimeout(() -> {
            gone.set(true);
            emitter.complete();
        });
        try {
            streams.execute(() -> runStream(uid, start, emitter, gone));
        } catch (RejectedExecutionException busy) {
            service.abandonStream(start);
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Buddy is busy right now. Try again in a moment.");
        }
        // A proxy that buffers (nginx, some CDNs) would hold every delta until
        // the end and make the stream a slower non-stream. These ask it not to.
        return ResponseEntity.ok()
                .header("Cache-Control", "no-cache")
                .header("X-Accel-Buffering", "no")
                .body(emitter);
    }

    /** The worker: CurrentUser is a ThreadLocal, so it is set here for the AI budget. */
    private void runStream(UUID uid, MentorService.StreamStart start, SseEmitter emitter,
                           AtomicBoolean gone) {
        CurrentUser.set(uid);
        try {
            ReplyResponse reply = service.completeStream(start, text -> {
                if (gone.get()) return;
                try {
                    emitter.send(SseEmitter.event().name("delta")
                            .data(Map.of("text", text), MediaType.APPLICATION_JSON));
                } catch (IOException | IllegalStateException clientGone) {
                    gone.set(true);
                }
            }, gone::get);
            if (reply != null && !gone.get()) {
                Map<String, Object> done = new LinkedHashMap<>();
                done.put("message", reply.assistantMessage());
                done.put("userMessage", reply.userMessage());
                emitter.send(SseEmitter.event().name("done").data(done, MediaType.APPLICATION_JSON));
            }
            emitter.complete();
        } catch (ApiException ex) {
            sendError(emitter, ex.getStatus().value(), ex.getMessage());
        } catch (Exception ex) {
            log.warn("Buddy stream failed: {}", ex.toString());
            sendError(emitter, 500, "Buddy couldn't finish that reply. Please try again.");
        } finally {
            CurrentUser.clear();
        }
    }

    private static void sendError(SseEmitter emitter, int status, String message) {
        try {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("status", status);
            err.put("message", message);
            emitter.send(SseEmitter.event().name("error").data(err, MediaType.APPLICATION_JSON));
            emitter.complete();
        } catch (IOException | IllegalStateException clientGone) {
            // Nobody left to tell.
        }
    }

    @DeleteMapping("/threads/{threadId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID threadId) {
        service.deleteThread(CurrentUser.id(), threadId);
    }
}
