package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;

import com.growthbuddy.goal.Goal;
import com.growthbuddy.mentorship.MentorshipRequest;
import java.util.List;
import org.hibernate.annotations.DynamicUpdate;
import org.junit.jupiter.api.Test;

/**
 * Rows that other paths write one column at a time, under their own lock or as
 * bulk SQL (users.ui_prefs / xp_total, goals.progress_json, a mentorship's
 * status), must save only the columns a save changed. A full-row save from a
 * stale copy put the old values back: a mentor opening the progress sheet
 * (markChecked) re-accepted a link just revoked, a timezone change reverted XP.
 */
class DynamicUpdateTest {

    @Test
    void sharedRowsWriteOnlyTheirChangedColumns() {
        for (Class<?> c : List.of(User.class, Goal.class, MentorshipRequest.class)) {
            assertThat(c.isAnnotationPresent(DynamicUpdate.class)).as(c.getSimpleName()).isTrue();
        }
    }
}
