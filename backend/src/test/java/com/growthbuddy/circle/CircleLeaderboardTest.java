package com.growthbuddy.circle;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Unit tests for leaderboard ranking (sort by value desc, ties share a rank). */
class CircleLeaderboardTest {

    private LeaderboardEntry e(String name, long value) {
        return new LeaderboardEntry(UUID.nameUUIDFromBytes(name.getBytes()), name, value, 0);
    }

    @Test
    void ranksByValueDescending() {
        List<LeaderboardEntry> out = CircleService.rank(List.of(e("a", 3), e("b", 9), e("c", 5)));
        assertThat(out).extracting(LeaderboardEntry::name).containsExactly("b", "c", "a");
        assertThat(out).extracting(LeaderboardEntry::rank).containsExactly(1, 2, 3);
    }

    @Test
    void tiesShareARankAndNextRankSkips() {
        // Values 9, 9, 4 -> ranks 1, 1, 3 (standard competition ranking).
        List<LeaderboardEntry> out = CircleService.rank(List.of(e("a", 9), e("b", 9), e("c", 4)));
        assertThat(out).extracting(LeaderboardEntry::value).containsExactly(9L, 9L, 4L);
        assertThat(out).extracting(LeaderboardEntry::rank).containsExactly(1, 1, 3);
    }

    @Test
    void emptyRosterYieldsEmptyBoard() {
        assertThat(CircleService.rank(List.of())).isEmpty();
    }
}
