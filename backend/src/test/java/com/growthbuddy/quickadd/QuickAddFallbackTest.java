package com.growthbuddy.quickadd;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.growthbuddy.quickadd.QuickAddService.Intent;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/** What the box reads with no model: the sentences people actually type. */
class QuickAddFallbackTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10); // a Saturday
    private static final LocalTime NOW = LocalTime.of(14, 5);

    private static List<Intent> read(String text, String... habits) {
        return QuickAddFallback.parse(text, List.of(habits), TODAY, NOW);
    }

    private static List<String> types(List<Intent> l) {
        return l.stream().map(Intent::type).toList();
    }

    @Test
    void aMixedDayLogsEveryPart() {
        var l = read("spent 200 on lunch, slept 7h, drank 2 glasses of water and feeling tired");
        assertEquals(List.of("expense", "sleep", "water", "mood"), types(l));
        assertEquals(200, l.get(0).amount());
        assertEquals("lunch", l.get(0).note());
        assertEquals(7.0, l.get(1).hours());
        assertEquals(500, l.get(2).amountMl());
        assertEquals("low", l.get(3).energy());
    }

    @Test
    void aReminderCarriesDayTimeRepeatAndLead() {
        var r = read("remind me tomorrow at 9pm to call mom, 10 minutes before").get(0);
        assertEquals("reminder", r.type());
        assertEquals("Call mom", r.text());
        assertEquals(TODAY.plusDays(1), r.date());
        assertEquals(LocalTime.of(21, 0), r.time());
        // The lead is its own clause after the comma: it is not part of this reminder.
        var weekly = read("remind me every monday at 7:30 am to take medicine 15 minutes before").get(0);
        assertEquals("weekly", weekly.repeat());
        assertEquals(LocalDate.of(2026, 10, 12), weekly.date());
        assertEquals(LocalTime.of(7, 30), weekly.time());
        assertEquals(15, weekly.notifyBefore());
        assertEquals("health", weekly.tag());
        assertEquals("Take medicine", weekly.text());
    }

    @Test
    void inMinutesCountsFromNow() {
        var r = read("remind me in 20 minutes to check the oven").get(0);
        assertEquals(LocalTime.of(14, 25), r.time());
        assertEquals("Check the oven", r.text());
    }

    @Test
    void controlsAndCreation() {
        assertEquals("money", read("open money").get(0).screen());
        assertEquals("dark", read("switch to dark mode").get(0).value());
        assertEquals(25, read("start focus for 25 min").get(0).minutes());
        assertEquals("habit_new", read("new habit: stretch").get(0).type());
        assertEquals("goal", read("my goal is to run a 10k").get(0).type());
        assertEquals("note", read("note: buy a gift for Priya").get(0).type());
        assertEquals("task", read("todo: file taxes").get(0).type());
        assertEquals("task_done", read("finished the report").get(0).type());
        assertEquals("2500", read("set water goal to 2.5 l").get(0).value());
    }

    @Test
    void foodIncomeAndHabits() {
        var food = read("had 2 idli and a dosa for breakfast");
        assertEquals(List.of("food", "food"), types(food));
        assertEquals("2 idli", food.get(0).name());
        assertEquals("breakfast", food.get(1).meal());
        var pay = read("got paid 50,000 salary").get(0);
        assertEquals("income", pay.type());
        assertEquals(50000, pay.amount());
        var gym = read("went to the gym", "Gym", "Read");
        assertEquals("habit", gym.get(0).type());
        assertEquals("Gym", gym.get(0).name());
    }

    @Test
    void nothingRecognisableIsEmpty() {
        assertTrue(read("hello there").isEmpty());
        assertTrue(read("").isEmpty());
    }

    /** FRC-1 in the patterns: TODAY is Saturday, NOW 14:05. */
    @Test
    void theAnchorFallsOnTheNamedWeekday() {
        assertEquals(LocalDate.of(2026, 10, 12), read("remind me every Monday at 9am to water plants").get(0).date());
        assertEquals(LocalDate.of(2026, 10, 16), read("remind me on Friday to call the bank").get(0).date());
        assertEquals(LocalDate.of(2026, 10, 13), read("remind me next Tuesday at 4pm dentist").get(0).date());
        assertEquals(TODAY, read("remind me every saturday at 6pm to call dad").get(0).date(), "6pm is still ahead");
        assertEquals(TODAY.plusWeeks(1), read("remind me every saturday at 9am to call dad").get(0).date(),
                "9am has passed: next Saturday");
        var wd = read("remind me every weekday at 8am to stand up").get(0);
        assertEquals("weekdays", wd.repeat());
        assertEquals(LocalDate.of(2026, 10, 12), wd.date(), "not on the weekend");
    }

    /** EXS-5: "at 9am" at 14:05 with no day said is tomorrow's 9am, not a time already gone. */
    @Test
    void aPassedTimeWithNoDayIsTomorrow() {
        assertEquals(TODAY.plusDays(1), read("remind me at 9am to call mom").get(0).date());
        assertEquals(TODAY, read("remind me at 6pm to call mom").get(0).date(), "still ahead today");
        assertEquals(TODAY, read("remind me today at 9am to call mom").get(0).date(), "today said out loud is kept");
        assertEquals(TODAY, read("remind me every day at 9am to stretch").get(0).date(), "a series still has tomorrow");
    }
}
