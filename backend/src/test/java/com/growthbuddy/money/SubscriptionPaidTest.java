package com.growthbuddy.money;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class SubscriptionPaidTest {

    private final ObjectMapper json = new ObjectMapper();

    private ObjectNode doc() throws Exception {
        return (ObjectNode) json.readTree("""
                {"expenses":[],"subscriptions":[
                  {"id":"m1","name":"Spotify","amount":100,"dueDay":30,"category":"entertainment"},
                  {"id":"m2","name":"Rent","amount":9000,"dueDay":31,"category":"home"}]}""");
    }

    @Test
    void dueDayPastMonthEndFallsOnLastDay() throws Exception {
        // September has 30 days: both the 30th and the "31st" are due on the 30th.
        assertEquals(2, SubscriptionDueScheduler.dueToday(doc(), LocalDate.of(2026, 9, 30)).size());
        assertEquals(0, SubscriptionDueScheduler.dueToday(doc(), LocalDate.of(2026, 9, 29)).size());
    }

    @Test
    void markingPaidLogsOneExpenseAndSilencesTheMonth() throws Exception {
        ObjectNode d = doc();
        LocalDate day = LocalDate.of(2026, 9, 30);
        assertEquals("Spotify", MoneyService.applyPaid(d, "m1", "2026-09", day));
        assertEquals("Spotify", MoneyService.applyPaid(d, "m1", "2026-09", day)); // second tap
        assertEquals(1, d.get("expenses").size());
        assertEquals(100, d.get("expenses").get(0).get("amount").asInt());
        assertEquals("2026-09-30", d.get("expenses").get(0).get("date").asText());
        assertEquals(1, SubscriptionDueScheduler.dueToday(d, day).size()); // only Rent left
        assertEquals(null, MoneyService.applyPaid(d, "nope", "2026-09", day));
    }

    @Test
    void anOldMonthsButtonNeverRollsPaidBack() throws Exception {
        ObjectNode d = doc();
        LocalDate oct = LocalDate.of(2026, 10, 31);
        MoneyService.applyPaid(d, "m1", "2026-09", oct);
        MoneyService.applyPaid(d, "m1", "2026-08", oct); // stale August message tapped late
        assertEquals("2026-09", d.get("subscriptions").get(0).get("paidFor").asText());
        assertEquals(1, d.get("expenses").size());
        MoneyService.applyPaid(d, "m1", "2026-10", oct);
        assertEquals("2026-10", d.get("subscriptions").get(0).get("paidFor").asText());
        assertEquals(2, d.get("expenses").size());
    }

    @Test
    void aBillWithNoAmountIsNotMarkedPaid() throws Exception {
        // Marking it would show the bill settled with no expense behind it.
        ObjectNode d = (ObjectNode) json.readTree("{\"subscriptions\":[{\"id\":\"x\",\"name\":\"Odd\",\"dueDay\":1}]}");
        assertEquals(null, MoneyService.applyPaid(d, "x", "2026-09", LocalDate.of(2026, 9, 1)));
        assertFalse(d.get("subscriptions").get(0).has("paidFor"));
        assertFalse(d.has("expenses"));
    }

    @Test
    void amountsGroupLikeTheApp() throws Exception {
        assertEquals("9,000", SubscriptionDueScheduler.amount(json.readTree("9000")));
        assertEquals("1,00,000", SubscriptionDueScheduler.amount(json.readTree("100000")));
        assertEquals("100", SubscriptionDueScheduler.amount(json.readTree("99.6")));
        // Expected values are what (n).toLocaleString('en-IN') prints in the app.
        String[][] cases = {{"0", "0"}, {"999", "999"}, {"1000", "1,000"}, {"99999", "99,999"},
                {"1234567", "12,34,567"}, {"123456789", "12,34,56,789"}};
        for (String[] c : cases) {
            assertEquals(c[1], SubscriptionDueScheduler.amount(json.readTree(c[0])), c[0]);
        }
        assertEquals("Rent is due today (₹9,000). Tap Mark as paid once it's done.",
                SubscriptionDueScheduler.message(doc().get("subscriptions").get(1), "₹"));
    }

    @Test
    void onlyTransientFailuresAreRetried() {
        assertTrue(new com.growthbuddy.reminder.WhatsAppService.SendFailed(400, "", null).permanent());
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(429, "", null).permanent());
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(503, "", null).permanent());
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(0, "", null).permanent());
    }

    @Test
    void webhookSignatureIsCheckedAndFailsClosed() throws Exception {
        byte[] body = "{\"entry\":[]}".getBytes(StandardCharsets.UTF_8);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("s3cret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String sig = "sha256=" + HexFormat.of().formatHex(mac.doFinal(body));
        assertTrue(WhatsAppWebhookController.signatureValid("s3cret", body, sig));
        assertFalse(WhatsAppWebhookController.signatureValid("other", body, sig));
        assertFalse(WhatsAppWebhookController.signatureValid("", body, sig));
        assertFalse(WhatsAppWebhookController.signatureValid("s3cret", body, null));
    }

    @Test
    void readsBothButtonShapes() throws Exception {
        assertEquals("paid:m1:2026-09", WhatsAppWebhookController.buttonPayload(json.readTree(
                "{\"type\":\"button\",\"button\":{\"payload\":\"paid:m1:2026-09\"}}")));
        assertEquals("paid:m1:2026-09", WhatsAppWebhookController.buttonPayload(json.readTree(
                "{\"type\":\"interactive\",\"interactive\":{\"button_reply\":{\"id\":\"paid:m1:2026-09\"}}}")));
    }

    @Test
    void metaRateLimitsRetryButABadNumberDoesNot() {
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(400,
                "HTTP 400 {\"error\":{\"message\":\"(#131056) Pair rate limit hit\",\"code\":131056}}", null).permanent());
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(400,
                "HTTP 400 {\"error\":{\"code\": 130429}}", null).permanent());
        assertFalse(new com.growthbuddy.reminder.WhatsAppService.SendFailed(401, "token expired", null).permanent());
        assertTrue(new com.growthbuddy.reminder.WhatsAppService.SendFailed(400,
                "HTTP 400 {\"error\":{\"message\":\"(#131030) Recipient not in allowed list\",\"code\":131030}}", null).permanent());
    }
}
