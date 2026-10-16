package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mentorship.MentorshipService;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** People search and browse show a level only for someone who shares their progress. */
class PublicLevelTest {

    private static UserController.PublicUser hit(Map<String, Object> prefs) {
        MentorshipService mentorship = mock(MentorshipService.class);
        when(mentorship.relationship(any(), any()))
                .thenReturn(new MentorshipService.Relationship("none", null, "none", null, "none", null));
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setDisplayName("Ana");
        u.setEmail("ana@example.com");
        u.setLevel(7);
        u.setUiPrefs(prefs);
        return new UserController(mock(UserRepository.class), mentorship, mock(RateLimiter.class))
                .toPublic(UUID.randomUUID(), u);
    }

    @Test
    void aHiddenLevelIsNull() {
        assertThat(hit(Map.of("shareProgress", false)).level()).isNull();
        assertThat(hit(Map.of("shareProgress", "false")).level()).isNull();
    }

    @Test
    void aSharedLevelShows() {
        assertThat(hit(null).level()).isEqualTo(7);
        assertThat(hit(Map.of("shareProgress", true)).level()).isEqualTo(7);
    }
}
