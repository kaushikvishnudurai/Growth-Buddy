package com.growthbuddy.push;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface PushRepository extends JpaRepository<PushSubscription, UUID> {
    List<PushSubscription> findByUserId(UUID userId);

    /** First, not single: a database from before the unique key could hold two. */
    Optional<PushSubscription> findFirstByEndpointHash(String endpointHash);

    default Optional<PushSubscription> findByEndpoint(String endpoint) {
        return findFirstByEndpointHash(PushSubscription.hashOf(endpoint));
    }

    /**
     * Store or refresh a subscription in one statement, on the endpoint_hash
     * unique key. Read-then-insert let two subscribes at once store the same
     * endpoint twice: every push then went out twice, and the lookup by endpoint
     * threw on every later call. Keeps an existing row's id and created_at.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "INSERT INTO push_subscriptions (id, user_id, endpoint, endpoint_hash, p256dh, auth, created_at)"
            + " VALUES (:id, :userId, :endpoint, :hash, :p256dh, :auth, :now)"
            + " ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint),"
            + " p256dh = VALUES(p256dh), auth = VALUES(auth)", nativeQuery = true)
    int upsert(@Param("id") String id, @Param("userId") String userId, @Param("endpoint") String endpoint,
            @Param("hash") String hash, @Param("p256dh") String p256dh, @Param("auth") String auth,
            @Param("now") Instant now);
}
