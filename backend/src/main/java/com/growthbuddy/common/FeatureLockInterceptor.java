package com.growthbuddy.common;

import com.growthbuddy.user.FeatureLocks;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.AsyncHandlerInterceptor;

/**
 * 403 on a write (anything but GET/HEAD/OPTIONS) to a feature an operator locked
 * for this account ({@link FeatureLocks}). Reads pass: boot loads habits, water,
 * money and the rest whatever the switches say, and the client already hides a
 * feature that /me reports off, so a read can't spend AI budget or change data.
 * Keyed on the matched route, like RateLimitInterceptor, so a spelling of the URI
 * Spring still routes can't slip past the prefix.
 */
@Component
public class FeatureLockInterceptor implements AsyncHandlerInterceptor {

    /** API prefix -> the feature that owns it. Longest prefix doesn't matter: none nest across features. */
    static final Map<String, String> PREFIX_FEATURE = Map.ofEntries(
            Map.entry("/api/habits", "habits"),
            Map.entry("/api/food", "food"),
            Map.entry("/api/water", "water"),
            Map.entry("/api/health", "health"),
            Map.entry("/api/goals", "goals"),
            Map.entry("/api/notes", "notes"),
            Map.entry("/api/money", "money"),
            Map.entry("/api/capture", "money"),
            Map.entry("/api/focus", "focus"),
            Map.entry("/api/reminders", "calendar"),
            Map.entry("/api/mentor", "mentor"),
            Map.entry("/api/circles", "circle"),
            Map.entry("/api/mentorship", "circle"),
            Map.entry("/api/family", "family"),
            Map.entry("/api/weekly-review", "report"));

    /** The feature a route belongs to, or null. {@code /api/mentorship} is not {@code /api/mentor}. */
    static String featureOf(String route) {
        if (route == null) {
            return null;
        }
        for (var e : PREFIX_FEATURE.entrySet()) {
            String p = e.getKey();
            if (route.equals(p) || route.startsWith(p + "/")) {
                return e.getValue();
            }
        }
        return null;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String m = request.getMethod();
        if ("GET".equals(m) || "HEAD".equals(m) || "OPTIONS".equals(m)) {
            return true;
        }
        String feature = featureOf(RateLimitInterceptor.route(request));
        UUID user = CurrentUser.idOrNull();
        if (feature != null && user != null && FeatureLocks.isLocked(user, feature)) {
            throw ApiException.forbidden("This feature is turned off for your account.");
        }
        return true;
    }
}
