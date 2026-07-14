package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository users;
    private final AuthService auth;
    private final SessionService sessions;

    public AuthController(UserRepository users, AuthService auth, SessionService sessions) {
        this.users = users;
        this.auth = auth;
        this.sessions = sessions;
    }

    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthUserResponse signup(@Valid @RequestBody SignupRequest req) {
        return auth.signup(req);
    }

    @PostMapping("/login")
    public AuthUserResponse login(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        return auth.login(req, http);
    }

    @PostMapping("/verify")
    public AuthUserResponse verify(@Valid @RequestBody VerifyOtpRequest req, HttpServletRequest http) {
        return auth.verifyEmail(req, http);
    }

    @PostMapping("/resend-verification")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resendVerification(@Valid @RequestBody EmailOnlyRequest req) {
        auth.resendVerification(req);
    }

    @PostMapping("/forgot-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void forgotPassword(@Valid @RequestBody EmailOnlyRequest req) {
        auth.forgotPassword(req);
    }

    @PostMapping("/reset-password")
    public AuthUserResponse resetPassword(@Valid @RequestBody ResetPasswordRequest req, HttpServletRequest http) {
        return auth.resetPassword(req, http);
    }

    /** Revoke the bearer token in the Authorization header. Idempotent. */
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader != null && authHeader.regionMatches(true, 0, "Bearer ", 0, 7)) {
            sessions.revoke(authHeader.substring(7).trim());
        }
    }

    @GetMapping("/me")
    public AuthUserResponse me() {
        User user = users.findById(CurrentUser.id())
                .orElseThrow(() -> ApiException.notFound("User not found"));
        return AuthUserResponse.from(user);
    }

    /** Active sessions for the current user, marking the one making this request. */
    @GetMapping("/sessions")
    public java.util.List<SessionSummary> sessions(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        java.util.UUID currentId = sessions.sessionIdForToken(bearer(authHeader));
        return sessions.listActive(CurrentUser.id()).stream()
                .map(s -> new SessionSummary(
                        s.getId(),
                        s.getDeviceLabel() != null ? s.getDeviceLabel() : shortenAgent(s.getUserAgent()),
                        s.getIp(),
                        s.getCreatedAt(),
                        s.getLastUsedAt(),
                        s.getId().equals(currentId)))
                .toList();
    }

    /** Revoke (sign out) one session by id. */
    @DeleteMapping("/sessions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revokeSession(@PathVariable java.util.UUID id) {
        if (!sessions.revokeById(CurrentUser.id(), id)) {
            throw ApiException.notFound("Session not found");
        }
    }

    /** Change password; boots all other sessions and returns a fresh token. */
    @PostMapping("/change-password")
    public AuthUserResponse changePassword(@Valid @RequestBody ChangePasswordRequest req, HttpServletRequest http) {
        return auth.changePassword(CurrentUser.id(), req, http);
    }

    /** Permanently delete the current user's account and data (password required). */
    @PostMapping("/delete-account")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@Valid @RequestBody DeleteAccountRequest req) {
        auth.deleteAccount(CurrentUser.id(), req.password());
    }

    private static String bearer(String header) {
        return (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7))
                ? header.substring(7).trim() : null;
    }

    /** Compress a raw User-Agent into a short, human label like "Chrome on macOS". */
    private static String shortenAgent(String ua) {
        if (ua == null || ua.isBlank()) return "Unknown device";
        String s = ua;
        String browser = s.contains("Edg") ? "Edge"
                : s.contains("Chrome") ? "Chrome"
                : s.contains("Firefox") ? "Firefox"
                : s.contains("Safari") ? "Safari" : "Browser";
        String os = s.contains("iPhone") || s.contains("iPad") ? "iOS"
                : s.contains("Android") ? "Android"
                : s.contains("Mac OS") || s.contains("Macintosh") ? "macOS"
                : s.contains("Windows") ? "Windows"
                : s.contains("Linux") ? "Linux" : "device";
        return browser + " on " + os;
    }

    @PutMapping("/whatsapp")
    public AuthUserResponse updateWhatsApp(@Valid @RequestBody UpdateWhatsAppRequest req) {
        return auth.updateWhatsApp(CurrentUser.id(), req);
    }

    @PostMapping("/whatsapp/send-otp")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void sendWhatsAppOtp(@Valid @RequestBody SendWhatsAppOtpRequest req) {
        auth.sendWhatsAppOtp(CurrentUser.id(), req);
    }

    @PostMapping("/whatsapp/verify-otp")
    public AuthUserResponse verifyWhatsAppOtp(@Valid @RequestBody VerifyWhatsAppOtpRequest req) {
        return auth.verifyWhatsAppOtp(CurrentUser.id(), req);
    }

    @PutMapping("/profile")
    public AuthUserResponse updateProfile(@Valid @RequestBody UpdateProfileRequest req) {
        return auth.updateProfile(CurrentUser.id(), req);
    }

    @PutMapping("/features")
    public AuthUserResponse updateFeatures(@RequestBody UpdateFeaturesRequest req) {
        return auth.updateFeatures(CurrentUser.id(), req.features());
    }

    @PutMapping("/ui-prefs")
    public AuthUserResponse updateUiPrefs(@RequestBody UpdateUiPrefsRequest req) {
        return auth.updateUiPrefs(CurrentUser.id(), req.prefs());
    }

    @PutMapping("/digest")
    public AuthUserResponse updateDigest(@Valid @RequestBody UpdateDigestRequest req) {
        return auth.updateDigest(CurrentUser.id(), req);
    }

    @PutMapping("/home-layout")
    public AuthUserResponse updateHomeLayout(@Valid @RequestBody UpdateHomeLayoutRequest req) {
        return auth.updateHomeLayout(CurrentUser.id(), req.layout());
    }

    @PutMapping("/nav-layout")
    public AuthUserResponse updateNavLayout(@Valid @RequestBody UpdateNavLayoutRequest req) {
        return auth.updateNavLayout(CurrentUser.id(), req.layout());
    }

    @PostMapping("/nutrition-suggestion")
    public NutritionSuggestionResponse nutritionSuggestion(
            @Valid @RequestBody(required = false) UpdateProfileRequest req) {
        return auth.nutritionSuggestion(CurrentUser.id(), req);
    }
}
