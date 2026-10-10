package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authenticator-app second factor: setup, enable, disable, and the check that
 * sign-in runs. {@link Totp} is the math; this is the storage around it.
 *
 * <p><b>The secret is encrypted at rest</b> with AES-256-GCM under a key derived
 * from {@code growthbuddy.session.hmac-secret} — so a database dump alone yields
 * no usable secrets. Consequence: rotating that env var invalidates every
 * enrolled authenticator (sessions too, which already happens). ponytail: a
 * dedicated TOTP key env var is the upgrade if the two ever need to rotate apart.
 *
 * <p>Recovery codes: 8, shown once at enable time, stored as bcrypt hashes;
 * {@link #accept} removes the one used.
 */
@Service
public class TotpService {

    static final int RECOVERY_CODES = 8;
    private static final String ISSUER = "Growth Buddy";
    private static final String RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

    private final UserTotpRepository repo;
    private final SecretKeySpec aesKey;
    private final SecureRandom rng = new SecureRandom();
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

    public TotpService(UserTotpRepository repo,
                       @Value("${growthbuddy.session.hmac-secret}") String serverSecret) {
        this.repo = repo;
        this.aesKey = deriveKey(serverSecret);
    }

    public record Setup(String secret, String otpauthUri) {}

    /** True when sign-in must ask for a second factor. */
    public boolean isEnabled(UUID userId) {
        return repo.existsByUserIdAndEnabledAtIsNotNull(userId);
    }

    public int recoveryCodesLeft(UUID userId) {
        return repo.findById(userId)
                .filter(t -> t.getEnabledAt() != null)
                .map(t -> t.getRecoveryCodes() == null ? 0 : t.getRecoveryCodes().size())
                .orElse(0);
    }

    /**
     * Start (or restart) setup: a fresh secret, stored pending. The only time
     * the secret ever leaves the server; refused once 2FA is on.
     */
    public Setup beginSetup(UUID userId, String email) {
        UserTotp row = repo.findById(userId).orElseGet(() -> {
            UserTotp t = new UserTotp();
            t.setUserId(userId);
            return t;
        });
        if (row.getEnabledAt() != null) {
            throw ApiException.badRequest("Two-step sign-in is already on. Turn it off first to set up a new app.");
        }
        String secret = Totp.newSecret(rng);
        row.setSecretEnc(encrypt(secret));
        row.setLastUsedStep(null);
        row.setRecoveryCodes(new ArrayList<>());
        repo.save(row);
        return new Setup(secret, Totp.otpauthUri(ISSUER, email, secret));
    }

    /**
     * Finish setup with the app's first code. Returns the recovery codes in
     * plain text — the only time they exist outside a bcrypt hash.
     */
    @Transactional
    public List<String> enable(UUID userId, String code) {
        UserTotp row = repo.lockById(userId)
                .orElseThrow(() -> ApiException.badRequest("Start setup first."));
        if (row.getEnabledAt() != null) {
            throw ApiException.badRequest("Two-step sign-in is already on.");
        }
        long step = Totp.matchingStep(key(row), digitsOnly(code), Totp.stepAt(Instant.now().getEpochSecond()));
        if (step < 0) {
            return null; // caller turns this into a guarded refusal
        }
        List<String> plain = newRecoveryCodes();
        List<String> hashes = new ArrayList<>();
        for (String c : plain) {
            hashes.add(bcrypt.encode(normalizeRecovery(c)));
        }
        row.setRecoveryCodes(hashes);
        row.setLastUsedStep(step);
        row.setEnabledAt(Instant.now());
        repo.save(row);
        return plain;
    }

    /**
     * Check a sign-in / disable code against an ENABLED factor and persist what
     * it used up. Under the row lock, so two concurrent sign-ins can't both
     * spend one code; joins the caller's transaction, holding the lock to its end.
     */
    @Transactional
    public boolean verify(UUID userId, String code) {
        Optional<UserTotp> row = repo.lockById(userId).filter(t -> t.getEnabledAt() != null);
        if (row.isEmpty()) {
            return false;
        }
        boolean ok = accept(row.get(), code, Totp.stepAt(Instant.now().getEpochSecond()));
        if (ok) {
            repo.save(row.get());
        }
        return ok;
    }

    public void disable(UUID userId) {
        repo.deleteById(userId);
    }

    /**
     * The decision itself, with no repository: a 6-digit code is a TOTP that
     * must be newer than the last one accepted; anything else is tried as a
     * recovery code, which is removed from the row when it matches. Mutates
     * {@code row} on success only.
     */
    boolean accept(UserTotp row, String code, long nowStep) {
        if (code == null || code.isBlank()) {
            return false;
        }
        String digits = digitsOnly(code);
        if (digits.length() == Totp.DIGITS && digits.length() == code.replaceAll("[\\s-]", "").length()) {
            long step = Totp.matchingStep(key(row), digits, nowStep);
            if (step < 0 || (row.getLastUsedStep() != null && step <= row.getLastUsedStep())) {
                return false;
            }
            row.setLastUsedStep(step);
            return true;
        }
        String typed = normalizeRecovery(code);
        List<String> hashes = row.getRecoveryCodes() == null ? List.of() : row.getRecoveryCodes();
        for (int i = 0; i < hashes.size(); i++) {
            if (bcrypt.matches(typed, hashes.get(i))) {
                List<String> left = new ArrayList<>(hashes);
                left.remove(i);
                row.setRecoveryCodes(left);
                return true;
            }
        }
        return false;
    }

    /** "k3m9p-x2qrt": 10 characters from an alphabet with no 0/o/1/l/i. */
    List<String> newRecoveryCodes() {
        List<String> out = new ArrayList<>();
        for (int n = 0; n < RECOVERY_CODES; n++) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) {
                if (i == 5) sb.append('-');
                sb.append(RECOVERY_ALPHABET.charAt(rng.nextInt(RECOVERY_ALPHABET.length())));
            }
            out.add(sb.toString());
        }
        return out;
    }

    /** Hashed and compared without case, spaces or the hyphen. */
    static String normalizeRecovery(String code) {
        return code == null ? "" : code.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static String digitsOnly(String code) {
        return code == null ? "" : code.replaceAll("\\D", "");
    }

    private byte[] key(UserTotp row) {
        return Totp.base32Decode(decrypt(row.getSecretEnc()));
    }

    /* ---- AES-GCM at rest ---- */

    private static SecretKeySpec deriveKey(String serverSecret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(serverSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] k = mac.doFinal("growthbuddy-totp-secret-v1".getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(k, "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot derive the TOTP key", e);
        }
    }

    String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            rng.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, aesKey, new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return "v1:" + Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Cannot encrypt the TOTP secret", e);
        }
    }

    String decrypt(String stored) {
        try {
            byte[] all = Base64.getDecoder().decode(stored.substring(3));
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, aesKey, new GCMParameterSpec(128, all, 0, 12));
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | RuntimeException e) {
            throw new IllegalStateException("Cannot decrypt the TOTP secret (was SESSION_HMAC_SECRET rotated?)", e);
        }
    }
}
