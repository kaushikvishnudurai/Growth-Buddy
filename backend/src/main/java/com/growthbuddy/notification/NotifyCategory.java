package com.growthbuddy.notification;

import java.util.List;

/**
 * What a notification is about, for the bell's filter chips and the per-category
 * mute. Stored in {@code notifications.category}; a row from before the column
 * existed is NULL there and falls back to {@link #of(NotificationKind)}.
 *
 * <p>Separate from {@link NotificationKind} because the kind is a MySQL ENUM the
 * client branches on (mentorship_request shows Accept/Reject), and family and
 * mentorship-chat cards are all {@code system} kind — only the publisher knows
 * that one is about a person.
 */
public enum NotifyCategory {
    reminders,
    habits,
    people,
    money,
    system;

    /** Muting is offered for these three only — reminders the user set and system cards always ring. */
    public boolean mutable() {
        return this == people || this == money || this == habits;
    }

    /** The category a kind implies when the publisher didn't say. */
    public static NotifyCategory of(NotificationKind kind) {
        if (kind == null) return system;
        return switch (kind) {
            case reminder -> reminders;
            case habit_reminder -> habits;
            case mentorship_request, mentorship_accepted, mentorship_rejected -> people;
            // buddy_checkin: the evening reflection, which has its own on/off in Settings.
            case system, buddy_checkin -> system;
        };
    }

    /** Kinds whose NULL-category (pre-column) rows belong here. Empty for money. */
    public List<NotificationKind> legacyKinds() {
        return switch (this) {
            case reminders -> List.of(NotificationKind.reminder);
            case habits -> List.of(NotificationKind.habit_reminder);
            case people -> List.of(NotificationKind.mentorship_request,
                    NotificationKind.mentorship_accepted, NotificationKind.mentorship_rejected);
            case system -> List.of(NotificationKind.system, NotificationKind.buddy_checkin);
            case money -> List.of();
        };
    }

    /** Null for blank / "all" / anything unknown — the caller treats that as no filter. */
    public static NotifyCategory parse(String s) {
        if (s == null || s.isBlank()) return null;
        for (NotifyCategory c : values()) {
            if (c.name().equalsIgnoreCase(s.trim())) return c;
        }
        return null;
    }
}
