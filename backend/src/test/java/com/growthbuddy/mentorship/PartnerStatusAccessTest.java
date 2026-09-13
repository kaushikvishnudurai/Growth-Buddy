package com.growthbuddy.mentorship;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.task.TaskRepository;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * Progress flows ONE way: a mentor sees their mentee's tasks and habit streaks,
 * the mentee sees nothing back — a manager reads a report's board, not the other
 * way round. The endpoint accepted both directions once, so a mentee could read
 * the person mentoring them. The Circle UI hides the tap target, but this is the
 * check that actually holds, so it gets a test.
 */
class PartnerStatusAccessTest {

    private static final UUID ME = UUID.randomUUID();
    private static final UUID THEM = UUID.randomUUID();

    private final MentorshipService service = mock(MentorshipService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final TaskRepository tasks = mock(TaskRepository.class);
    private final HabitService habits = mock(HabitService.class);
    private final MentorshipController controller =
            new MentorshipController(service, users, tasks, habits);

    @AfterEach
    void clear() {
        CurrentUser.clear();
    }

    private void asCaller(String relationshipState) {
        CurrentUser.set(ME);
        when(service.relationship(ME, THEM))
                .thenReturn(new MentorshipService.Relationship(
                        relationshipState, null, "none", null, "none", null));
    }

    private User mentee(Object shareProgress) {
        User them = new User();
        them.setId(THEM);
        them.setDisplayName("Vivek");
        if (shareProgress != null) {
            them.setUiPrefs(Map.of("shareProgress", shareProgress));
        }
        when(users.findById(THEM)).thenReturn(Optional.of(them));
        return them;
    }

    @Test
    void mentorSeesTheirMenteesProgress() {
        asCaller("mentoring");
        mentee(null); // no toggle stored: every account predating it still shares
        when(tasks.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(THEM)).thenReturn(List.of());
        when(habits.contextSummary(THEM)).thenReturn("Habits: none");

        assertThat(controller.partnerStatus(THEM)).containsEntry("displayName", "Vivek");
    }

    /** The regression: "they mentor me" is not a licence to read their board. */
    @Test
    void menteeCannotSeeTheirMentorsProgress() {
        asCaller("mentee");
        assertThatThrownBy(() -> controller.partnerStatus(THEM))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("mentor")
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.FORBIDDEN);
    }

    /** The mentee's own switch, in Settings > Account > Privacy. */
    @Test
    void menteeCanOptOutOfBeingSeen() {
        asCaller("mentoring");
        mentee(false);
        assertThatThrownBy(() -> controller.partnerStatus(THEM))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("turned off progress sharing");
    }

    @Test
    void optingBackInRestoresTheWindow() {
        asCaller("mentoring");
        mentee(true);
        when(tasks.findByUserIdAndDeletedAtIsNullOrderByCreatedAtAsc(THEM)).thenReturn(List.of());
        when(habits.contextSummary(THEM)).thenReturn("Habits: none");
        assertThat(controller.partnerStatus(THEM)).containsEntry("displayName", "Vivek");
    }

    @Test
    void strangerIsRefused() {
        asCaller("none");
        assertThatThrownBy(() -> controller.partnerStatus(THEM)).isInstanceOf(ApiException.class);
    }
}
