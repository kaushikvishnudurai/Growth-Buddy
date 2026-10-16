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

    /**
     * One column, and only while the session is live. A save() of the session
     * read at request start wrote every column back, so a request racing a
     * revoke could put revoked_at back to NULL and un-revoke a stolen token.
     */
    @Modifying
    @org.springframework.transaction.annotation.Transactional
    @Query("update Session s set s.lastUsedAt = :now where s.id = :id and s.revokedAt is null")
    int touchLastUsed(@Param("id") UUID id, @Param("now") java.time.Instant now);

    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.userId = :userId and s.revokedAt is null")
    void revokeAllForUser(@Param("userId") UUID userId, @Param("now") java.time.Instant now);

    @Modifying
    @Query("update Session s set s.revokedAt = :now where s.userId = :userId and s.id <> :keep and s.revokedAt is null")
    void revokeOthersForUser(@Param("userId") UUID userId, @Param("keep") UUID keep, @Param("now") java.time.Instant now);
}

interface EmailVerificationTokenRepository extends JpaRepository<EmailVerificationToken, String> {

    List<EmailVerificationToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    List<EmailVerificationToken> findByUserId(UUID userId);

    /**
     * A plain read, then a delete by primary key. Not {@code delete ... where
     * user_id = ?}: on MySQL's REPEATABLE READ that statement takes a gap lock on
     * ix_*_user even when nothing matches (every new signup), two concurrent
     * signups whose UUIDs share a gap each hold one, and each one's following
     * INSERT waits on the other's: a deadlock (CRB-1). A plain SELECT locks
     * nothing; an empty list deletes nothing and locks nothing.
     */
    default void deleteAllForUser(UUID userId) {
        deleteAllInBatch(findByUserId(userId));
    }
}

interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, String> {

    List<PasswordResetToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    List<PasswordResetToken> findByUserId(UUID userId);

    /** See {@link EmailVerificationTokenRepository#deleteAllForUser}. */
    default void deleteAllForUser(UUID userId) {
        deleteAllInBatch(findByUserId(userId));
    }
}

interface EmailChangeTokenRepository extends JpaRepository<EmailChangeToken, String> {

    List<EmailChangeToken> findByUserIdAndConsumedAtIsNull(UUID userId);

    List<EmailChangeToken> findByUserId(UUID userId);

    /** See {@link EmailVerificationTokenRepository#deleteAllForUser}. */
    default void deleteAllForUser(UUID userId) {
        deleteAllInBatch(findByUserId(userId));
    }
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

    List<WhatsAppOtpToken> findByUserId(UUID userId);

    /** See {@link EmailVerificationTokenRepository#deleteAllForUser}. */
    default void deleteAllForUser(UUID userId) {
        deleteAllInBatch(findByUserId(userId));
    }
}
