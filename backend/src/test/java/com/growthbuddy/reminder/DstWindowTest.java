package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.Test;

/**
 * The delivery window across a daylight-saving change.
 *
 * <p>Europe/London springs forward at 01:00 on 2026-03-29: local time goes
 * 00:59:59 → 02:00:00, so 01:30 does not exist that day. Built as a bare
 * LocalDateTime the window is 01:30–01:35 local, which never arrives, and the
 * reminder was skipped without a word. Resolved through the zone it lands on
 * the first instant that does exist.
 */
class DstWindowTest {

    private static final ZoneId LONDON = ZoneId.of("Europe/London");
    private static final Duration CATCH_UP = Duration.ofMinutes(5);
    private static final LocalDate SPRING_FORWARD = LocalDate.of(2026, 3, 29);

    /** What the scheduler does now. */
    private static Instant windowStart(LocalDate day, LocalTime time, ZoneId zone) {
        return ZonedDateTime.of(day, time, zone).toInstant();
    }

    @Test
    void aReminderInsideTheSkippedHourStillGetsAWindow() {
        Instant at = windowStart(SPRING_FORWARD, LocalTime.of(1, 30), LONDON);
        ZonedDateTime local = at.atZone(LONDON);
        assertThat(local.toLocalDate()).as("still that day").isEqualTo(SPRING_FORWARD);
        assertThat(local.toLocalTime())
                .as("01:30 does not exist, so it resolves forward to 02:30")
                .isEqualTo(LocalTime.of(2, 30));
    }

    /**
     * The old shape, kept as the thing that must never come back: a local window
     * inside the skipped hour is a window no clock ever shows.
     */
    @Test
    void theOldLocalWindowNeverArrivedOnThatMorning() {
        LocalDateTime scheduled = LocalDateTime.of(SPRING_FORWARD, LocalTime.of(1, 30));
        boolean everInside = false;
        // Walk the real instants of that morning minute by minute.
        Instant cursor = ZonedDateTime.of(SPRING_FORWARD, LocalTime.MIDNIGHT, LONDON).toInstant();
        for (int i = 0; i < 6 * 60; i++) {
            LocalDateTime nowLocal = cursor.atZone(LONDON).toLocalDateTime();
            if (!nowLocal.isBefore(scheduled) && !nowLocal.isAfter(scheduled.plus(CATCH_UP))) {
                everInside = true;
                break;
            }
            cursor = cursor.plusSeconds(60);
        }
        assertThat(everInside)
                .as("no minute of that morning falls inside a 01:30-01:35 local window")
                .isFalse();
    }

    /** A normal day is unaffected: the window is exactly where it says. */
    @Test
    void anOrdinaryDayIsUnchanged() {
        Instant at = windowStart(LocalDate.of(2026, 6, 15), LocalTime.of(9, 0), LONDON);
        assertThat(at.atZone(LONDON).toLocalTime()).isEqualTo(LocalTime.of(9, 0));
    }

    /**
     * A reminder's time is a LOCAL time, so it follows the user. Move from
     * London to Kolkata and 09:00 is still 09:00 where they now are — the
     * scheduler reads the user's current zone every tick, it does not pin an
     * instant at creation.
     */
    @Test
    void nineAmFollowsTheUserToANewTimezone() {
        LocalDate day = LocalDate.of(2026, 6, 15);
        Instant inLondon = windowStart(day, LocalTime.of(9, 0), LONDON);
        Instant inKolkata = windowStart(day, LocalTime.of(9, 0), ZoneId.of("Asia/Kolkata"));
        assertThat(inLondon).as("different instants…").isNotEqualTo(inKolkata);
        assertThat(inKolkata.atZone(ZoneId.of("Asia/Kolkata")).toLocalTime())
                .as("…but both are 09:00 where the user is")
                .isEqualTo(LocalTime.of(9, 0));
    }
}
