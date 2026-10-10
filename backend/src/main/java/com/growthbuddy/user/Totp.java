package com.growthbuddy.user;

import java.io.ByteArrayOutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * RFC 6238 time-based one-time passwords (HMAC-SHA1, 30-second step, 6 digits —
 * what every authenticator app defaults to), plus the RFC 4648 base32 the
 * secret travels in. Pure functions, no state: {@code TotpServiceTest} holds
 * them to the RFC's own test vectors.
 *
 * <p>Hand-rolled on purpose: it is ~60 lines of javax.crypto, and a dependency
 * for it would be the largest thing it does.
 */
final class Totp {

    static final int STEP_SECONDS = 30;
    static final int DIGITS = 6;
    /** Steps either side of now that still count: absorbs a phone clock ±30s off. */
    static final int WINDOW = 1;

    private static final String B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final int[] POW10 = {1, 10, 100, 1_000, 10_000, 100_000, 1_000_000,
        10_000_000, 100_000_000};

    private Totp() {
    }

    /** 160 random bits — the RFC 4226 recommended length for SHA-1 — as base32. */
    static String newSecret(SecureRandom rng) {
        byte[] key = new byte[20];
        rng.nextBytes(key);
        return base32Encode(key);
    }

    static long stepAt(long epochSeconds) {
        return Math.floorDiv(epochSeconds, STEP_SECONDS);
    }

    /** RFC 4226 HOTP over the step counter, truncated to {@code digits}. */
    static String code(byte[] key, long step, int digits) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] msg = new byte[8];
            for (int i = 7; i >= 0; i--) {
                msg[i] = (byte) (step & 0xff);
                step >>>= 8;
            }
            byte[] hash = mac.doFinal(msg);
            int offset = hash[hash.length - 1] & 0x0f;
            int binary = ((hash[offset] & 0x7f) << 24)
                    | ((hash[offset + 1] & 0xff) << 16)
                    | ((hash[offset + 2] & 0xff) << 8)
                    | (hash[offset + 3] & 0xff);
            String s = Integer.toString(binary % POW10[digits]);
            return "0".repeat(digits - s.length()) + s;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA1 unavailable", e);
        }
    }

    /**
     * The step {@code code} matches within ±{@link #WINDOW} of {@code nowStep},
     * or -1. The caller rejects a step it has already accepted (replay).
     * Compared in constant time so the response time says nothing about digits.
     */
    static long matchingStep(byte[] key, String code, long nowStep) {
        if (code == null || code.length() != DIGITS) {
            return -1;
        }
        byte[] typed = code.getBytes(StandardCharsets.US_ASCII);
        long found = -1;
        for (int d = -WINDOW; d <= WINDOW; d++) {
            byte[] want = code(key, nowStep + d, DIGITS).getBytes(StandardCharsets.US_ASCII);
            if (MessageDigest.isEqual(want, typed) && found < 0) {
                found = nowStep + d;
            }
        }
        return found;
    }

    /** The otpauth:// URI authenticator apps import (Google's Key Uri Format). */
    static String otpauthUri(String issuer, String account, String secretB32) {
        String label = enc(issuer) + ":" + enc(account);
        return "otpauth://totp/" + label + "?secret=" + secretB32 + "&issuer=" + enc(issuer)
                + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + STEP_SECONDS;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    static String base32Encode(byte[] data) {
        StringBuilder out = new StringBuilder((data.length * 8 + 4) / 5);
        int buffer = 0;
        int bits = 0;
        for (byte b : data) {
            buffer = (buffer << 8) | (b & 0xff);
            bits += 8;
            while (bits >= 5) {
                out.append(B32.charAt((buffer >> (bits - 5)) & 31));
                bits -= 5;
            }
        }
        if (bits > 0) {
            out.append(B32.charAt((buffer << (5 - bits)) & 31));
        }
        return out.toString();
    }

    /** Tolerates lowercase, spaces and '=' padding — people type these by hand. */
    static byte[] base32Decode(String s) {
        String clean = s.replace(" ", "").replace("=", "").toUpperCase(Locale.ROOT);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int buffer = 0;
        int bits = 0;
        for (char c : clean.toCharArray()) {
            int v = B32.indexOf(c);
            if (v < 0) {
                throw new IllegalArgumentException("Not base32: " + c);
            }
            buffer = (buffer << 5) | v;
            bits += 5;
            if (bits >= 8) {
                out.write((buffer >> (bits - 8)) & 0xff);
                bits -= 8;
            }
        }
        return out.toByteArray();
    }
}
