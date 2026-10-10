package com.growthbuddy.mentorship;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MentorshipMessageRepository extends JpaRepository<MentorshipMessage, UUID> {

    List<MentorshipMessage> findByLinkIdOrderByCreatedAtDesc(UUID linkId, Pageable page);

    List<MentorshipMessage> findByLinkIdAndCreatedAtBeforeOrderByCreatedAtDesc(
            UUID linkId, Instant before, Pageable page);

    /** The nudge cap: how many cheers/nudges this sender put on this link since {@code since}. */
    long countByLinkIdAndSenderIdAndKindInAndCreatedAtGreaterThanEqual(
            UUID linkId, UUID senderId, Collection<String> kinds, Instant since);
}
