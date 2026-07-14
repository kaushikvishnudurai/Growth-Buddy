package com.growthbuddy.score;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** A snapshot of a user's completion score for one day. */
@Entity
@Table(name = "daily_scores")
@IdClass(DailyScore.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class DailyScore {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Id
    @Column(name = "score_date")
    private LocalDate scoreDate;

    @Column(nullable = false)
    private int score;

    @Column(name = "tasks_done", nullable = false)
    private int tasksDone;

    @Column(name = "tasks_total", nullable = false)
    private int tasksTotal;

    @Column(name = "habits_done", nullable = false)
    private int habitsDone;

    @Column(name = "habits_total", nullable = false)
    private int habitsTotal;

    @Column(name = "workout_done", nullable = false)
    private boolean workoutDone;

    /** Composite key holder for {@link DailyScore}. */
    @Getter
    @Setter
    @NoArgsConstructor
    public static class Key implements Serializable {
        private UUID userId;
        private LocalDate scoreDate;

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key key)) {
                return false;
            }
            return Objects.equals(userId, key.userId) && Objects.equals(scoreDate, key.scoreDate);
        }

        @Override
        public int hashCode() {
            return Objects.hash(userId, scoreDate);
        }
    }
}
