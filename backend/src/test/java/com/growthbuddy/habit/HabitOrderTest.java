package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** {@code PUT /api/habits/order}: what {@link HabitService#applyOrder} numbers, and what it refuses. */
class HabitOrderTest {

    private static Habit habit(String name, int sortOrder) {
        Habit h = new Habit();
        h.setId(UUID.randomUUID());
        h.setName(name);
        h.setSortOrder(sortOrder);
        return h;
    }

    private static List<String> namesInOrder(List<Habit> rows) {
        List<Habit> copy = new ArrayList<>(rows);
        copy.sort(Comparator.comparingInt(Habit::getSortOrder));
        return copy.stream().map(Habit::getName).toList();
    }

    @Test
    void ordersTheListedIdsTopFirst() {
        Habit a = habit("a", 0), b = habit("b", 0), c = habit("c", 0);
        List<Habit> rows = List.of(a, b, c);
        HabitService.applyOrder(rows, List.of(c.getId(), a.getId(), b.getId()));
        assertThat(namesInOrder(rows)).containsExactly("c", "a", "b");
        assertThat(List.of(c.getSortOrder(), a.getSortOrder(), b.getSortOrder()))
                .containsExactly(0, 1, 2);
    }

    @Test
    void habitsLeftOutKeepTheirPlaceAfterTheListedOnes() {
        // A stale client (a habit added on another device) must not lose one.
        Habit a = habit("a", 0), b = habit("b", 1), c = habit("c", 2), d = habit("d", 3);
        List<Habit> rows = List.of(a, b, c, d);
        HabitService.applyOrder(rows, List.of(c.getId(), a.getId()));
        assertThat(namesInOrder(rows)).containsExactly("c", "a", "b", "d");
    }

    @Test
    void aRepeatedIdCountsOnceAtItsFirstPlace() {
        Habit a = habit("a", 0), b = habit("b", 1);
        List<Habit> rows = List.of(a, b);
        HabitService.applyOrder(rows, List.of(b.getId(), a.getId(), b.getId()));
        assertThat(namesInOrder(rows)).containsExactly("b", "a");
    }

    @Test
    void returnsOnlyTheHabitsWhosePositionChanged() {
        Habit a = habit("a", 0), b = habit("b", 1), c = habit("c", 2);
        // Swap b and c: a stays at 0 and is not worth a write.
        List<Habit> changed = HabitService.applyOrder(List.of(a, b, c),
                List.of(a.getId(), c.getId(), b.getId()));
        assertThat(changed).containsExactlyInAnyOrder(b, c);
        assertThat(HabitService.applyOrder(List.of(a, c, b),
                List.of(a.getId(), c.getId(), b.getId()))).isEmpty();
    }

    @Test
    void refusesAnIdThatIsNotOneOfTheUsersLiveHabits() {
        Habit a = habit("a", 0);
        assertThatThrownBy(() -> HabitService.applyOrder(List.of(a), List.of(UUID.randomUUID())))
                .isInstanceOf(ApiException.class);
        // Nothing was renumbered on the way to the refusal.
        assertThat(a.getSortOrder()).isZero();
    }

    @Test
    void anEmptyRequestJustCompactsTheExistingOrder() {
        Habit a = habit("a", 0), b = habit("b", 0), c = habit("c", 5);
        List<Habit> rows = List.of(a, b, c);
        HabitService.applyOrder(rows, null);
        assertThat(List.of(a.getSortOrder(), b.getSortOrder(), c.getSortOrder()))
                .containsExactly(0, 1, 2);
    }

    @Test
    void aNewHabitGoesToTheBottom() {
        assertThat(HabitService.nextSortOrder(List.of())).isZero();
        assertThat(HabitService.nextSortOrder(List.of(habit("a", 0), habit("b", 4), habit("c", 2))))
                .isEqualTo(5);
    }
}
