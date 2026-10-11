package com.growthbuddy.wellness;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/** SEC-8: sleep and mood fields were stored (and fed to Buddy) whatever they said. */
class WellnessValidationTest {

    private final Validator v = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void sleepTakesWhatTheDialogSends() {
        assertThat(v.validate(new SleepRequest(null, "23:30", "07:00", "okay", null))).isEmpty();
        assertThat(v.validate(new SleepRequest(null, null, null, "poor", null))).isEmpty(); // quick add
        assertThat(v.validate(new SleepRequest(null, "99:99", "-1", "x", null))).hasSize(3);
    }

    @Test
    void moodTakesWordsAndTheDialogsOptions() {
        assertThat(v.validate(new MoodRequest(null, "a bit tired", "medium", "calm", null))).isEmpty();
        assertThat(v.validate(new MoodRequest(null, "<b>", "x", "y", null))).hasSize(3);
    }
}
