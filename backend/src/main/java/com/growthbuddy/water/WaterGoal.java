package com.growthbuddy.water;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "water_goals")
@Getter
@Setter
@NoArgsConstructor
public class WaterGoal {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "goal_ml", nullable = false)
    private int goalMl;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void prePersist() {
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }
}
