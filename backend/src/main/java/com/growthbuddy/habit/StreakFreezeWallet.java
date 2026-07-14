package com.growthbuddy.habit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A user's freeze-token wallet. One free token is granted each ISO week
 * (Monday-anchored), capped at {@link HabitService#FREEZE_CAP}. A token is spent
 * to protect a habit day (a planned "rest day" or a rescue of a missed day).
 */
@Entity
@Table(name = "streak_freeze_wallets")
@Getter
@Setter
@NoArgsConstructor
public class StreakFreezeWallet {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false)
    private int tokens = 1;

    /** Monday of the week the wallet was last topped up. */
    @Column(name = "week_anchor", nullable = false)
    private LocalDate weekAnchor;
}
