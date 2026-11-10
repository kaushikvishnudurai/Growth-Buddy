package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.family.FamilyService;
import com.growthbuddy.food.FoodService;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.money.MoneyController;
import com.growthbuddy.money.MoneyService;
import com.growthbuddy.user.FeatureLocks;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** null is the picker's no-AI fallback, so every failure must land there, never a 5xx. */
class PhotoRouteControllerTest {

    private static final String IMG = "data:image/jpeg;base64,AAAA";
    private final OpenAIClient openai = mock(OpenAIClient.class);
    private final FoodService food = mock(FoodService.class);
    private final FamilyService family = mock(FamilyService.class);
    private final PhotoRouteController ctl = new PhotoRouteController(openai, null, food, family);
    private static final UUID USER = UUID.randomUUID();

    @AfterEach
    void reset() {
        CurrentUser.clear();
        FeatureLocks.use(List.of());
    }

    private Map<String, Object> read(String answer, List<String> kinds) {
        CurrentUser.set(USER);
        when(openai.isConfigured()).thenReturn(true);
        when(openai.completeWithImage(anyString(), anyString(), anyString())).thenReturn(answer);
        return ctl.read(new PhotoRouteController.ReadRequest(IMG, kinds,
                List.of(new MoneyController.ReceiptCategory("food", "Food"))));
    }

    /* ---- the one-call read ---- */

    @Test
    void aPaymentScreenshotReadsAsOneCheckedReceipt() {
        Map<String, Object> out = read("{\"kind\":\"receipt\",\"items\":[{\"name\":\"Ravi Tea Stall\",\"amount\":250,"
                + "\"category\":\"food\"},{\"name\":\"bad\",\"amount\":\"x\"}],\"merchant\":\"Ravi Tea Stall\",\"date\":null}",
                List.of("receipt", "plate"));
        assertEquals("receipt", out.get("kind"));
        MoneyService.ReceiptScan scan = (MoneyService.ReceiptScan) out.get("receipt");
        assertEquals(1, scan.items().size()); // the non-number line is dropped, as scanReceipt drops it
        assertEquals("food", scan.items().get(0).category());
        assertEquals("Ravi Tea Stall", scan.merchant());
    }

    @Test
    void aKindTheUserDidNotOfferIsNoAnswer() {
        Map<String, Object> out = read("{\"kind\":\"groceries\",\"items\":[{\"name\":\"Milk\"}]}", List.of("receipt", "plate"));
        assertNull(out.get("kind"));
        verify(family, never()).pantryFrom(any(), any());
    }

    @Test
    void groceriesGoThroughThePantryAndALockedFeatureIsNotOffered() {
        when(family.pantryFrom(eq(USER), any())).thenReturn("added");
        Map<String, Object> out = read("{\"kind\":\"groceries\",\"items\":[{\"name\":\"Milk\"}]}", List.of("groceries"));
        assertEquals("added", out.get("groceries"));
        FeatureLocks.use(List.of(new FeatureLocks.Lock("family", "*", null)));
        assertNull(read("{\"kind\":\"groceries\"}", List.of("groceries")).get("kind"));
    }

    @Test
    void aReaderThatRefusesLeavesTheKindWithNoAnswer() {
        when(family.pantryFrom(eq(USER), any())).thenThrow(ApiException.badRequest("Join a family first."));
        Map<String, Object> out = read("{\"kind\":\"groceries\",\"items\":[]}", List.of("groceries"));
        assertEquals("groceries", out.get("kind"));
        assertNull(out.get("groceries"));
    }

    @Test
    void thePromptHoldsOnlyTheOfferedKinds() {
        String p = PhotoRouteController.readPrompt(List.of("receipt", "plate"), Map.of("food", "Food"));
        assertTrue(p.contains("## kind \"receipt\"") && p.contains("## kind \"plate\"") && p.contains("- food = Food"));
        assertFalse(p.contains("## kind \"groceries\""));
    }

    @Test
    void garbageReadIsNoAnswer() {
        assertNull(read("not json", List.of("receipt")).get("kind"));
    }

    /* ---- the guess only ---- */

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
