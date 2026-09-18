package com.growthbuddy.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * {@code ddl-auto: update} creates whatever an {@code @Entity} asks for, so a new
 * table works locally whether or not anyone added it to
 * {@code tableCreationQueries.sql} — and then prod, which is built from that
 * file, is missing it. The omission is invisible right up until deploy.
 *
 * <p>So: every {@code @Table(name = …)} in the source must have a
 * {@code CREATE TABLE} in the schema file. Source text rather than reflection,
 * because loading the entities would need a Spring context and a database, and
 * this has to be answerable in milliseconds.
 */
class SchemaCoverageTest {

    /** The first `name = "…"` after an `@Table(` — not the ones inside `@Index(`. */
    private static final Pattern TABLE = Pattern.compile("@Table\\s*\\([^)]*?name\\s*=\\s*\"([a-zA-Z_]+)\"",
            Pattern.DOTALL);
    private static final Pattern CREATE = Pattern.compile(
            "(?i)CREATE TABLE (?:IF NOT EXISTS )?`?([a-z_]+)`?\\s*\\(");
    private static final Pattern ALTER_ADD = Pattern.compile(
            "(?i)ALTER TABLE\\s+`?([a-z_]+)`?\\s+ADD COLUMN\\s+`?([a-z_]+)`?");
    /** A column line: an identifier followed by a type, not a KEY/CONSTRAINT line. */
    private static final Pattern COLUMN = Pattern.compile(
            "(?i)^`?([a-z_]+)`?\\s+(?!KEY|PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|INDEX)[a-z]");

    @Test
    void everyEntityTableIsInTheSchemaFile() throws IOException {
        Set<String> entities = entityTables();
        Set<String> schema = schemaTables();

        // If either side comes back empty the test would pass by finding nothing
        // to compare, which is the one way a guard like this rots silently.
        assertThat(entities).as("@Table names found in the source").hasSizeGreaterThan(30);
        assertThat(schema).as("CREATE TABLE statements found in the schema").hasSizeGreaterThan(30);

        assertThat(schema)
                .as("entities whose table is missing from tableCreationQueries.sql — "
                        + "ddl-auto hides this in dev and it breaks prod")
                .containsAll(entities);
    }

    private static Set<String> entityTables() throws IOException {
        Set<String> out = new TreeSet<>();
        Path main = repoRoot().resolve("backend/src/main/java");
        try (Stream<Path> files = Files.walk(main)) {
            for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String src = Files.readString(f);
                if (!src.contains("@Entity")) {
                    continue;
                }
                Matcher m = TABLE.matcher(src);
                if (m.find()) {
                    out.add(m.group(1).toLowerCase());
                }
            }
        }
        return out;
    }

    /**
     * A bare {@code ALTER TABLE x ADD COLUMN y} for a column x's own CREATE TABLE
     * already declares aborts a fresh load at that line — MySQL has no
     * {@code ADD COLUMN IF NOT EXISTS} — and every statement after it is skipped.
     *
     * <p>This has now happened twice: {@code nav_layout} left a fresh database with
     * 28 of 45 tables, and {@code checked_at} left it with 29 of 47. Both were
     * invisible here, because the coverage test above only reads the file as text
     * and never runs it. Prod is built from this file, so the failure lands on a
     * deploy, not on anyone's laptop.
     *
     * <p>An ALTER for a column the CREATE TABLE does NOT have is fine: that is a
     * genuine migration for an older database.
     */
    @Test
    void noAlterReAddsAColumnItsCreateTableAlreadyHas() throws IOException {
        String sql = Files.readString(repoRoot().resolve("tableCreationQueries.sql"));
        Set<String> clashes = new TreeSet<>();
        Matcher alter = ALTER_ADD.matcher(sql);
        while (alter.find()) {
            String table = alter.group(1).toLowerCase();
            String column = alter.group(2).toLowerCase();
            if (columnsOf(sql, table).contains(column)) {
                clashes.add(table + "." + column);
            }
        }
        assertThat(clashes)
                .as("ALTER TABLE … ADD COLUMN for a column the CREATE TABLE already declares — "
                        + "this aborts a fresh load at that line and skips every statement after it")
                .isEmpty();
    }

    /** Column names declared inside {@code table}'s CREATE TABLE body. */
    private static Set<String> columnsOf(String sql, String table) {
        Matcher m = Pattern.compile(
                "(?is)CREATE TABLE (?:IF NOT EXISTS )?`?" + Pattern.quote(table) + "`?\\s*\\((.*?)\\n\\)")
                .matcher(sql);
        Set<String> out = new TreeSet<>();
        if (!m.find()) {
            return out;
        }
        for (String line : m.group(1).split("\\n")) {
            Matcher col = COLUMN.matcher(line.trim());
            if (col.find()) {
                out.add(col.group(1).toLowerCase());
            }
        }
        return out;
    }

    private static Set<String> schemaTables() throws IOException {
        Set<String> out = new TreeSet<>();
        Matcher m = CREATE.matcher(Files.readString(repoRoot().resolve("tableCreationQueries.sql")));
        while (m.find()) {
            out.add(m.group(1).toLowerCase());
        }
        return out;
    }

    /** Surefire runs from backend/; the schema and the source tree hang off the repo root. */
    static Path repoRoot() {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            if (Files.exists(dir.resolve("tableCreationQueries.sql"))) {
                return dir;
            }
        }
        throw new IllegalStateException("repo root not found from " + Path.of("").toAbsolutePath());
    }
}
