package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The user's whole Money Buddy state, stored as one JSON document.
 *
 * <p>ponytail: a per-user JSON blob, not normalized tables. The frontend saves
 * the entire money object through one setter and computes every insight
 * client-side, so there is no server-side query that would justify splitting
 * expenses/budgets/goals/etc. into separate tables. If money logic ever moves
 * server-side (e.g. shared analytics, cross-user reports), normalize then.
 */
@Entity
@Table(name = "money_state")
@Getter
@Setter
@NoArgsConstructor
public class MoneyState {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "data", columnDefinition = "json")
    private JsonNode data;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
