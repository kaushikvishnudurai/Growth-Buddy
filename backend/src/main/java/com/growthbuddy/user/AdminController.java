package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operator switches: turn a whole feature off for one account (by email) or for
 * everyone ({@link FeatureLocks}). Callable only from a signed-in, verified
 * account on the {@link AdminAccess} list. Anyone else gets a 404 (the same one
 * an unknown route gets, and CurrentUserInterceptor sends it to visitors who
 * aren't signed in). The UI is Settings, Account, Operator (settings.js
 * operatorSection): its probe of this list is the 404 check.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);

    private final UserRepository users;
    private final FeatureLocks locks;

    public AdminController(UserRepository users, FeatureLocks locks) {
        this.users = users;
        this.locks = locks;
    }

    record LockView(String feature, String email, String reason) {}

    record LockRequest(String feature, String email, String reason) {}

    @GetMapping("/feature-locks")
    public List<LockView> list() {
        requireAdmin();
        return views();
    }

    private List<LockView> views() {
        List<FeatureLocks.Lock> all = locks.list();
        java.util.Map<String, String> emails = new java.util.HashMap<>();
        users.findAllById(all.stream().map(FeatureLocks.Lock::userId)
                .filter(id -> !FeatureLocks.EVERYONE.equals(id)).map(UUID::fromString).toList())
                .forEach(u -> emails.put(u.getId().toString(), u.getEmail()));
        return all.stream().map(l -> new LockView(l.feature(),
                FeatureLocks.EVERYONE.equals(l.userId()) ? null : emails.getOrDefault(l.userId(), l.userId()),
                l.reason())).toList();
    }

    /** {@code email} absent = every account. */
    @PutMapping("/feature-locks")
    public List<LockView> lock(@RequestBody LockRequest req) {
        String admin = requireAdmin();
        String feature = feature(req.feature());
        String reason = req.reason() == null ? null : req.reason().strip();
        if (reason != null && reason.length() > 200) {
            throw ApiException.badRequest("Reason is longer than 200 characters.");
        }
        UUID target = target(req.email());
        locks.lock(feature, target, reason == null || reason.isEmpty() ? null : reason);
        log.warn("admin {} locked feature {} for {}", admin, feature, target == null ? "everyone" : target);
        return views();
    }

    /** {@code email} absent = lift the everyone lock; per-account locks stay. */
    @DeleteMapping("/feature-locks")
    public List<LockView> unlock(@RequestParam String feature, @RequestParam(required = false) String email) {
        String admin = requireAdmin();
        String f = feature(feature);
        UUID target = target(email);
        if (!locks.unlock(f, target)) {
            throw ApiException.notFound("that lock");
        }
        log.warn("admin {} unlocked feature {} for {}", admin, f, target == null ? "everyone" : target);
        return views();
    }

    private String requireAdmin() {
        User me = users.findById(CurrentUser.id()).orElse(null);
        if (me == null || !me.isEmailVerified() || !AdminAccess.isAdmin(me.getEmail())) {
            throw ApiException.notFound("that page");
        }
        return me.getId().toString();
    }

    private static String feature(String key) {
        if (key == null || !FeatureLocks.FEATURES.contains(key)) {
            throw ApiException.badRequest("Unknown feature. One of: " + new java.util.TreeSet<>(FeatureLocks.FEATURES));
        }
        return key;
    }

    private UUID target(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        return users.findByEmail(email.trim().toLowerCase(Locale.ROOT)).map(User::getId)
                .orElseThrow(() -> ApiException.notFound("that account"));
    }
}
