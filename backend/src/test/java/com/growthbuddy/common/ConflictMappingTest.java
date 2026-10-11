package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;

/** CRB-2: a unique-key race and a deadlock victim used to fall through to the generic 500. */
class ConflictMappingTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void duplicateKeyIs409() {
        assertThat(handler.handleConflict(new DataIntegrityViolationException("Duplicate entry")).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
        // What MySQL/TiDB actually raise under Hibernate: error 1062 in the cause chain.
        assertThat(handler.handleConflict(new DataIntegrityViolationException("could not execute statement",
                new SQLIntegrityConstraintViolationException("x for key 'uq'", "23000", 1062))).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    /**
     * HOS-1/HOS-10: a date outside TIMESTAMP's range or a too-long value is no
     * duplicate. Calling it "already saved" sent the user to refresh and retry a
     * save that could never succeed.
     */
    @Test
    void outOfRangeOrTooLongIs400NotAlreadySaved() {
        var truncation = handler.handleConflict(new DataIntegrityViolationException("could not execute statement",
                new SQLException("Data truncation: Incorrect datetime value", "22001", 1292)));
        assertThat(truncation.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(truncation.getBody().message()).doesNotContain("already saved");

        var notNull = handler.handleConflict(new DataIntegrityViolationException("could not execute statement",
                new SQLIntegrityConstraintViolationException("Column 'title' cannot be null", "23000", 1048)));
        assertThat(notNull.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void deadlockIs503() {
        assertThat(handler.handleLockFailure(new CannotAcquireLockException("Deadlock found")).getStatusCode())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }
}
