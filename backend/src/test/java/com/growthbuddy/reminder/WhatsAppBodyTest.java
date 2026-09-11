package com.growthbuddy.reminder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The Cloud API rejects a malformed payload with a 400 that reads like a config error. */
class WhatsAppBodyTest {

    @Test
    void textWhenNoTemplateConfigured() {
        assertEquals(
                "{\"messaging_product\":\"whatsapp\",\"to\":\"919000000000\","
                        + "\"type\":\"text\",\"text\":{\"body\":\"hi\"}}",
                WhatsAppService.buildBody("919000000000", "", "en", "hi"));
    }

    @Test
    void templateCarriesTheMessageAsTheFirstBodyVariable() {
        assertEquals(
                "{\"messaging_product\":\"whatsapp\",\"to\":\"919000000000\","
                        + "\"type\":\"template\",\"template\":{\"name\":\"gb_reminder\","
                        + "\"language\":{\"code\":\"en\"},\"components\":[{\"type\":\"body\","
                        + "\"parameters\":[{\"type\":\"text\",\"text\":\"take meds\"}]}]}}",
                WhatsAppService.buildBody("919000000000", "gb_reminder", "en", "take meds"));
    }

    @Test
    void quotesInAReminderCannotBreakOutOfTheJson() {
        assertEquals(
                "{\"messaging_product\":\"whatsapp\",\"to\":\"1\",\"type\":\"template\","
                        + "\"template\":{\"name\":\"t\",\"language\":{\"code\":\"en\"},"
                        + "\"components\":[{\"type\":\"body\",\"parameters\":[{\"type\":\"text\","
                        + "\"text\":\"say \\\"hi\\\"\"}]}]}}",
                WhatsAppService.buildBody("1", "t", "en", "say \"hi\""));
    }

    @Test
    void authTemplateRepeatsTheCodeInBodyAndCopyButton() {
        assertEquals(
                "{\"messaging_product\":\"whatsapp\",\"to\":\"919000000000\","
                        + "\"type\":\"template\",\"template\":{\"name\":\"gb_verification\","
                        + "\"language\":{\"code\":\"en_US\"},\"components\":["
                        + "{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\"123456\"}]},"
                        + "{\"type\":\"button\",\"sub_type\":\"url\",\"index\":\"0\","
                        + "\"parameters\":[{\"type\":\"text\",\"text\":\"123456\"}]}]}}",
                WhatsAppService.buildAuthBody("919000000000", "gb_verification", "en_US", "123456"));
    }

    /** Meta 132000-rejects any template parameter containing a newline or tab. */
    @Test
    void otpFallbackTextStaysOnOneLine() {
        String text = WhatsAppService.otpText("123456");
        assertTrue(text.contains("123456"));
        assertFalse(text.matches("(?s).*[\\n\\r\\t].*"), text);
    }
}
