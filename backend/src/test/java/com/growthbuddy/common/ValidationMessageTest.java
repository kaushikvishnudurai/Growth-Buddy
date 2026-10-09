package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** BUG-015: validation text is shown to users verbatim, so no field names and no Bean Validation phrasing. */
class ValidationMessageTest {

    @Test
    void readsLikeASentence() {
        assertEquals("Enter a valid email address.",
                GlobalExceptionHandler.humanMessage("email", "Email", "must be a well-formed email address"));
        assertEquals("Weight (kg) must be 400 or less.",
                GlobalExceptionHandler.humanMessage("weightKg", "Max", "must be less than or equal to 400"));
        assertEquals("Height (cm) must be at least 2.",
                GlobalExceptionHandler.humanMessage("members[0].heightCm", "Min", "must be greater than or equal to 2"));
        assertEquals("Display name is too long (at most 120).",
                GlobalExceptionHandler.humanMessage("displayName", "Size", "size must be between 0 and 120"));
        assertEquals("Password is required.",
                GlobalExceptionHandler.humanMessage("password", "NotBlank", "must not be blank"));
    }
}
