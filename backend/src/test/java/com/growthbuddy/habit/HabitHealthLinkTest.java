package com.growthbuddy.habit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.ProgressService;
import com.growthbuddy.user.UserClock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * A habit linked to a phone health reading (healthLink + healthTarget): the
 * backend only stores and validates the link; the app reads and ticks.
 * Repositories are mocks; nothing touches a database.
 */
class HabitHealthLinkTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 7);
    private static final UUID USER = UUID.randomUUID();

    private final HabitRepository habits = mock(HabitRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final HabitService service = new HabitService(habits, mock(HabitCheckinRepository.class),
            mock(HabitStreakRepository.class), mock(StreakFreezeWalletRepository.class),
            mock(ProgressService.class), clock);

    private Habit walk;

    @BeforeEach
    void setUp() {
        when(clock.today(USER)).thenReturn(TODAY);
        when(clock.zoneOf(USER)).thenReturn(ZoneId.of("UTC"));
        walk = new Habit();
        walk.setId(UUID.randomUUID());
        walk.setUserId(USER);
        walk.setName("Walk");
        walk.setIcon("repeat");
        walk.setCreatedAt(TODAY.minusDays(3).atStartOfDay(ZoneOffset.UTC).toInstant());
        walk.setHealthLink("steps");
        walk.setHealthTarget(8000d);
        when(habits.findByIdAndUserIdAndDeletedAtIsNull(walk.getId(), USER)).thenReturn(Optional.of(walk));
    }

    private static CreateHabitRequest create(HabitKind kind, String link, Double target) {
        return new CreateHabitRequest("Walk", null, "repeat", null, null, null, null, null, null,
                kind, link, target);
    }

    private static UpdateHabitRequest update(String link, Double target) {
        return new UpdateHabitRequest(null, null, null, null, null, null, null, null, null, null,
                null, link, target);
    }

    @Test
    void createStoresLinkAndTarget() {
        HabitResponse r = service.create(USER, create(null, "sleep", 7.5));
        assertThat(r.healthLink()).isEqualTo("sleep");
        assertThat(r.healthTarget()).isEqualTo(7.5);
    }

    @Test
    void createWithoutLinkIgnoresTarget() {
        HabitResponse r = service.create(USER, create(null, null, 5000d));
        assertThat(r.healthLink()).isNull();
        assertThat(r.healthTarget()).isNull();
    }

    @Test
    void linkWithoutTargetIsRefused() {
        assertThatThrownBy(() -> service.create(USER, create(null, "steps", null)))
                .isInstanceOf(ApiException.class).hasMessageContaining("target");
    }

    @Test
    void unknownLinkIsRefused() {
        assertThatThrownBy(() -> service.create(USER, create(null, "heartrate", 60d)))
                .isInstanceOf(ApiException.class).hasMessageContaining("Unknown health link");
    }

    @Test
    void outOfRangeTargetIsRefused() {
        assertThatThrownBy(() -> service.create(USER, create(null, "sleep", 25d)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.create(USER, create(null, "steps", 0d)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.update(USER, walk.getId(), update(null, 100_001d)))
                .isInstanceOf(ApiException.class);
        assertThat(walk.getHealthTarget()).isEqualTo(8000d);
    }

    @Test
    void quitHabitCarriesNoLink() {
        HabitResponse r = service.create(USER, create(HabitKind.quit, "steps", 8000d));
        assertThat(r.healthLink()).isNull();
        assertThat(r.healthTarget()).isNull();
    }

    @Test
    void emptyLinkClearsBoth() {
        service.update(USER, walk.getId(), update("", 9000d));
        assertThat(walk.getHealthLink()).isNull();
        assertThat(walk.getHealthTarget()).isNull();
    }

    @Test
    void updateSemantics() {
        service.update(USER, walk.getId(), update(null, null));          // nothing sent: unchanged
        assertThat(walk.getHealthTarget()).isEqualTo(8000d);
        service.update(USER, walk.getId(), update(null, 10_000d));       // target alone retargets
        assertThat(walk.getHealthTarget()).isEqualTo(10_000d);
        service.update(USER, walk.getId(), update("steps", null));       // same link keeps its target
        assertThat(walk.getHealthTarget()).isEqualTo(10_000d);
        assertThatThrownBy(() -> service.update(USER, walk.getId(), update("sleep", null)))
                .isInstanceOf(ApiException.class);                       // new link needs a target
        service.update(USER, walk.getId(), update("workout", 30d));
        assertThat(walk.getHealthLink()).isEqualTo("workout");
        assertThat(walk.getHealthTarget()).isEqualTo(30d);
    }
}
