package com.growthbuddy.quickadd;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.food.FoodService;
import com.growthbuddy.goal.GoalService;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.money.MoneyService;
import com.growthbuddy.note.NoteService;
import com.growthbuddy.quickadd.QuickAddService.Intent;
import com.growthbuddy.reminder.ReminderService;
import com.growthbuddy.task.TaskService;
import com.growthbuddy.water.WaterService;
import com.growthbuddy.wellness.WellnessService;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** A WhatsApp message's intents: every one tried, a switched-off tracker untouched, one refusal one line. */
class QuickAddApplierTest {

    private final TaskService tasks = mock(TaskService.class);
    private final WaterService water = mock(WaterService.class);
    private final MoneyService money = mock(MoneyService.class);
    private final ObjectMapper json = new ObjectMapper();
    private final QuickAddApplier applier = new QuickAddApplier(tasks, mock(HabitService.class), water,
            mock(WellnessService.class), mock(ReminderService.class), mock(FoodService.class),
            mock(NoteService.class), mock(GoalService.class), money, json);
    private static final UUID U = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10);

    @Test
    void aSwitchedOffTrackerTakesNothingAndOneRefusalIsOneLine() {
        doThrow(new IllegalArgumentException("boom")).when(tasks).createTitled(U, "Pay rent");
        var lines = applier.apply(U, Map.of("water", false),
                List.of(Intent.of("water").amountMl(500), Intent.of("task").title("Pay rent"),
                        Intent.of("open").screen("money")), TODAY);
        verify(water, never()).addMl(any(), any(Integer.class));
        assertEquals(3, lines.size());
        assertTrue(lines.get(0).contains("switched off"));
        assertTrue(lines.get(1).contains("boom"));
        assertTrue(lines.get(2).startsWith("Open the app"));
    }

    @Test
    void ledgerWritesMatchTheAppsShape() {
        var exp = applier.ledgerWrite(Intent.of("expense").amount(200).note("lunch"), TODAY, "cash-1").path("upserts").get(0);
        assertEquals("expense", exp.path("kind").asText());
        assertEquals("others", exp.path("category").asText());
        assertEquals("2026-10-10", exp.path("date").asText());
        assertEquals("cash-1", exp.path("accountId").asText(), "FRC-3: on an account, so the balance moves");
        var inc = applier.ledgerWrite(Intent.of("income").amount(50000).note("October salary"), TODAY, null).path("upserts").get(0);
        assertEquals("salary", inc.path("source").asText());
        assertEquals("October salary", inc.path("label").asText());
        assertTrue(inc.path("accountId").isMissingNode(), "no accounts yet: the row still saves");
    }

    @Test
    void sleepHoursBecomeABedtimeBeforeASevenOClockWake() {
        assertArrayEquals(new String[] {"23:30", "07:00"}, QuickAddApplier.sleepTimes(7.5));
        assertArrayEquals(new String[] {"01:00", "07:00"}, QuickAddApplier.sleepTimes(6));
    }
}
