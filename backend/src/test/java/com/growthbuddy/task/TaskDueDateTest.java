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

    @Test
    void onlyAMoveHalfADayLaterCountsAsAPush() {
        assertThat(TaskService.isPush(NOW, NOW.plusSeconds(86400))).isTrue();
        assertThat(TaskService.isPush(NOW, NOW.plusSeconds(3600))).isFalse();
        assertThat(TaskService.isPush(NOW, NOW.minusSeconds(86400))).isFalse();
        assertThat(TaskService.isPush(null, NOW)).isFalse();
        assertThat(TaskService.isPush(NOW, null)).isFalse();
    }

    /**
     * HOS-1: tasks.due_at is a TIMESTAMP (1970-01-01..2038-01-19 UTC). A date
     * outside it reached the database and came back as a misleading 409; refuse
     * it at the boundary with a plain 400 instead.
     */
    @Test
    void aDueDateOutsideTheStorableWindowIsRefused() {
        for (String bad : new String[] {"1969-12-31T23:00:00Z", "1900-01-01T00:00:00Z",
                "2038-06-01T00:00:00Z", "2100-12-31T00:00:00Z", "9999-12-31T00:00:00Z"}) {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> TaskService.checkDueAt(Instant.parse(bad)))
                    .isInstanceOf(com.growthbuddy.common.ApiException.class)
                    .hasMessageContaining("2037");
        }
        TaskService.checkDueAt(null);
        TaskService.checkDueAt(Instant.parse("1970-01-02T00:00:00Z"));
        TaskService.checkDueAt(Instant.parse("2037-12-31T23:59:59Z"));
    }
}
