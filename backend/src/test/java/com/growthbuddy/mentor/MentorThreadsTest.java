package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
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
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Threads name themselves from their first message; replies carry their actions, not the fence. */
class MentorThreadsTest {

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
    private final MentorThread thread = new MentorThread();

    @BeforeEach
    void setUp() {
        thread.setTitle(MentorService.NEW_THREAD_TITLE);
        when(threads.findByIdAndUserId(THREAD, USER)).thenReturn(Optional.of(thread));
        when(threads.save(any(MentorThread.class))).thenAnswer(inv -> inv.getArgument(0));
        when(messages.save(any(MentorMessage.class))).thenAnswer(inv -> inv.getArgument(0));
        when(messages.findTop200ByThreadIdOrderByCreatedAtDesc(THREAD)).thenReturn(List.of());
        when(clock.zoneOf(USER)).thenReturn(ZoneId.of("UTC"));
        when(scores.today(USER)).thenReturn(new ScoreService.ScoreResponse(LocalDate.now(), 50, 1, 2, 1, 2));
        when(habits.contextSummary(USER)).thenReturn("");
        when(wellness.contextSummary(USER)).thenReturn("");
        when(openai.isConfigured()).thenReturn(true);
    }

    @Test
    void aRepliesActionsBlockIsSavedAsDataAndNotAsText() {
        when(openai.complete(anyString(), any(), anyInt())).thenReturn(
                "A short walk resets your focus.\n```actions\n[{\"type\":\"habit\",\"title\":\"Walk after lunch\",\"time\":\"13:30\"}]\n```");
        ReplyResponse r = service.postMessage(USER, THREAD, new PostMessageRequest("I can't focus"));
        assertThat(r.assistantMessage().content()).isEqualTo("A short walk resets your focus.");
        assertThat(r.assistantMessage().actions())
                .containsExactly(new MentorActions.Action("habit", "Walk after lunch", "13:30"));
        assertThat(r.userMessage().actions()).isEmpty();
    }

    @Test
    void theFirstMessageNamesANewThread() {
        when(openai.complete(anyString(), any(), anyInt())).thenReturn("Let's plan it.");
        service.postMessage(USER, THREAD, new PostMessageRequest("  Help me plan\nmy exam week please  "));
        assertThat(thread.getTitle()).isEqualTo("Help me plan my exam week please");
        verify(threads).save(thread);
    }

    @Test
    void aRenamedThreadKeepsItsName() {
        thread.setTitle("Exams");
        when(openai.complete(anyString(), any(), anyInt())).thenReturn("Sure.");
        service.postMessage(USER, THREAD, new PostMessageRequest("hello"));
        assertThat(thread.getTitle()).isEqualTo("Exams");
        verify(threads, never()).save(any(MentorThread.class));
    }

    @Test
    void aThreadWithEarlierMessagesIsNotRenamedByALaterOne() {
        MentorMessage earlier = new MentorMessage();
        earlier.setRole(MessageRole.user);
        earlier.setContent("first");
        MentorMessage now = new MentorMessage();
        now.setRole(MessageRole.user);
        now.setContent("second");
        when(messages.findTop200ByThreadIdOrderByCreatedAtDesc(THREAD)).thenReturn(List.of(now, earlier));
        thread.setTitle(MentorService.DEFAULT_THREAD_TITLE);
        when(openai.complete(anyString(), any(), anyInt())).thenReturn("ok");
        service.postMessage(USER, THREAD, new PostMessageRequest("second"));
        assertThat(thread.getTitle()).isEqualTo(MentorService.DEFAULT_THREAD_TITLE);
    }

    @Test
    void renameTrimsAndRefusesBlank() {
        ThreadResponse t = service.renameThread(USER, THREAD, new RenameThreadRequest("  Sleep   plan "));
        assertThat(t.title()).isEqualTo("Sleep plan");
        assertThatThrownBy(() -> service.renameThread(USER, THREAD, new RenameThreadRequest(" ")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void theSystemPromptAsksForTheBlock() {
        assertThat(MentorService.ACTIONS_PROMPT).contains("```actions").contains("\"type\"");
    }
}
