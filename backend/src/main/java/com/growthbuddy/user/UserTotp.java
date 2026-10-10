package com.growthbuddy.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One account's authenticator-app (TOTP) second factor. A row with
 * {@code enabledAt == null} is a setup in progress: the secret has been shown
 * once and is waiting for its first code.
 *
 * <ul>
 *   <li>{@code secretEnc} is AES-GCM ciphertext ({@link TotpService}), never the
 *       base32 secret itself, and no endpoint returns it once enabled.</li>
 *   <li>{@code recoveryCodes} holds bcrypt hashes of the unused one-time codes;
 *       using one removes it from the list.</li>
 *   <li>{@code lastUsedStep} is the 30-second step of the last accepted code, so
 *       the same code can't be replayed inside its window.</li>
 * </ul>
 */
@Entity
@Table(name = "user_totp")
@Getter
@Setter
@NoArgsConstructor
public class UserTotp {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "secret_enc", nullable = false, length = 255)
    private String secretEnc;

    @Column(name = "enabled_at")
    private Instant enabledAt;

    @Column(name = "last_used_step")
    private Long lastUsedStep;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recovery_codes", columnDefinition = "json")
    private List<String> recoveryCodes = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }
}
