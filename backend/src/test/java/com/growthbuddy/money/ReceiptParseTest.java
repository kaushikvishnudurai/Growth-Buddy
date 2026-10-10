package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

/** The model's receipt JSON becomes expenses, so what it may not smuggle through is pinned here. */
class ReceiptParseTest {

    private final ObjectMapper json = new ObjectMapper();

    private MoneyService.ReceiptScan parse(String s) throws Exception {
        return MoneyService.parseReceipt(json.readTree(s));
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
    void discountLargerThanItsLineRemovesIt() throws Exception {
        var r = parse("{\"items\":[{\"name\":\"Soap\",\"amount\":20},{\"name\":\"Coupon\",\"amount\":-25}]}");
        assertThat(r.items()).isEmpty();
    }

    @Test
    void badDateAndMissingFieldsAreNull() throws Exception {
        var r = parse("{\"items\":[],\"date\":\"8 Oct\",\"merchant\":null}");
        assertThat(r.items()).isEmpty();
        assertThat(r.date()).isNull();
        assertThat(r.merchant()).isNull();
    }
}
