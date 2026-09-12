package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.growthbuddy.common.WorkWeek;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The same recurrence cases {@code scripts/recurrence.test.mjs} runs, run against
 * the Java implementation.
 *
 * <p>There are two copies of this logic and there have to be: the WhatsApp
 * scheduler cannot import JavaScript. They had already drifted once, silently —
 * the mini calendar lost a monthly reminder anchored to the 31st every February
 * while the calendar screen kept it. Mirrored-but-separate test files did not
 * stop that, because nothing made anyone write the same case twice.
 *
 * <p>So the cases live in {@code scripts/recurrence.cases.json} and both sides
 * read them. Add one there and this test picks it up with no Java change at all.
 */
class SharedRecurrenceCasesTest {

    private final ReminderService service = new ReminderService(null, null, null);

    @Test
    void bothImplementationsAgreeOnEverySharedCase() throws IOException {
        JsonNode cases = new ObjectMapper()
                .readTree(Files.readString(casesFile()))
                .get("cases");

        assertThat(cases).as("shared cases found").isNotNull();
        assertThat(cases.size()).as("the shared case file should not have shrunk to nothing")
                .isGreaterThan(20);

        for (JsonNode c : cases) {
            JsonNode r = c.get("reminder");
            CalendarReminder rem = new CalendarReminder();
            rem.setAnchorDate(LocalDate.parse(r.get("date").asText()));
            rem.setRepeat(RepeatFreq.valueOf(r.get("repeat").asText()));
            if (r.hasNonNull("from")) {
                rem.setFromDate(LocalDate.parse(r.get("from").asText()));
            }
            if (r.hasNonNull("until")) {
                rem.setUntilDate(LocalDate.parse(r.get("until").asText()));
            }
            if (r.hasNonNull("skip")) {
                Set<LocalDate> skips = new HashSet<>();
                r.get("skip").forEach(d -> skips.add(LocalDate.parse(d.asText())));
                rem.setSkipDays(skips);
            }
            WorkWeek week = c.hasNonNull("workWeek")
                    ? WorkWeek.of(c.get("workWeek").asText())
                    : WorkWeek.DEFAULT;

            assertThat(service.occursOn(rem, LocalDate.parse(c.get("day").asText()), week))
                    .as("%s — %s anchored %s on %s", c.get("why").asText(),
                            r.get("repeat").asText(), r.get("date").asText(), c.get("day").asText())
                    .isEqualTo(c.get("expect").asBoolean());
        }
    }

    /** Surefire runs from backend/; the case file sits in the frontend's scripts/. */
    private static Path casesFile() {
        for (Path dir = Path.of("").toAbsolutePath(); dir != null; dir = dir.getParent()) {
            Path candidate = dir.resolve("scripts/recurrence.cases.json");
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("scripts/recurrence.cases.json not found from "
                + Path.of("").toAbsolutePath());
    }
}
