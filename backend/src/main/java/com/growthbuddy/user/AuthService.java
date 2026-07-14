package com.growthbuddy.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mail.MailService;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import com.growthbuddy.reminder.WhatsAppService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.HttpServletRequest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns signup, login, email verification, and password reset.
 *
 * <ul>
 *   <li>Passwords are stored as bcrypt hashes in {@code password_credentials}.</li>
 *   <li>OTPs are 6-digit numeric strings; only their bcrypt hash is persisted
 *       in {@code email_verification_tokens} / {@code password_reset_tokens}.
 *       Verification scans the user's unconsumed tokens and matches with bcrypt.</li>
 *   <li>OTPs expire in 15 minutes. Issuing a new OTP invalidates older ones.</li>
 *   <li>Login on an unverified account returns 403 with code {@code email_unverified}
 *       and re-issues a fresh OTP so the frontend can route to /verify.</li>
 * </ul>
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final int OTP_TTL_MINUTES = 15;
    private static final Pattern E164 = Pattern.compile("^\\+[1-9]\\d{7,14}$");

    private final UserRepository users;
    private final PasswordCredentialRepository creds;
    private final EmailVerificationTokenRepository verifyTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final WhatsAppOtpTokenRepository waOtpTokens;
    private final MailService mail;
    private final SessionService sessions;
    private final OpenAIClient openai;
    private final RateLimiter rateLimiter;
    private final boolean prod;
    private final ObjectMapper json = new ObjectMapper();
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

    /** Cap OTP sends per user, independent of the per-IP limit: 5 per hour. */
    private static final int WA_OTP_PER_HOUR = 5;

    @Lazy
    @Autowired
    private WhatsAppService whatsApp;
    private final SecureRandom rng = new SecureRandom();

    @PersistenceContext
    private EntityManager em;

        private static final String NUTRITION_PROMPT = """
            You are a practical Indian nutrition coach.
            Respond with strict JSON only using keys:
            waterMl (integer), foodGoalKcal (integer), indianFoods (array of 6 strings), guidance (string under 220 chars).
            Keep food suggestions common in South Indian homes (idli, dosa, sambar, rasam, upma, pongal, curd rice, avial, etc.) and honour the diet preference.
            NEVER suggest any food that contains an ingredient listed under allergic, and do not mention that ingredient.
            If a favourite dish is given, work in a healthier take on it when it fits.
            Use whatever profile fields are provided; do not ask the user for more details.
            """;

    public AuthService(UserRepository users,
                       PasswordCredentialRepository creds,
                       EmailVerificationTokenRepository verifyTokens,
                       PasswordResetTokenRepository resetTokens,
                       WhatsAppOtpTokenRepository waOtpTokens,
                       MailService mail,
                       SessionService sessions,
                       OpenAIClient openai,
                       RateLimiter rateLimiter,
                       @org.springframework.beans.factory.annotation.Value("${spring.profiles.active:}") String activeProfiles) {
        this.users = users;
        this.creds = creds;
        this.verifyTokens = verifyTokens;
        this.resetTokens = resetTokens;
        this.waOtpTokens = waOtpTokens;
        this.mail = mail;
        this.sessions = sessions;
        this.openai = openai;
        this.rateLimiter = rateLimiter;
        this.prod = activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
    }

    @Transactional
    public AuthUserResponse signup(SignupRequest req) {
        String email = normalize(req.email());
        users.findByEmailIgnoreCase(email).ifPresent(existing -> {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "An account with this email already exists. Try signing in.");
        });
        User user = new User();
        user.setEmail(email);
        user.setDisplayName(resolveDisplayName(req.displayName(), email));
        user.setTimezone(resolveTimezone(req.timezone()));
        user.setEmailVerified(false);
        users.save(user);

        PasswordCredential c = new PasswordCredential();
        c.setUserId(user.getId());
        c.setPasswordHash(bcrypt.encode(req.password()));
        c.setAlgo("bcrypt");
        creds.save(c);

        issueVerificationOtp(user, "verification");
        return AuthUserResponse.from(user);
    }

    /**
     * Sign-in. Returns the user when credentials check out and email is verified.
     * If the email is not yet verified, throws 403 (the controller surfaces this so
     * the frontend can switch to the OTP screen).
     */
    @Transactional
    public AuthUserResponse login(LoginRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        User user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> ApiException.badRequest("Wrong email or password"));
        PasswordCredential c = creds.findById(user.getId())
                .orElseThrow(() -> ApiException.badRequest("Wrong email or password"));
        if (!bcrypt.matches(req.password(), c.getPasswordHash())) {
            throw ApiException.badRequest("Wrong email or password");
        }
        if (!user.isEmailVerified()) {
            // Sign-in must NOT send a verification email and must NOT reveal that
            // the account exists-but-unverified. Verification only happens during
            // signup, so an unverified account simply fails sign-in like any other
            // bad credential.
            throw ApiException.badRequest("Wrong email or password");
        }
        return AuthUserResponse.withToken(user, sessions.issue(user.getId(), http).token());
    }

    @Transactional
    public AuthUserResponse verifyEmail(VerifyOtpRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        // Same generic error whether the email is unknown or the code is wrong,
        // so verify can't be used to enumerate which emails have accounts.
        User user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> ApiException.badRequest("Invalid or expired code. Try resending."));
        EmailVerificationToken match = findMatchingToken(
                verifyTokens.findByUserIdAndConsumedAtIsNull(user.getId()),
                req.otp(), EmailVerificationToken::getExpiresAt, EmailVerificationToken::getTokenHash);
        if (match == null) {
            throw ApiException.badRequest("Invalid or expired code. Try resending.");
        }
        match.setConsumedAt(Instant.now());
        verifyTokens.save(match);
        user.setEmailVerified(true);
        users.save(user);
        return AuthUserResponse.withToken(user, sessions.issue(user.getId(), http).token());
    }

    @Transactional
    public void resendVerification(EmailOnlyRequest req) {
        users.findByEmailIgnoreCase(normalize(req.email())).ifPresent(u -> {
            if (!u.isEmailVerified()) {
                issueVerificationOtp(u, "verification");
            }
        });
        // Do not signal whether the email exists.
    }

    @Transactional
    public void forgotPassword(EmailOnlyRequest req) {
        users.findByEmailIgnoreCase(normalize(req.email())).ifPresent(u -> {
            issuePasswordResetOtp(u);
        });
        // Do not signal whether the email exists.
    }

    @Transactional
    public AuthUserResponse resetPassword(ResetPasswordRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        // Generic error for unknown email or wrong code (no enumeration oracle).
        User user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> ApiException.badRequest("Invalid or expired code. Request a new one."));
        PasswordResetToken match = findMatchingToken(
                resetTokens.findByUserIdAndConsumedAtIsNull(user.getId()),
                req.otp(), PasswordResetToken::getExpiresAt, PasswordResetToken::getTokenHash);
        if (match == null) {
            throw ApiException.badRequest("Invalid or expired code. Request a new one.");
        }
        match.setConsumedAt(Instant.now());
        resetTokens.save(match);

        PasswordCredential c = creds.findById(user.getId()).orElseGet(() -> {
            PasswordCredential fresh = new PasswordCredential();
            fresh.setUserId(user.getId());
            fresh.setAlgo("bcrypt");
            return fresh;
        });
        c.setPasswordHash(bcrypt.encode(req.password()));
        creds.save(c);

        // Successful reset doubles as proof of email ownership.
        if (!user.isEmailVerified()) {
            user.setEmailVerified(true);
            users.save(user);
        }
        // A reset invalidates every existing session — a thief's stolen token
        // must not survive the legitimate owner regaining control.
        sessions.revokeAllForUser(user.getId());
        return AuthUserResponse.withToken(user, sessions.issue(user.getId(), http).token());
    }

    /**
     * Change the password for a signed-in user. Verifies the current password,
     * stores the new bcrypt hash, then revokes every existing session and issues
     * a fresh one for this device — so a change also boots any other logins.
     */
    @Transactional
    public AuthUserResponse changePassword(UUID userId, ChangePasswordRequest req, HttpServletRequest http) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        PasswordCredential c = creds.findById(userId)
                .orElseThrow(() -> ApiException.badRequest("This account has no password set."));
        if (!bcrypt.matches(req.currentPassword(), c.getPasswordHash())) {
            throw ApiException.badRequest("Current password is incorrect.");
        }
        c.setPasswordHash(bcrypt.encode(req.newPassword()));
        creds.save(c);
        sessions.revokeAllForUser(userId);
        return AuthUserResponse.withToken(user, sessions.issue(userId, http).token());
    }

    /**
     * Permanently delete the user's account and their data. Verifies the password
     * first. Shared entities (circles, families) are intentionally left intact —
     * only the user's own membership/posts are removed. FK checks are disabled for
     * the purge so table order doesn't matter; each statement is best-effort so a
     * schema that lacks a legacy table doesn't abort the whole delete.
     */
    @Transactional
    public void deleteAccount(UUID userId, String password) {
        PasswordCredential c = creds.findById(userId)
                .orElseThrow(() -> ApiException.badRequest("This account has no password set."));
        if (!bcrypt.matches(password, c.getPasswordHash())) {
            throw ApiException.badRequest("Password is incorrect.");
        }
        // Children keyed by a parent id → delete via the user's parent rows first.
        String[][] childDeletes = {
            {"habit_streaks", "habit_id", "habits"},
            {"workout_exercises", "workout_id", "workouts"},
            {"mentor_messages", "thread_id", "mentor_threads"},
            {"calendar_reminder_skips", "reminder_id", "calendar_reminders"},
            {"reminder_dispatch_log", "reminder_id", "calendar_reminders"},
        };
        // Tables owning a direct user_id column.
        String[] userTables = {
            "user_preferences", "auth_identities", "password_credentials",
            "email_verification_tokens", "password_reset_tokens", "whatsapp_otp_tokens",
            "task_templates", "task_completion_history", "tasks",
            "habit_checkins", "habits", "streak_freeze_wallets",
            "water_entries", "water_goals", "food_entries", "food_photo_logs",
            "goal_actions", "goals", "gratitude_entries", "journal_entries",
            "workouts", "daily_scores", "daily_logs",
            "mentor_threads", "circle_members", "circle_posts",
            "device_tokens", "push_subscriptions", "xp_events", "notifications",
            "money_state", "reminders", "calendar_reminders", "sessions",
        };
        // Only touch tables that actually exist — the schema file lists some tables
        // that were never created (no JPA entity), and a DELETE against a missing
        // table throws a SQLException, which marks the whole transaction
        // rollback-only and aborts the purge.
        java.util.Set<String> existing = existingTables();

        exec("SET FOREIGN_KEY_CHECKS=0", null);
        for (String[] cd : childDeletes) {
            if (existing.contains(cd[0]) && existing.contains(cd[2])) {
                exec("DELETE FROM " + cd[0] + " WHERE " + cd[1]
                        + " IN (SELECT id FROM " + cd[2] + " WHERE user_id = ?1)", userId);
            }
        }
        for (String t : userTables) {
            if (existing.contains(t)) {
                exec("DELETE FROM " + t + " WHERE user_id = ?1", userId);
            }
        }
        exec("DELETE FROM users WHERE id = ?1", userId);
        exec("SET FOREIGN_KEY_CHECKS=1", null);
        sessions.revokeAllForUser(userId);
    }

    /** Lowercased set of tables present in the current schema. */
    @SuppressWarnings("unchecked")
    private java.util.Set<String> existingTables() {
        java.util.Set<String> out = new java.util.HashSet<>();
        for (Object r : em.createNativeQuery(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()")
                .getResultList()) {
            out.add(String.valueOf(r).toLowerCase());
        }
        return out;
    }

    /** Run one native statement (table already known to exist). */
    private void exec(String sql, UUID userId) {
        var q = em.createNativeQuery(sql);
        if (userId != null) q.setParameter(1, userId);
        q.executeUpdate();
    }

    @Transactional
    public AuthUserResponse updateWhatsApp(UUID userId, UpdateWhatsAppRequest req) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));

        // A toggle-only request ({"enabled":true}) carries no number — in that
        // case keep the number already on file instead of wiping it to null.
        boolean numberProvided = req.number() != null && !req.number().isBlank();
        String effectiveNumber = numberProvided ? normalizePhone(req.number()) : user.getWhatsappNumber();
        boolean enabled = req.enabled() != null && req.enabled();
        if (enabled && (effectiveNumber == null || effectiveNumber.isBlank())) {
            throw ApiException.badRequest("Provide a WhatsApp number before enabling reminders.");
        }

        user.setWhatsappNumber(effectiveNumber);
        user.setWhatsappEnabled(enabled);
        users.save(user);
        return AuthUserResponse.from(user);
    }

    @Transactional
    public void sendWhatsAppOtp(UUID userId, SendWhatsAppOtpRequest req) {
        users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        // Per-user cap so a logged-in account can't blast OTP messages to
        // arbitrary numbers (toll/spam abuse), independent of the per-IP limit.
        if (!rateLimiter.allow("waotp:" + userId, WA_OTP_PER_HOUR, 3_600_000L)) {
            throw ApiException.badRequest("Too many code requests. Please wait a while and try again.");
        }
        String normalized = normalizePhone(req.number());

        waOtpTokens.deleteAllForUser(userId);
        String otp = newOtp();
        WhatsAppOtpToken t = new WhatsAppOtpToken();
        t.setTokenHash(bcrypt.encode(otp));
        t.setUserId(userId);
        t.setPhone(normalized);
        t.setExpiresAt(Instant.now().plus(OTP_TTL_MINUTES, ChronoUnit.MINUTES));
        waOtpTokens.save(t);

        String message = "Your Growth Buddy verification code: " + otp
                + "\nDo not share this code.";
        if (whatsApp != null && whatsApp.isConfigured()) {
            whatsApp.sendReminder(normalized, message);
        } else if (prod) {
            log.error("WhatsApp not configured — cannot deliver OTP to {}.", normalized);
        } else {
            log.info("[DEV] WhatsApp OTP for {} → {}", normalized, otp);
        }
    }

    @Transactional
    public AuthUserResponse verifyWhatsAppOtp(UUID userId, VerifyWhatsAppOtpRequest req) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        String normalized = normalizePhone(req.number());

        List<WhatsAppOtpToken> tokens = waOtpTokens.findByUserIdAndConsumedAtIsNull(userId);
        WhatsAppOtpToken match = findMatchingWaToken(tokens, req.otp(), normalized);
        if (match == null) {
            throw ApiException.badRequest("Invalid or expired code. Request a new one.");
        }
        match.setConsumedAt(Instant.now());
        waOtpTokens.save(match);

        user.setWhatsappNumber(normalized);
        user.setWhatsappVerified(true);
        user.setWhatsappEnabled(true);
        users.save(user);
        return AuthUserResponse.from(user);
    }

    private WhatsAppOtpToken findMatchingWaToken(List<WhatsAppOtpToken> tokens, String otp, String phone) {
        Instant now = Instant.now();
        for (WhatsAppOtpToken t : tokens) {
            if (t.getExpiresAt() == null || t.getExpiresAt().isBefore(now)) continue;
            if (!phone.equals(t.getPhone())) continue;
            if (bcrypt.matches(otp, t.getTokenHash())) return t;
        }
        return null;
    }

    @Transactional
    public AuthUserResponse updateProfile(UUID userId, UpdateProfileRequest req) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));

        if (req.displayName() != null && !req.displayName().isBlank()) {
            user.setDisplayName(req.displayName().trim());
        }
        if (req.timezone() != null && !req.timezone().isBlank()) {
            user.setTimezone(req.timezone().trim());
        }
        if (req.gender() != null) user.setGender(clean(req.gender()));
        if (req.fitnessGoal() != null) user.setFitnessGoal(clean(req.fitnessGoal()));
        user.setDob(req.dob());
        if (req.dob() != null) {
            int age = yearsFromDob(req.dob(), LocalDate.now());
            if (age < 10 || age > 100) {
                throw ApiException.badRequest("Age from date of birth must be between 10 and 100 years.");
            }
            user.setAgeYears(age);
        } else {
            user.setAgeYears(req.ageYears());
        }
        user.setHeightCm(req.heightCm());
        user.setWeightKg(req.weightKg());
        user.setDietPreference(clean(req.dietPreference()));
        user.setAboutMe(clean(req.aboutMe()));
        user.setAllergicTo(clean(req.allergicTo()));
        user.setFavouriteDish(clean(req.favouriteDish()));
        user.setDailyFoodGoalKcal(req.dailyFoodGoalKcal());
        user.setDailyWaterGoalMl(req.dailyWaterGoalMl());
        users.save(user);
        return AuthUserResponse.from(user);
    }

    /** Merge per-feature on/off toggles into the user's preferences. */
    @Transactional
    public AuthUserResponse updateFeatures(UUID userId, java.util.Map<String, Boolean> features) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        java.util.Map<String, Boolean> prefs = user.getFeaturePrefs() != null
                ? new java.util.HashMap<>(user.getFeaturePrefs())
                : new java.util.HashMap<>();
        if (features != null) {
            features.forEach((k, v) -> {
                if (k != null && v != null) prefs.put(k, v);
            });
        }
        user.setFeaturePrefs(prefs);
        users.save(user);
        return AuthUserResponse.from(user);
    }

    /** Merge client UI prefs (theme, language, onboarding flag, seen achievements). */
    @Transactional
    public AuthUserResponse updateUiPrefs(UUID userId, java.util.Map<String, Object> prefs) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        java.util.Map<String, Object> merged = user.getUiPrefs() != null
                ? new java.util.HashMap<>(user.getUiPrefs())
                : new java.util.HashMap<>();
        if (prefs != null) {
            prefs.forEach((k, v) -> {
                if (k != null) merged.put(k, v);
            });
        }
        user.setUiPrefs(merged);
        users.save(user);
        return AuthUserResponse.from(user);
    }

    /** Update the progress-digest cadence and preferred send hour. */
    @Transactional
    public AuthUserResponse updateDigest(UUID userId, UpdateDigestRequest req) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        if (req.frequency() != null) {
            String f = req.frequency().trim().toLowerCase();
            if (!f.equals("off") && !f.equals("daily") && !f.equals("weekly")) {
                throw ApiException.badRequest("Digest frequency must be off, daily, or weekly.");
            }
            user.setDigestFrequency(f);
        }
        if (req.hour() != null) {
            user.setDigestHour(req.hour());
        }
        users.save(user);
        return AuthUserResponse.from(user);
    }

    /** Replace the user's ordered home-screen layout. Null clears it (defaults). */
    @Transactional
    public AuthUserResponse updateHomeLayout(UUID userId, java.util.List<HomeLayoutItem> layout) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        if (layout == null) {
            user.setHomeLayout(null);
        } else {
            java.util.List<HomeLayoutItem> clean = layout.stream()
                    .filter(i -> i != null && i.id() != null && !i.id().isBlank())
                    .map(i -> new HomeLayoutItem(i.id().trim(), i.enabled()))
                    .toList();
            user.setHomeLayout(clean);
        }
        users.save(user);
        return AuthUserResponse.from(user);
    }

    /** Replace the user's ordered bottom-nav layout. Null clears it (defaults). */
    @Transactional
    public AuthUserResponse updateNavLayout(UUID userId, java.util.List<NavLayoutItem> layout) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        if (layout == null) {
            user.setNavLayout(null);
        } else {
            java.util.List<NavLayoutItem> clean = layout.stream()
                    .filter(i -> i != null && i.id() != null && !i.id().isBlank())
                    .map(i -> new NavLayoutItem(i.id().trim(), i.primary()))
                    .toList();
            user.setNavLayout(clean);
        }
        users.save(user);
        return AuthUserResponse.from(user);
    }

    private static int yearsFromDob(LocalDate dob, LocalDate today) {
        int age = today.getYear() - dob.getYear();
        if (today.getMonthValue() < dob.getMonthValue()
                || (today.getMonthValue() == dob.getMonthValue() && today.getDayOfMonth() < dob.getDayOfMonth())) {
            age -= 1;
        }
        return age;
    }

    @Transactional(readOnly = true)
    public NutritionSuggestionResponse nutritionSuggestion(UUID userId, UpdateProfileRequest form) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        // Prefer the values the user just typed (unsaved form) over stored ones.
        Integer age = pick(form == null ? null : form.ageYears(), user.getAgeYears());
        Integer heightCm = pick(form == null ? null : form.heightCm(), user.getHeightCm());
        Integer weightKg = pick(form == null ? null : form.weightKg(), user.getWeightKg());
        String diet = pick(form == null ? null : form.dietPreference(), user.getDietPreference());
        String about = pick(form == null ? null : form.aboutMe(), user.getAboutMe());
        String allergicTo = pick(form == null ? null : form.allergicTo(), user.getAllergicTo());
        String favouriteDish = pick(form == null ? null : form.favouriteDish(), user.getFavouriteDish());
        Integer foodGoal = pick(form == null ? null : form.dailyFoodGoalKcal(), user.getDailyFoodGoalKcal());
        Integer waterGoal = pick(form == null ? null : form.dailyWaterGoalMl(), user.getDailyWaterGoalMl());

        NutritionSuggestionResponse base = heuristicSuggestion(weightKg, diet, allergicTo, foodGoal, waterGoal);
        if (!openai.isConfigured()) {
            return base;
        }
        try {
            String profile = "age=" + safe(age)
                    + ", heightCm=" + safe(heightCm)
                    + ", weightKg=" + safe(weightKg)
                    + ", diet=" + safe(diet)
                    + ", allergic=" + safe(allergicTo)
                    + ", favouriteDish=" + safe(favouriteDish)
                    + ", about=" + safe(about)
                    + ", currentFoodGoalKcal=" + safe(foodGoal)
                    + ", currentWaterGoalMl=" + safe(waterGoal);
            String raw = openai.complete(NUTRITION_PROMPT, List.of(new ChatTurn("user", profile)));
            JsonNode node = json.readTree(raw);
            int water = clamp(node.path("waterMl").asInt(base.recommendedWaterMl()), 1500, 6000);
            int kcal = clamp(node.path("foodGoalKcal").asInt(base.recommendedFoodGoalKcal()), 1200, 4200);
            List<String> foods = parseFoods(node.path("indianFoods"), base.indianFoodSuggestions());
            String guidance = textOr(node.path("guidance").asText(), base.guidance());
            return new NutritionSuggestionResponse(water, kcal, foods, guidance);
        } catch (Exception ex) {
            return base;
        }
    }

    /* ---- helpers ---- */

    private void issueVerificationOtp(User user, String purpose) {
        verifyTokens.deleteAllForUser(user.getId());
        String otp = newOtp();
        EmailVerificationToken t = new EmailVerificationToken();
        t.setTokenHash(bcrypt.encode(otp));
        t.setUserId(user.getId());
        t.setExpiresAt(Instant.now().plus(OTP_TTL_MINUTES, ChronoUnit.MINUTES));
        verifyTokens.save(t);
        mail.sendOtp(user.getEmail(), user.getDisplayName(), otp, purpose);
    }

    private void issuePasswordResetOtp(User user) {
        resetTokens.deleteAllForUser(user.getId());
        String otp = newOtp();
        PasswordResetToken t = new PasswordResetToken();
        t.setTokenHash(bcrypt.encode(otp));
        t.setUserId(user.getId());
        t.setExpiresAt(Instant.now().plus(OTP_TTL_MINUTES, ChronoUnit.MINUTES));
        resetTokens.save(t);
        mail.sendOtp(user.getEmail(), user.getDisplayName(), otp, "password reset");
    }

    private <T> T findMatchingToken(
            List<T> tokens, String otp,
            java.util.function.Function<T, Instant> expiresAtFn,
            java.util.function.Function<T, String> hashFn) {
        Instant now = Instant.now();
        for (T t : tokens) {
            if (expiresAtFn.apply(t).isBefore(now)) {
                continue;
            }
            if (bcrypt.matches(otp, hashFn.apply(t))) {
                return t;
            }
        }
        return null;
    }

    private String newOtp() {
        int n = rng.nextInt(1_000_000);
        return String.format("%06d", n);
    }

    private String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizePhone(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String compact = raw.replaceAll("[\\s()-]", "");
        if (!compact.startsWith("+")) {
            compact = "+" + compact;
        }
        if (!E164.matcher(compact).matches()) {
            throw ApiException.badRequest("Use international format like +14155552671");
        }
        return compact;
    }

    private String resolveTimezone(String tz) {
        return (tz == null || tz.isBlank()) ? "UTC" : tz.trim();
    }

    private String resolveDisplayName(String requested, String email) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : "Buddy";
    }

    private NutritionSuggestionResponse heuristicSuggestion(
            Integer weightKg, String dietPref, String allergicTo, Integer foodGoalKcal, Integer waterGoalMl) {
        int weight = weightKg != null ? weightKg : 70;
        int water = clamp(weight * 35, 1800, 4200);
        int kcal = clamp((int) Math.round(weight * 30.0), 1500, 3200);
        if (waterGoalMl != null) {
            water = clamp(waterGoalMl, 1500, 6000);
        }
        if (foodGoalKcal != null) {
            kcal = clamp(foodGoalKcal, 1200, 4200);
        }
        String diet = textOr(dietPref, "balanced Indian").toLowerCase(Locale.ROOT);
        List<String> foods = diet.contains("veg")
                ? List.of("Idli + sambar", "Vegetable upma", "Ven pongal + chutney",
                          "Curd rice with cucumber", "Rasam + rice + sabzi", "Dosa + tomato chutney")
                : List.of("Egg dosa + sambar", "Grilled fish + rice + rasam", "Chicken curry + idiyappam",
                          "Curd rice + fish fry", "Pepper chicken + rice", "Buttermilk + sundal");
        foods = withoutAllergens(foods, allergicTo);
        String guidance = "Spread meals through the day, keep protein in each meal, and limit deep-fried foods to occasional portions.";
        return new NutritionSuggestionResponse(water, kcal, foods, guidance);
    }

    // Drop any suggestion that mentions an allergen (comma/space separated tokens).
    private static List<String> withoutAllergens(List<String> foods, String allergicTo) {
        if (allergicTo == null || allergicTo.isBlank()) {
            return foods;
        }
        String[] tokens = allergicTo.toLowerCase(Locale.ROOT).split("[,;/]+");
        List<String> out = new java.util.ArrayList<>();
        for (String food : foods) {
            String lower = food.toLowerCase(Locale.ROOT);
            boolean hit = false;
            for (String t : tokens) {
                String tok = t.trim();
                if (!tok.isEmpty() && lower.contains(tok)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                out.add(food);
            }
        }
        return out.isEmpty() ? foods : out;
    }

    private static <T> T pick(T formValue, T stored) {
        return formValue != null ? formValue : stored;
    }

    private static List<String> parseFoods(JsonNode node, List<String> fallback) {
        if (!node.isArray()) return fallback;
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        for (JsonNode n : node) {
            if (n.isTextual() && !n.asText().isBlank()) {
                out.add(n.asText().trim());
            }
            if (out.size() >= 8) break;
        }
        return out.isEmpty() ? fallback : out;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String safe(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String clean(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String textOr(String s, String fallback) {
        return (s == null || s.isBlank()) ? fallback : s.trim();
    }
}
