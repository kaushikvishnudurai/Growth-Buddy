package com.growthbuddy.wellness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Unit tests for the range() map-building: a day appears in sleepByDate /
 * moodByDate / byDate only when the matching fields were actually logged.
 */
@ExtendWith(MockitoExtension.class)
class WellnessServiceTest {

    private static final UUID USER = UUID.randomUUID();

    @Mock DailyLogRepository logs;

    private WellnessService service() {
        return new WellnessService(logs);
    }

    private DailyLog row(LocalDate date) {
        DailyLog d = new DailyLog();
        d.setUserId(USER);
        d.setLogDate(date);
        return d;
    }

    @Test
    void splitsRowsIntoTheRightMapsByPresence() {
        LocalDate d1 = LocalDate.of(2026, 6, 20);
        LocalDate d2 = LocalDate.of(2026, 6, 21);
        LocalDate d3 = LocalDate.of(2026, 6, 22);

        DailyLog sleepOnly = row(d1);
        sleepOnly.setSleepQuality("great");
        sleepOnly.setBedtime("23:00");

        DailyLog moodOnly = row(d2);
        moodOnly.setMood("good");
        moodOnly.setEnergy("high");

        DailyLog metricOnly = row(d3);
        metricOnly.setScore(80);
        metricOnly.setWaterMl(2000);

        when(logs.findByUserIdAndLogDateBetween(eq(USER), any(), any()))
                .thenReturn(List.of(sleepOnly, moodOnly, metricOnly));

        DailyLogsResponse r = service().range(USER, 30);

        assertThat(r.sleepByDate()).containsOnlyKeys("2026-06-20");
        assertThat(r.moodByDate()).containsOnlyKeys("2026-06-21");
        assertThat(r.byDate()).containsOnlyKeys("2026-06-22");
        assertThat(r.sleepByDate().get("2026-06-20").quality()).isEqualTo("great");
        assertThat(r.byDate().get("2026-06-22").score()).isEqualTo(80);
        // Snapshot nulls coalesce to 0, not null.
        assertThat(r.byDate().get("2026-06-22").kcal()).isZero();
    }

    @Test
    void aSingleRowCanContributeToAllThreeMaps() {
        LocalDate d = LocalDate.of(2026, 6, 27);
        DailyLog full = row(d);
        full.setSleepQuality("okay");
        full.setMood("low");
        full.setScore(50);
        when(logs.findByUserIdAndLogDateBetween(eq(USER), any(), any())).thenReturn(List.of(full));

        DailyLogsResponse r = service().range(USER, 7);
        assertThat(r.sleepByDate()).containsKey("2026-06-27");
        assertThat(r.moodByDate()).containsKey("2026-06-27");
        assertThat(r.byDate()).containsKey("2026-06-27");
    }
}
