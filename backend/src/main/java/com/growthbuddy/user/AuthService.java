package com.growthbuddy.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.LoginAttemptGuard;
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
    private final LoginAttemptGuard loginGuard;
    private final com.growthbuddy.water.WaterService water;
    private final boolean prod;
    private final ObjectMapper json = new ObjectMapper();
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

    /** Cap OTP sends per user, independent of the per-IP limit: 5 per hour. */
    private static final int WA_OTP_PER_HOUR = 5;
    /** Same cap for email verification codes (signup, sign-in and resend can each send one). */
    private static final int VERIFY_OTP_PER_HOUR = 5;

    @Lazy
    @Autowired
    private WhatsAppService whatsApp;
    private final SecureRandom rng = new SecureRandom();

    /* Field-injected so the constructor (and the unit tests that call it) stay
       as they were. A test that builds AuthService by hand leaves them null —
       login() reads that as "no second factor". */
    @Autowired
    private EmailChangeTokenRepository emailChangeTokens;
    @Autowired
    private TotpService totp;

    /** Days between "delete my account" and the purge; signing in before then can cancel. */
    public static final int DELETION_GRACE_DAYS = 7;
    /** Change-email codes per account per hour, on top of the per-IP limit. */
    private static final int EMAIL_CHANGE_PER_HOUR = 5;
    /**
     * OTP emails per destination address per hour, across EVERY purpose
     * (verification, resend, password reset, email change). The per-purpose caps
     * each allow 5/h, so without this one an address could be sent 15+ codes an
     * hour by mixing flows — mail-bombing with our sender reputation. Plus a
     * daily ceiling, so 5/h can't run all day; RateLimiter retains counters 48h
     * for exactly this window.
     */
    static final int OTP_MAIL_PER_HOUR = 5;
    static final int OTP_MAIL_PER_DAY = 10;

    /**
     * Every table owning a direct {@code user_id} column — what a deleted account
     * has to take with it. Hoisted out of {@code deleteAccount} so a test can hold
     * it against the schema: this list is hand-written, and the two tables added
     * after it (focus_sessions, weekly_reviews) were simply never added to it, so
     * a deleted account left its focus history and weekly reviews behind, keyed to
     * a user row that no longer existed. {@code AccountDeletionCoverageTest} now
     * fails the build when a new user-owned table forgets this line.
     *
     * <p>Columns spelled differently — {@code owner_user_id} (families),
     * {@code linked_user_id} (family_members), {@code from_user_id}/{@code to_user_id}
     * (mentorship_requests), {@code created_by_user_id}/{@code generated_by_user_id}
     * (the family_* tables) — are deliberately NOT here. Those rows belong to a
     * family or a conversation rather than to one account, and unpicking them is a
     * product decision (transfer the family? delete it?), not a cascade.
     */
    /**
     * Everything a family owns, child-first. Only ever deleted when a family is
     * being removed outright — see {@link #handOverOrRemoveFamilies}.
     */
    private static final String[] FAMILY_OWNED_TABLES = {
        "family_chores", "family_recipes",
        "family_dish_preferences", "family_pantry_items", "family_shopping_items",
        "family_favourite_menus", "family_multi_day_plans", "family_meal_plans",
        "family_members",
    };

    static final String[] USER_OWNED_TABLES = {
        "password_credentials",
        "email_verification_tokens", "password_reset_tokens", "whatsapp_otp_tokens",
        "email_change_tokens", "user_totp",
        "task_completion_history", "tasks",
        "habit_checkins", "habits", "streak_freeze_wallets",
        "water_entries", "water_goals", "food_entries", "food_photo_logs", "food_diet_checks",
        "food_favourites",
        "goal_actions", "goals", "daily_scores", "daily_logs",
        "mentor_threads", "circle_members", "circle_post_reactions", "circle_posts",
        "push_subscriptions", "notifications", "custom_sounds", "focus_sessions", "weekly_reviews",
        "money_state", "money_accounts", "money_transactions",
        "calendar_reminders", "reminder_done", "note_drafts", "note_edit_drafts", "notes", "sessions",
        "idempotency_keys",
    };

    @PersistenceContext
    private EntityManager em;

        private static final String NUTRITION_PROMPT = """
            You are a practical Indian nutrition coach.
            Respond with strict JSON only using keys:
            waterMl (integer), foodGoalKcal (integer), indianFoods (array of 6 strings), guidance (string under 220 chars).
            Keep food suggestions common in South Indian homes (idli, dosa, sambar, rasam, upma, pongal, curd rice, avial, etc.) and honour the diet preference.
            "non vegetarian" means meat, fish and eggs are wanted — do not return an all-vegetarian list for it.
            Point foodGoalKcal in the direction of the fitness goal: a surplus to gain weight or bulk, a deficit to lose weight, maintenance otherwise.
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
                       LoginAttemptGuard loginGuard,
                       com.growthbuddy.water.WaterService water,
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
        this.loginGuard = loginGuard;
        this.water = water;
        this.prod = activeProfiles != null && activeProfiles.toLowerCase().contains("prod");
    }

    @Transactional
    public AuthUserResponse signup(SignupRequest req) {
        String email = normalize(req.email());
        User existing = users.findByEmailIgnoreCase(email).orElse(null);
        if (existing != null) {
            // Signed up before and never typed the code: with the SAME password
            // that is the owner back again, so send a fresh code and answer like a
            // first signup (unverified, no token) so the app opens the code screen.
            // Anything else gets the same 409 as a verified account. Never take the
            // new password: whoever verifies would then inherit one a stranger
            // chose. A mismatch is a password guess, so it counts against the lockout.
            if (!existing.isEmailVerified() && passwordMatches(existing, req.password(), "login:" + email)) {
                issueVerificationOtpLimited(existing);
                return AuthUserResponse.from(existing);
            }
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "An account with this email already exists. Sign in, or reset your password if you've forgotten it.");
        }
        requireOtpMailBudget(email);
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
     * If the email is not yet verified, emails a fresh code and throws 403 so the
     * frontend switches to the OTP screen. noRollbackFor is load-bearing: that 403
     * must not roll back the code it just saved, or the emailed code never works.
     * Every other throw here happens before any write.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthUserResponse login(LoginRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        // Before the lookup, and keyed on the typed email rather than on a user
        // row — so an unknown address is throttled exactly like a real one and
        // the lockout can't be used to ask which emails have accounts.
        loginGuard.check("login:" + email);
        User user = users.findByEmailIgnoreCase(email).orElse(null);
        PasswordCredential c = user == null ? null : creds.findById(user.getId()).orElse(null);
        if (c == null || !bcrypt.matches(req.password(), c.getPasswordHash())) {
            loginGuard.recordFailure("login:" + email);
            throw ApiException.badRequest("Wrong email or password");
        }
        // The password was right, so this is the owner typing — clear the count
        // even if the unverified check below still turns them away.
        loginGuard.recordSuccess("login:" + email);
        if (!user.isEmailVerified()) {
            // Only someone holding the right password gets here, so saying
            // "unverified" reveals nothing a stranger could use. Answering "Wrong
            // email or password" left the owner looping against signup's 409.
            // 403 is the frontend's cue to open the code screen.
            issueVerificationOtpLimited(user);
            throw ApiException.forbidden("Verify your email to finish signing up. We sent a new code to " + email + ".");
        }
        // Both checks come after the password, so neither says anything to a
        // stranger: 401 totp_required / 409 deletion_scheduled each mean "right
        // password", which only the owner can produce.
        // Deletion first, the code second: the code is single-use, so asking for
        // it before the cancel screen would leave the cancel unable to reuse it.
        if (user.getDeletionRequestedAt() != null && !Boolean.TRUE.equals(req.cancelDeletion())) {
            throw deletionScheduled(user);
        }
        requireSecondFactor(user, req.code(), email);
        if (user.getDeletionRequestedAt() != null) {
            user.setDeletionRequestedAt(null);
            users.save(user);
            notifyQuietly(user.getEmail(), "Your Growth Buddy account is staying",
                    greeting(user) + "You cancelled the deletion of your Growth Buddy account, so nothing "
                            + "will be removed. If that wasn't you, change your password now.\n\n— Growth Buddy");
        }
        return AuthUserResponse.withToken(user, sessions.issue(user.getId(), http).token());
    }

    /**
     * Second step of sign-in when an authenticator is enrolled. No code yet →
     * 401 {@code totp_required} (the client opens the code step and re-sends the
     * same email + password with it). A wrong code is a guess at a 6-digit
     * secret, so it gets the same LoginAttemptGuard backoff as a password.
     */
    private void requireSecondFactor(User user, String code, String email) {
        if (totp == null || !totp.isEnabled(user.getId())) {
            return;
        }
        if (code == null || code.isBlank()) {
            throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,
                    "Enter the 6-digit code from your authenticator app.", "totp_required");
        }
        String key = "totp:" + email;
        loginGuard.check(key);
        if (!totp.verify(user.getId(), code)) {
            loginGuard.recordFailure(key);
            throw new ApiException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "That code didn't work. Use the newest one in your app, or a recovery code.", "totp_invalid");
        }
        loginGuard.recordSuccess(key);
    }

    private ApiException deletionScheduled(User user) {
        return new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                "Your account is scheduled for deletion on " + deletionDate(user) + ".", "deletion_scheduled");
    }

    /** The purge day, in the user's own zone, e.g. "17 October 2026". */
    private static String deletionDate(User user) {
        java.time.ZoneId zone;
        try {
            zone = java.time.ZoneId.of(user.getTimezone());
        } catch (RuntimeException ex) {
            zone = java.time.ZoneOffset.UTC;
        }
        return user.getDeletionRequestedAt().plus(DELETION_GRACE_DAYS, ChronoUnit.DAYS).atZone(zone)
                .format(java.time.format.DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH));
    }

    private static String greeting(User user) {
        String name = user.getDisplayName();
        return (name == null || name.isBlank() ? "Hello" : "Hi " + name) + ",\n\n";
    }

    /**
     * A courtesy email (old-address notice, deletion receipt). Never allowed to
     * undo the change it reports: MailService throws when delivery fails, and
     * inside the caller's transaction that would roll the change back.
     */
    private void notifyQuietly(String to, String subject, String body) {
        try {
            mail.sendPlain(to, subject, body);
        } catch (RuntimeException ex) {
            log.warn("Courtesy email to {} failed ({}): {}", to, subject, ex.getMessage());
        }
    }

    @Transactional
    public AuthUserResponse verifyEmail(VerifyOtpRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        // Same generic error whether the email is unknown or the code is wrong,
        // so verify can't be used to enumerate which emails have accounts.
        // An OTP is six digits and this endpoint hands back a session, so it is a
        // login by another name — same backoff.
        loginGuard.check("otp:" + email);
        User user = users.findByEmailIgnoreCase(email).orElse(null);
        EmailVerificationToken match = user == null ? null : findMatchingToken(
                verifyTokens.findByUserIdAndConsumedAtIsNull(user.getId()),
                req.otp(), EmailVerificationToken::getExpiresAt, EmailVerificationToken::getTokenHash);
        if (match == null) {
            loginGuard.recordFailure("otp:" + email);
            throw ApiException.badRequest("Invalid or expired code. Try resending.");
        }
        loginGuard.recordSuccess("otp:" + email);
        match.setConsumedAt(Instant.now());
        verifyTokens.save(match);
        user.setEmailVerified(true);
        users.save(user);
        return AuthUserResponse.withToken(user, sessions.issue(user.getId(), http).token());
    }

    @Transactional
    public void resendVerification(EmailOnlyRequest req) {
        // Before the lookup, keyed on the typed address: an unknown email hits
        // the same 429 as a real one, so the refusal says nothing about accounts.
        requireOtpMailBudget(normalize(req.email()));
        users.findByEmailIgnoreCase(normalize(req.email())).ifPresent(u -> {
            // Over the per-account cap: skip silently; a refusal would say the account exists.
            if (!u.isEmailVerified() && verificationOtpAllowed(u)) {
                issueVerificationOtp(u, "verification");
            }
        });
        // Do not signal whether the email exists.
    }

    @Transactional
    public void forgotPassword(EmailOnlyRequest req) {
        // Pre-lookup for the same reason as resendVerification: no oracle.
        requireOtpMailBudget(normalize(req.email()));
        users.findByEmailIgnoreCase(normalize(req.email())).ifPresent(u -> {
            issuePasswordResetOtp(u);
        });
        // Do not signal whether the email exists.
    }

    /**
     * noRollbackFor: the two refusals at the end (second factor, scheduled
     * deletion) come AFTER the new password is saved, and must keep it — the
     * client then signs in with that password through the normal steps.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthUserResponse resetPassword(ResetPasswordRequest req, HttpServletRequest http) {
        String email = normalize(req.email());
        // Generic error for unknown email or wrong code (no enumeration oracle).
        loginGuard.check("reset:" + email);
        User user = users.findByEmailIgnoreCase(email).orElse(null);
        PasswordResetToken match = user == null ? null : findMatchingToken(
                resetTokens.findByUserIdAndConsumedAtIsNull(user.getId()),
                req.otp(), PasswordResetToken::getExpiresAt, PasswordResetToken::getTokenHash);
        if (match == null) {
            loginGuard.recordFailure("reset:" + email);
            throw ApiException.badRequest("Invalid or expired code. Request a new one.");
        }
        loginGuard.recordSuccess("reset:" + email);
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
        // A reset proves the inbox, not the authenticator: with 2FA on it must not
        // hand out a session by itself, or the mailbox alone would bypass it.
        // Same for an account waiting to be deleted — it gets the cancel screen.
        if (user.getDeletionRequestedAt() != null) {
            throw deletionScheduled(user);
        }
        requireSecondFactor(user, null, email);
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
     * Schedule the account for deletion (password-confirmed); {@link #purgeAccount}
     * does the actual delete after the grace period. What the purge does: shared entities (circles, families) survive: the ones this account
     * owns are handed to their longest-standing other member, or deleted when
     * nobody else is in them; elsewhere only the user's own membership/posts go. FK checks are disabled for
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
        // Not deleted here: scheduled. Every session goes now, so the account is
        // shut to every device at once; AccountDeletionJob runs purgeAccount once
        // DELETION_GRACE_DAYS have passed, and signing in before then offers to
        // cancel (login → 409 deletion_scheduled). A second request keeps the
        // first date — asking twice must not push the purge further out.
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        if (user.getDeletionRequestedAt() == null) {
            user.setDeletionRequestedAt(Instant.now());
            users.save(user);
        }
        sessions.revokeAllForUser(userId);
        notifyQuietly(user.getEmail(), "Your Growth Buddy account will be deleted on " + deletionDate(user),
                greeting(user) + "We received your request to delete your Growth Buddy account. It is "
                        + "signed out everywhere, and it and all of its data will be permanently deleted on "
                        + deletionDate(user) + ".\n\nChanged your mind? Sign in before then and choose "
                        + "\"Cancel deletion\". If you didn't ask for this, sign in, cancel, and change your "
                        + "password.\n\n— Growth Buddy");
    }

    /**
     * The purge for {@code AccountDeletionJob}. Re-checks the schedule inside its
     * own transaction, so an account whose owner cancelled after the job listed
     * it is left alone. Returns whether it deleted anything.
     */
    @Transactional
    public boolean purgeScheduledAccount(UUID userId, Instant cutoff) {
        User user = users.findById(userId).orElse(null);
        if (user == null || user.getDeletionRequestedAt() == null
                || !user.getDeletionRequestedAt().isBefore(cutoff)) {
            return false;
        }
        purgeAccount(userId);
        return true;
    }

    /** The hard delete: every user-owned row, then the users row. No checks — callers gate it. */
    private void purgeAccount(UUID userId) {
        // Children keyed by a parent id → delete via the user's parent rows first.
        String[][] childDeletes = {
            {"habit_streaks", "habit_id", "habits"},
            {"habit_reminder_dispatch_log", "habit_id", "habits"},
            {"mentor_messages", "thread_id", "mentor_threads"},
            {"calendar_reminder_skips", "reminder_id", "calendar_reminders"},
            {"reminder_dispatch_log", "reminder_id", "calendar_reminders"},
            // Other members' kudos on this account's posts (its own kudos: USER_OWNED_TABLES).
            {"circle_post_reactions", "post_id", "circle_posts"},
        };
        // Kept as a guard even though every table above now exists: a DELETE against
        // a missing table throws, which marks the whole transaction rollback-only and
        // aborts the purge — so a future rename fails safe instead of half-deleting.
        java.util.Set<String> existing = existingTables();

        // FOREIGN_KEY_CHECKS is a SESSION variable, and the session here is a pooled
        // connection that goes straight back to Hikari for the next request to use.
        // The restore therefore belongs in a finally: any throw between the two
        // statements — a renamed table, a lock timeout, a dropped connection — used
        // to hand back a connection with referential integrity switched OFF, for
        // every request that borrowed it afterwards, until the pool recycled it.
        exec("SET FOREIGN_KEY_CHECKS=0", null);
        try {
            handOverOrRemoveFamilies(userId);
            handOverOrRemoveCircles(userId, existing);
            // A link's thread goes with the link (FK checks are off, so no cascade).
            if (existing.contains("mentorship_messages")) {
                exec("DELETE FROM mentorship_messages WHERE link_id IN (SELECT id FROM mentorship_requests"
                        + " WHERE from_user_id = ?1 OR to_user_id = ?1)", userId);
            }
            // A request is addressed to a person, so it cannot outlive either end.
            em.createNativeQuery(
                    "DELETE FROM mentorship_requests WHERE from_user_id = ?1 OR to_user_id = ?1")
                    .setParameter(1, userId).executeUpdate();
            // This account's own membership of someone ELSE's family.
            em.createNativeQuery("DELETE FROM family_members WHERE linked_user_id = ?1")
                    .setParameter(1, userId).executeUpdate();
            for (String[] cd : childDeletes) {
                if (existing.contains(cd[0]) && existing.contains(cd[2])) {
                    exec("DELETE FROM " + cd[0] + " WHERE " + cd[1]
                            + " IN (SELECT id FROM " + cd[2] + " WHERE user_id = ?1)", userId);
                }
            }
            for (String t : USER_OWNED_TABLES) {
                if (existing.contains(t)) {
                    exec("DELETE FROM " + t + " WHERE user_id = ?1", userId);
                }
            }
            exec("DELETE FROM users WHERE id = ?1", userId);
        } finally {
            exec("SET FOREIGN_KEY_CHECKS=1", null);
        }
        sessions.revokeAllForUser(userId);
    }

    /**
     * Deal with families this account owns before the account goes.
     *
     * <p>A family is not the owner's private data — the other members have their
     * own accounts, their own food profiles, and a shared meal history. Deleting
     * it because one person left would take all of that with it. So: hand the
     * family to the longest-standing other member, and only delete it outright
     * when there is nobody left to hand it to.
     *
     * <p>Leaving {@code owner_user_id} pointing at a deleted row, which is what
     * happened before, is the one option that is wrong either way.
     */
    @SuppressWarnings("unchecked")
    private void handOverOrRemoveFamilies(UUID userId) {
        List<?> owned = em.createNativeQuery("SELECT id FROM families WHERE owner_user_id = ?1")
                .setParameter(1, userId).getResultList();
        for (Object raw : owned) {
            String familyId = String.valueOf(raw);
            List<?> heirs = em.createNativeQuery(
                    "SELECT linked_user_id FROM family_members WHERE family_id = ?1"
                            + " AND linked_user_id IS NOT NULL AND linked_user_id <> ?2"
                            + " AND deleted_at IS NULL AND status = 'mapped'"
                            + " ORDER BY created_at ASC LIMIT 1")
                    .setParameter(1, familyId).setParameter(2, userId).getResultList();
            if (!heirs.isEmpty()) {
                em.createNativeQuery("UPDATE families SET owner_user_id = ?1 WHERE id = ?2")
                        .setParameter(1, String.valueOf(heirs.get(0)))
                        .setParameter(2, familyId).executeUpdate();
                log.info("Family {} handed to another member as its owner deleted their account", familyId);
                continue;
            }
            for (String t : FAMILY_OWNED_TABLES) {
                em.createNativeQuery("DELETE FROM " + t + " WHERE family_id = ?1")
                        .setParameter(1, familyId).executeUpdate();
            }
            em.createNativeQuery("DELETE FROM families WHERE id = ?1")
                    .setParameter(1, familyId).executeUpdate();
        }
    }

    /**
     * Same rule for Growth Circles the account owns ({@code circles.created_by}
     * is the owner): the longest-standing other member takes it over, and a
     * circle with nobody else in it goes. Before, the circle stayed behind with
     * {@code created_by} naming a deleted user — ownerless, so nobody could
     * delete it, remove a member or hand it on.
     */
    private void handOverOrRemoveCircles(UUID userId, java.util.Set<String> existing) {
        List<?> owned = em.createNativeQuery("SELECT id FROM circles WHERE created_by = ?1")
                .setParameter(1, userId).getResultList();
        for (Object raw : owned) {
            String circleId = String.valueOf(raw);
            List<?> heirs = em.createNativeQuery(
                    "SELECT user_id FROM circle_members WHERE circle_id = ?1 AND user_id <> ?2"
                            + " ORDER BY joined_at ASC LIMIT 1")
                    .setParameter(1, circleId).setParameter(2, userId).getResultList();
            if (!heirs.isEmpty()) {
                String heir = String.valueOf(heirs.get(0));
                em.createNativeQuery("UPDATE circles SET created_by = ?1 WHERE id = ?2")
                        .setParameter(1, heir).setParameter(2, circleId).executeUpdate();
                em.createNativeQuery("UPDATE circle_members SET role = 'owner' WHERE circle_id = ?1 AND user_id = ?2")
                        .setParameter(1, circleId).setParameter(2, heir).executeUpdate();
                continue;
            }
            if (existing.contains("circle_post_reactions")) {
                em.createNativeQuery("DELETE FROM circle_post_reactions WHERE post_id IN"
                                + " (SELECT id FROM circle_posts WHERE circle_id = ?1)")
                        .setParameter(1, circleId).executeUpdate();
            }
            for (String t : new String[] {"circle_posts", "circle_challenges", "circle_members"}) {
                em.createNativeQuery("DELETE FROM " + t + " WHERE circle_id = ?1")
                        .setParameter(1, circleId).executeUpdate();
            }
            em.createNativeQuery("DELETE FROM circles WHERE id = ?1")
                    .setParameter(1, circleId).executeUpdate();
        }
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

    /* ---- Change email ---- */

    /**
     * Step 1: password-confirmed, then a code goes to the NEW address — the
     * address only moves once that inbox proves it is real and theirs. Taken
     * addresses are refused here and again at confirm (15 minutes is long enough
     * for someone else to sign up with it).
     */
    @Transactional
    public void requestEmailChange(UUID userId, ChangeEmailRequest req) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        String newEmail = normalize(req.newEmail());
        if (!passwordMatches(user, req.password(), "login:" + user.getEmail())) {
            throw ApiException.badRequest("Password is incorrect.");
        }
        if (newEmail.equalsIgnoreCase(user.getEmail())) {
            throw ApiException.badRequest("That is already your email.");
        }
        if (users.findByEmailIgnoreCase(newEmail).isPresent()) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "Another account already uses that email.");
        }
        if (!rateLimiter.allow("emailchange:" + userId, EMAIL_CHANGE_PER_HOUR, 3_600_000L)) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many code requests. Use the last code we sent, or try again in an hour.");
        }
        requireOtpMailBudget(newEmail);
        emailChangeTokens.deleteAllForUser(userId);
        String otp = newOtp();
        EmailChangeToken t = new EmailChangeToken();
        t.setTokenHash(bcrypt.encode(otp));
        t.setUserId(userId);
        t.setNewEmail(newEmail);
        t.setExpiresAt(Instant.now().plus(OTP_TTL_MINUTES, ChronoUnit.MINUTES));
        emailChangeTokens.save(t);
        mail.sendOtp(newEmail, user.getDisplayName(), otp, "email change");
    }

    /**
     * Step 2: the code from the new inbox. Swaps the address, keeps every
     * session (the account didn't change hands — its owner proved both the
     * password and the new inbox), and tells the OLD address, which is the only
     * warning a hijacked account's owner would get.
     */
    @Transactional
    public AuthUserResponse confirmEmailChange(UUID userId, String code) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        String key = "emailchange:" + userId;
        loginGuard.check(key);
        EmailChangeToken match = findMatchingToken(
                emailChangeTokens.findByUserIdAndConsumedAtIsNull(userId),
                code, EmailChangeToken::getExpiresAt, EmailChangeToken::getTokenHash);
        if (match == null) {
            loginGuard.recordFailure(key);
            throw ApiException.badRequest("Invalid or expired code. Request a new one.");
        }
        loginGuard.recordSuccess(key);
        String newEmail = match.getNewEmail();
        if (users.findByEmailIgnoreCase(newEmail).filter(u -> !u.getId().equals(userId)).isPresent()) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "Another account started using that email in the meantime.");
        }
        String oldEmail = user.getEmail();
        emailChangeTokens.deleteAllForUser(userId);
        user.setEmail(newEmail);
        user.setEmailVerified(true); // the code just proved the inbox
        users.save(user);
        notifyQuietly(oldEmail, "Your Growth Buddy email was changed",
                greeting(user) + "The email on your Growth Buddy account was changed from " + oldEmail
                        + " to " + newEmail + ". Sign in with the new address from now on.\n\n"
                        + "If you didn't do this, reply to this email straight away.\n\n— Growth Buddy");
        return AuthUserResponse.from(user);
    }

    /* ---- Two-step sign-in (TOTP) ---- */

    @Transactional(readOnly = true)
    public AccountSecurityStatus securityStatus(UUID userId) {
        Instant now = Instant.now();
        String pending = emailChangeTokens.findByUserIdAndConsumedAtIsNull(userId).stream()
                .filter(t -> t.getExpiresAt().isAfter(now))
                .map(EmailChangeToken::getNewEmail)
                .findFirst().orElse(null);
        return new AccountSecurityStatus(totp.isEnabled(userId), totp.recoveryCodesLeft(userId), pending);
    }

    @Transactional
    public TotpSetupResponse beginTotpSetup(UUID userId) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        TotpService.Setup s = totp.beginSetup(userId, user.getEmail());
        return new TotpSetupResponse(s.secret(), s.otpauthUri());
    }

    /** First code from the app turns 2FA on; answers the recovery codes, once. */
    @Transactional
    public RecoveryCodesResponse enableTotp(UUID userId, String code) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        String key = "totpsetup:" + userId;
        loginGuard.check(key);
        List<String> codes = totp.enable(userId, code);
        if (codes == null) {
            loginGuard.recordFailure(key);
            throw ApiException.badRequest("That code didn't match. Check the app's clock and use the newest code.");
        }
        loginGuard.recordSuccess(key);
        notifyQuietly(user.getEmail(), "Two-step sign-in is on",
                greeting(user) + "Two-step sign-in was turned on for your Growth Buddy account. Signing in "
                        + "now also asks for a code from your authenticator app.\n\n"
                        + "If this wasn't you, reset your password straight away.\n\n— Growth Buddy");
        return new RecoveryCodesResponse(codes);
    }

    /** Off needs both factors: the password and a current code (or a recovery code). */
    @Transactional
    public void disableTotp(UUID userId, TotpDisableRequest req) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.notFound("User not found"));
        if (!totp.isEnabled(userId)) {
            totp.disable(userId); // drops a half-finished setup, if any
            return;
        }
        if (!passwordMatches(user, req.password(), "login:" + user.getEmail())) {
            throw ApiException.badRequest("Password is incorrect.");
        }
        String key = "totp:" + user.getEmail();
        loginGuard.check(key);
        if (!totp.verify(userId, req.code())) {
            loginGuard.recordFailure(key);
            throw ApiException.badRequest("That code didn't work. Use the newest one in your app, or a recovery code.");
        }
        loginGuard.recordSuccess(key);
        totp.disable(userId);
        notifyQuietly(user.getEmail(), "Two-step sign-in is off",
                greeting(user) + "Two-step sign-in was turned off for your Growth Buddy account.\n\n"
                        + "If this wasn't you, reset your password and turn it back on.\n\n— Growth Buddy");
    }

    /**
     * Only the zone, unlike {@link #updateProfile}, which replaces every field.
     * The client calls it when the device's zone and the stored one disagree.
     */
    @Transactional
    public AuthUserResponse updateTimezone(UUID userId, String timezone) {
        User user = users.findById(userId)
                .orElseThrow(() -> ApiException.notFound("User not found"));
        user.setTimezone(requireValidTimezone(timezone));
        users.save(user);
        return AuthUserResponse.from(user);
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

        // A new number is an unproven one. Keeping the old flag let anyone type in a
        // stranger's number and have it treated as theirs by the WhatsApp webhook.
        if (effectiveNumber != null && !effectiveNumber.equals(user.getWhatsappNumber())) {
            user.setWhatsappVerified(false);
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

        if (whatsApp != null && whatsApp.isConfigured()) {
            whatsApp.sendOtp(normalized, otp);
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
            user.setTimezone(requireValidTimezone(req.timezone()));
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
        if (!java.util.Objects.equals(user.getDailyWaterGoalMl(), req.dailyWaterGoalMl())) {
            // The tracker reads an old water_goals row first; once the goal is
            // edited here, this column is the only one.
            water.dropLegacyGoal(userId);
        }
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
        String fitnessGoal = pick(form == null ? null : form.fitnessGoal(), user.getFitnessGoal());
        String diet = pick(form == null ? null : form.dietPreference(), user.getDietPreference());
        String about = pick(form == null ? null : form.aboutMe(), user.getAboutMe());
        String allergicTo = pick(form == null ? null : form.allergicTo(), user.getAllergicTo());
        String favouriteDish = pick(form == null ? null : form.favouriteDish(), user.getFavouriteDish());
        Integer foodGoal = pick(form == null ? null : form.dailyFoodGoalKcal(), user.getDailyFoodGoalKcal());
        Integer waterGoal = pick(form == null ? null : form.dailyWaterGoalMl(), user.getDailyWaterGoalMl());

        NutritionSuggestionResponse base =
                heuristicSuggestion(weightKg, fitnessGoal, diet, allergicTo, foodGoal, waterGoal);
        if (!openai.isConfigured()) {
            return base;
        }
        try {
            String profile = "age=" + safe(age)
                    + ", heightCm=" + safe(heightCm)
                    + ", weightKg=" + safe(weightKg)
                    + ", fitnessGoal=" + safe(fitnessGoal)
                    + ", diet=" + safe(diet)
                    + ", allergic=" + safe(allergicTo)
                    + ", favouriteDish=" + safe(favouriteDish)
                    + ", about=" + safe(about)
                    + ", currentFoodGoalKcal=" + safe(foodGoal)
                    + ", currentWaterGoalMl=" + safe(waterGoal);
            String raw = openai.complete(NUTRITION_PROMPT, List.of(new ChatTurn("user", profile)));
            JsonNode node = json.readTree(OpenAIClient.jsonOf(raw));
            int water = clamp(node.path("waterMl").asInt(base.recommendedWaterMl()), 1500, 6000);
            int kcal = clamp(node.path("foodGoalKcal").asInt(base.recommendedFoodGoalKcal()), 1200, 4200);
            List<String> foods = parseFoods(node.path("indianFoods"), base.indianFoodSuggestions());
            String guidance = textOr(node.path("guidance").asText(), base.guidance());
            return new NutritionSuggestionResponse(water, kcal, foods, guidance);
        } catch (Exception ex) {
            // Falling back is fine; doing it silently is not — this is exactly
            // how the fenced-JSON breakage above went unnoticed.
            log.warn("Nutrition suggestion fell back to the heuristic: {}", ex.toString());
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

    /* Per-account cap on verification emails, on top of the per-IP limit. */
    private boolean verificationOtpAllowed(User user) {
        return rateLimiter.allow("verifyotp:" + user.getId(), VERIFY_OTP_PER_HOUR, 3_600_000L);
    }

    private void issueVerificationOtpLimited(User user) {
        if (!verificationOtpAllowed(user)) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many code requests. Use the last code we sent, or try again in an hour.");
        }
        requireOtpMailBudget(user.getEmail());
        issueVerificationOtp(user, "verification");
    }

    /**
     * The cross-purpose cap ({@link #OTP_MAIL_PER_HOUR}), keyed on the address
     * the code is going TO. Every mail.sendOtp path calls this exactly once
     * before sending: signup, issueVerificationOtpLimited (signup again, login),
     * resendVerification, forgotPassword, requestEmailChange.
     */
    private void requireOtpMailBudget(String email) {
        String to = email.toLowerCase(java.util.Locale.ROOT);
        if (!rateLimiter.allow("otpmail:" + to, OTP_MAIL_PER_HOUR, 3_600_000L)) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many codes sent to this email. Use the last one we sent, or try again in an hour.");
        }
        if (!rateLimiter.allow("otpday:" + to, OTP_MAIL_PER_DAY, 86_400_000L)) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                    "Too many codes sent to this email today. Use the last one we sent, or try again tomorrow.");
        }
    }

    /* A password check outside login() still goes through LoginAttemptGuard. */
    private boolean passwordMatches(User user, String password, String guardKey) {
        loginGuard.check(guardKey);
        PasswordCredential c = creds.findById(user.getId()).orElse(null);
        if (c == null || !bcrypt.matches(password, c.getPasswordHash())) {
            loginGuard.recordFailure(guardKey);
            return false;
        }
        loginGuard.recordSuccess(guardKey);
        return true;
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
        if (tz == null || tz.isBlank()) {
            return "UTC";
        }
        // Signup comes from the browser's Intl zone, so a bad value means a broken
        // client, not a broken user — take UTC rather than blocking the signup.
        return isKnownZone(tz) ? tz.trim() : "UTC";
    }

    /**
     * The timezone decides which calendar day a user's check-ins, streaks and water
     * totals land on (see {@code UserClock}), so an unparseable value would quietly
     * demote them to UTC. Say so instead.
     */
    private String requireValidTimezone(String tz) {
        if (!isKnownZone(tz)) {
            throw ApiException.badRequest("Unknown timezone: " + tz.trim());
        }
        return tz.trim();
    }

    private static boolean isKnownZone(String tz) {
        try {
            java.time.ZoneId.of(tz.trim());
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }

    private String resolveDisplayName(String requested, String email) {
        if (requested != null && !requested.isBlank()) {
            return requested.trim();
        }
        int at = email.indexOf('@');
        return at > 0 ? email.substring(0, at) : "Buddy";
    }

    private NutritionSuggestionResponse heuristicSuggestion(
            Integer weightKg, String fitnessGoal, String dietPref,
            String allergicTo, Integer foodGoalKcal, Integer waterGoalMl) {
        int weight = weightKg != null ? weightKg : 70;
        int water = clamp(weight * 35, 1800, 4200);
        int kcal = clamp((int) Math.round(weight * 30.0 * goalFactor(fitnessGoal)), 1500, 3600);
        if (waterGoalMl != null) {
            water = clamp(waterGoalMl, 1500, 6000);
        }
        if (foodGoalKcal != null) {
            kcal = clamp(foodGoalKcal, 1200, 4200);
        }
        List<String> foods = vegetarian(dietPref)
                ? List.of("Idli + sambar", "Vegetable upma", "Ven pongal + chutney",
                          "Curd rice with cucumber", "Rasam + rice + sabzi", "Dosa + tomato chutney")
                : List.of("Egg dosa + sambar", "Grilled fish + rice + rasam", "Chicken curry + idiyappam",
                          "Curd rice + fish fry", "Pepper chicken + rice", "Buttermilk + sundal");
        foods = withoutAllergens(foods, allergicTo);
        String guidance = "Spread meals through the day, keep protein in each meal, and limit deep-fried foods to occasional portions.";
        return new NutritionSuggestionResponse(water, kcal, foods, guidance);
    }

    /* "non vegetarian" contains "veg", so a plain substring test hands a
       non-vegetarian the vegetarian menu. Rule out the negations first.
       "egg" is deliberately not one of them: it has to leave "vegetarian, no
       egg" vegetarian, and "eggetarian" resolves without it anyway by having no
       "veg" to match. Suggesting chicken to a vegetarian is the bad direction
       to fail in. */
    static boolean vegetarian(String dietPref) {
        String diet = textOr(dietPref, "balanced Indian").toLowerCase(Locale.ROOT);
        if (diet.contains("non") || diet.contains("meat")
                || diet.contains("chicken") || diet.contains("fish")) {
            return false;
        }
        return diet.contains("veg");
    }

    /* ponytail: keyword match on a free-text goal, not a calorie model. A
       surplus/deficit in the right direction beats a precise number aimed the
       wrong way; swap in Mifflin-St Jeor if the goal field ever gets structured. */
    static double goalFactor(String fitnessGoal) {
        String goal = textOr(fitnessGoal, "").toLowerCase(Locale.ROOT);
        if (goal.contains("gain") || goal.contains("bulk") || goal.contains("muscle")
                || goal.contains("weight up")) {
            return 1.2;
        }
        if (goal.contains("lose") || goal.contains("loss") || goal.contains("cut")
                || goal.contains("slim") || goal.contains("lean")) {
            return 0.85;
        }
        return 1.0;
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
