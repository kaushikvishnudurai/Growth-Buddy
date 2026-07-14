package com.growthbuddy.notification;

/** Matches MySQL ENUM('mentorship_request','mentorship_accepted','mentorship_rejected','system'). */
public enum NotificationKind {
    mentorship_request,
    mentorship_accepted,
    mentorship_rejected,
    system
}
