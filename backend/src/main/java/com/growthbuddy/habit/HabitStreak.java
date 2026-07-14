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

/** Cached streak counters for a habit (recomputed on every check-in change). */
@Entity
@Table(name = "habit_streaks")
@Getter
@Setter
@NoArgsConstructor
public class HabitStreak {

    @Id
    @Column(name = "habit_id")
    private UUID habitId;

    @Column(name = "current_streak", nullable = false)
    private int currentStreak = 0;

    @Column(name = "longest_streak", nullable = false)
    private int longestStreak = 0;

    @Column(name = "last_done_on")
    private LocalDate lastDoneOn;
}
