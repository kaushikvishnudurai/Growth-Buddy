package com.growthbuddy.quickadd;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentor.OpenAIClient;
import java.util.List;
import org.junit.jupiter.api.Test;

/** An upstream failure is "unavailable", not "nothing in your sentence". */
class QuickAddServiceTest {

    @Test
    void modelFailureIsReportedAsUnavailable() {
        OpenAIClient openai = mock(OpenAIClient.class);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.complete(anyString(), anyList())).thenThrow(new RuntimeException("timeout"));
        var r = new QuickAddService(openai).parse("drank 500ml", List.of());
        assertTrue(r.configured());
        assertTrue(r.unavailable());
        assertTrue(r.intents().isEmpty());
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
}
