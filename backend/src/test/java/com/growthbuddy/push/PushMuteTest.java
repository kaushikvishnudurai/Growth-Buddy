package com.growthbuddy.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Settings → Alerts mutes web push per category (ui_prefs.notifyMute). The
 * check sits in PushService, so every caller that names its category gets it;
 * the bell card is recorded by NotificationService.publish either way.
 */
class PushMuteTest {

    private static final UUID USER = UUID.randomUUID();

    private final PushRepository subs = mock(PushRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final PushService push = new PushService(subs, users, "", "", "mailto:test@example.com");

    private void prefs(Map<String, Object> p) {
        User u = new User();
        u.setId(USER);
        u.setUiPrefs(p);
        when(users.findById(USER)).thenReturn(Optional.of(u));
    }

    @Test
    void aMutedCategoryIsNeverSent() {
        ReflectionTestUtils.setField(push, "configured", true);
        prefs(Map.of("notifyMute", Map.of("habits", true)));

        assertThat(push.isMuted(USER, NotifyCategory.habits)).isTrue();
        assertThat(push.sendToUser(USER, NotifyCategory.habits, "Habit reminder", "Walk", "/#habits")).isZero();
        verifyNoInteractions(subs); // not even a look at the user's devices
    }

    @Test
    void anUnmutedCategoryGoesToTheDevices() {
        ReflectionTestUtils.setField(push, "configured", true);
        prefs(Map.of("notifyMute", Map.of("habits", true)));
        when(subs.findByUserId(USER)).thenReturn(List.of());

        push.sendToUser(USER, NotifyCategory.people, "Asha nudged you", null, "/#circle");

        verify(subs).findByUserId(USER);
    }

    @Test
    void remindersAndSystemCannotBeMutedAndCostNoLookup() {
        assertThat(push.isMuted(USER, NotifyCategory.reminders)).isFalse();
        assertThat(push.isMuted(USER, NotifyCategory.system)).isFalse();
        assertThat(push.isMuted(USER, null)).isFalse();
        verifyNoInteractions(users);
    }

    /* The one door every push shares: an account in its deletion grace period
       gets nothing, even with a live device and an unmutable category. Returns
       before anything touches the (unconfigured) web-push client. */
    @Test
    void anAccountPendingDeletionIsNeverPushed() {
        ReflectionTestUtils.setField(push, "configured", true);
        User u = new User();
        u.setId(USER);
        u.setDeletionRequestedAt(java.time.Instant.now());
        when(users.findById(USER)).thenReturn(Optional.of(u));
        when(subs.findByUserId(USER)).thenReturn(List.of(new PushSubscription()));

        assertThat(push.sendToUser(USER, "Reminder", "Stretch", "/")).isZero();
        assertThat(push.sendToUser(USER, NotifyCategory.system, "Hi", "x", "/")).isZero();
    }

    @Test
    void anUnknownUserIsNotMuted() {
        when(users.findById(USER)).thenReturn(Optional.empty());
        assertThat(push.isMuted(USER, NotifyCategory.money)).isFalse();
    }
}
