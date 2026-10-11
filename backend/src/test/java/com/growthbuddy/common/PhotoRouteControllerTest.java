package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.mentor.OpenAIClient;
import org.junit.jupiter.api.Test;

/** null is the picker's no-AI fallback, so every failure must land there, never a 5xx. */
class PhotoRouteControllerTest {

    private static final String IMG = "data:image/jpeg;base64,AAAA";
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private final PhotoRouteController ctl = new PhotoRouteController(openai);

    @Test
    void unconfiguredGivesNullAndSpendsNothing() {
        when(openai.isConfigured()).thenReturn(false);
        assertNull(ctl.route(new PhotoRouteController.RouteRequest(IMG)).get("kind"));
        verify(openai, never()).completeWithImage(anyString(), anyString(), anyString());
    }

    @Test
    void garbageOrUnknownGivesNull() {
        when(openai.isConfigured()).thenReturn(true);
        when(openai.completeWithImage(anyString(), anyString(), anyString())).thenReturn("not json at all");
        assertNull(ctl.route(new PhotoRouteController.RouteRequest(IMG)).get("kind"));
        when(openai.completeWithImage(anyString(), anyString(), anyString())).thenReturn("{\"kind\":\"selfie\"}");
        assertNull(ctl.route(new PhotoRouteController.RouteRequest(IMG)).get("kind"));
    }

    @Test
    void plateGivesPlate() {
        when(openai.isConfigured()).thenReturn(true);
        when(openai.completeWithImage(anyString(), anyString(), anyString()))
                .thenReturn("```json\n{\"kind\": \"Plate\"}\n```");
        assertEquals("plate", ctl.route(new PhotoRouteController.RouteRequest(IMG)).get("kind"));
    }

    @Test
    void nonPhotoIsRefusedBeforeAnyCall() {
        when(openai.isConfigured()).thenReturn(true);
        assertThrows(ApiException.class,
                () -> ctl.route(new PhotoRouteController.RouteRequest("data:image/svg+xml;base64,AAAA")));
        verify(openai, never()).completeWithImage(anyString(), anyString(), anyString());
    }
}
