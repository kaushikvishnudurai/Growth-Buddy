package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * The TOTP math against the RFCs' own published vectors, and the rules sign-in
 * leans on: a code works once, the window is ±1 step and no wider, a recovery
 * code is spent when used, and the stored secret is not the secret.
 */
class TotpServiceTest {

    /** RFC 6238 Appendix B's SHA-1 seed: the ASCII bytes "12345678901234567890". */
    private static final byte[] RFC_KEY = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);

    private final TotpService service = new TotpService(mock(UserTotpRepository.class),
            "test-secret-that-is-long-enough-for-the-key-derivation");

    @Test
    void matchesRfc6238Sha1Vectors() {
        // Appendix B, SHA1 column, 8 digits, X = 30.
        long[][] vectors = {
            {59L, 94287082L},
            {1111111109L, 7081804L},
            {1111111111L, 14050471L},
            {1234567890L, 89005924L},
            {2000000000L, 69279037L},
            {20000000000L, 65353130L},
        };
        for (long[] v : vectors) {
            String expected = String.format("%08d", v[1]);
            assertThat(Totp.code(RFC_KEY, Totp.stepAt(v[0]), 8)).as("T=" + v[0]).isEqualTo(expected);
        }
    }

    @Test
    void matchesRfc4226HotpVectors() {
        // Appendix D: the same seed, counters 0..9, 6 digits.
        String[] expected = {"755224", "287082", "359152", "969429", "338314",
            "254676", "287922", "162583", "399871", "520489"};
        for (int c = 0; c < expected.length; c++) {
            assertThat(Totp.code(RFC_KEY, c, 6)).as("counter " + c).isEqualTo(expected[c]);
        }
    }

    @Test
    void base32RoundTripsAndMatchesTheKnownEncoding() {
        assertThat(Totp.base32Encode(RFC_KEY)).isEqualTo("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
        assertThat(Totp.base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).isEqualTo(RFC_KEY);
    }

    @Test
    void acceptsOneStepEitherSideAndNoFurther() {
        long now = Totp.stepAt(1_700_000_000L);
        for (int d = -1; d <= 1; d++) {
            assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, now + d, 6), now)).isEqualTo(now + d);
        }
        assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, now + 2, 6), now)).isEqualTo(-1);
        assertThat(Totp.matchingStep(RFC_KEY, Totp.code(RFC_KEY, now - 2, 6), now)).isEqualTo(-1);
        assertThat(Totp.matchingStep(RFC_KEY, "12345", now)).isEqualTo(-1);
    }

    @Test
    void aCodeCannotBeReplayed() {
        UserTotp row = enrolled(new ArrayList<>());
        long now = Totp.stepAt(1_700_000_000L);
        String code = Totp.code(RFC_KEY, now, 6);
        assertThat(service.accept(row, code, now)).isTrue();
        assertThat(service.accept(row, code, now)).as("same code, same window").isFalse();
        // An older step inside the window is a replay too, once a newer one was used.
        assertThat(service.accept(row, Totp.code(RFC_KEY, now - 1, 6), now)).isFalse();
        assertThat(service.accept(row, Totp.code(RFC_KEY, now + 1, 6), now)).isTrue();
    }

    @Test
    void aRecoveryCodeWorksOnceAndOnlyItIsSpent() {
        List<String> plain = service.newRecoveryCodes();
        assertThat(plain).hasSize(TotpService.RECOVERY_CODES).doesNotHaveDuplicates();
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(4);
        List<String> hashes = new ArrayList<>();
        for (String c : plain) {
            hashes.add(bcrypt.encode(TotpService.normalizeRecovery(c)));
        }
        UserTotp row = enrolled(hashes);
        long now = Totp.stepAt(1_700_000_000L);

        // Typed loosely: upper case, no hyphen.
        String typed = plain.get(3).toUpperCase().replace("-", "");
        assertThat(service.accept(row, typed, now)).isTrue();
        assertThat(row.getRecoveryCodes()).hasSize(TotpService.RECOVERY_CODES - 1);
        assertThat(service.accept(row, plain.get(3), now)).as("spent").isFalse();
        assertThat(service.accept(row, plain.get(0), now)).as("the others still work").isTrue();
        assertThat(row.getRecoveryCodes()).hasSize(TotpService.RECOVERY_CODES - 2);
        assertThat(service.accept(row, "nope-nope1", now)).isFalse();
        assertThat(service.accept(row, "", now)).isFalse();
    }

    @Test
    void theStoredSecretIsCiphertext() {
        String secret = Totp.base32Encode(RFC_KEY);
        String stored = service.encrypt(secret);
        assertThat(stored).doesNotContain(secret).startsWith("v1:");
        assertThat(service.decrypt(stored)).isEqualTo(secret);
        assertThat(service.encrypt(secret)).as("fresh IV each time").isNotEqualTo(stored);
    }

    @Test
    void otpauthUriCarriesWhatAppsRead() {
        String uri = Totp.otpauthUri("Growth Buddy", "ada@example.com", "ABC");
        assertThat(uri).startsWith("otpauth://totp/Growth%20Buddy:ada%40example.com?secret=ABC")
                .contains("issuer=Growth%20Buddy").contains("digits=6").contains("period=30");
    }

    /* Two concurrent sign-ins must not both spend one code: the replay guard is
       read-check-save, so verify and enable read the row under SELECT ... FOR
       UPDATE, inside a transaction that holds it until the save. And isEnabled
       must not load the entity first, or the lock query would return that
       already-managed, stale instance. */
    @Test
    void theReplayGuardReadsUnderARowLock() throws Exception {
        UserTotpRepository repo = mock(UserTotpRepository.class);
        TotpService locked = new TotpService(repo, "test-secret-that-is-long-enough-for-the-key-derivation");
        java.util.UUID id = java.util.UUID.randomUUID();
        UserTotp pending = enrolled(new ArrayList<>());
        pending.setEnabledAt(null);
        org.mockito.Mockito.when(repo.lockById(id))
                .thenReturn(java.util.Optional.of(enrolled(new ArrayList<>())), java.util.Optional.of(pending));
        org.mockito.Mockito.when(repo.existsByUserIdAndEnabledAtIsNotNull(id)).thenReturn(true);

        assertThat(locked.isEnabled(id)).isTrue();
        assertThat(locked.verify(id, "not-a-code")).isFalse();
        assertThat(locked.enable(id, "not-a-code")).isNull();
        org.mockito.Mockito.verify(repo, org.mockito.Mockito.times(2)).lockById(id);
        org.mockito.Mockito.verify(repo, org.mockito.Mockito.never()).findById(id);

        var lock = UserTotpRepository.class.getDeclaredMethod("lockById", java.util.UUID.class)
                .getAnnotation(org.springframework.data.jpa.repository.Lock.class);
        assertThat(lock.value()).isEqualTo(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);
        for (String m : new String[] {"verify", "enable"}) {
            assertThat(TotpService.class.getMethod(m, java.util.UUID.class, String.class)
                    .isAnnotationPresent(org.springframework.transaction.annotation.Transactional.class)).as(m).isTrue();
        }
    }

    private UserTotp enrolled(List<String> recoveryHashes) {
        UserTotp row = new UserTotp();
        row.setSecretEnc(service.encrypt(Totp.base32Encode(RFC_KEY)));
        row.setEnabledAt(java.time.Instant.now());
        row.setRecoveryCodes(recoveryHashes);
        return row;
    }
}
