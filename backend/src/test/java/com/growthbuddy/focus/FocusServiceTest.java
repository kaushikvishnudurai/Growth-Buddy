package com.growthbuddy.focus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * The focus stats: mode and duration as stored, and where "today" and "this
 * week" begin — the user's own midnight and Monday, not the last 24 hours and
 * 7 days, which counted last night's session as today's.
 */
class FocusServiceTest {

    private static FocusSession at(String iso, int sec) {
        FocusSession s = new FocusSession();
        s.setMode("focus");
        s.setDurationSec(sec);
        s.setCompletedAt(Instant.parse(iso));
        return s;
    }

    @Test
    void modeIsFocusUnlessItSaysBreak() {
        assertThat(FocusService.normaliseMode("break")).isEqualTo("break");
        assertThat(FocusService.normaliseMode("focus")).isEqualTo("focus");
        assertThat(FocusService.normaliseMode(null)).isEqualTo("focus");
        assertThat(FocusService.normaliseMode("nap")).isEqualTo("focus");
    }

    @Test
    void durationIsClampedToSixHours() {
        assertThat(FocusService.clampDuration(-5)).isZero();
        assertThat(FocusService.clampDuration(1500)).isEqualTo(1500);
        assertThat(FocusService.clampDuration(99_999)).isEqualTo(6 * 3600);
    }

