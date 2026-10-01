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
 * client-side. The part that grows without bound — expenses, income, transfers —
 * already moved out to money_transactions (see MoneyLedger), because re-sending
 * years of history on every edit is what stopped scaling. What is left is small:
 * budgets, goals, subscriptions, settings.
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
