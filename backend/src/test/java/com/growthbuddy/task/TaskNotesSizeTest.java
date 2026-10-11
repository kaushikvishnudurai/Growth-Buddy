package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/**
 * HOS-10: tasks.notes is TEXT (64 KB). 70,000 characters reached the database
 * and came back as the duplicate-tap 409. 10,000 is a bound utf8mb4 always fits.
 */
class TaskNotesSizeTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void notesOverTheBoundAreRefusedOnCreateAndUpdate() {
        String big = "x".repeat(10_001);
        assertThat(validator.validate(new CreateTaskRequest("t", big, null, null, null)))
                .anyMatch(v -> v.getPropertyPath().toString().equals("notes"));
        assertThat(validator.validate(new UpdateTaskRequest(null, big, null, null, null, null, null, null, null)))
                .anyMatch(v -> v.getPropertyPath().toString().equals("notes"));
        assertThat(validator.validate(new CreateTaskRequest("t", "x".repeat(10_000), null, null, null))).isEmpty();
    }
}
