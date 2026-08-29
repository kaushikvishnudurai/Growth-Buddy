package com.growthbuddy.user;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * A weak signing key lets anyone forge a session token for any account, and every
 * way it can be weak looks like a working config from the outside.
 */
class SessionSecretTest {

    @Test
    void acceptsALongPrivateSecret() {
        assertDoesNotThrow(() ->
                SessionService.rejectWeakSecret("Ux7t2N4pQrS9vWzA1bC3dE5fG6hJ8kL0mN2pQ4rS6tU8"));
    }

    /** An unset env var arrives as this literal, not as a startup failure. */
    @Test
    void rejectsAnUnresolvedPlaceholder() {
        var ex = assertThrows(IllegalStateException.class,
                () -> SessionService.rejectWeakSecret("${SESSION_HMAC_SECRET}"));
        assertTrue(ex.getMessage().contains("not set"), ex.getMessage());
    }

    @Test
    void rejectsTheDevDefault() {
        assertThrows(IllegalStateException.class, () ->
                SessionService.rejectWeakSecret("growth-buddy-dev-hmac-secret-replace-in-production"));
    }

    @Test
    void rejectsEmptyAndShortSecrets() {
        assertThrows(IllegalStateException.class, () -> SessionService.rejectWeakSecret(""));
        assertThrows(IllegalStateException.class, () -> SessionService.rejectWeakSecret(null));
        assertThrows(IllegalStateException.class, () -> SessionService.rejectWeakSecret("short-key-123"));
    }
}
