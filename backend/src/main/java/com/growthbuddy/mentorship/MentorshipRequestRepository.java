package com.growthbuddy.mentorship;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MentorshipRequestRepository extends JpaRepository<MentorshipRequest, UUID> {

    Optional<MentorshipRequest> findFirstByFromUserIdAndToUserIdAndDirectionAndStatus(
            UUID fromUserId, UUID toUserId, MentorshipRequest.Direction direction,
            MentorshipRequest.Status status);

    List<MentorshipRequest> findByToUserIdOrderByCreatedAtDesc(UUID toUserId);

    List<MentorshipRequest> findByFromUserIdOrderByCreatedAtDesc(UUID fromUserId);

    /**
     * Every request between two users (either direction). Tiny result set, so
     * callers reduce to the "best" status in code.
     */
    @org.springframework.data.jpa.repository.Query(
            "select r from MentorshipRequest r where "
                    + "(r.fromUserId = :a and r.toUserId = :b) or "
                    + "(r.fromUserId = :b and r.toUserId = :a)")
    List<MentorshipRequest> findAllBetween(
            @org.springframework.data.repository.query.Param("a") UUID userA,
            @org.springframework.data.repository.query.Param("b") UUID userB);

    /**
     * {@link #findAllBetween} as a locking read, in id order. A locking read sees
     * the latest committed rows (a plain read after a lock can still be the
     * transaction's older snapshot on TiDB), so create / respond / revoke decide on this.
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query(
            "select r from MentorshipRequest r where "
                    + "(r.fromUserId = :a and r.toUserId = :b) or "
                    + "(r.fromUserId = :b and r.toUserId = :a) order by r.id")
    List<MentorshipRequest> lockAllBetween(
            @org.springframework.data.repository.query.Param("a") UUID userA,
            @org.springframework.data.repository.query.Param("b") UUID userB);

    /** Who a request is between, without loading (and caching a stale copy of) the row. */
    Optional<Pair> findPairById(UUID id);

    interface Pair {
        UUID getFromUserId();

        UUID getToUserId();
    }
}
