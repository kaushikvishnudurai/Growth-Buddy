package com.growthbuddy.task;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

/**
 * Every field on an update means "leave it alone" when it is null, which left
 * no way to say "make the due date empty" — clearing the field in the edit
 * dialog saved with the old date still on it, and the UI reported success.
 */
class TaskDueDateTest {

    private static final Instant NOW = Instant.parse("2026-09-25T10:00:00Z");
    private static final Instant LATER = Instant.parse("2026-10-01T10:00:00Z");

    @Test
    void anExplicitClearRemovesTheDueDate() {
        assertThat(TaskService.resolveDueAt(NOW, null, true)).isNull();
    }

    @Test
    void aSuppliedValueMovesIt() {
        assertThat(TaskService.resolveDueAt(NOW, LATER, false)).isEqualTo(LATER);
        assertThat(TaskService.resolveDueAt(null, LATER, null)).isEqualTo(LATER);
    }

    @Test
    void nothingSuppliedLeavesItAlone() {
        assertThat(TaskService.resolveDueAt(NOW, null, null)).isEqualTo(NOW);
        assertThat(TaskService.resolveDueAt(NOW, null, false)).isEqualTo(NOW);
    }

    @Test
    void aClearBeatsAValueRatherThanRacingIt() {
        // Can't come from our own dialog — it only sets clearDueAt when the
        // field is empty — but the order has to be defined, not incidental.
        assertThat(TaskService.resolveDueAt(NOW, LATER, true)).isNull();
    }
}
