package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.CurrentUser;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The export used to read only {@code WHERE user_id = ?} tables, so every Buddy
 * chat message, both sides of a mentorship and the account's own family profile
 * were purged on deletion but never handed over on export (SEC-15).
 */
class DataExportCoverageTest {

    @AfterEach
    void clear() {
        CurrentUser.clear();
    }

    /** Every child the purge deletes is exported, or named as someone else's rows. */
    @Test
    void everyPurgedChildTableIsExportedOrExcludedOnPurpose() {
        for (String[] cd : AuthService.CHILD_TABLES) {
            assertThat(DataExportController.RELATED_QUERIES.containsKey(cd[0])
                    || DataExportController.NOT_EXPORTED_CHILDREN.contains(cd[0]))
                    .as("purged child table %s is neither exported nor excluded", cd[0])
                    .isTrue();
        }
        // The purge's relationship-keyed deletes (purgeAccount), written out by hand there.
        assertThat(DataExportController.RELATED_QUERIES)
                .containsKeys("mentor_messages", "habit_streaks", "calendar_reminder_skips",
                        "mentorship_requests", "mentorship_messages", "family_members")
                .doesNotContainKeys("circle_post_reactions", "circle_post_comments");
        // An exclusion that is not a purged child is a typo hiding a real table.
        assertThat(Arrays.stream(AuthService.CHILD_TABLES).map(cd -> cd[0]).toList())
                .containsAll(DataExportController.NOT_EXPORTED_CHILDREN);
    }

    @Test
    void exportCarriesTheRelatedTablesScopedToTheUser() {
        UUID me = UUID.randomUUID();
        CurrentUser.set(me);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), eq(me.toString()))).thenReturn(List.of());
        when(jdbc.queryForList(eq(DataExportController.RELATED_QUERIES.get("mentor_messages")), eq(me.toString())))
                .thenReturn(List.of(Map.of("id", "m1", "content", "hello")));

        Map<String, Object> body = new DataExportController(jdbc).export().getBody();
        @SuppressWarnings("unchecked")
        Map<String, Object> tables = (Map<String, Object>) body.get("tables");

        assertThat(tables).containsKeys("mentor_messages", "mentorship_requests", "family_members", "habits");
        assertThat(tables.get("mentor_messages")).isEqualTo(List.of(Map.of("id", "m1", "content", "hello")));
        assertThat(tables).doesNotContainKeys("sessions", "password_credentials");
        // One bound parameter each, so nothing but the user's id is ever spliced in.
        DataExportController.RELATED_QUERIES.values()
                .forEach(sql -> assertThat(sql.chars().filter(c -> c == '?').count()).isEqualTo(1));
        assertThat(Set.copyOf(DataExportController.RELATED_QUERIES.keySet()))
                .doesNotContainAnyElementsOf(DataExportController.SECRET_TABLES);
    }
}
