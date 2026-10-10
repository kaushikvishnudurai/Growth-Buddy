package com.growthbuddy.it;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The two SQL files against a real MySQL 8, run the way an operator runs them:
 * through the {@code mysql} client.
 *
 * <p>{@code tableCreationQueries.sql} must build a fresh database with no error,
 * and again on top of itself (every CREATE is guarded).
 *
 * <p>{@code migrations.sql} is NOT fully idempotent, by its own header: MySQL has
 * no {@code ADD COLUMN IF NOT EXISTS}, so re-running an ALTER for a column that
 * already exists is an error. What it must be is <em>harmless</em> to re-run on a
 * database that already has everything: the only errors allowed are "that column
 * / index is already there" and "that index is already gone", and the structure
 * afterwards must be exactly what the schema file built. That last check is the
 * one that bites: a {@code MODIFY ... ENUM(...)} that lists fewer values than the
 * CREATE TABLE would silently narrow a live column, and a migration naming a table
 * or column the schema no longer has fails with a code outside the allowed set.
 */
@Tag("integration")
@Testcontainers(disabledWithoutDocker = true)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SchemaMigrationsIT {

    /** 1060 duplicate column, 1061 duplicate key name, 1091 can't DROP (already gone). */
    private static final Set<Integer> ALREADY_APPLIED = Set.of(1060, 1061, 1091);

    private static final String COLUMNS =
            "SELECT table_name, column_name, column_type, is_nullable, IFNULL(column_default, '<null>'), extra"
                    + " FROM information_schema.COLUMNS WHERE table_schema = 'growth_buddy' ORDER BY 1, 2";
    private static final String INDEXES =
            "SELECT table_name, index_name, non_unique, seq_in_index, column_name"
                    + " FROM information_schema.STATISTICS WHERE table_schema = 'growth_buddy' ORDER BY 1, 2, 4";
    private static final String TABLES =
            "SELECT table_name FROM information_schema.TABLES WHERE table_schema = 'growth_buddy' ORDER BY 1";

    @Container
    static final MySQLContainer<?> MYSQL = MySqlScripts.newContainer();

    private static List<String> columnsAfterSchema;
    private static List<String> indexesAfterSchema;
    private static List<String> tablesAfterSchema;
    private static List<MySqlScripts.SqlError> firstMigrationErrors;

    @Test
    @Order(1)
    void schemaBuildsAFreshDatabaseWithoutErrors() throws Exception {
        MySqlScripts.Run run = MySqlScripts.run(MYSQL, MySqlScripts.SCHEMA_IN_CONTAINER, false);
        assertThat(run.errors()).as(run.stderr()).isEmpty();
        assertThat(run.exitCode()).as(run.stderr()).isZero();

        tablesAfterSchema = MySqlScripts.query(MYSQL, TABLES);
        columnsAfterSchema = MySqlScripts.query(MYSQL, COLUMNS);
        indexesAfterSchema = MySqlScripts.query(MYSQL, INDEXES);
        assertThat(tablesAfterSchema).contains("users", "sessions", "rate_limit_counters", "login_attempts");
    }

    @Test
    @Order(2)
    void schemaIsSafeToRunTwice() throws Exception {
        MySqlScripts.Run run = MySqlScripts.run(MYSQL, MySqlScripts.SCHEMA_IN_CONTAINER, false);
        assertThat(run.errors()).as(run.stderr()).isEmpty();
        assertThat(run.exitCode()).as(run.stderr()).isZero();
        assertThat(MySqlScripts.query(MYSQL, COLUMNS)).isEqualTo(columnsAfterSchema);
    }

    @Test
    @Order(3)
    void migrationsOnTopOfTheSchemaOnlyHitAlreadyAppliedErrors() throws Exception {
        MySqlScripts.Run run = MySqlScripts.run(MYSQL, MySqlScripts.MIGRATIONS_IN_CONTAINER, true);
        assertThat(run.errors())
                .as("migrations.sql against a fresh schema: every error must mean 'already applied'\n"
                        + run.stderr())
                .allSatisfy(e -> assertThat(ALREADY_APPLIED).contains(e.code()));
        firstMigrationErrors = run.errors();
        assertStructureUnchanged("first migrations run");
    }

    @Test
    @Order(4)
    void migrationsAreHarmlessToRunASecondTime() throws Exception {
        MySqlScripts.Run run = MySqlScripts.run(MYSQL, MySqlScripts.MIGRATIONS_IN_CONTAINER, true);
        assertThat(run.errors()).as(run.stderr())
                .allSatisfy(e -> assertThat(ALREADY_APPLIED).contains(e.code()));
        // Same statements fail the same way: a second run converges, it does not drift.
        assertThat(run.errors()).isEqualTo(firstMigrationErrors);
        assertStructureUnchanged("second migrations run");
    }

    private static void assertStructureUnchanged(String when) throws Exception {
        assertThat(MySqlScripts.query(MYSQL, TABLES)).as("tables after " + when).isEqualTo(tablesAfterSchema);
        assertThat(MySqlScripts.query(MYSQL, COLUMNS))
                .as("columns after " + when + " (a MODIFY must not narrow what the CREATE TABLE declares)")
                .isEqualTo(columnsAfterSchema);
        assertThat(MySqlScripts.query(MYSQL, INDEXES)).as("indexes after " + when).isEqualTo(indexesAfterSchema);
    }
}
