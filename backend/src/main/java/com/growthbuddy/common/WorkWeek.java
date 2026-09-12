package com.growthbuddy.common;

import java.time.DayOfWeek;
import java.util.Map;
import java.util.Set;

/**
 * Which days count as a working week for this user.
 *
 * <p>"Weekdays" was hardcoded Mon–Fri in both recurrence implementations, which
 * is simply wrong in much of the world: the Gulf works Sun–Thu, and plenty of
 * Indian offices work Mon–Sat. A reminder set to repeat on working days fired on
 * the user's weekend and stayed silent on a day they were at work.
 *
 * <p>Stored in the user's {@code ui_prefs} JSON under {@code workWeek} rather
 * than as its own column, because prod runs {@code ddl-auto: none} and a new
 * column there needs a hand-run migration. The blob is already synced across
 * devices in both directions. It does mean this one key is read by the server
 * (the WhatsApp scheduler needs it), not only by the client — worth knowing
 * before someone treats {@code ui_prefs} as client-only state.
 *
 * <p>{@code scripts/recurrence.js} must agree with this day for day, and
 * {@code scripts/recurrence.cases.json} is the shared list of cases both sides
 * are tested against.
 */
public enum WorkWeek {

    MON_FRI("mon_fri", Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
            DayOfWeek.THURSDAY, DayOfWeek.FRIDAY)),
    SUN_THU("sun_thu", Set.of(DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY,
            DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY)),
    MON_SAT("mon_sat", Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
            DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY));

    /** What an unset or unrecognised preference means. */
    public static final WorkWeek DEFAULT = MON_FRI;

    private final String key;
    private final Set<DayOfWeek> days;

    WorkWeek(String key, Set<DayOfWeek> days) {
        this.key = key;
        this.days = days;
    }

    public String key() {
        return key;
    }

    public boolean includes(DayOfWeek day) {
        return days.contains(day);
    }

    /** Parse a stored value; anything unknown falls back to {@link #DEFAULT}. */
    public static WorkWeek of(String value) {
        if (value != null) {
            for (WorkWeek w : values()) {
                if (w.key.equalsIgnoreCase(value.trim())) {
                    return w;
                }
            }
        }
        return DEFAULT;
    }

    /** Read it out of a user's ui_prefs blob, tolerating every shape of missing. */
    public static WorkWeek fromPrefs(Map<String, Object> uiPrefs) {
        Object raw = uiPrefs == null ? null : uiPrefs.get("workWeek");
        return of(raw instanceof String s ? s : null);
    }
}
