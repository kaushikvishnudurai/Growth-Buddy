package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.score.ScoreService;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.wellness.WellnessService;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * The streamed send keeps the non-streamed one's promises: a budget refusal
 * leaves no trace, a failure before any word is a flagged fallback, and the
 * words the user saw are the words saved.
 */
class MentorStreamTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID THREAD = UUID.randomUUID();

    private final MentorThreadRepository threads = mock(MentorThreadRepository.class);
    private final MentorMessageRepository messages = mock(MentorMessageRepository.class);
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private final ScoreService scores = mock(ScoreService.class);
    private final HabitService habits = mock(HabitService.class);
    private final WellnessService wellness = mock(WellnessService.class);
    private final UserClock clock = mock(UserClock.class);
    private final MentorService service = new MentorService(threads, messages, openai,
            mock(TaskRepository.class), habits, scores, wellness, clock);

    private final List<String> delivered = new ArrayList<>();
    private final AtomicBoolean gone = new AtomicBoolean();

    @BeforeEach
    void setUp() {
        when(threads.findByIdAndUserId(THREAD, USER)).thenReturn(Optional.of(new MentorThread()));
        when(messages.save(any(MentorMessage.class))).thenAnswer(inv -> inv.getArgument(0));
        when(messages.findTop200ByThreadIdOrderByCreatedAtDesc(THREAD)).thenReturn(List.of());
        when(clock.zoneOf(USER)).thenReturn(ZoneId.of("UTC"));
        when(scores.today(USER)).thenReturn(new ScoreService.ScoreResponse(LocalDate.now(), 50, 1, 2, 1, 2));
        when(habits.contextSummary(USER)).thenReturn("");
        when(wellness.contextSummary(USER)).thenReturn("");
        when(openai.isConfigured()).thenReturn(true);
    }

    /** The model "streams" these chunks, then optionally fails. */
    @SuppressWarnings("unchecked")
    private void modelSends(RuntimeException after, String... chunks) {
        doAnswer(inv -> {
            Consumer<String> onDelta = inv.getArgument(3);
            StringBuilder all = new StringBuilder();
            for (String c : chunks) {
                onDelta.accept(c);
                all.append(c);
            }
            if (after != null) throw after;
            return all.toString();
        }).when(openai).stream(anyString(), any(), anyInt(), any(Consumer.class), any());
    }

    private ReplyResponse run() {
        MentorService.StreamStart start = service.beginStream(USER, THREAD, new PostMessageRequest("hi"));
        return service.completeStream(start, t -> {
            if (!gone.get()) delivered.add(t);
        }, gone::get);
    }

    @Test
    void theStreamedWordsAreTheSavedReply() {
        modelSends(null, "One ", "small ", "step.");
        ReplyResponse r = run();
        assertThat(delivered).containsExactly("One ", "small ", "step.");
        assertThat(r.assistantMessage().content()).isEqualTo("One small step.");
        assertThat(r.assistantMessage().fallback()).isFalse();
        verify(openai).stream(anyString(), any(), eq(MentorService.REPLY_MAX_TOKENS), any(), any());
    }

    @Test
    void aBudgetRefusalBeforeAnyWordTakesTheMessageBackOut() {
        ApiException tooMany = new ApiException(HttpStatus.TOO_MANY_REQUESTS, "take a short break");
        modelSends(tooMany);
        MentorService.StreamStart start = service.beginStream(USER, THREAD, new PostMessageRequest("hi"));
        assertThatThrownBy(() -> service.completeStream(start, delivered::add, gone::get)).isSameAs(tooMany);
        verify(messages).delete(start.userMsg());
        assertThat(delivered).isEmpty();
    }

    @Test
    void aFailureBeforeAnyWordIsAFlaggedFallback() {
        modelSends(new IllegalStateException("AI gateway 502"));
        ReplyResponse r = run();
        assertThat(r.assistantMessage().fallback()).isTrue();
        assertThat(r.assistantMessage().content()).startsWith(MentorService.TROUBLE_PREFIX);
        verify(messages, never()).delete(any(MentorMessage.class));
    }

    @Test
    void aFailureMidReplyKeepsTheWordsAlreadyShown() {
        modelSends(new IllegalStateException("reset"), "Start ", "with water");
        ReplyResponse r = run();
        assertThat(r.assistantMessage().content()).isEqualTo("Start with water");
        assertThat(r.assistantMessage().fallback()).isFalse();
    }

    @Test
    void aStopBeforeAnyWordSavesNothingAndRemovesTheMessage() {
        gone.set(true);
        modelSends(null, "never shown");
        MentorService.StreamStart start = service.beginStream(USER, THREAD, new PostMessageRequest("hi"));
        assertThat(service.completeStream(start, t -> { }, gone::get)).isNull();
        verify(messages).delete(start.userMsg());
    }

    @Test
    void anUnconfiguredClientAnswersOfflineWithoutStreaming() {
        when(openai.isConfigured()).thenReturn(false);
        ReplyResponse r = run();
        assertThat(r.assistantMessage().content()).startsWith(MentorService.OFFLINE_PREFIX);
        assertThat(r.assistantMessage().fallback()).isTrue();
        verify(openai, never()).stream(anyString(), any(), anyInt(), any(), any());
    }

    @Test
    void aBlankMessageIsRefusedBeforeAnythingIsSaved() {
        assertThatThrownBy(() -> service.beginStream(USER, THREAD, new PostMessageRequest("  ")))
                .isInstanceOf(ApiException.class);
        verify(messages, never()).save(any());
    }
}
