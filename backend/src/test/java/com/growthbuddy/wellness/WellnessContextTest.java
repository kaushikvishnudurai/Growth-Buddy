package com.growthbuddy.wellness;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The week of check-ins Buddy is told about: oldest first, words only, no notes. */
class WellnessContextTest {

    private static DailyLog day(String date, String mood, String sleep, String note) {
        DailyLog d = new DailyLog();
        d.setLogDate(LocalDate.parse(date));
        if (mood != null) {
            d.setMood(mood);
            d.setEnergy("high");
            d.setStress("calm");
            d.setMoodNote(note);
        }
        d.setSleepQuality(sleep);
        return d;
    }

    @Test
    void summarisesTheWeekOldestFirstWithoutNotes() {
        String s = WellnessService.summarize(List.of(
                day("2026-10-10", "great", "good", "secret diary entry"),
                day("2026-10-08", "low", null, null),
                day("2026-10-09", null, "poor", null)));
        assertThat(s).contains("mood: low, great");
        assertThat(s).contains("sleep quality: poor, good");
        assertThat(s).doesNotContain("secret");
    }

    @Test
    void anEmptyWeekSaysSo() {
        assertThat(WellnessService.summarize(List.of())).contains("no mood or sleep logged");
        assertThat(WellnessService.summarize(null)).contains("no mood or sleep logged");
    }

    @Test
    void aStoredWordCannotCarryMarkup() {
        String s = WellnessService.summarize(List.of(day("2026-10-10", "<b>ok</b>", null, null)));
        assertThat(s).doesNotContain("<").contains("bokb");
    }
}