    @Test
    void windowsStartAtTheUsersMidnightAndMonday() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        // Saturday 10 Oct 2026.
        Instant[] w = FocusService.windows(LocalDate.of(2026, 10, 10), kolkata);
        assertThat(w[0]).isEqualTo(Instant.parse("2026-10-09T18:30:00Z"));
        assertThat(w[1]).as("Monday 5 Oct, local midnight").isEqualTo(Instant.parse("2026-10-04T18:30:00Z"));
        // On a Monday the week starts that same day.
        Instant[] mon = FocusService.windows(LocalDate.of(2026, 10, 5), ZoneOffset.UTC);
        assertThat(mon[1]).isEqualTo(mon[0]);
    }

    @Test
    void lastNightIsNotToday() {
        Instant dayStart = Instant.parse("2026-10-10T00:00:00Z");
        FocusService.FocusStats s = FocusService.summarise(List.of(
                at("2026-10-09T23:30:00Z", 25 * 60), // last night: the week, not today
                at("2026-10-10T00:00:00Z", 25 * 60), // exactly midnight: today
                at("2026-10-10T09:00:00Z", 50 * 60)), dayStart, 7);
        assertThat(s.todaySessions()).isEqualTo(2);
        assertThat(s.todayMinutes()).isEqualTo(75);
        assertThat(s.weekMinutes()).isEqualTo(100);
        assertThat(s.totalSessions()).isEqualTo(7);
    }

    @Test
    void statsCountFocusSessionsOnlyAndAskFromTheWeekStart() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        UserClock clock = mock(UserClock.class);
        UUID user = UUID.randomUUID();
        when(clock.zoneOf(user)).thenReturn(ZoneOffset.UTC);
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of());
        when(repo.countByUserIdAndMode(user, "focus")).thenReturn(3L);
        when(repo.countByUserId(user)).thenReturn(9L);

        FocusService.FocusStats s = new FocusService(repo, clock, mock(UserRepository.class), mock(FocusLinks.class)).stats(user);

        assertThat(s.totalSessions()).as("breaks are not sessions of focus").isEqualTo(3);
        ArgumentCaptor<Instant> since = ArgumentCaptor.forClass(Instant.class);
        verify(repo).findByUserIdAndModeAndCompletedAtAfter(eq(user), eq("focus"), since.capture());
        Instant weekStart = FocusService.windows(LocalDate.now(ZoneOffset.UTC), ZoneOffset.UTC)[1];
        assertThat(since.getValue()).isBefore(weekStart).isAfter(weekStart.minusSeconds(1));
    }

    @Test
    void recordStoresTheNormalisedSession() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        UserClock clock = mock(UserClock.class);
        UUID user = UUID.randomUUID();
        when(clock.zoneOf(user)).thenReturn(ZoneOffset.UTC);
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of());

        new FocusService(repo, clock, mock(UserRepository.class), mock(FocusLinks.class)).record(user, "whatever", 99_999);

        ArgumentCaptor<FocusSession> saved = ArgumentCaptor.forClass(FocusSession.class);
        verify(repo).save(saved.capture());
        assertThat(saved.getValue().getMode()).isEqualTo("focus");
        assertThat(saved.getValue().getDurationSec()).isEqualTo(6 * 3600);
        assertThat(saved.getValue().getUserId()).isEqualTo(user);
    }

    private static FocusSession linked(String iso, int sec, UUID task, UUID goal) {
        FocusSession s = at(iso, sec);
        s.setTaskId(task);
        s.setGoalId(goal);
        return s;
    }

    @Test
    void historyBucketsEachSessionOnTheUsersOwnDay() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata"); // UTC+5:30
        LocalDate today = LocalDate.of(2026, 10, 10);
        List<FocusService.DayMinutes> days = FocusService.buckets(List.of(
                at("2026-10-09T18:29:00Z", 25 * 60), // 23:59 on the 9th in Kolkata
                at("2026-10-09T18:30:00Z", 30 * 60), // 00:00 on the 10th in Kolkata
                at("2026-10-10T10:00:00Z", 15 * 60),
                at("2026-10-08T02:00:00Z", 90)), today, kolkata, 3);
        assertThat(days).extracting(FocusService.DayMinutes::date)
                .containsExactly("2026-10-08", "2026-10-09", "2026-10-10");
        assertThat(days).extracting(FocusService.DayMinutes::minutes)
                .as("oldest first; a UTC bucket would have put the 18:30Z session on the 9th")
                .containsExactly(1, 25, 45);
        assertThat(FocusService.buckets(List.of(), today, kolkata, 30)).hasSize(30)
                .allSatisfy(d -> assertThat(d.minutes()).isZero());
    }

    @Test
    void historyReachesBackToMondayAndTotalsLinksForTheWeek() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        UserClock clock = mock(UserClock.class);
        FocusLinks links = mock(FocusLinks.class);
        UUID user = UUID.randomUUID();
        UUID task = UUID.randomUUID();
        UUID goal = UUID.randomUUID();
        when(clock.zoneOf(user)).thenReturn(ZoneOffset.UTC);
        String now = Instant.now().toString();
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of(
                linked(now, 25 * 60, task, null),
                linked(now, 50 * 60, null, goal),
                linked(now, 20, task, null), // under a minute; adds to the task's seconds
                linked("2000-01-01T00:00:00Z", 99 * 60, task, null))); // not this week
        when(links.taskTitles(eq(user), any())).thenReturn(Map.of(task, "Write report"));
        when(links.goalTitles(eq(user), any())).thenReturn(Map.of());

        FocusService.FocusHistory h = new FocusService(repo, clock, mock(UserRepository.class), links)
                .history(user, 1);

        assertThat(h.days()).hasSize(1);
        assertThat(h.week()).extracting(FocusService.LinkTotal::kind).containsExactly("goal", "task");
        assertThat(h.week().get(0).title()).as("a deleted goal keeps its minutes").isNull();
        assertThat(h.week().get(1).title()).isEqualTo("Write report");
        assertThat(h.week().get(1).minutes()).isEqualTo(25);
        ArgumentCaptor<Instant> since = ArgumentCaptor.forClass(Instant.class);
        verify(repo).findByUserIdAndModeAndCompletedAtAfter(eq(user), eq("focus"), since.capture());
        Instant weekStart = FocusService.windows(LocalDate.now(ZoneOffset.UTC), ZoneOffset.UTC)[1];
        assertThat(since.getValue()).as("days=1 still reaches back to Monday for the week's totals")
                .isBefore(weekStart);
    }

    @Test
    void aLinkMustBeTheUsersOwn() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        FocusLinks links = mock(FocusLinks.class);
        UserClock clock = mock(UserClock.class);
        UUID user = UUID.randomUUID();
        UUID mine = UUID.randomUUID();
        UUID theirs = UUID.randomUUID();
        when(clock.zoneOf(user)).thenReturn(ZoneOffset.UTC);
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of());
        when(links.ownsTask(user, mine)).thenReturn(true);
        FocusService svc = new FocusService(repo, clock, mock(UserRepository.class), links);

        assertThatThrownBy(() -> svc.record(user, "focus", 1500, theirs, null)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> svc.record(user, "focus", 1500, null, theirs)).isInstanceOf(ApiException.class);
        verify(repo, never()).save(any());

        svc.record(user, "focus", 1500, mine, null);
        ArgumentCaptor<FocusSession> saved = ArgumentCaptor.forClass(FocusSession.class);
        verify(repo).save(saved.capture());
        assertThat(saved.getValue().getTaskId()).isEqualTo(mine);
    }

    @Test
    void aBreakIsNeverLinked() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        FocusLinks links = mock(FocusLinks.class);
        UserClock clock = mock(UserClock.class);
        UUID user = UUID.randomUUID();
        when(clock.zoneOf(user)).thenReturn(ZoneOffset.UTC);
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of());

        new FocusService(repo, clock, mock(UserRepository.class), links)
                .record(user, "break", 300, UUID.randomUUID(), UUID.randomUUID());

        ArgumentCaptor<FocusSession> saved = ArgumentCaptor.forClass(FocusSession.class);
        verify(repo).save(saved.capture());
        assertThat(saved.getValue().getTaskId()).isNull();
        assertThat(saved.getValue().getGoalId()).isNull();
    }

    @Test
    void goalStreakCountsDaysInARowAndTodayInProgressDoesNotBreakIt() {
        LocalDate today = LocalDate.of(2026, 10, 10);
        Map<LocalDate, Integer> sec = new HashMap<>();
        sec.put(today.minusDays(1), 60 * 60);
        sec.put(today.minusDays(2), 30 * 60); // exactly the goal: met
        sec.put(today.minusDays(3), 29 * 60); // short: the streak stops here
        sec.put(today.minusDays(4), 90 * 60);
        assertThat(FocusService.goalStreak(sec, today, 30)).as("today not met yet").isEqualTo(2);
        sec.put(today, 31 * 60);
        assertThat(FocusService.goalStreak(sec, today, 30)).isEqualTo(3);
        assertThat(FocusService.goalStreak(sec, today, 0)).as("no goal, no streak").isZero();
        assertThat(FocusService.goalStreak(Map.of(), today, 30)).isZero();
    }

    @Test
    void theGoalComesFromUiPrefsClampedAndOffByDefault() {
        assertThat(FocusService.goalFromPrefs(null)).isZero();
        assertThat(FocusService.goalFromPrefs(Map.of())).isZero();
        assertThat(FocusService.goalFromPrefs(Map.of("focusGoalMins", 60))).isEqualTo(60);
        assertThat(FocusService.goalFromPrefs(Map.of("focusGoalMins", "45"))).isEqualTo(45);
        assertThat(FocusService.goalFromPrefs(Map.of("focusGoalMins", "lots"))).isZero();
        assertThat(FocusService.goalFromPrefs(Map.of("focusGoalMins", -5))).isZero();
        assertThat(FocusService.goalFromPrefs(Map.of("focusGoalMins", 5000))).isEqualTo(720);
    }

    @Test
    void statsWithAGoalReportTheStreakBucketedInTheUsersZone() {
        FocusSessionRepository repo = mock(FocusSessionRepository.class);
        UserClock clock = mock(UserClock.class);
        UserRepository users = mock(UserRepository.class);
        UUID user = UUID.randomUUID();
        ZoneId zone = ZoneId.of("America/New_York");
        when(clock.zoneOf(user)).thenReturn(zone);
        User u = new User();
        u.setUiPrefs(new HashMap<String, Object>(Map.of("focusGoalMins", 25)));
        when(users.findById(user)).thenReturn(Optional.of(u));
        LocalDate today = LocalDate.now(zone);
        // 00:30 local: already the next day in UTC for the evening before.
        Instant early = today.atTime(0, 30).atZone(zone).toInstant();
        when(repo.findByUserIdAndModeAndCompletedAtAfter(any(), any(), any())).thenReturn(List.of(
                at(early.toString(), 25 * 60),
                at(today.minusDays(1).atTime(0, 30).atZone(zone).toInstant().toString(), 25 * 60),
                at(today.minusDays(30).atTime(0, 30).atZone(zone).toInstant().toString(), 25 * 60)));

        FocusService.FocusStats s = new FocusService(repo, clock, users, mock(FocusLinks.class)).stats(user);

        assertThat(s.goalMinutes()).isEqualTo(25);
        assertThat(s.goalStreak()).isEqualTo(2);
        assertThat(s.todayMinutes()).isEqualTo(25);
        assertThat(s.weekMinutes()).as("the streak's look-back is not this week").isLessThanOrEqualTo(50);
    }
}
