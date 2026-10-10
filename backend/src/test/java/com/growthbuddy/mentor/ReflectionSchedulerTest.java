package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.Notification;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationRepository;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.push.PushService;
import com.growthbuddy.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Which users the evening reflection goes to, on a given tick, in their own zone. */
class ReflectionSchedulerTest {

    private final ReflectionUsers users = mock(ReflectionUsers.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final NotificationRepository rows = mock(NotificationRepository.class);
    private final PushService push = mock(PushService.class);
    private final ReflectionScheduler job = new ReflectionScheduler(users, notifications, rows, push);

    private static User user(String zone, Object pref) {
        User u = new User();
        u.setId(UUID.randomUUID());
        u.setTimezone(zone);
        u.setEmailVerified(true);
        Map<String, Object> prefs = new HashMap<>();
        prefs.put(ReflectionScheduler.PREF, pref);
        u.setUiPrefs(prefs);
        return u;
    }

    @Test
    void timeOfReadsHhMmAndTreatsAnythingElseAsOff() {
        assertThat(ReflectionScheduler.timeOf(Map.of("buddyReflection", "21:00"))).isEqualTo(LocalTime.of(21, 0));
        assertThat(ReflectionScheduler.timeOf(Map.of("buddyReflection", "9:30"))).isEqualTo(LocalTime.of(9, 30));
        assertThat(ReflectionScheduler.timeOf(Map.of("buddyReflection", ""))).isNull();
        assertThat(ReflectionScheduler.timeOf(Map.of("buddyReflection", "off"))).isNull();
        assertThat(ReflectionScheduler.timeOf(Map.of("buddyReflection", 2100))).isNull();
        assertThat(ReflectionScheduler.timeOf(Map.of())).isNull();
        assertThat(ReflectionScheduler.timeOf(null)).isNull();
    }

    @Test
    void dueOnlyInsideTheWindowAndOncePerLocalDay() {
        ZoneId z = ZoneId.of("Asia/Kolkata");
        LocalTime at = LocalTime.of(21, 0);
        LocalDate day = LocalDate.of(2026, 10, 10);
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(20, 59), z), null)).isFalse();
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(21, 0), z), null)).isTrue();
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(21, 9), z), null)).isTrue();
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(21, 10), z), null)).isFalse();
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(21, 5), z), day)).isFalse();
        assertThat(ReflectionScheduler.isDue(at, ZonedDateTime.of(day, LocalTime.of(21, 5), z), day.minusDays(1))).isTrue();
        assertThat(ReflectionScheduler.isDue(null, ZonedDateTime.of(day, at, z), null)).isFalse();
    }

    @Test
    void aSpringForwardSlotThatDoesNotExistLocallyStillArrives() {
        // 2026-03-08 in New York: 02:00 → 03:00. A 02:30 slot resolves to 03:30.
        ZoneId ny = ZoneId.of("America/New_York");
        LocalDate day = LocalDate.of(2026, 3, 8);
        assertThat(ReflectionScheduler.isDue(LocalTime.of(2, 30), ZonedDateTime.of(day, LocalTime.of(3, 32), ny), null))
                .isTrue();
    }

    @Test
    void oneTickPicksOnlyTheUsersWhoseLocalTimeHasCome() {
        // 15:30 UTC = 21:00 in Kolkata, 11:30 in New York, 16:30 in London (still BST on 10 Oct).
        Instant now = Instant.parse("2026-10-10T15:30:00Z");
        User kolkata = user("Asia/Kolkata", "21:00");
        User newYork = user("America/New_York", "21:00");
        User london = user("Europe/London", "16:30");
        User off = user("Asia/Kolkata", "");
        when(users.findWithReflectionPref()).thenReturn(List.of(kolkata, newYork, london, off));
        when(rows.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(any(), any(), any()))
                .thenReturn(Optional.empty());

        assertThat(job.run(now)).isEqualTo(2);
        verify(notifications).publish(eq(kolkata.getId()), eq(NotificationKind.buddy_checkin),
                eq(ReflectionScheduler.TITLE), eq(ReflectionScheduler.STARTER), isNull());
        verify(notifications).publish(eq(london.getId()), eq(NotificationKind.buddy_checkin),
                anyString(), anyString(), isNull());
        verify(notifications, never()).publish(eq(newYork.getId()), any(NotificationKind.class),
                anyString(), anyString(), any());
        verify(notifications, never()).publish(eq(off.getId()), any(NotificationKind.class),
                anyString(), anyString(), any());
        verify(push).sendToUser(kolkata.getId(), ReflectionScheduler.TITLE, ReflectionScheduler.STARTER, "/#mentor");

        // The next tick inside the same window sends nothing again.
        assertThat(job.run(now.plusSeconds(300))).isZero();
        verify(notifications, times(2)).publish(any(UUID.class), any(NotificationKind.class),
                anyString(), anyString(), any());
    }

    @Test
    void oneAlreadySentTodayIsNotSentAgainAfterARestart() {
        Instant now = Instant.parse("2026-10-10T15:30:00Z");
        User kolkata = user("Asia/Kolkata", "21:00");
        when(users.findWithReflectionPref()).thenReturn(List.of(kolkata));
        when(rows.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(
                eq(kolkata.getId()), eq(NotificationKind.buddy_checkin), any()))
                .thenReturn(Optional.of(new Notification()));
        assertThat(job.run(now)).isZero();
        verify(notifications, never()).publish(any(UUID.class), any(NotificationKind.class),
                anyString(), anyString(), any());
    }

    @Test
    void quietHoursHoldItBack() {
        Instant now = Instant.parse("2026-10-10T15:30:00Z");
        User kolkata = user("Asia/Kolkata", "21:00");
        kolkata.getUiPrefs().put("quietStart", "20:00");
        kolkata.getUiPrefs().put("quietEnd", "07:00");
        when(users.findWithReflectionPref()).thenReturn(List.of(kolkata));
        when(rows.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(any(), any(), any()))
                .thenReturn(Optional.empty());
        assertThat(job.run(now)).isZero();
    }
}
