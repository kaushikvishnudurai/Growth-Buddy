package com.growthbuddy.mentorship;

import com.growthbuddy.user.User;

/**
 * The Settings → Account → Privacy switch ({@code shareProgress} in ui_prefs).
 *
 * <p>One rule, read in two places: a mentor's progress window
 * ({@link MentorshipController#partnerStatus}) and a circle challenge's
 * leaderboard ({@code CircleService}). The leaderboard used to rank every member
 * by their habit check-ins regardless, so switching sharing off hid your board
 * from your mentor while a circle of near-strangers could still read the count.
 *
 * <p>Anything other than an explicit false means sharing, so every account that
 * predates the toggle keeps working.
 */
public final class ProgressSharing {

    private ProgressSharing() {
    }

    public static boolean sharesProgress(User u) {
        if (u == null) {
            return true;
        }
        Object v = u.getUiPrefs() == null ? null : u.getUiPrefs().get("shareProgress");
        return !Boolean.FALSE.equals(v) && !"false".equals(v);
    }
}
