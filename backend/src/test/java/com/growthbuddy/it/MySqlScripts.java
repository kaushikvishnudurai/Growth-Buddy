package com.growthbuddy.it;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.testcontainers.containers.Container.ExecResult;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

/**
 * Shared plumbing for the integration tests: the repo's two SQL files, a MySQL 8
 * container, and a way to run a file through the real {@code mysql} client —
 * the same tool an operator pastes these files into, so statement splitting,
 * comments and error reporting are exactly what prod sees.
 */
final class MySqlScripts {

    static final String DB = "growth_buddy";
    static final String SCHEMA_IN_CONTAINER = "/tmp/tableCreationQueries.sql";
    static final String MIGRATIONS_IN_CONTAINER = "/tmp/migrations.sql";

    private static final Pattern ERROR_LINE =
            Pattern.compile("^ERROR (\\d+) \\(([0-9A-Z]+)\\)(?: at line (\\d+))?: (.*)$");

    private MySqlScripts() {}

    /** A repo-root file, found by walking up from the surefire working directory (backend/). */
    static Path repoFile(String name) {
        Path dir = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path d = dir; d != null; d = d.getParent()) {
            Path p = d.resolve(name);
            if (Files.isRegularFile(p)) return p;
        }
        throw new IllegalStateException(name + " not found above " + dir);
    }

    @SuppressWarnings("resource")
    static MySQLContainer<?> newContainer() {
        return new MySQLContainer<>(DockerImageName.parse("mysql:8.0"))
                .withDatabaseName(DB)
                .withUsername("test")
                .withPassword("test")
                .withCommand("--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci")
                .withCopyFileToContainer(MountableFile.forHostPath(repoFile("tableCreationQueries.sql")),
                        SCHEMA_IN_CONTAINER)
                .withCopyFileToContainer(MountableFile.forHostPath(repoFile("migrations.sql")),
                        MIGRATIONS_IN_CONTAINER);
    }

    /** One error the mysql client reported: code, line in the file, message. */
    record SqlError(int code, String sqlState, int line, String message) {
        @Override public String toString() {
            return "ERROR " + code + " (" + sqlState + ") at line " + line + ": " + message;
        }
    }

    /** Result of piping a file through {@code mysql}. */
    record Run(int exitCode, List<SqlError> errors, String stderr) {}

    /**
     * Runs {@code fileInContainer} as root against {@link #DB}. With {@code force}
     * the client keeps going past an error (and reports every one); without it, it
     * stops at the first, as an operator's paste would.
     */
    static Run run(MySQLContainer<?> c, String fileInContainer, boolean force) throws Exception {
        String cmd = "MYSQL_PWD='" + c.getPassword() + "' mysql -uroot --default-character-set=utf8mb4 "
                + (force ? "--force " : "") + DB + " < " + fileInContainer + " > /dev/null";
        ExecResult r = c.execInContainer("sh", "-c", cmd);
        List<SqlError> errors = new ArrayList<>();
        for (String line : r.getStderr().split("\\R")) {
            Matcher m = ERROR_LINE.matcher(line.trim());
            if (m.matches()) {
                errors.add(new SqlError(Integer.parseInt(m.group(1)), m.group(2),
                        m.group(3) == null ? -1 : Integer.parseInt(m.group(3)), m.group(4)));
            }
        }
        return new Run(r.getExitCode(), errors, r.getStderr());
    }

    /** Runs a query through the client and returns its tab-separated rows. */
    static List<String> query(MySQLContainer<?> c, String sql) throws Exception {
        ExecResult r = c.execInContainer("sh", "-c",
                "MYSQL_PWD='" + c.getPassword() + "' mysql -uroot -N -B --default-character-set=utf8mb4 "
                        + DB + " -e \"" + sql.replace("\"", "\\\"") + "\"");
        if (r.getExitCode() != 0) {
            throw new IllegalStateException("query failed: " + sql + "\n" + r.getStderr());
        }
        List<String> rows = new ArrayList<>();
        for (String line : r.getStdout().split("\\R")) {
            if (!line.isEmpty()) rows.add(line);
        }
        return rows;
    }
}
