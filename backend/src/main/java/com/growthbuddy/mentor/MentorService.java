package com.growthbuddy.mentor;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import com.growthbuddy.score.ScoreService;
import com.growthbuddy.task.Task;
import com.growthbuddy.task.TaskRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class MentorService {

    private static final Logger log = LoggerFactory.getLogger(MentorService.class);

    /** Cap how many past turns we send. OpenAI handles plenty more, but tokens cost money. */
    private static final int HISTORY_WINDOW = 20;

    private static final String SYSTEM_PROMPT = """
            You are Buddy, a warm, encouraging growth mentor inside the Growth Buddy app.
            You help users with habits, focus, study planning, mood, motivation, and accountability.
            Be concise (under 120 words by default), specific, kind, and human. Offer one
            concrete next step they can do today. If the user just wants to vent, listen
            and validate first — don't pile on advice. Never claim to be a therapist; if
            the user mentions self-harm or crisis, gently suggest reaching out to a local
            crisis line. Avoid lists unless the user asks for steps. Speak in second person.

            Stay strictly within that scope. You are NOT a general-purpose assistant.
            If the user asks for something off-topic — writing or debugging code, math
            or homework answers, essays, trivia, product/tech help, or any general
            knowledge question — do not answer it. Instead, in one friendly sentence,
            say that's outside what you help with here, and steer back to their goals,
            habits, focus, or mood. Example: "That's a bit outside my lane — I'm here
            for your habits, focus, and goals. Want to plan your day instead?" Never
            produce the requested off-topic content, even if the user insists or
            rephrases.
            """;

    private final MentorThreadRepository threads;
    private final MentorMessageRepository messages;
    private final OpenAIClient openai;
    private final TaskRepository tasks;
    private final HabitService habitService;
    private final ScoreService scoreService;

    public MentorService(MentorThreadRepository threads,
                         MentorMessageRepository messages,
                         OpenAIClient openai,
                         TaskRepository tasks,
                         HabitService habitService,
                         ScoreService scoreService) {
        this.threads = threads;
        this.messages = messages;
        this.openai = openai;
        this.tasks = tasks;
        this.habitService = habitService;
        this.scoreService = scoreService;
    }

    @Transactional(readOnly = true)
    public List<ThreadResponse> listThreads(UUID userId) {
        return threads.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(ThreadResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public List<MessageResponse> listMessages(UUID userId, UUID threadId) {
        requireThread(userId, threadId);
        return messages.findByThreadIdOrderByCreatedAtAsc(threadId).stream()
                .map(MessageResponse::from).toList();
    }

    @Transactional
    public ThreadResponse createThread(UUID userId, CreateThreadRequest req) {
        MentorThread t = new MentorThread();
        t.setUserId(userId);
        t.setTitle(req != null && StringUtils.hasText(req.title()) ? req.title().trim() : "New conversation");
        return ThreadResponse.from(threads.save(t));
    }

    /** Returns the user's most recent thread, creating one if none exists. */
    @Transactional
    public MentorThread defaultThread(UUID userId) {
        return threads.findByUserIdOrderByCreatedAtDesc(userId).stream().findFirst()
                .orElseGet(() -> {
                    MentorThread t = new MentorThread();
                    t.setUserId(userId);
                    t.setTitle("Talk to Buddy");
                    return threads.save(t);
                });
    }

    @Transactional
    public void clearDefaultChat(UUID userId) {
        MentorThread t = defaultThread(userId);
        messages.deleteAllByThreadId(t.getId());
    }

    /**
     * Save the user's message, generate an assistant reply, and return both.
     *
     * <p>Deliberately NOT {@code @Transactional} around the whole method: the
     * OpenAI call can block for up to 45s, and holding a DB connection for that
     * long would exhaust the pool under load. Each DB op below runs on its own
     * short (Spring Data) transaction; the slow HTTP call sits between them
     * holding no connection.
     */
    public ReplyResponse postMessage(UUID userId, UUID threadId, PostMessageRequest req) {
        if (req == null || !StringUtils.hasText(req.content())) {
            throw ApiException.badRequest("content is required");
        }
        requireThread(userId, threadId);
        MentorMessage userMsg = save(threadId, MessageRole.user, req.content().trim());
        List<MentorMessage> history = messages.findByThreadIdOrderByCreatedAtAsc(threadId);
        String userContext = buildUserContext(userId);
        // The slow OpenAI call holds no DB connection.
        String reply = generateReply(history, userContext);
        MentorMessage assistantMsg = save(threadId, MessageRole.assistant, reply);
        return new ReplyResponse(MessageResponse.from(userMsg), MessageResponse.from(assistantMsg));
    }

    /**
     * Snapshot of the user's current tasks + habits + streaks for today.
     * Injected silently into the system prompt so Buddy can answer "help me
     * plan my day" without the user having to paste their list. Never shown
     * back to the user in the chat UI.
     */
    private String buildUserContext(UUID userId) {
        StringBuilder sb = new StringBuilder("USER STATE (today ");
        sb.append(LocalDate.now()).append("):\n");

        // Daily growth score is the heartbeat metric — let Buddy coach to it.
        ScoreService.ScoreResponse s = scoreService.today(userId);
        sb.append("Growth score today: ").append(s.score()).append("/100")
                .append(" (tasks ").append(s.tasksDone()).append("/").append(s.tasksTotal())
                .append(", habits ").append(s.habitsDone()).append("/").append(s.habitsTotal())
                .append(").\n");

        List<Task> userTasks = tasks.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(userId);
        if (userTasks.isEmpty()) {
            sb.append("- No tasks logged.\n");
        } else {
            sb.append("Tasks:\n");
            for (Task t : userTasks) {
                sb.append("  - [").append(t.isDone() ? "x" : " ").append("] ")
                        .append(t.getTitle());
                if (t.getPriority() != null) {
                    sb.append(" (priority ").append(t.getPriority().name().toLowerCase()).append(")");
                }
                sb.append("\n");
            }
        }

        sb.append(habitService.contextSummary(userId));
        sb.append("\nUse this context silently. Don't list it back unless asked. ")
                .append("If they ask for a daily plan, anchor it to these items. When it ")
                .append("fits naturally, reference their momentum (score, streaks, what's ")
                .append("left today) to motivate — but don't recite the numbers mechanically.");
        return sb.toString();
    }

    @Transactional
    public void deleteThread(UUID userId, UUID threadId) {
        MentorThread t = requireThread(userId, threadId);
        messages.deleteAll(messages.findByThreadIdOrderByCreatedAtAsc(threadId));
        threads.delete(t);
    }

    private MentorMessage save(UUID threadId, MessageRole role, String content) {
        MentorMessage m = new MentorMessage();
        m.setThreadId(threadId);
        m.setRole(role);
        m.setContent(content);
        return messages.save(m);
    }

    /**
     * Produces the assistant's reply by calling OpenAI with the recent
     * conversation. Falls back to a canned encouraging message on transport
     * errors or when no API key is configured, so chat never hard-fails.
     */
    private String generateReply(List<MentorMessage> history, String userContext) {
        String lastUser = history.stream()
                .filter(m -> m.getRole() == MessageRole.user)
                .reduce((a, b) -> b)
                .map(MentorMessage::getContent)
                .orElse("");

        if (!openai.isConfigured()) {
            return "Mentor (offline mode): I hear you — \""
                    + truncate(lastUser)
                    + "\". I'm not connected to OpenAI yet, but here's a nudge: "
                    + "break it into one small step you can do today, and check it off. "
                    + "You're doing better than you think. Start with one 10-minute action now, then come back and tell me how it went.";
        }

        List<MentorMessage> window = history.size() > HISTORY_WINDOW
                ? history.subList(history.size() - HISTORY_WINDOW, history.size())
                : history;
        List<ChatTurn> turns = new ArrayList<>(window.size());
        for (MentorMessage m : window) {
            String role = switch (m.getRole()) {
                case user -> "user";
                case assistant -> "assistant";
                case system -> "system";
            };
            turns.add(new ChatTurn(role, m.getContent()));
        }
        String systemPrompt = SYSTEM_PROMPT
                + "\nFormatting: respond in plain prose. Do NOT use Markdown bold (**…**), "
                + "headers, or bullet stars; if you must list, use plain '- ' bullets sparingly."
                + "\n\n" + userContext;
        try {
            String reply = openai.complete(systemPrompt, turns).trim();
            return StringUtils.hasText(reply) ? reply : "I'm here. Tell me a bit more about what's going on?";
        } catch (RuntimeException ex) {
            log.warn("OpenAI call failed, falling back: {}", ex.getMessage());
            return "I'm having trouble reaching my brain right now — give me a moment and try again. "
                    + "In the meantime, what's one small win you could go after today?";
        }
    }

    private String truncate(String s) {
        if (s == null) {
            return "";
        }
        return s.length() <= 80 ? s : s.substring(0, 77) + "...";
    }

    private MentorThread requireThread(UUID userId, UUID threadId) {
        return threads.findByIdAndUserId(threadId, userId)
                .orElseThrow(() -> ApiException.notFound("Thread"));
    }
}
