package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.common.ThrottleStore;
import com.growthbuddy.mentor.OpenAIClient.StreamChunk;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntUnaryOperator;
import org.junit.jupiter.api.Test;

/**
 * Reading a streamed reply line by line. Like {@link AiPayloadTest}, this is the
 * half that fails quietly: a parser aimed at the wrong field skips every chunk
 * and Buddy "replies" with nothing.
 */
class OpenAIStreamTest {

    @Test
    void readsTheDeltaTextOfAChunk() {
        StreamChunk c = OpenAIClient.parseStreamLine(
                "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi there\"}}]}");
        assertThat(c).isEqualTo(new StreamChunk("Hi there", false));
        // No space after the colon is the same line.
        assertThat(OpenAIClient.parseStreamLine("data:{\"choices\":[{\"delta\":{\"content\":\"x\"}}]}"))
                .isEqualTo(new StreamChunk("x", false));
    }

    @Test
    void whitespaceInsideADeltaIsKept() {
        assertThat(OpenAIClient.parseStreamLine(
                "data: {\"choices\":[{\"delta\":{\"content\":\" next\\nline \"}}]}").text())
                .isEqualTo(" next\nline ");
    }

    @Test
    void doneEndsTheStream() {
        assertThat(OpenAIClient.parseStreamLine("data: [DONE]")).isSameAs(StreamChunk.DONE);
        assertThat(OpenAIClient.parseStreamLine("data:[DONE]").done()).isTrue();
    }

    @Test
    void contentPartsAreJoined() {
        assertThat(OpenAIClient.parseStreamLine(
                "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"a\"},"
                        + "{\"type\":\"text\",\"text\":\"b\"}]}}]}").text())
                .isEqualTo("ab");
    }

    @Test
    void everythingThatIsNotTextIsSkipped() {
        for (String line : new String[] {
                null,
                "",
                ": keep-alive",
                "event: message",
                "id: 7",
                "data:",
                "data:    ",
                "data: {not json",
                "data: \"just a string\"",
                "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}",
                "data: {\"choices\":[]}",
                "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}",
                "{\"choices\":[{\"delta\":{\"content\":\"no data prefix\"}}]}",
        }) {
            assertThat(OpenAIClient.parseStreamLine(line)).as(String.valueOf(line)).isNull();
        }
    }

    @Test
    void anErrorMidStreamThrowsRatherThanEndingTheReplyShort() {
        assertThatThrownBy(() -> OpenAIClient.parseStreamLine(
                "data: {\"error\":{\"message\":\"overloaded\",\"type\":\"server_error\"}}"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("overloaded");
    }

    /** Always over budget: the refusal must land before a single delta. */
    private static class SpentStore implements ThrottleStore {
        @Override public int countHit(String bucketKey, long windowStart) {
            return 10_000;
        }

        @Override public void sweepCounters(long cutoffWindowStart) { }

        @Override public Attempt attempt(String key) {
            return Attempt.NONE;
        }

        @Override public void recordFailure(String key, IntUnaryOperator lockMsForFailures) { }

        @Override public void clearAttempt(String key) { }

        @Override public void sweepAttempts(long cutoffMs) { }
    }

    @Test
    void theBudgetRefusesAStreamBeforeAnyDelta() {
        OpenAIClient client = new OpenAIClient("test-key", "m", "https://example.invalid/compat",
                new RateLimiter(new SpentStore()));
        List<String> deltas = new ArrayList<>();
        assertThatThrownBy(() -> client.stream("system", List.of(), 500, deltas::add, () -> false))
                .isInstanceOf(ApiException.class);
        assertThat(deltas).isEmpty();
    }

    @Test
    void anUnconfiguredClientNeverStreams() {
        OpenAIClient client = new OpenAIClient("", "m", "", new RateLimiter(new SpentStore()));
        assertThatThrownBy(() -> client.stream("s", List.of(), 500, t -> { }, () -> false))
                .isInstanceOf(IllegalStateException.class);
    }
}
