package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * The sound limits live twice, because the browser can't read a Java constant:
 * {@code CUSTOM_MAX_COUNT} / {@code CUSTOM_MAX_BYTES} in scripts/chime.js, and
 * {@link CustomSoundService#MAX_PER_USER} / {@link CustomSoundService#MAX_BYTES}
 * here. Changed on one side only, the picker would offer a slot the server
 * refuses (or hide one it allows). This reads chime.js and holds them equal.
 */
class CustomSoundLimitsTest {

    @Test
    void theClientAndServerAgreeOnTheCap() throws IOException {
        String chime = Files.readString(chimeJs());
        assertThat(constant(chime, "CUSTOM_MAX_COUNT"))
                .as("CUSTOM_MAX_COUNT in chime.js vs CustomSoundService.MAX_PER_USER")
                .isEqualTo(CustomSoundService.MAX_PER_USER);
    }

    @Test
    void theClientAndServerAgreeOnTheSize() throws IOException {
        Matcher m = Pattern.compile("export const CUSTOM_MAX_BYTES = (\\d+) \\* 1024;").matcher(Files.readString(chimeJs()));
        assertThat(m.find()).as("CUSTOM_MAX_BYTES in chime.js, written as N * 1024").isTrue();
        assertThat(Integer.parseInt(m.group(1)) * 1024).isEqualTo(CustomSoundService.MAX_BYTES);
    }

    private static int constant(String source, String name) {
        Matcher m = Pattern.compile("export const " + name + " = (\\d+);").matcher(source);
        assertThat(m.find()).as(name + " in chime.js").isTrue();
        return Integer.parseInt(m.group(1));
    }

    /** Surefire runs from backend/; chime.js sits in the frontend's scripts/. */
    private static Path chimeJs() {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("scripts/chime.js");
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("scripts/chime.js not found from " + Path.of("").toAbsolutePath());
    }
}
