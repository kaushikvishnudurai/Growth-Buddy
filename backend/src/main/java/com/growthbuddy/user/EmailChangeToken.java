package com.growthbuddy.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A pending email change: the code went to {@code newEmail}, and the account's
 * address only moves once that code comes back. Like every OTP table, only the
 * bcrypt hash of the code is stored.
 *
 * <p>Its own table rather than a row in {@code email_verification_tokens}: those
 * are consumed by {@code /api/auth/verify}, which hands out a session — a code
 * mailed to the NEW address must never work as a sign-in for the old one.
 */
@Entity
@Table(name = "email_change_tokens")
@Getter
@Setter
@NoArgsConstructor
public class EmailChangeToken {

    @Id
    @Column(name = "token_hash", length = 255)
    private String tokenHash;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "new_email", nullable = false, length = 254)
    private String newEmail;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;
}
