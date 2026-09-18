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
     * No bare {@code ALTER TABLE … ADD COLUMN} in the schema file — every added
     * column goes through {@code gb_add_column}, which adds it only if missing.
     *
     * <p>A bare ALTER cannot be right in both directions at once. On a fresh
     * database it aborts the load at that line if the CREATE TABLE already has
     * the column (nav_layout left 28 of 45 tables; checked_at left 29 of 47),
     * and on an existing one it aborts if the column is already there — which
     * is every deploy, since prod runs {@code ddl-auto: none} and this file is
     * the only thing that ever adds a column there.
     */
    @Test
    void everyAddedColumnGoesThroughTheAddIfMissingProcedure() throws IOException {
        String sql = Files.readString(repoRoot().resolve("tableCreationQueries.sql"));
        Set<String> bare = new TreeSet<>();
        for (String line : sql.split("\\n")) {
            Matcher m = ALTER_ADD.matcher(line.trim());
            if (line.trim().toUpperCase().startsWith("ALTER TABLE") && m.find()) {
                bare.add(m.group(1) + "." + m.group(2));
            }
        }
        assertThat(bare)
                .as("bare ALTER TABLE … ADD COLUMN — use CALL gb_add_column('table', 'col', "
                        + "'col TYPE …') so the file is safe on a fresh database, on prod, and on a re-run")
                .isEmpty();
    }

    /**
     * Every table the file creates is guarded, so running it against a database
     * that already has them is a no-op rather than an abort at the first one.
     * That is what makes it usable as the migration it has to be.
     */
    @Test
    void everyCreateTableIsGuarded() throws IOException {
        String sql = Files.readString(repoRoot().resolve("tableCreationQueries.sql"));
        Set<String> unguarded = new TreeSet<>();
        for (String line : sql.split("\\n")) {
            String t = line.trim();
            if (t.toUpperCase().startsWith("CREATE TABLE ") && !t.toUpperCase().contains("IF NOT EXISTS")) {
                unguarded.add(t);
            }
        }
        assertThat(unguarded).as("CREATE TABLE without IF NOT EXISTS").isEmpty();
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
