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
 * Serves the frontend's index.html. Looks first in the JVM working directory,
 * then one level up — so both {@code java -jar backend/target/*.jar} (run from
 * backend/) and {@code ./run.sh} (run from repo root) work without arguments.
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
