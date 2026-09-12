package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * "Delete my account" runs off a hand-written list of tables. A list like that is
 * only ever as current as the last person who remembered it — and two tables
 * (focus_sessions, weekly_reviews) had already been added without it, so deleting
 * an account quietly left those rows behind pointing at a user that was gone.
 *
 * <p>This reads the schema instead of the database, so it needs no connection:
 * every table declaring a plain {@code user_id} column must appear in
 * {@link AuthService#USER_OWNED_TABLES}. Columns named for a relationship rather
 * than ownership ({@code owner_user_id}, {@code linked_user_id}, …) are out of
 * scope on purpose — see the field's javadoc.
 */
class AccountDeletionCoverageTest {

    private static final Pattern CREATE_TABLE = Pattern.compile(
            "(?i)CREATE TABLE (?:IF NOT EXISTS )?`?([a-z_]+)`?\\s*\\(");
    private static final Pattern OWNS_USER_ID = Pattern.compile("(?im)^\\s*`?user_id`?\\s");

    @Test
    void everyUserOwnedTableIsPurgedOnAccountDeletion() throws IOException {
        Set<String> declared = tablesWithAUserIdColumn();
        // A guard on the guard: if the schema ever moves, this test must fail loudly
        // rather than pass by finding nothing to check.
        assertThat(declared).hasSizeGreaterThan(20);

        assertThat(Set.of(AuthService.USER_OWNED_TABLES))
                .as("tables with a user_id column that deleteAccount() would leave behind")
                .containsAll(declared);
    }

    /** And nothing in the list that the schema doesn't have — a typo deletes nothing. */
    @Test
    void thePurgeListHasNoTableTheSchemaDoesNotDeclare() throws IOException {
        assertThat(tablesWithAUserIdColumn())
                .as("entries in USER_OWNED_TABLES with no matching CREATE TABLE")
                .containsAll(Set.of(AuthService.USER_OWNED_TABLES));
    }

    private static Set<String> tablesWithAUserIdColumn() throws IOException {
        String sql = Files.readString(schemaPath());
        Set<String> out = new LinkedHashSet<>();
        Matcher m = CREATE_TABLE.matcher(sql);
        while (m.find()) {
            String name = m.group(1);
            int bodyEnd = sql.indexOf(';', m.end());
            String body = sql.substring(m.end(), bodyEnd < 0 ? sql.length() : bodyEnd);
            if (OWNS_USER_ID.matcher(body).find()) {
                out.add(name);
            }
        }
        return out;
    }

    /** Surefire runs from backend/; the schema lives at the repo root. */
    private static Path schemaPath() {
        Path relative = Path.of("tableCreationQueries.sql");
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve(relative);
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("tableCreationQueries.sql not found from " + Path.of("").toAbsolutePath());
    }
}
