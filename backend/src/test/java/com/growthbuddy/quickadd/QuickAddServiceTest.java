package com.growthbuddy.quickadd;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentor.OpenAIClient;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.Test;

/** An upstream failure is "unavailable", not "nothing in your sentence". */
class QuickAddServiceTest {

    /** The plain patterns still read the sentence, and say they did. */
    @Test
    void modelFailureIsReportedAsUnavailableAndFallsBack() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenThrow(new RuntimeException("timeout"));
        var r = new QuickAddService(openai).parse("drank 500ml", List.of());
        assertTrue(r.configured());
        assertTrue(r.unavailable());
        assertTrue(r.fallback());
        assertEquals(500, r.intents().get(0).amountMl());
        assertTrue(new QuickAddService(openai).parse("hmm", List.of()).intents().isEmpty());
    }

    /** No key at all: still "not configured", but what the patterns read comes back. */
    @Test
    void noModelStillReadsPlainSentences() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(false);
        var r = new QuickAddService(openai).parse("spent 200 on lunch", List.of());
        assertFalse(r.configured());
        assertEquals("expense", r.intents().get(0).type());
    }

    /** The new types arrive with their own fields, bounded. */
    @Test
    void everyControlTypeIsRead() {
        var r = parse("{\"intents\":[{\"type\":\"food\",\"name\":\"2 idli\",\"meal\":\"Breakfast\",\"kcal\":9999},"
                + "{\"type\":\"income\",\"amount\":50000,\"note\":\"Salary\"},"
                + "{\"type\":\"task_done\",\"title\":\"report\"},{\"type\":\"focus\",\"minutes\":25},"
                + "{\"type\":\"open\",\"screen\":\"money\"},{\"type\":\"open\",\"screen\":\"admin\"},"
                + "{\"type\":\"setting\",\"key\":\"theme\",\"value\":\"dark\"},"
                + "{\"type\":\"setting\",\"key\":\"password\",\"value\":\"x\"},"
                + "{\"type\":\"note\",\"text\":\"idea\"},{\"type\":\"goal\",\"title\":\"Run 10k\"},"
                + "{\"type\":\"habit_new\",\"name\":\"Stretch\"}]}");
        var types = r.intents().stream().map(QuickAddService.Intent::type).toList();
        assertEquals(List.of("food", "income", "task_done", "focus", "open", "setting", "note", "goal", "habit_new"), types);
        assertEquals("breakfast", r.intents().get(0).meal());
        assertEquals(null, r.intents().get(0).kcal(), "an impossible kcal is dropped, not the dish");
        assertEquals("money", r.intents().get(4).screen());
        assertEquals("dark", r.intents().get(5).value());
    }

    @Test
    void emptyParseIsNotUnavailable() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenReturn("{\"intents\":[],\"note\":\"\"}");
        var r = new QuickAddService(openai).parse("hello", List.of());
        assertFalse(r.unavailable());
        assertEquals(0, r.intents().size());
    }

    private static final LocalDate TODAY = LocalDate.of(2026, 10, 10); // a Saturday

    private static QuickAddService.QuickAddResult parse(String modelSays) {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenReturn(modelSays);
        return new QuickAddService(openai).parse("whatever was said", List.of(), TODAY);
    }

    /** "Every Monday at 7 to 7:30 call mom, 10 minutes before, until December" — every field arrives. */
    @Test
    void aReminderCarriesEveryFieldThatWasSaid() {
        var r = parse("{\"intents\":[{\"type\":\"reminder\",\"text\":\"Call mom\",\"date\":\"2026-10-12\","
                + "\"time\":\"19:00\",\"endTime\":\"19:30\",\"repeat\":\"weekly\",\"until\":\"2026-12-31\","
                + "\"tag\":\"personal\",\"notifyBefore\":10}]}");
        var it = r.intents().get(0);
        assertEquals("reminder", it.type());
        assertEquals("Call mom", it.text());
        assertEquals(LocalDate.of(2026, 10, 12), it.date());
        assertEquals(LocalTime.of(19, 0), it.time());
        assertEquals(LocalTime.of(19, 30), it.endTime());
        assertEquals("weekly", it.repeat());
        assertEquals(LocalDate.of(2026, 12, 31), it.until());
        assertEquals(10, it.notifyBefore());
    }

    /** One bad field drops that field, never the reminder. */
    @Test
    void aBadFieldIsDroppedNotTheReminder() {
        var it = parse("{\"intents\":[{\"type\":\"reminder\",\"text\":\"Pay rent\",\"date\":\"2026-10-03\","
                + "\"time\":\"25:99\",\"endTime\":\"10:00\",\"repeat\":\"fortnightly\",\"until\":\"2026-01-01\","
                + "\"tag\":\"money\",\"notifyBefore\":30}]}").intents().get(0);
        assertEquals(TODAY, it.date(), "a past day (last Saturday) becomes today");
        assertEquals(null, it.time());
        assertEquals(null, it.endTime(), "no end without a start");
        assertEquals("none", it.repeat());
        assertEquals(null, it.until());
        assertEquals("personal", it.tag());
        assertEquals(null, it.notifyBefore(), "a lead needs a time to be ahead of");
    }

    @Test
    void anEndBeforeTheStartAndAMissingTextAreRefused() {
        var r = parse("{\"intents\":[{\"type\":\"reminder\",\"text\":\"Gym\",\"time\":\"18:00\",\"endTime\":\"17:00\"},"
                + "{\"type\":\"reminder\",\"text\":\"  \",\"time\":\"09:00\"}]}");
        assertEquals(1, r.intents().size());
        assertEquals(TODAY, r.intents().get(0).date(), "no day said = today");
        assertEquals(null, r.intents().get(0).endTime());
    }

    /** The model can only resolve "tomorrow" or "next Friday" if it is told what today is. */
    @Test
    void theModelIsToldTodayAndItsWeekday() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        when(openai.complete(prompt.capture(), anyList())).thenReturn("{\"intents\":[]}");
        new QuickAddService(openai).parse("remind me tomorrow", List.of(), TODAY);
        assertTrue(prompt.getValue().contains("TODAY: 2026-10-10 (Saturday)"));
    }

    private static final LocalDate SUNDAY = LocalDate.of(2026, 10, 11);

    private static QuickAddService.Intent said(String text, String date, String time, String repeat, LocalTime now) {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenReturn("{\"intents\":[{\"type\":\"reminder\","
                + "\"text\":\"x\",\"date\":\"" + date + "\",\"time\":" + (time == null ? "null" : "\"" + time + "\"")
                + ",\"repeat\":\"" + repeat + "\"}]}");
        return new QuickAddService(openai).parse(text, List.of(), SUNDAY, now).intents().get(0);
    }

    /** FRC-1: the model filed "every Monday" on Tuesday 13 Oct; a weekly series would ring every Tuesday. */
    @Test
    void theAnchorFallsOnTheWeekdayTheTextNames() {
        LocalTime late = LocalTime.of(23, 12);
        assertEquals(LocalDate.of(2026, 10, 12),
                said("remind me every monday at 9am to water plants", "2026-10-13", "09:00", "weekly", late).date());
        assertEquals(LocalDate.of(2026, 10, 16),
                said("call the bank on Friday", "2026-10-11", null, "none", late).date(), "on Friday");
        assertEquals(LocalDate.of(2026, 10, 13),
                said("next Tuesday dentist at 4pm", "2026-10-08", "16:00", "none", late).date(), "a past day too");
        assertEquals(LocalDate.of(2026, 10, 23),
                said("Friday the 23rd at 5 pay rent", "2026-10-23", "17:00", "none", late).date(),
                "a date already on that weekday is kept");
        // Today is Sunday: "every Sunday" counts today while 9pm is still ahead, not after it.
        assertEquals(SUNDAY, said("every sunday at 9pm plan the week", "2026-10-11", "21:00", "weekly",
                LocalTime.of(20, 0)).date());
        assertEquals(LocalDate.of(2026, 10, 18), said("every sunday at 9pm plan the week", "2026-10-11", "21:00",
                "weekly", late).date());
        assertEquals(LocalDate.of(2026, 10, 12),
                said("every weekday at 8 stand up", "2026-10-11", "08:00", "weekdays", late).date(),
                "a weekdays series does not start on a Sunday");
        assertEquals(LocalDate.of(2026, 10, 13), said("gym on monday and wednesday", "2026-10-13", null, "none",
                late).date(), "two weekdays named: trusted as read");
    }

    /** EXS-5 on the model path: 23:12, "at 9pm", the model says today. */
    @Test
    void aPassedTimeWithNoDaySaidIsTomorrow() {
        LocalTime late = LocalTime.of(23, 12);
        assertEquals(SUNDAY.plusDays(1), said("remind me at 9pm to call mom", "2026-10-11", "21:00", "none", late).date());
        assertEquals(SUNDAY, said("remind me tonight at 9pm to call mom", "2026-10-11", "21:00", "none", late).date());
    }

    /** SEC-10: names go into the system prompt clipped, each and in total. */
    @Test
    void habitNamesAreClippedOnTheWayIntoThePrompt() {
        assertEquals("(none)", QuickAddService.habitLine(null));
        assertEquals("Read, Walk", QuickAddService.habitLine(List.of(" Read ", "Walk", "")));
        assertEquals(120, QuickAddService.habitLine(List.of("x".repeat(80_000))).length());
        assertEquals(4096, QuickAddService.habitLine(java.util.Collections.nCopies(100, "y".repeat(120))).length());
    }

    /** A spent AI budget is not a dead box: the plain patterns answer, flagged limited. */
    @Test
    void aSpentBudgetFallsBackFlaggedLimited() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenThrow(
                new com.growthbuddy.common.ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "spent"));
        var r = new QuickAddService(openai).parse("spent 200 on lunch", List.of(), TODAY);
        assertTrue(r.limited());
        assertTrue(r.fallback());
        assertFalse(r.unavailable());
        assertEquals("expense", r.intents().get(0).type());
    }

    /** The logging types may carry a past day; money a foreign currency; sleep no made-up quality; no emoji. */
    @Test
    void datesCurrencyQualityAndANeutralNote() {
        var r = parse("{\"intents\":[{\"type\":\"expense\",\"amount\":12,\"note\":\"Coffee\",\"currency\":\"usd\",\"date\":\"2026-10-09\"},"
                + "{\"type\":\"income\",\"amount\":5,\"currency\":\"dollars\",\"date\":\"2026-10-11\"},"
                + "{\"type\":\"sleep\",\"hours\":7},"
                + "{\"type\":\"food\",\"name\":\"Dosa\",\"date\":\"2025-01-01\"}],"
                + "\"note\":\"Logs coffee \uD83D\uDE00\u2615\uFE0F and sleep\"}");
        var l = r.intents();
        assertEquals(LocalDate.of(2026, 10, 9), l.get(0).date(), "yesterday stays");
        assertEquals("USD", l.get(0).currency());
        assertEquals(null, l.get(1).date(), "a future day is dropped (means today)");
        assertEquals(null, l.get(1).currency(), "not an ISO code");
        assertEquals(null, l.get(2).quality(), "not said = null, not ok");
        assertEquals(null, l.get(3).date(), "older than a month is a misread");
        assertEquals("Logs coffee and sleep", r.note());
    }
}
