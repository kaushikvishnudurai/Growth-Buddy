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

    @GetMapping(value = { "/", "/index.html" }, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<byte[]> index() throws Exception {
        Path file = locate();
        if (file == null) {
            return ResponseEntity.status(404).body("<h1>index.html not found</h1>".getBytes());
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.TEXT_HTML)
                .body(Files.readAllBytes(file));
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
