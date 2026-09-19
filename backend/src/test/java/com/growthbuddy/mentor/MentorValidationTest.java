package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.junit.jupiter.api.Test;

/**
 * The mentor payloads are the only write DTOs in this app that ever shipped
 * without bounds. A thread title past the column's 255 reached the insert and
 * came back a 500 saying "Something went wrong" — which is all the user saw.
 */
class MentorValidationTest {

    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    @Test
    void anOverlongThreadTitleIsRefusedBeforeItReachesTheColumn() {
        assertThat(validator.validate(new CreateThreadRequest("x".repeat(5000)))).isNotEmpty();
        assertThat(validator.validate(new CreateThreadRequest("Plan my week"))).isEmpty();
        assertThat(validator.validate(new CreateThreadRequest(null)))
                .as("no title is fine — the service names it for you").isEmpty();
    }

    /** content is MEDIUMTEXT so nothing overflows, but it is also the prompt. */
    @Test
    void anUnboundedMessageIsRefusedBecauseItIsAlsoAnUnboundedPrompt() {
        assertThat(validator.validate(new PostMessageRequest("x".repeat(5000)))).isNotEmpty();
        assertThat(validator.validate(new PostMessageRequest("How do I start?"))).isEmpty();
    }
}
