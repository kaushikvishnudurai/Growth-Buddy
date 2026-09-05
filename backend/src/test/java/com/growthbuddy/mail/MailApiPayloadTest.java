package com.growthbuddy.mail;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** Mirrors WhatsAppBodyTest: the wire shape is the part worth pinning down. */
class MailApiPayloadTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void buildsBrevoShape() throws Exception {
        JsonNode n = json.readTree(MailService.buildApiPayload(
                json, "me@gmail.com", "Growth Buddy", "you@example.com",
                "Your Growth Buddy code: 123456", "Hi,\n\n123456"));

        assertEquals("me@gmail.com", n.path("sender").path("email").asText());
        assertEquals("Growth Buddy", n.path("sender").path("name").asText());
        // `to` is an array of objects, not a bare string — Brevo 400s otherwise.
        assertTrue(n.path("to").isArray());
        assertEquals("you@example.com", n.path("to").get(0).path("email").asText());
        assertEquals("Your Growth Buddy code: 123456", n.path("subject").asText());
        assertEquals("Hi,\n\n123456", n.path("textContent").asText());
    }

    @Test
    void escapesQuotesAndNewlinesInsteadOfBreakingTheJson() throws Exception {
        String nasty = "Alex \"The \\ Great\"\nsecond line";
        JsonNode n = json.readTree(MailService.buildApiPayload(
                json, "me@gmail.com", nasty, "you@example.com", "s", "b"));
        // Round-trips intact: proves escaping happened rather than corrupting the doc.
        assertEquals(nasty, n.path("sender").path("name").asText());
    }
}
