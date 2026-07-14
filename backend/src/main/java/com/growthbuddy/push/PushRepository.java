package com.growthbuddy.push;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface PushRepository extends JpaRepository<PushSubscription, UUID> {
    List<PushSubscription> findByUserId(UUID userId);

    Optional<PushSubscription> findByEndpoint(String endpoint);
}
