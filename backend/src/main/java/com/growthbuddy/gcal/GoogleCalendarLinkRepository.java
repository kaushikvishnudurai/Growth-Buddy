package com.growthbuddy.gcal;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GoogleCalendarLinkRepository extends JpaRepository<GoogleCalendarLink, UUID> {
}
