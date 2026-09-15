package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * The sweep runs hourly and fires on whichever tick lands in the user's first
 * local hour of the day. Everything else about the job is two repository calls;
 * this is the only decision it makes.
 */
class TaskMidnightSweepTest {

    /** 2026-09-15T18:30:00Z — 00:00 in Kolkata (+5:30), 19:30 in London (+1). */
    private static final Instant AT = Instant.parse("2026-09-15T18:30:00Z");

    @Test
    void firesOnlyInsideEachZonesOwnFirstHour() {
        assertThat(TaskMidnightSweep.isLocalMidnightHour("Asia/Kolkata", AT)).isTrue();
        assertThat(TaskMidnightSweep.isLocalMidnightHour("Europe/London", AT)).isFalse();
        assertThat(TaskMidnightSweep.isLocalMidnightHour("UTC", AT)).isFalse();
        assertThat(TaskMidnightSweep.isLocalMidnightHour("UTC", Instant.parse("2026-09-15T00:20:00Z")))
                .isTrue();
    }

    @Test
    void offsetZonesStillCatchExactlyOneHourlyTick() {
        // Kathmandu is +5:45, so the hourly ticks land at :15 past each local
        // hour. 18:30Z is 00:15 local — inside the first hour, and the next
        // tick an hour later is already past it.
        assertThat(TaskMidnightSweep.isLocalMidnightHour("Asia/Kathmandu", AT)).isTrue();
        assertThat(TaskMidnightSweep.isLocalMidnightHour("Asia/Kathmandu", AT.plusSeconds(3600)))
                .isFalse();
    }

    @Test
    void unknownZoneFallsBackToUtcRatherThanThrowing() {
        assertThat(TaskMidnightSweep.isLocalMidnightHour("Mars/Olympus", Instant.parse("2026-09-15T00:20:00Z")))
                .isTrue();
    }
}
