package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Scoped delete and edit, where a series is cut in two. The trap these pin:
 * "this and all future" from the FIRST occurrence leaves nothing of the old
 * series ahead of the cut, and ending it the day before its own anchor made a
 * row that could never fire and sat in the reminder list forever.
 */
class ReminderScopedSplitTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 14);
    private static final UUID USER = UUID.randomUUID();

    private final CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
    private final ReminderService service;

    ReminderScopedSplitTest() {
        UserClock clock = mock(UserClock.class);
        when(clock.today(any())).thenReturn(TODAY);
        when(repo.save(any())).thenAnswer(i -> i.getArgument(0));
        service = new ReminderService(repo, clock, null);
    }

    private CalendarReminder series(LocalDate anchor) {
        CalendarReminder r = new CalendarReminder();
        r.setId(UUID.randomUUID());
        r.setUserId(USER);
        r.setText("Standup");
        r.setAnchorDate(anchor);
        r.setTime(LocalTime.of(9, 0));
        r.setTag(ReminderTag.work);
        r.setRepeat(RepeatFreq.daily);
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));
        return r;
    }

    private static UpdateReminderRequest patch(String text, LocalTime time) {
        return new UpdateReminderRequest(text, time, null, null, null, null, null, null, null, null, null);
    }

    @Test
    void deletingFutureFromTheFirstOccurrenceDeletesTheRow() {
        CalendarReminder r = series(TODAY);
        service.delete(USER, r.getId(), "future", TODAY);
        verify(repo).delete(r);
    }

    @Test
    void deletingFutureFromTheFirstKeptDayAfterABeforeDeleteDeletesTheRow() {
        CalendarReminder r = series(TODAY.minusDays(10));
        r.setFromDate(TODAY);
        service.delete(USER, r.getId(), "future", TODAY);
        verify(repo).delete(r);
    }

    @Test
    void deletingFutureMidSeriesEndsItTheDayBefore() {
        CalendarReminder r = series(TODAY);
        service.delete(USER, r.getId(), "future", TODAY.plusDays(4));
        verify(repo, never()).delete(r);
        assertThat(r.getUntilDate()).isEqualTo(TODAY.plusDays(3));
    }

    @Test
    void editingFutureFromTheFirstOccurrenceReplacesTheRow() {
        CalendarReminder r = series(TODAY);
        ReminderResponse rest = service.update(USER, r.getId(), "future", TODAY, patch(null, LocalTime.of(8, 0)));
        verify(repo).delete(r);
        assertThat(rest.date()).isEqualTo(TODAY);
        assertThat(rest.time()).isEqualTo(LocalTime.of(8, 0));
        assertThat(rest.repeat()).isEqualTo(RepeatFreq.daily);
    }

    @Test
    void editingFutureMidSeriesKeepsTheHead() {
        CalendarReminder r = series(TODAY);
        service.update(USER, r.getId(), "future", TODAY.plusDays(2), patch("Later", null));
        verify(repo, never()).delete(r);
        assertThat(r.getUntilDate()).isEqualTo(TODAY.plusDays(1));
        assertThat(r.getText()).as("the head keeps its old values").isEqualTo("Standup");
    }

    @Test
    void allDayTakesTheTimeAndEndOffAndDropsTheSnooze() {
        CalendarReminder r = series(TODAY);
        r.setEndTime(LocalTime.of(10, 0));
        r.setSnoozedUntil(Instant.parse("2026-09-14T09:10:00Z"));
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, null, null, null, null, true, null, null));
        assertThat(r.getTime()).isNull();
        assertThat(r.getEndTime()).isNull();
        assertThat(r.getSnoozedUntil()).isNull();
    }

    @Test
    void aOneOffCanMoveDayButNotIntoThePast() {
        CalendarReminder r = series(TODAY);
        r.setRepeat(RepeatFreq.none);
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, null, null, null, null, null, TODAY.plusDays(5), null));
        assertThat(r.getAnchorDate()).isEqualTo(TODAY.plusDays(5));
        assertThatThrownBy(() -> service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, null, null, null, null, null, TODAY.minusDays(9), null)))
                .hasMessageContaining("already passed");
    }

    @Test
    void aWholeSeriesEditDoesNotMoveTheAnchor() {
        CalendarReminder r = series(TODAY);
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, null, null, null, null, null, TODAY.plusDays(5), null));
        assertThat(r.getAnchorDate()).isEqualTo(TODAY);
    }

    @Test
    void onlyThisDayCanLandOnAnotherDay() {
        CalendarReminder r = series(TODAY);
        ReminderResponse one = service.update(USER, r.getId(), "this", TODAY.plusDays(1),
                new UpdateReminderRequest(null, null, null, ReminderTag.health, null, null, null, null, null,
                        TODAY.plusDays(3), null));
        assertThat(r.getSkipDays()).contains(TODAY.plusDays(1));
        assertThat(one.date()).isEqualTo(TODAY.plusDays(3));
        assertThat(one.tag()).isEqualTo(ReminderTag.health);
        assertThat(one.repeat()).isEqualTo(RepeatFreq.none);
    }

    @Test
    void repeatAndUntilCanBeChangedAndCleared() {
        CalendarReminder r = series(TODAY);
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, RepeatFreq.weekly, TODAY.plusDays(30), null, null,
                        null, null, null));
        assertThat(r.getRepeat()).isEqualTo(RepeatFreq.weekly);
        assertThat(r.getUntilDate()).isEqualTo(TODAY.plusDays(30));
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, null, null, null, null, null, null, true));
        assertThat(r.getUntilDate()).isNull();
        r.setUntilDate(TODAY.plusDays(3));
        service.update(USER, r.getId(), "all", null,
                new UpdateReminderRequest(null, null, null, null, RepeatFreq.none, null, null, null, null, null, null));
        assertThat(r.getUntilDate()).as("a one-off carries no end date").isNull();
    }
}
