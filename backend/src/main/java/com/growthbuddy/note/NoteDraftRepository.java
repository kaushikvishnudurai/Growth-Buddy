package com.growthbuddy.note;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NoteDraftRepository extends JpaRepository<NoteDraft, UUID> {
}
