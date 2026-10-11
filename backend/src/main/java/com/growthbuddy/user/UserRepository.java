package com.growthbuddy.user;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import org.springframework.http.HttpStatus;
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
    /* q is matched LITERALLY (likeEscape): unescaped, "_" was a wildcard that
       matched every account. "!" is the escape character rather than "\\",
       which MySQL also reads as a string-literal escape. */
    default List<User> search(String q, UUID excludeId, Pageable pageable) {
        return searchByName(likeEscape(q), excludeId, pageable);
    }

    @Query("select u from User u where lower(u.displayName) like lower(concat('%', :q, '%')) escape '!' "
            + "and u.id <> :excludeId "
            + "and u.emailVerified = true "
            + "and u.deletionRequestedAt is null "
            + "order by u.displayName")
    List<User> searchByName(@Param("q") String q, @Param("excludeId") UUID excludeId, Pageable pageable);

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
        return searchForFamily(likeEscape(q), idMatch, excludeId, pageable);
    }

    @Query("select u from User u where (u.id = :idMatch "
            + "or lower(u.displayName) like lower(concat('%', :q, '%')) escape '!') and u.id <> :excludeId "
            + "and u.emailVerified = true "
            + "and u.deletionRequestedAt is null "
            + "order by u.displayName")
    List<User> searchForFamily(@Param("q") String q, @Param("idMatch") UUID idMatch,
            @Param("excludeId") UUID excludeId, Pageable pageable);

    /** {@code q} with LIKE's wildcards (and the escape character itself) made literal. */
    static String likeEscape(String q) {
        return q.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    /**
     * {@code alice@example.com} becomes {@code a•••e}: enough to tell two people
     * with one display name apart, and no domain, which with a short local part
     * gave most of the address away.
     */
    static String maskEmail(String email) {
        if (email == null) return null;
        int at = email.indexOf('@');
        String local = at >= 0 ? email.substring(0, at) : email;
        if (local.length() <= 1) return "\u2022\u2022\u2022";
        return local.charAt(0) + "\u2022\u2022\u2022" + local.charAt(local.length() - 1);
    }

    /** The people searches (Circle's /search and /browse, Family's) share one per-user budget. */
    int SEARCHES_PER_WINDOW = 60;
    long SEARCH_WINDOW_MS = 5 * 60_000L;

    static void throttleSearch(RateLimiter limiter, UUID userId) {
        if (!limiter.allow("user-search:" + userId, SEARCHES_PER_WINDOW, SEARCH_WINDOW_MS)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "That's a lot of searches. Try again in a few minutes.");
        }
    }
}
