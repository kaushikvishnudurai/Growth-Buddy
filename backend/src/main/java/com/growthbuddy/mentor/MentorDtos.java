package com.growthbuddy.mentor;

import jakarta.validation.constraints.Size;
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

/**
 * Payloads for the mentor chat.
 *
 * <p>These carried no bounds at all, alone among the write DTOs in this app. A
 * title past the column's 255 reached the insert and came back a 500 — the
 * message was "Something went wrong", which is all a user ever saw. Bounds here,
 * at the boundary, the way every other request in the codebase does it.
 */
record CreateThreadRequest(@Size(max = 200) String title) {
}

/**
 * {@code content} is MEDIUMTEXT, so nothing overflows — but it is also the
 * prompt, and an unbounded prompt is an unbounded bill. 4000 characters is far
 * more than anyone types at a mentor and still a ceiling.
 */
record PostMessageRequest(@Size(max = 4000) String content) {
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
