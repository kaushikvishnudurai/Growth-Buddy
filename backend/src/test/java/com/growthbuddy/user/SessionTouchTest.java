package com.growthbuddy.user;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ClientIp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * resolve() refreshes lastUsedAt with a one-column update guarded on
 * revoked_at IS NULL, never a save() of the session it read: that wrote every
 * column back, so a request racing a revoke could un-revoke a stolen token.
 */
class SessionTouchTest {

    private final SessionRepository sessions = mock(SessionRepository.class);
    private final SessionService service = new SessionService(sessions,
            "Ux7t2N4pQrS9vWzA1bC3dE5fG6hJ8kL0mN2pQ4rS6tU8", "", new ClientIp(false, 1));

    @Test
    void aStaleLastUsedIsTouchedNotSaved() {
        UUID user = UUID.randomUUID();
        String token = service.issue(user, null).token();
        Session s = new Session();
        s.setId(UUID.randomUUID());
        s.setUserId(user);
        s.setExpiresAt(Instant.now().plus(1, ChronoUnit.DAYS));
        s.setLastUsedAt(Instant.now().minus(1, ChronoUnit.HOURS));
        when(sessions.findByTokenHash(anyString())).thenReturn(Optional.of(s));

        org.assertj.core.api.Assertions.assertThat(service.resolve(token)).contains(user);

        verify(sessions).touchLastUsed(eq(s.getId()), any(Instant.class));
        verify(sessions, never()).save(s);
    }
}
