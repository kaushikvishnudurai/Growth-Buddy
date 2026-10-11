package com.growthbuddy.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByEmail(String email);

    /** Users who opted into a progress digest (frequency other than "off"). */
    List<User> findByDigestFrequencyNot(String frequency);

    Optional<User> findByEmailIgnoreCase(String email);

    /** Accounts whose deletion grace period has run out (AccountDeletionJob). */
    @Query("select u.id from User u where u.deletionRequestedAt is not null and u.deletionRequestedAt < :cutoff")
    List<UUID> findIdsDueForDeletion(@Param("cutoff") java.time.Instant cutoff);

    /**
     * {@code [id, uiPrefs]} for every account that has prefs at all — the
     * notification sweep's per-user retention (NotificationPrefs.keepReadDays).
     * ponytail: reads every blob nightly; JSON_EXTRACT on notifyKeepReadDays in
     * a native query is the upgrade once that gets heavy.
     */
    @Query("select u.id, u.uiPrefs from User u where u.uiPrefs is not null")
    List<Object[]> findIdsWithUiPrefs();

    /**
     * ui_prefs alone, as bulk SQL: it skips the DeliveryCache listener on purpose
     * (AuthService.updateUiPrefs bumps it itself when a scheduler-read key moved).
     * updated_at follows by its ON UPDATE. Clears the persistence context, so the
     * caller's loaded User is detached.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = "update users set ui_prefs = :prefs where id = :id", nativeQuery = true)
    int updateUiPrefs(@Param("id") String id, @Param("prefs") String prefsJson);

    /**
     * The digest claim: stamps today only if no run has yet, so exactly one
     * instance (or overlapping run) wins the send. One column, not a save of the
     * run-start snapshot, which reverted XP and settings written meanwhile (CRB-8).
     */
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.transaction.annotation.Transactional
    @Query("update User u set u.lastDigestOn = :day where u.id = :id "
            + "and (u.lastDigestOn is null or u.lastDigestOn <> :day)")
    int claimDigest(@Param("id") UUID id, @Param("day") java.time.LocalDate day);

    /** A failed send hands the claim back, so the next hourly tick retries. */
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.transaction.annotation.Transactional
    @Query("update User u set u.lastDigestOn = :previous where u.id = :id and u.lastDigestOn = :day")
    int releaseDigest(@Param("id") UUID id, @Param("day") java.time.LocalDate day,
                      @Param("previous") java.time.LocalDate previous);

    /** Everyone a bill-due WhatsApp may go to: only a number its owner proved by OTP. */

    /**
     * The accounts an inbound WhatsApp message may act for. Verified only — the
     * webhook trusts the sender's number, so an unproven one must match nobody.
     * A list: nothing makes a number unique across accounts. Stored E.164 with "+".
     */
    List<User> findByWhatsappNumberAndWhatsappEnabledTrueAndWhatsappVerifiedTrue(String whatsappNumber);

    /* Only VERIFIED accounts are discoverable. signup() writes a users row before
       the OTP is checked, so a typo'd or abandoned signup leaves a ghost account
       that can never log in — and inviting one produces an invite nobody can
       ever accept. Same reason browseExcluding and searchForFamily filter it. */
    /* Name only, never email: an email match - even an exact one - answers
       "does this address have an account?", which sign-in is careful never to
       do. Circle invites go by user id from a result row, so nothing needs it. */
    /* Nor an account scheduled for deletion (User.isPendingDeletion): for its
       7-day grace period it is gone to everyone else, so it is not found, not
       browsable and not invitable. All three discovery queries filter it. */
    @Query("select u from User u where lower(u.displayName) like lower(concat('%', :q, '%')) "
            + "and u.id <> :excludeId "
            + "and u.emailVerified = true "
            + "and u.deletionRequestedAt is null "
            + "order by u.displayName")
    List<User> search(@Param("q") String q, @Param("excludeId") UUID excludeId, Pageable pageable);

    @Query("select u from User u where u.id <> :excludeId and u.emailVerified = true "
            + "and u.deletionRequestedAt is null "
            + "order by u.createdAt desc")
    List<User> browseExcluding(@Param("excludeId") UUID excludeId, Pageable pageable);

    /**
     * Same signature as before the UUID migration: {@code q} is free text; when
     * it happens to be a well-formed UUID we also match on the id column.
     */
    default List<User> searchForFamily(String q, UUID excludeId, Pageable pageable) {
        UUID idMatch = null;
        try {
            idMatch = UUID.fromString(q);
        } catch (IllegalArgumentException ignored) {
            // q is a name fragment, not an id. Name or exact id only, as in search():
            // an email or phone match tells the caller that contact has an account.
        }
        return searchForFamily(q, idMatch, excludeId, pageable);
    }

    @Query("select u from User u where (u.id = :idMatch "
            + "or lower(u.displayName) like lower(concat('%', :q, '%'))) and u.id <> :excludeId "
            + "and u.emailVerified = true "
            + "and u.deletionRequestedAt is null "
            + "order by u.displayName")
    List<User> searchForFamily(@Param("q") String q, @Param("idMatch") UUID idMatch,
            @Param("excludeId") UUID excludeId, Pageable pageable);
}
