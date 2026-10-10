package com.growthbuddy.mentorship;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentorship.MentorshipRequest.Direction;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** An account scheduled for deletion is as good as gone: a mentorship invite to it is a 404. */
class MentorshipPendingDeletionTest {

    private final MentorshipRequestRepository requests = mock(MentorshipRequestRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final MentorshipService service = new MentorshipService(requests, users, notifications);

    @Test
    void anAccountScheduledForDeletionCannotBeInvited() {
        UUID me = UUID.randomUUID();
        User leaving = new User();
        leaving.setId(UUID.randomUUID());
        leaving.setDeletionRequestedAt(Instant.now());
        when(users.findById(leaving.getId())).thenReturn(Optional.of(leaving));

        assertThatThrownBy(() -> service.create(me, leaving.getId(), Direction.offer, null))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus().value()).isEqualTo(404);
        verify(requests, never()).save(any());
        verify(notifications, never()).publish(any(), any(), any(), any(), any());
    }
}
