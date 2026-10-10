package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.messaging.simp.SimpMessagingTemplate;

/**
 * The bell's settings and bulk actions: read-card retention per user
 * (ui_prefs.notifyKeepReadDays), the per-category push mute
 * (ui_prefs.notifyMute; PushService's side is PushMuteTest), and Mark all read / Clear read touching the caller's
 * rows only.
 */
class NotificationRetentionAndMuteTest {

    private static final Instant NOW = Instant.parse("2026-10-10T03:20:00Z");
    private static final UUID USER = UUID.randomUUID();

    private final NotificationRepository repo = mock(NotificationRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService service =
            new NotificationService(repo, mock(SimpMessagingTemplate.class), users);

    private static Instant daysAgo(int d) {
        return NOW.minus(d, ChronoUnit.DAYS);
    }

    // ---- Retention ------------------------------------------------------

    @Test
    void keepReadDaysAcceptsOnlyTheOfferedChoices() {
        assertThat(NotificationPrefs.keepReadDays(null)).isEqualTo(30);
        assertThat(NotificationPrefs.keepReadDays(Map.of())).isEqualTo(30);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", 7))).isEqualTo(7);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", 90))).isEqualTo(90);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", "7"))).isEqualTo(7);
        // Jackson hands a JSON 7.0 back as a Double.
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", 7.0))).isEqualTo(7);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", 1))).isEqualTo(30);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", 365))).isEqualTo(30);
        assertThat(NotificationPrefs.keepReadDays(Map.of("notifyKeepReadDays", "soon"))).isEqualTo(30);
    }

    @Test
    void everyoneOnTheDefaultIsOneStatementPlusTheCap() {
        when(users.findIdsWithUiPrefs()).thenReturn(List.of(
                new Object[] {UUID.randomUUID(), Map.of("theme", "dark")},
                new Object[] {UUID.randomUUID(), Map.of("notifyKeepReadDays", 30)}));

        service.sweep(NOW);

        verify(repo).deleteReadBefore(daysAgo(30));
        verify(repo).deleteCreatedBefore(daysAgo(90));
        verify(repo, never()).deleteReadBeforeExcept(any(), anyCollection());
        verify(repo, never()).deleteReadBeforeForUsers(any(), anyCollection());
    }

    @Test
    void eachUserKeepsReadCardsForTheirOwnWindow() {
        UUID week = UUID.randomUUID();
        UUID quarter = UUID.randomUUID();
        UUID month = UUID.randomUUID();
        UUID junk = UUID.randomUUID();
        when(users.findIdsWithUiPrefs()).thenReturn(List.of(
                new Object[] {week, Map.of("notifyKeepReadDays", 7)},
                new Object[] {quarter, Map.of("notifyKeepReadDays", 90)},
                new Object[] {month, Map.of("notifyKeepReadDays", 30)},
                new Object[] {junk, Map.of("notifyKeepReadDays", "forever")}));

        service.sweep(NOW);

        // The default window spares only those who keep longer...
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> spared = ArgumentCaptor.forClass(Collection.class);
        verify(repo).deleteReadBeforeExcept(eq(daysAgo(30)), spared.capture());
        assertThat(spared.getValue()).containsExactly(quarter);
        // ...the 7-day user also loses read cards past a week...
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> shorter = ArgumentCaptor.forClass(Collection.class);
        verify(repo).deleteReadBeforeForUsers(eq(daysAgo(7)), shorter.capture());
        assertThat(shorter.getValue()).containsExactly(week);
        // ...and the 90-day user's read cards go with the cap, unread or not.
        verify(repo).deleteCreatedBefore(daysAgo(90));
        verify(repo, never()).deleteReadBefore(any());
        verify(repo, never()).deleteReadBeforeForUsers(eq(daysAgo(90)), anyCollection());
    }

    @Test
    void aLongShortListGoesInChunks() {
        List<Object[]> rows = new ArrayList<>();
        for (int i = 0; i < 1200; i++) rows.add(new Object[] {UUID.randomUUID(), Map.of("notifyKeepReadDays", 7)});
        when(users.findIdsWithUiPrefs()).thenReturn(rows);

        service.sweep(NOW);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> chunks = ArgumentCaptor.forClass(Collection.class);
        verify(repo, org.mockito.Mockito.times(3)).deleteReadBeforeForUsers(eq(daysAgo(7)), chunks.capture());
        assertThat(chunks.getAllValues()).extracting(Collection::size).containsExactly(500, 500, 200);
        verify(repo).deleteReadBefore(daysAgo(30));
    }

    // ---- Mark all read / Clear read are the caller's alone --------------

    @Test
    void markAllReadAndClearReadAreScopedToTheCaller() {
        service.markAllRead(USER);
        service.clearRead(USER);

        verify(repo).markAllReadForUser(eq(USER), any(Instant.class));
        verify(repo).deleteReadForUser(USER);
        verifyNoMoreInteractions(repo);
    }

    @Test
    void theBulkQueriesFilterByTheirUser() throws Exception {
        for (String name : List.of("markAllReadForUser", "deleteReadForUser")) {
            var m = java.util.Arrays.stream(NotificationRepository.class.getMethods())
                    .filter(x -> x.getName().equals(name)).findFirst().orElseThrow();
            String jpql = m.getAnnotation(Query.class).value();
            assertThat(jpql).as(name).contains("n.userId = :userId");
        }
        String mark = NotificationRepository.class
                .getMethod("markAllReadForUser", UUID.class, Instant.class)
                .getAnnotation(Query.class).value();
        assertThat(mark).as("only unread rows get a new readAt").contains("n.readAt is null");
    }

    // ---- Categories and the mute ---------------------------------------

    @Test
    void publishStampsTheCategoryAndFallsBackToTheKind() {
        when(repo.save(any(Notification.class))).thenAnswer(inv -> inv.getArgument(0));

        Notification family = service.publish(USER, NotificationKind.system, NotifyCategory.people, "Asha joined", null, null);
        Notification habit = service.publish(USER, NotificationKind.habit_reminder, "Walk", null, null);
        Notification legacy = new Notification();
        legacy.setKind(NotificationKind.mentorship_accepted);

        assertThat(family.getCategory()).isEqualTo(NotifyCategory.people);
        assertThat(habit.getCategory()).isEqualTo(NotifyCategory.habits);
        assertThat(legacy.effectiveCategory()).isEqualTo(NotifyCategory.people);
    }

    @Test
    void muteReadsTheUsersPrefsForMutableCategoriesOnly() {
        Map<String, Object> prefs = Map.of("notifyMute", Map.of("people", true, "money", false));

        assertThat(NotificationPrefs.isMuted(prefs, NotifyCategory.people)).isTrue();
        assertThat(NotificationPrefs.isMuted(prefs, NotifyCategory.money)).isFalse();
        assertThat(NotificationPrefs.isMuted(prefs, NotifyCategory.habits)).isFalse();
        assertThat(NotificationPrefs.isMuted(null, NotifyCategory.people)).isFalse();
        // Reminders and system cards can't be muted, whatever the blob says.
        assertThat(NotificationPrefs.isMuted(Map.of("notifyMute", Map.of("reminders", true)), NotifyCategory.reminders))
                .isFalse();
    }
}
