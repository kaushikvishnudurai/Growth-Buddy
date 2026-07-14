package com.growthbuddy.user;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface PasswordCredentialRepository extends JpaRepository<PasswordCredential, UUID> {
}

interface SessionRepository extends JpaRepository<Session, UUID> {

    java.util.Optional<Session> findByTokenHash(String tokenHash);

    List<Session> findByUserIdOrderByLastUsedAtDesc(UUID userId);

    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.userId = :userId and s.revokedAt is null")
    void revokeAllForUser(@Param("userId") UUID userId, @Param("now") java.time.Instant now);
}

interface EmailVerificationTokenRepository extends JpaRepository<EmailVerificationToken, String> {

    List<EmailVerificationToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    @Modifying
    @Query("delete from EmailVerificationToken t where t.userId = :userId")
    void deleteAllForUser(@Param("userId") UUID userId);
}

interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, String> {

    List<PasswordResetToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    @Modifying
    @Query("delete from PasswordResetToken t where t.userId = :userId")
    void deleteAllForUser(@Param("userId") UUID userId);
}

interface WhatsAppOtpTokenRepository extends JpaRepository<WhatsAppOtpToken, String> {

    List<WhatsAppOtpToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    @Modifying
    @Query("delete from WhatsAppOtpToken t where t.userId = :userId")
    void deleteAllForUser(@Param("userId") UUID userId);
}
