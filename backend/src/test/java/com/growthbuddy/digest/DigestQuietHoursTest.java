package com.growthbuddy.digest;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** Quiet hours hold the digest back to the first whole hour after them, never drop it. */
class DigestQuietHoursTest {

    @Test
    void outsideQuietHoursTheUsersOwnHourStands() {
        assertThat(DigestScheduler.digestHourFor(8, null)).isEqualTo(8);
        assertThat(DigestScheduler.digestHourFor(8, Map.of("quietStart", "22:00", "quietEnd", "07:00"))).isEqualTo(8);
    }

    @Test
    void insideQuietHoursItWaitsForTheEnd() {
        Map<String, Object> night = Map.of("quietStart", "22:00", "quietEnd", "07:00");
        assertThat(DigestScheduler.digestHourFor(6, night)).isEqualTo(7);
        assertThat(DigestScheduler.digestHourFor(23, night)).isEqualTo(7);
        // An end on the half hour rounds up: 07:30 would still be quiet at 07:00.
        assertThat(DigestScheduler.digestHourFor(6, Map.of("quietStart", "22:00", "quietEnd", "07:30")))
                .isEqualTo(8);
    }
}
