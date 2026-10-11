package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** BUG-015: validation text is shown to users verbatim, so no field names and no Bean Validation phrasing. */
class ValidationMessageTest {

    @Test
    void readsLikeASentence() {
        assertEquals("Bedtime is not a value we accept.",
                GlobalExceptionHandler.humanMessage("bedtime", "Pattern", "must match \"([01]\\d|2[0-3]):[0-5]\\d\""));
        assertEquals("Otp must be a 6-digit code.",
                GlobalExceptionHandler.humanMessage("otp", "Pattern", "must be a 6-digit code"));
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
