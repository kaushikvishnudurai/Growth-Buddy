package com.growthbuddy.habit;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * {@link HabitService#HABIT_ICONS} mirrors the icons the habit form can send:
 * gb-kit.js's DOMAIN map and app.js's FITNESS_PRESETS and HABIT_TEMPLATES. An icon added there and
 * not here makes the form's own save fail with a 400.
 */
class HabitIconsTest {

    @Test
    void allowListCoversEveryIconTheFormSends() throws Exception {
        assertCovers(block("scripts/gb-kit.js", "const DOMAIN = {", "};"));
        assertCovers(block("scripts/app.js", "const FITNESS_PRESETS = [", "];"));
        assertCovers(block("scripts/app.js", "const HABIT_TEMPLATES = [", "];"));
    }

    private static void assertCovers(String block) {
        Matcher m = Pattern.compile("icon: '([^']+)'").matcher(block);
        int found = 0;
        while (m.find()) {
            found++;
            assertTrue(HabitService.HABIT_ICONS.contains(m.group(1)),
                    "HABIT_ICONS is missing '" + m.group(1) + "'");
        }
        assertTrue(found > 0, "no icons parsed; did the JS list move?");
    }

    /** Surefire runs from backend/; the JS sits in the frontend's scripts/. */
    private static String block(String file, String start, String end) throws Exception {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path p = dir.resolve(file);
            if (Files.exists(p)) {
                String src = Files.readString(p);
                int from = src.indexOf(start);
                assertTrue(from >= 0, start + " not found in " + file);
                return src.substring(from, src.indexOf(end, from));
            }
        }
        throw new IllegalStateException(file + " not found");
    }
}
