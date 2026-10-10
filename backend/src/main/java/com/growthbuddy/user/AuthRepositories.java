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

    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.userId = :userId and s.id <> :keep and s.revokedAt is null")
    void revokeOthersForUser(@Param("userId") UUID userId, @Param("keep") UUID keep, @Param("now") java.time.Instant now);
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

interface EmailChangeTokenRepository extends JpaRepository<EmailChangeToken, String> {

    List<EmailChangeToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    @Modifying
    @Query("delete from EmailChangeToken t where t.userId = :userId")
    void deleteAllForUser(@Param("userId") UUID userId);
}

interface UserTotpRepository extends JpaRepository<UserTotp, UUID> {

    /**
     * The row, locked until the transaction ends (SELECT ... FOR UPDATE). The
     * replay guard (last_used_step, recovery codes) is read-check-save: without
     * the lock two concurrent sign-ins could both accept the same code.
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from UserTotp t where t.userId = :id")
    java.util.Optional<UserTotp> lockById(@Param("id") UUID id);

    /**
     * A scalar check, so it never puts the entity in the persistence context: a
     * later {@link #lockById} in the same transaction would otherwise hand back
     * that already-loaded, possibly stale, instance.
     */
    boolean existsByUserIdAndEnabledAtIsNotNull(UUID userId);
}

interface WhatsAppOtpTokenRepository extends JpaRepository<WhatsAppOtpToken, String> {

    List<WhatsAppOtpToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    @Modifying
    @Query("delete from WhatsAppOtpToken t where t.userId = :userId")
    void deleteAllForUser(@Param("userId") UUID userId);
}
