package com.growthbuddy.water;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** Drink types: what each counts towards the day's water, and where that is applied. */
class WaterDrinkTypeTest {

    private static final UUID USER = UUID.randomUUID();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final WaterEntryRepository entries = mock(WaterEntryRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private WaterService service;
    private LocalDate today;

    @BeforeEach
    void setUp() {
        today = LocalDate.now(IST);
        when(clock.zoneOf(any())).thenReturn(IST);
        when(clock.today(any())).thenReturn(today);
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        when(entries.findByUserIdAndLogDateOrderByLoggedAtAsc(any(), any())).thenReturn(List.of());
        WaterGoalRepository goals = mock(WaterGoalRepository.class);
        when(goals.findById(any())).thenReturn(Optional.empty());
        UserRepository users = mock(UserRepository.class);
        when(users.findById(any())).thenReturn(Optional.empty());
        service = new WaterService(entries, goals, clock, users);
    }

    @Test
    void theFactorsAreTheAgreedOnes() {
        assertThat(DrinkType.effectiveMl(DrinkType.water, 250)).isEqualTo(250);
        assertThat(DrinkType.effectiveMl(null, 250)).as("null is water").isEqualTo(250);
        assertThat(DrinkType.effectiveMl(DrinkType.tea, 250)).isEqualTo(225);
        assertThat(DrinkType.effectiveMl(DrinkType.coffee, 250)).isEqualTo(200);
        assertThat(DrinkType.effectiveMl(DrinkType.juice, 200)).isEqualTo(180);
        assertThat(DrinkType.effectiveMl(DrinkType.milk, 300)).isEqualTo(270);
        assertThat(DrinkType.effectiveMl(DrinkType.other, 300)).isEqualTo(300);
    }

    @Test
    void theDayCountsEffectiveMillilitresAndReportsWhatWasPoured() {
        WaterEntry water = row(500, null);
        WaterEntry coffee = row(250, DrinkType.coffee);
        when(entries.findByUserIdAndLogDateOrderByLoggedAtAsc(USER, today)).thenReturn(List.of(water, coffee));
        WaterSummaryResponse s = service.summary(USER, today);
        assertThat(s.consumedMl()).isEqualTo(700);
        assertThat(s.drankMl()).isEqualTo(750);
        assertThat(s.remainingMl()).isEqualTo(1300);
        assertThat(s.entries()).extracting(WaterEntryResponse::drinkType)
                .containsExactly(DrinkType.water, DrinkType.coffee);
        assertThat(s.entries()).extracting(WaterEntryResponse::effectiveMl).containsExactly(500, 200);
    }

    @Test
    void theWeekAppliesTheFactorPerDrinkAndAddsThemUp() {
        List<Object[]> rows = List.of(
                new Object[] {today, null, 1000L},
                new Object[] {today, DrinkType.tea, 500L},
                new Object[] {today.minusDays(1), DrinkType.coffee, 500L});
        when(entries.totalsByDay(USER, today.minusDays(6), today)).thenReturn(rows);
        Map<LocalDate, Integer> t = service.totalsByDay(USER, today.minusDays(6), today);
        assertThat(t).containsEntry(today, 1450).containsEntry(today.minusDays(1), 400).hasSize(2);
    }

    @Test
    void waterIsStoredAsNullAndOtherDrinksByName() {
        service.addEntry(USER, new AddWaterEntryRequest(250, null, null, DrinkType.water));
        service.addEntry(USER, new AddWaterEntryRequest(250, null, null, DrinkType.tea));
        ArgumentCaptor<WaterEntry> c = ArgumentCaptor.forClass(WaterEntry.class);
        org.mockito.Mockito.verify(entries, org.mockito.Mockito.times(2)).save(c.capture());
        assertThat(c.getAllValues()).extracting(WaterEntry::getDrinkType).containsExactly(null, DrinkType.tea);
    }

    private WaterEntry row(int ml, DrinkType type) {
        WaterEntry e = new WaterEntry();
        e.setId(UUID.randomUUID());
        e.setUserId(USER);
        e.setAmountMl(ml);
        e.setDrinkType(type);
        e.setLoggedAt(Instant.now());
        e.setLogDate(today);
        return e;
    }
}
