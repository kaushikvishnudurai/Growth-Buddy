package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;

import com.growthbuddy.common.RateLimiter;
import org.junit.jupiter.api.Test;

/**
 * Reading the reply is the half of the move from OpenAI to Claude that fails
 * silently. A wrong URL throws and someone sees it in the logs within minutes;
 * a parser still aimed at the old Responses API shape ({@code output[].content
 * []}) just returns "", which every AI feature turns into its canned fallback —
 * an app that looks like it works and has quietly stopped calling the model.
 */
class AiPayloadTest {

    private final OpenAIClient client =
            new OpenAIClient("token", "anthropic/claude-sonnet-4-5",
                    "https://example.invalid/compat", new RateLimiter(null));

    @Test
    void readsTheAssistantTextOutOfAChatCompletion() {
        String body = """
                {"choices":[{"index":0,"message":{"role":"assistant",
                 "content":"Two small wins beat one big plan."}}]}""";
        assertThat(client.extractContent(body)).isEqualTo("Two small wins beat one big plan.");
    }

    /** Some providers answer with content split into typed parts. */
    @Test
    void joinsContentPartsWhenTheReplyIsAnArray() {
        String body = """
                {"choices":[{"message":{"content":[
                  {"type":"text","text":"line one"},
                  {"type":"text","text":"line two"}]}}]}""";
        assertThat(client.extractContent(body)).isEqualTo("line one\nline two");
    }

    /**
     * Claude fences its JSON and sometimes introduces it; OpenAI's json_object
     * mode never did. Every caller that parsed the raw reply broke on the day we
     * switched, and broke the quiet way — canned fallback, no error.
     */
    @Test
    void findsTheJsonDocumentInsideAFencedOrChattyReply() {
        String doc = "{\"waterMl\":2000}";
        assertThat(OpenAIClient.jsonOf("```json\n" + doc + "\n```")).isEqualTo(doc);
        assertThat(OpenAIClient.jsonOf("```\n" + doc + "\n```")).isEqualTo(doc);
        assertThat(OpenAIClient.jsonOf("Here is the JSON:\n\n" + doc)).isEqualTo(doc);
        assertThat(OpenAIClient.jsonOf(doc)).isEqualTo(doc);
        assertThat(OpenAIClient.jsonOf("```json\n[1,2]\n```")).isEqualTo("[1,2]");
        assertThat(OpenAIClient.jsonOf(null)).isEmpty();
    }

    /** The old shape must not quietly read as an empty answer. */
    @Test
    void anEmptyOrForeignPayloadReadsAsEmpty() {
        assertThat(client.extractContent("{\"output\":[{\"type\":\"message\"}]}")).isEmpty();
        assertThat(client.extractContent("{}")).isEmpty();
    }
}
