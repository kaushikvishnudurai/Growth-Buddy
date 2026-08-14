package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

/**
 * The day-boundary rules the whole app depends on. These are deliberately written
 * against a fixed {@link Instant}, so they assert real timezone behaviour rather than
 * whatever zone the machine running the build happens to be in.
 */
class UserZoneTest {

    /** 2026-08-14 22:30 UTC — already the 15th in Kolkata, still the 14th in New York. */
    private static final Instant EVENING_UTC = Instant.parse("2026-08-14T22:30:00Z");

    @Test
    void theSameInstantIsADifferentDayInDifferentZones() {
        assertEquals(LocalDate.parse("2026-08-15"), UserZone.today("Asia/Kolkata", EVENING_UTC),
                "+05:30 has already rolled over");
        assertEquals(LocalDate.parse("2026-08-14"), UserZone.today("UTC", EVENING_UTC));
        assertEquals(LocalDate.parse("2026-08-14"), UserZone.today("America/New_York", EVENING_UTC),
                "-04:00 has not rolled over yet");
    }

    @Test
    void earlyMorningInKolkataIsStillYesterdayInUtc() {
        // 01:00 IST on the 15th == 19:30 UTC on the 14th. This is the case that broke
        // habit streaks and water totals: the user's "today" is the 15th.
        Instant oneAmIst = Instant.parse("2026-08-14T19:30:00Z");
        assertEquals(LocalDate.parse("2026-08-15"), UserZone.today("Asia/Kolkata", oneAmIst));
        assertEquals(LocalDate.parse("2026-08-14"), UserZone.today("UTC", oneAmIst));
    }

    @Test
    void unusableZonesFallBackToUtcInsteadOfThrowing() {
        assertEquals(UserZone.FALLBACK, UserZone.of(null));
        assertEquals(UserZone.FALLBACK, UserZone.of(""));
        assertEquals(UserZone.FALLBACK, UserZone.of("   "));
        assertEquals(UserZone.FALLBACK, UserZone.of("Not/AZone"),
                "a stale or hand-edited value must not take an endpoint down");
        assertEquals(UserZone.FALLBACK, UserZone.of("Asia/Kolkata/Extra"));
    }

    @Test
    void validZonesAreParsedIncludingOffsetsAndSurroundingWhitespace() {
        assertEquals(ZoneId.of("Asia/Kolkata"), UserZone.of("Asia/Kolkata"));
        assertEquals(ZoneId.of("Asia/Kolkata"), UserZone.of("  Asia/Kolkata  "));
        assertEquals(ZoneId.of("Europe/London"), UserZone.of("Europe/London"));
        assertEquals(ZoneId.of("+05:30"), UserZone.of("+05:30"));
    }

    @Test
    void fallbackIsUtcNotTheHostZone() {
        // Deterministic across machines on purpose — it matches the users.timezone
        // column default and AuthService.resolveTimezone.
        assertEquals(ZoneId.of("UTC"), UserZone.FALLBACK);
        assertEquals(LocalDate.parse("2026-08-14"), UserZone.today("Not/AZone", EVENING_UTC));
    }

    @Test
    void dstIsHonouredRatherThanAssumingAFixedOffset() {
        // London is UTC+1 in summer, UTC+0 in winter. A fixed offset would get one wrong.
        Instant summerNight = Instant.parse("2026-07-01T23:30:00Z");
        Instant winterNight = Instant.parse("2026-12-01T23:30:00Z");
        assertEquals(LocalDate.parse("2026-07-02"), UserZone.today("Europe/London", summerNight));
        assertEquals(LocalDate.parse("2026-12-01"), UserZone.today("Europe/London", winterNight));
    }
}
