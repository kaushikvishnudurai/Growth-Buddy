package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * The lockout is the only thing standing between a leaked email address and an
 * unlimited number of password guesses, so the three ways it could quietly stop
 * working each get a line here: letting the 6th guess through, never escalating,
 * and never letting the real owner back in.
 *
 * <p>Driven through {@link FakeThrottleStore}: the counters live in the database
 * now, and the policy these tests pin down is the same either way.
 */
class LoginAttemptGuardTest {

    @Test
    void fiveGuessesAreFreeAndTheSixthLocks() {
        LoginAttemptGuard guard = new LoginAttemptGuard(new FakeThrottleStore());
        for (int i = 0; i < 5; i++) {
            guard.check("login:ada@example.com");   // must not throw
            guard.recordFailure("login:ada@example.com");
        }
        assertEquals(0, guard.retryAfterMs("login:ada@example.com"), "5 typos are forgiven");

        guard.recordFailure("login:ada@example.com");
        ApiException locked = assertThrows(ApiException.class, () -> guard.check("login:ada@example.com"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, locked.getStatus());
        assertTrue(guard.retryAfterMs("login:ada@example.com") > 55_000L, "6th failure locks for a minute");
    }

    @Test
    void eachFurtherGuessDoublesTheWait() {
        LoginAttemptGuard guard = new LoginAttemptGuard(new FakeThrottleStore());
        for (int i = 0; i < 6; i++) guard.recordFailure("login:ada@example.com");
        long first = guard.retryAfterMs("login:ada@example.com");
        guard.recordFailure("login:ada@example.com");
        long second = guard.retryAfterMs("login:ada@example.com");
        assertTrue(second > first * 1.8, "backoff escalates: " + first + " then " + second);

        // …but never past the cap, or a stranger could lock an account forever.
        for (int i = 0; i < 30; i++) guard.recordFailure("login:ada@example.com");
        assertTrue(guard.retryAfterMs("login:ada@example.com") <= 60 * 60_000L, "capped at an hour");
    }

    @Test
    void gettingItRightClearsTheCount() {
        LoginAttemptGuard guard = new LoginAttemptGuard(new FakeThrottleStore());
        for (int i = 0; i < 5; i++) guard.recordFailure("login:ada@example.com");
        guard.recordSuccess("login:ada@example.com");
        for (int i = 0; i < 5; i++) {
            guard.check("login:ada@example.com");
            guard.recordFailure("login:ada@example.com");
        }
        assertEquals(0, guard.retryAfterMs("login:ada@example.com"), "the counter restarted");
    }

    @Test
    void oneAccountsLockoutDoesNotTouchAnother() {
        LoginAttemptGuard guard = new LoginAttemptGuard(new FakeThrottleStore());
        for (int i = 0; i < 10; i++) guard.recordFailure("login:ada@example.com");
        guard.check("login:grace@example.com");   // must not throw
        assertEquals(0, guard.retryAfterMs("login:grace@example.com"));
    }
}
