package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

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
    }

    @Test
    void deadlockIs503() {
        assertThat(handler.handleLockFailure(new CannotAcquireLockException("Deadlock found")).getStatusCode())
                .isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }
}
