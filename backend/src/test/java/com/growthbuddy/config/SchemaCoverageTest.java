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
