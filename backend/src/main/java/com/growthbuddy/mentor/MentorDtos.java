package com.growthbuddy.mentor;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface MentorThreadRepository extends JpaRepository<MentorThread, UUID> {
    List<MentorThread> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Optional<MentorThread> findByIdAndUserId(UUID id, UUID userId);
}

interface MentorMessageRepository extends JpaRepository<MentorMessage, UUID> {
    List<MentorMessage> findByThreadIdOrderByCreatedAtAsc(UUID threadId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from MentorMessage m where m.threadId = :threadId")
    int deleteAllByThreadId(@Param("threadId") UUID threadId);
}

/** Payloads for the mentor chat. */
record CreateThreadRequest(String title) {
}

record PostMessageRequest(String content) {
}

record MessageResponse(UUID id, MessageRole role, String content, Instant createdAt) {
    static MessageResponse from(MentorMessage m) {
        return new MessageResponse(m.getId(), m.getRole(), m.getContent(), m.getCreatedAt());
    }
}

record ThreadResponse(UUID id, String title, Instant createdAt) {
    static ThreadResponse from(MentorThread t) {
        return new ThreadResponse(t.getId(), t.getTitle(), t.getCreatedAt());
    }
}

/** Returned after posting: the saved user message plus the assistant reply. */
record ReplyResponse(MessageResponse userMessage, MessageResponse assistantMessage) {
}
