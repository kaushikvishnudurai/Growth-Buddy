package com.growthbuddy.money;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/** Setu FI data -> ledger rows, the webhook gate, and a server with no Setu credentials. */
class BankFeedTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** The shape on docs.setu.co/data/account-aggregator/api-integration/data-apis. */
    private static JsonNode session(String txns) throws Exception {
        return JSON.readTree("""
                {"status":"COMPLETED","fips":[{"fipID":"Setu-FIP","accounts":[{
                  "linkRefNumber":"b2329f47","maskedAccNumber":"XXXXXX4373","status":"DELIVERED",
                  "data":{"account":{"type":"deposit","transactions":{"transaction":[%s]}}}}]}]}
                """.formatted(txns));
    }

    private static final String SWIGGY = """
            {"txnId":"T1","type":"DEBIT","mode":"UPI","amount":"249.00","currentBalance":"1000",
             "transactionTimestamp":"2026-10-10T20:05:29+00:00","valueDate":"2026-10-10T20:05:29+00:00",
             "narration":"UPI/DR/457233689286/SWIGGY/YESB/swiggy@ybl/Payment","reference":"1"}""";
    private static final String SALARY = """
            {"txnId":"T2","type":"CREDIT","mode":"NEFT","amount":"50000","transactionTimestamp":"2026-10-01T04:00:00+00:00",
             "narration":"NEFT/ACME CORP/SALARY OCT"}""";

    @Test
    void debitsAreExpensesAndCreditsIncome() throws Exception {
        var rows = BankFeedService.rows(session(SWIGGY + "," + SALARY), IST);
        assertEquals(2, rows.size());
        var swiggy = rows.get(0);
        assertEquals("expense", swiggy.kind());
        assertEquals(new BigDecimal("249.00"), swiggy.amount());
        assertEquals("food", swiggy.category());
        assertEquals("Swiggy", swiggy.note());
        // 20:05 UTC is 01:35 the next day in India: dated where the user lives.
        assertEquals(LocalDate.of(2026, 10, 11), swiggy.day());
        assertTrue(swiggy.extra().contains("\"source\":\"bank\""));
        assertTrue(swiggy.extra().contains("\"bankMask\":\"4373\""));
        assertFalse(swiggy.extra().contains("XXXXXX"), "no more of the account number than four digits");
        var pay = rows.get(1);
        assertEquals("income", pay.kind());
        assertEquals("salary", pay.category());
    }

    @Test
    void theSameTransactionAlwaysGetsTheSameId() throws Exception {
        var a = BankFeedService.rows(session(SWIGGY), IST).get(0).id();
        var b = BankFeedService.rows(session(SWIGGY), IST).get(0).id();
        assertEquals(a, b);
        assertTrue(a.startsWith("bank-") && a.length() <= 64);
        var other = BankFeedService.rows(session(SALARY), IST).get(0).id();
        assertNotEquals(a, other);
    }

    @Test
    void oddRowsAreSkippedNotFatal() throws Exception {
        var rows = BankFeedService.rows(session("""
                {"txnId":"X","type":"OPENING","amount":"5"},
                {"txnId":"Y","type":"DEBIT","amount":"abc","transactionTimestamp":"2026-10-01T00:00:00Z"},
                {"txnId":"Z","type":"DEBIT","amount":"10"},
                {"type":"DEBIT","amount":"99","valueDate":"2026-10-02","narration":"POS/UBER INDIA"}"""), IST);
        assertEquals(1, rows.size(), "no type, no amount, or no date = skipped");
        assertEquals("transport", rows.get(0).category());
        assertTrue(rows.get(0).id().startsWith("bank-"), "no txnId still gets a stable id");
    }

    @Test
    void categoryGuessesAndMerchantNames() {
        assertEquals("entertainment", BankFeedService.category("ACH/NETFLIX COM/123"));
        assertEquals("shopping", BankFeedService.category("UPI/DR/1/AMAZON PAY/UTIB"));
        assertEquals("others", BankFeedService.category("UPI/DR/1/RAMESH KUMAR/SBIN"));
        assertEquals("others", BankFeedService.category("UPI/DR/1/COLA/SBIN"), "ola inside a word is not Ola");
        assertEquals("Ramesh kumar", BankFeedService.merchant("UPI/DR/1234567890/RAMESH KUMAR/SBIN0001234/x@okhdfc"));
        assertEquals("4373", BankFeedService.tail("XXXXXX4373"));
    }

    @Test
    void theWebhookNeedsTheConfiguredToken() {
        assertTrue(BankFeedController.tokenValid("s3cret", "s3cret"));
        assertFalse(BankFeedController.tokenValid("s3cret", "nope"));
        assertFalse(BankFeedController.tokenValid("s3cret", null));
        assertFalse(BankFeedController.tokenValid("", ""), "no token configured = every call refused");
    }

    @Test
    void withNoCredentialsNothingIsCalledAndRoutesSaySo() {
        BankFeedClient setu = mock(BankFeedClient.class);
        when(setu.isConfigured()).thenReturn(false);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var feed = new BankFeedService(setu, mock(MoneyLedger.class), jdbc, mock(UserClock.class), JSON);
        UUID u = UUID.randomUUID();
        assertFalse(feed.status(u).path("configured").asBoolean());
        assertEquals(0, feed.status(u).path("consents").size());
        assertThrows(ApiException.class, () -> feed.connect(u, "9876543210"));
        assertThrows(ApiException.class, () -> feed.syncNow(u));
        feed.tick();
        feed.onNotification(JSON.createObjectNode().put("consentId", "c1").put("type", "CONSENT_STATUS_UPDATE"));
        verifyNoInteractions(jdbc);
    }

    @Test
    void aBadMobileIsRefusedBeforeSetuIsCalled() {
        BankFeedClient setu = mock(BankFeedClient.class);
        when(setu.isConfigured()).thenReturn(true);
        var feed = new BankFeedService(setu, mock(MoneyLedger.class), mock(JdbcTemplate.class), mock(UserClock.class), JSON);
        assertThrows(ApiException.class, () -> feed.connect(UUID.randomUUID(), "12345"));
        org.mockito.Mockito.verify(setu, org.mockito.Mockito.never()).createConsent(any(), any(), any());
    }
}
