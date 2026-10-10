package com.growthbuddy.notification;

/** Matches MySQL ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','reminder','system','habit_reminder','buddy_checkin'). */
public enum NotificationKind {
    mentorship_request,
    mentorship_accepted,
    mentorship_rejected,
    reminder,
    system,
    habit_reminder,
    /** Buddy's evening reflection prompt ({@code mentor/ReflectionScheduler}); tapping it opens Buddy. */
    buddy_checkin
}
