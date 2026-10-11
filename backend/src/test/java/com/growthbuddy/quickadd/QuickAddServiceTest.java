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
}
