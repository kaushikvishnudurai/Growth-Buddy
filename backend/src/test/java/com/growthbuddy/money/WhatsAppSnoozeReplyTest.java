package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** What a typed reply has to look like to be taken as a snooze — and what must not be. */
class WhatsAppSnoozeReplyTest {

    private static boolean snooze(String s) {
        return WhatsAppWebhookController.SNOOZE_REPLY.matcher(s).matches();
    }

    @Test
    void shortRepliesSnooze() {
        assertThat(snooze("snooze")).isTrue();
        assertThat(snooze(" SNOOZE ")).isTrue();
        assertThat(snooze("Snooze.")).isTrue();
        assertThat(snooze("snooze 20")).isTrue();
        assertThat(snooze("snooze 15 min")).isTrue();
        assertThat(snooze("snooze 5 minutes")).isTrue();
    }

    @Test
    void chatDoesNot() {
        assertThat(snooze("don't snooze")).isFalse();
        assertThat(snooze("snooze until tomorrow please")).isFalse();
        assertThat(snooze("snoozed")).isFalse();
        assertThat(snooze("snooze 1000")).isFalse();
    }

    @Test
    void onlyATextMessageHasABody() throws Exception {
        ObjectMapper json = new ObjectMapper();
        assertThat(WhatsAppWebhookController.textBody(json.readTree(
                "{\"type\":\"text\",\"text\":{\"body\":\"snooze\"}}"))).isEqualTo("snooze");
        assertThat(WhatsAppWebhookController.textBody(json.readTree(
                "{\"type\":\"button\",\"button\":{\"payload\":\"snooze:x\"}}"))).isNull();
    }
}
