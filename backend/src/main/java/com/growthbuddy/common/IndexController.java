package com.growthbuddy.common;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves the frontend's index.html.
 *
 * <p>A built {@code dist/} wins over the raw source, so one container can serve
 * the API and the real bundle on a single origin — which is also what makes
 * relative API paths work, taking CORS out of the deployment entirely. Falling
 * back to the source tree keeps {@code ./run.sh} usable without a build.
 *
 * <p>Both the working directory and its parent are searched, so {@code java -jar
 * backend/target/*.jar} (run from backend/) and {@code ./run.sh} (run from the
 * repo root) both work without arguments.
 */
@RestController
public class IndexController {

    /**
     * The page's bytes, re-read only when the file's modified time changes: a stat
     * per request instead of a read, and a rebuild (or a dev edit) still shows up
     * at once. It was read once and kept forever, and a local {@code npm run build}
     * mid-run served the old page, whose hashed chunks were gone: a blank app.
     */
    private record Cached(Path file, java.nio.file.attribute.FileTime modified, byte[] body) {}

    private volatile Cached cached;

    @GetMapping(value = { "/", "/index.html" }, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<byte[]> index() throws Exception {
        Path file = locate();
        if (file == null) {
            return ResponseEntity.status(404).body("<h1>index.html not found</h1>".getBytes());
        }
        java.nio.file.attribute.FileTime modified = Files.getLastModifiedTime(file);
        Cached c = cached;
        if (c == null || !c.file().equals(file) || !c.modified().equals(modified)) {
            c = new Cached(file, modified, Files.readAllBytes(file));
            cached = c;
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.TEXT_HTML)
                .body(c.body());
    }

    private Path locate() {
        for (Path candidate : new Path[] {
                Paths.get("dist", "index.html"),
                Paths.get("..", "dist", "index.html"),
                Paths.get("index.html"),
                Paths.get("..", "index.html"),
        }) {
            if (Files.isRegularFile(candidate)) {
                return candidate;
            }
        }
        return null;
    }
}
