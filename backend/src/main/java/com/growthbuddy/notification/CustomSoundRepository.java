package com.growthbuddy.notification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface CustomSoundRepository extends JpaRepository<CustomSound, UUID> {

    Optional<CustomSound> findByUserId(UUID userId);

    void deleteByUserId(UUID userId);
}
