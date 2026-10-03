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

    /**
     * Bit (d - 1) set for every subscription due on day d — what lets
     * SubscriptionDueScheduler ask the database who could be due today instead of
     * parsing every WhatsApp user's document each tick. Derived on every write, so
     * no save path can forget it. NULL only on rows written before the column
     * existed; the scheduler includes those and fills them in.
     */
    @Column(name = "sub_due_days")
    private Integer subDueDays;

    @PrePersist
    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
        subDueDays = SubscriptionDueScheduler.dueDayMask(data);
    }
}
