package com.growthbuddy.notification;

import java.util.List;
import java.util.Map;

/**
 * The user's notification settings, read from {@code ui_prefs} like
 * {@code ReminderPrefs}. Settings → Alerts writes them; the server reads them
 * because the cleanup job and push sending run with no client around.
 *
 * <ul>
 *   <li>{@code notifyKeepReadDays}: 7 | 30 | 90 — how long a READ card stays in
 *       the bell. Anything else (or unset) means {@value #DEFAULT_KEEP_READ_DAYS}.
 *       Unread cards still go at {@link NotificationService#ANY_TTL_DAYS} whatever
 *       this says.</li>
 *   <li>{@code notifyMute}: {@code {people, money, habits}} booleans — no web
 *       push / device notification for that category. The bell still records it.</li>
 * </ul>
 */
public final class NotificationPrefs {

    public static final int DEFAULT_KEEP_READ_DAYS = 30;
    public static final List<Integer> KEEP_READ_CHOICES = List.of(7, 30, 90);

    private NotificationPrefs() {}

    public static int keepReadDays(Map<String, Object> uiPrefs) {
        Object raw = uiPrefs == null ? null : uiPrefs.get("notifyKeepReadDays");
        Integer days = null;
        if (raw instanceof Number n) {
            days = n.intValue();
        } else if (raw instanceof String s) {
            try {
                days = Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                // not a number: default
            }
        }
        return days != null && KEEP_READ_CHOICES.contains(days) ? days : DEFAULT_KEEP_READ_DAYS;
    }

    public static boolean isMuted(Map<String, Object> uiPrefs, NotifyCategory category) {
        if (category == null || !category.mutable() || uiPrefs == null) return false;
        return uiPrefs.get("notifyMute") instanceof Map<?, ?> m && Boolean.TRUE.equals(m.get(category.name()));
    }
}
