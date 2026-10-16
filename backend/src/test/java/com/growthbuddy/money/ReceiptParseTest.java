package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/** The model's receipt JSON becomes expenses, so what it may not smuggle through is pinned here. */
class ReceiptParseTest {

    private final ObjectMapper json = new ObjectMapper();

    private MoneyService.ReceiptScan parse(String s) throws Exception {
        return MoneyService.parseReceipt(json.readTree(s), java.util.Set.of("food", "others"));
    }

    @Test
    void keepsLinesFoldsDiscountsAndDropsJunk() throws Exception {
        var r = parse("""
                {"items":[
                  {"name":"Milk","amount":56.004},
                  {"name":"Bread","amount":40},
                  {"name":"Offer","amount":-10},
                  {"name":"Free bag","amount":0},
                  {"name":"Huge","amount":99999999},
                  {"name":"Text price","amount":"30"},
                  {"name":"","amount":12.5}
                ],"date":"2026-10-08","merchant":"Corner Store"}""");
        assertThat(r.configured()).isTrue();
        assertThat(r.items()).extracting(MoneyService.ReceiptItem::name)
                .containsExactly("Milk", "Bread", "Receipt item");
        assertThat(r.items()).extracting(MoneyService.ReceiptItem::amount)
                .containsExactly(new BigDecimal("56.00"), new BigDecimal("30.00"), new BigDecimal("12.50"));
        assertThat(r.date()).isEqualTo("2026-10-08");
        assertThat(r.merchant()).isEqualTo("Corner Store");
    }

    @Test
    void keepsOnlyCategoriesTheUserHas() throws Exception {
        var r = parse("""
                {"items":[
                  {"name":"Toor dal","amount":120,"category":"food"},
                  {"name":"Offer","amount":-20},
                  {"name":"Bucket","amount":90,"category":"household"},
                  {"name":"Soap","amount":30}
                ]}""");
        assertThat(r.items()).extracting(MoneyService.ReceiptItem::category)
                .containsExactly("food", null, null);
        assertThat(r.items().get(0).amount()).isEqualTo(new BigDecimal("100.00"));
    }

    @Test
    void discountLargerThanItsLineRemovesIt() throws Exception {
        var r = parse("{\"items\":[{\"name\":\"Soap\",\"amount\":20},{\"name\":\"Coupon\",\"amount\":-25}]}");
        assertThat(r.items()).isEmpty();
    }

    /** A discount bigger than its line runs on into earlier lines; a leading one comes off the next line. */
    @Test
    void aDiscountIsNeverPartlyDropped() throws Exception {
        var r = parse("""
                {"items":[{"name":"Pizza","amount":400},{"name":"Coke","amount":60},{"name":"Discount","amount":-100}]}""");
        assertThat(r.items()).extracting(MoneyService.ReceiptItem::amount).containsExactly(new BigDecimal("360.00"));
        var lead = parse("""
                {"items":[{"name":"Discount","amount":-50},{"name":"Tea","amount":100}]}""");
        assertThat(lead.items()).extracting(MoneyService.ReceiptItem::amount).containsExactly(new BigDecimal("50.00"));
    }

    @Test
    void badDateAndMissingFieldsAreNull() throws Exception {
        var r = parse("{\"items\":[],\"date\":\"8 Oct\",\"merchant\":null}");
        assertThat(r.items()).isEmpty();
        assertThat(r.date()).isNull();
        assertThat(r.merchant()).isNull();
    }

    /** A rejected AI key is "unavailable", not an empty photo: the client says which. */
    @Test
    void aFailedAiCallIsUnavailableNotAnEmptyRead() {
        var openai = org.mockito.Mockito.mock(com.growthbuddy.mentor.OpenAIClient.class);
        org.mockito.Mockito.when(openai.isConfigured()).thenReturn(true);
        org.mockito.Mockito.when(openai.completeWithImage(org.mockito.ArgumentMatchers.anyString(),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString()))
                .thenThrow(new IllegalStateException("AI gateway 401"));
        var service = new MoneyService(org.mockito.Mockito.mock(MoneyRepository.class), new ObjectMapper(), openai,
                org.mockito.Mockito.mock(MoneyLedger.class));
        var r = service.scanReceipt("data:image/jpeg;base64,AAAA", java.util.Map.of("others", "Others"));
        assertThat(r.configured()).isTrue();
        assertThat(r.unavailable()).isTrue();
        assertThat(r.items()).isEmpty();

        org.mockito.Mockito.when(openai.isConfigured()).thenReturn(false);
        var none = service.scanReceipt("data:image/jpeg;base64,AAAA", java.util.Map.of("others", "Others"));
        assertThat(none.configured()).isFalse();
        assertThat(none.unavailable()).isFalse();
    }
}
