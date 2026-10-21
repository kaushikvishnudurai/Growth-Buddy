package com.growthbuddy.user;

import java.util.Locale;
import java.util.Set;

/**
 * Who may open the admin portal ({@code /api/admin}, the Operator box in Settings).
 * To grant access, add the account's email to {@link #EMAILS} (lowercase) and
 * deploy. An account not on the list, signed in or not, gets a 404, the same as
 * an unknown page.
 */
public final class AdminAccess {

    private static final Set<String> EMAILS = Set.of(
            "kaushikvishnudurai@gmail.com"
    );

    private AdminAccess() {
    }

    /** True for a listed email, any case. Null or blank is never an admin. */
    public static boolean isAdmin(String email) {
        return email != null && EMAILS.contains(email.trim().toLowerCase(Locale.ROOT));
    }
}
