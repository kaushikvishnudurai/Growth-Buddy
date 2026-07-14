package com.growthbuddy.gcal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.YearMonth;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link GoogleCalendarService#parseEvents}: timed vs all-day
 * events, multi-day expansion, midnight ends, and the month filter that keeps
 * padded fetches from duplicating edge events across months.
 */
class GoogleCalendarEventParsingTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final YearMonth JULY = YearMonth.of(2026, 7);

    private static JsonNode items(String itemsJson) {
        try {
            return JSON.readTree(itemsJson);
        } catch (Exception ex) {
            throw new IllegalArgumentException(ex);
        }
    }

    @Test
    void timedEventKeepsDateAndTime() {
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"a","summary":"Standup",
                  "start":{"dateTime":"2026-07-14T09:30:00+05:30"},
                  "end":{"dateTime":"2026-07-14T10:00:00+05:30"}}]"""), JULY);
        assertThat(out).hasSize(1);
        assertThat(out.get(0).date()).isEqualTo("2026-07-14");
        assertThat(out.get(0).time()).isEqualTo("09:30");
        assertThat(out.get(0).title()).isEqualTo("Standup");
    }

    @Test
    void allDayEventHasNoTime() {
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"b","summary":"Holiday",
                  "start":{"date":"2026-07-20"},
                  "end":{"date":"2026-07-21"}}]"""), JULY);
        assertThat(out).hasSize(1);
        assertThat(out.get(0).date()).isEqualTo("2026-07-20");
        assertThat(out.get(0).time()).isNull();
    }

    @Test
    void multiDayEventAppearsOnEveryCoveredDayWithinTheMonth() {
        // All-day July 30 – Aug 1 (Google end date is exclusive: Aug 2).
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"c","summary":"Trip",
                  "start":{"date":"2026-07-30"},
                  "end":{"date":"2026-08-02"}}]"""), JULY);
        assertThat(out).extracting(GoogleCalendarService.EventDto::date)
                .containsExactly("2026-07-30", "2026-07-31"); // Aug 1 belongs to August's fetch
        // August's fetch picks up the remainder — no duplicated July days.
        var aug = GoogleCalendarService.parseEvents(items("""
                [{"id":"c","summary":"Trip",
                  "start":{"date":"2026-07-30"},
                  "end":{"date":"2026-08-02"}}]"""), YearMonth.of(2026, 8));
        assertThat(aug).extracting(GoogleCalendarService.EventDto::date)
                .containsExactly("2026-08-01");
    }

    @Test
    void timeShowsOnlyOnTheFirstDayOfAMultiDaySpan() {
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"d","summary":"Hackathon",
                  "start":{"dateTime":"2026-07-10T18:00:00+05:30"},
                  "end":{"dateTime":"2026-07-12T12:00:00+05:30"}}]"""), JULY);
        assertThat(out).extracting(GoogleCalendarService.EventDto::date)
                .containsExactly("2026-07-10", "2026-07-11", "2026-07-12");
        assertThat(out.get(0).time()).isEqualTo("18:00");
        assertThat(out.get(1).time()).isNull();
        assertThat(out.get(2).time()).isNull();
    }

    @Test
    void eventEndingAtMidnightDoesNotBleedIntoTheNextDay() {
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"e","summary":"Late show",
                  "start":{"dateTime":"2026-07-05T22:00:00+05:30"},
                  "end":{"dateTime":"2026-07-06T00:00:00+05:30"}}]"""), JULY);
        assertThat(out).extracting(GoogleCalendarService.EventDto::date)
                .containsExactly("2026-07-05");
    }

    @Test
    void paddedFetchLeaksFromAdjacentMonthsAreFilteredOut() {
        // The ±1 day fetch window can return a June 30 event — July must drop it.
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"f","summary":"June thing",
                  "start":{"date":"2026-06-30"},
                  "end":{"date":"2026-07-01"}}]"""), JULY);
        assertThat(out).isEmpty();
    }

    @Test
    void missingEndAndUntitledEventsStillParse() {
        var out = GoogleCalendarService.parseEvents(items("""
                [{"id":"g","start":{"dateTime":"2026-07-08T08:00:00+05:30"}}]"""), JULY);
        assertThat(out).hasSize(1);
        assertThat(out.get(0).title()).isEqualTo("(no title)");
        assertThat(out.get(0).date()).isEqualTo("2026-07-08");
    }

    @Test
    void eventsWithoutAStartAreSkipped() {
        List<GoogleCalendarService.EventDto> out =
                GoogleCalendarService.parseEvents(items("[{\"id\":\"h\",\"summary\":\"broken\"}]"), JULY);
        assertThat(out).isEmpty();
    }
}
