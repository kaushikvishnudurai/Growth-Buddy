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
 * One-time code sent to a WhatsApp number to verify ownership before saving it.
 * Only the bcrypt hash is stored — the plain code is never persisted.
 */
@Entity
@Table(name = "whatsapp_otp_tokens")
@Getter
@Setter
@NoArgsConstructor
public class WhatsAppOtpToken {

    @Id
    @Column(name = "token_hash", length = 255)
    private String tokenHash;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** The E.164 phone number this OTP was issued for. */
    @Column(name = "phone", nullable = false, length = 20)
    private String phone;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;
}
