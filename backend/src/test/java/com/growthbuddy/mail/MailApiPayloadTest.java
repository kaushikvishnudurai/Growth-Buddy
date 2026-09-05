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
    void buildsMailjetShape() throws Exception {
        JsonNode n = json.readTree(MailService.buildApiPayload(
                json, "me@gmail.com", "Growth Buddy", "you@example.com",
                "Your Growth Buddy code: 123456", "Hi,\n\n123456"));

        // Mailjet batches even a single message, and capitalises every key.
        assertTrue(n.path("Messages").isArray());
        JsonNode m = n.path("Messages").get(0);
        assertEquals("me@gmail.com", m.path("From").path("Email").asText());
        assertEquals("Growth Buddy", m.path("From").path("Name").asText());
        assertTrue(m.path("To").isArray());
        assertEquals("you@example.com", m.path("To").get(0).path("Email").asText());
        assertEquals("Your Growth Buddy code: 123456", m.path("Subject").asText());
        assertEquals("Hi,\n\n123456", m.path("TextPart").asText());
    }

    @Test
    void escapesQuotesAndNewlinesInsteadOfBreakingTheJson() throws Exception {
        String nasty = "Alex \"The \\ Great\"\nsecond line";
        JsonNode n = json.readTree(MailService.buildApiPayload(
                json, "me@gmail.com", nasty, "you@example.com", "s", "b"));
        // Round-trips intact: proves escaping happened rather than corrupting the doc.
        assertEquals(nasty, n.path("Messages").get(0).path("From").path("Name").asText());
    }
}
