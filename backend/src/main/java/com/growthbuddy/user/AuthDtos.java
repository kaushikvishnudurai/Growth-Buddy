package com.growthbuddy.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Update a user's per-feature on/off toggles (e.g. {"water":false}). */
record UpdateFeaturesRequest(Map<String, Boolean> features) {}

/** Merge client UI prefs (theme, language, onboarding flag, seen achievements). */
record UpdateUiPrefsRequest(Map<String, Object> prefs) {}

/** Update the progress-digest cadence ("off"|"daily"|"weekly") and send hour. */
record UpdateDigestRequest(
        @Size(max = 16) String frequency,
        @Min(0) @Max(23) Integer hour) {
}

/** Replace the user's ordered home-screen layout (which widgets show, in order). */
record UpdateHomeLayoutRequest(@Size(max = 40) List<HomeLayoutItem> layout) {
}

/** Replace the user's ordered bottom-nav layout (primary bar vs More, in order). */
record UpdateNavLayoutRequest(@Size(max = 40) List<NavLayoutItem> layout) {
}

record SignupRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(min = 8, max = 128) String password,
        @Size(max = 120) String displayName,
        @Size(max = 64) String timezone) {
}

/**
 * {@code code}: the authenticator code or a recovery code, sent on the second
 * try once the first answered 401 {@code totp_required}. {@code cancelDeletion}:
 * the "Cancel deletion" button on the 409 {@code deletion_scheduled} screen.
 */
record LoginRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(max = 128) String password,
        @Size(max = 32) String code,
        Boolean cancelDeletion) {

    LoginRequest(String email, String password) {
        this(email, password, null, null);
    }
}

record ChangeEmailRequest(
        @NotBlank @Email @Size(max = 254) String newEmail,
        @NotBlank @Size(max = 128) String password) {
}

record ConfirmEmailChangeRequest(
        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String code) {
}

record TotpCodeRequest(@NotBlank @Size(max = 32) String code) {
}

record TotpDisableRequest(
        @NotBlank @Size(max = 128) String password,
        @NotBlank @Size(max = 32) String code) {
}

/** Settings → Account: is 2FA on, how many recovery codes remain, an email change awaiting its code. */
record AccountSecurityStatus(boolean twoFactorEnabled, int recoveryCodesLeft, String pendingEmail) {
}

record TotpSetupResponse(String secret, String otpauthUri) {
}

record RecoveryCodesResponse(List<String> recoveryCodes) {
}

record ChangePasswordRequest(
        @NotBlank @Size(max = 128) String currentPassword,
        @NotBlank @Size(min = 8, max = 128) String newPassword) {
}

record DeleteAccountRequest(@NotBlank @Size(max = 128) String password) {
}

/** One active session/device, as shown on the Security screen. */
record SessionSummary(
        java.util.UUID id,
        String device,
        String ip,
        java.time.Instant createdAt,
        java.time.Instant lastUsedAt,
        boolean current) {
}

record VerifyOtpRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String otp) {
}

record EmailOnlyRequest(
        @NotBlank @Email @Size(max = 254) String email) {
}

record ResetPasswordRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String otp,
        @NotBlank @Size(min = 8, max = 128) String password) {
}

record UpdateTimezoneRequest(@NotBlank @Size(max = 64) String timezone) {
}

record UpdateWhatsAppRequest(
        @Pattern(regexp = "^\\+?[1-9]\\d{7,14}$", message = "must be a valid international number") String number,
        Boolean enabled) {
}

record SendWhatsAppOtpRequest(
        @NotBlank @Pattern(regexp = "^\\+?[1-9]\\d{7,14}$", message = "must be a valid international number") String number) {
}

record VerifyWhatsAppOtpRequest(
        @NotBlank @Pattern(regexp = "^\\+?[1-9]\\d{7,14}$", message = "must be a valid international number") String number,
        @NotBlank @Pattern(regexp = "\\d{6}", message = "must be a 6-digit code") String otp) {
}

record UpdateProfileRequest(
        @Size(max = 120) String displayName,
        @Size(max = 64) String timezone,
        LocalDate dob,
        @Min(10) @Max(100) Integer ageYears,
        @Min(100) @Max(250) Integer heightCm,
        @Min(25) @Max(300) Integer weightKg,
        @Size(max = 20) String gender,
        @Size(max = 100) String fitnessGoal,
        @Size(max = 64) String dietPreference,
        @Size(max = 500) String aboutMe,
        @Size(max = 255) String allergicTo,
        @Size(max = 120) String favouriteDish,
        @Min(800) @Max(6000) Integer dailyFoodGoalKcal,
        @Min(1000) @Max(7000) Integer dailyWaterGoalMl) {
}

record NutritionSuggestionResponse(
        int recommendedWaterMl,
        int recommendedFoodGoalKcal,
        List<String> indianFoodSuggestions,
        String guidance) {
}

/**
 * Standard auth response. {@code token} is non-null only on signin / verify /
 * password-reset (responses that establish a fresh session). Sign-up returns
 * no token — the user verifies their email first.
 */
record AuthUserResponse(
        java.util.UUID id,
        String email,
        String displayName,
        String timezone,
        String gender,
        String fitnessGoal,
        String whatsappNumber,
        boolean whatsappEnabled,
        boolean whatsappVerified,
        LocalDate dob,
        Integer ageYears,
        Integer heightCm,
        Integer weightKg,
        String dietPreference,
        String aboutMe,
        String allergicTo,
        String favouriteDish,
        Integer dailyFoodGoalKcal,
        Integer dailyWaterGoalMl,
        int level,
        int xpTotal,
        int xpIntoLevel,
        int xpForNextLevel,
        int xpPerLevel,
        boolean emailVerified,
        Map<String, Boolean> features,
        String digestFrequency,
        int digestHour,
        List<HomeLayoutItem> homeLayout,
        List<NavLayoutItem> navLayout,
        Map<String, Object> uiPrefs,
        String token) {

    static AuthUserResponse from(User user) {
        return build(user, null);
    }

    static AuthUserResponse withToken(User user, String token) {
        return build(user, token);
    }

    private static AuthUserResponse build(User user, String token) {
        return new AuthUserResponse(user.getId(), user.getEmail(), user.getDisplayName(),
                user.getTimezone(), user.getGender(), user.getFitnessGoal(),
                user.getWhatsappNumber(), user.isWhatsappEnabled(), user.isWhatsappVerified(),
                user.getDob(), user.getAgeYears(), user.getHeightCm(), user.getWeightKg(),
                user.getDietPreference(), user.getAboutMe(),
                user.getAllergicTo(), user.getFavouriteDish(),
                user.getDailyFoodGoalKcal(), user.getDailyWaterGoalMl(),
                user.getLevel(), user.getXpTotal(),
                ProgressService.xpIntoLevel(user.getXpTotal()),
                ProgressService.xpForNextLevel(user.getXpTotal()),
                ProgressService.XP_PER_LEVEL, user.isEmailVerified(),
                user.getFeaturePrefs(), user.getDigestFrequency(), user.getDigestHour(),
                user.getHomeLayout(), user.getNavLayout(), user.getUiPrefs(), token);
    }
}
