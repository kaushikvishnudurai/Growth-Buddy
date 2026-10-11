package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * The sweep clears ticks from before the user's own local midnight, on any hourly
 * tick. Everything else about the job is two repository calls; the midnight is
 * the only decision it makes.
 */
class TaskMidnightSweepTest {

    /** 2026-09-15T18:30:00Z — 00:00 on the 16th in Kolkata (+5:30), 19:30 on the 15th in London (+1). */
    private static final Instant AT = Instant.parse("2026-09-15T18:30:00Z");

    @Test
    void midnightIsEachZonesOwn() {
        assertThat(TaskMidnightSweep.localMidnight("Asia/Kolkata", AT)).isEqualTo(AT);
        assertThat(TaskMidnightSweep.localMidnight("Europe/London", AT))
                .isEqualTo(Instant.parse("2026-09-14T23:00:00Z"));
        // Hours later the same midnight still stands, so a missed hour-0 tick is caught up.
        assertThat(TaskMidnightSweep.localMidnight("Asia/Kolkata", AT.plusSeconds(5 * 3600))).isEqualTo(AT);
    }

    @Test
    void aZoneSpringingForwardAtMidnightStillHasADayStart() {
        // Santiago skips 00:00 to 01:00 on 2026-09-06; the day starts at 01:00 local (04:00Z).
        assertThat(TaskMidnightSweep.localMidnight("America/Santiago", Instant.parse("2026-09-06T12:00:00Z")))
                .isEqualTo(Instant.parse("2026-09-06T04:00:00Z"));
    }

    @Test
    void unknownZoneFallsBackToUtcRatherThanThrowing() {
        assertThat(TaskMidnightSweep.localMidnight("Mars/Olympus", Instant.parse("2026-09-15T05:20:00Z")))
                .isEqualTo(Instant.parse("2026-09-15T00:00:00Z"));
    }
}
