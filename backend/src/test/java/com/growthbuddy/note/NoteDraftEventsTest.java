package com.growthbuddy.note;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The note_draft frame names a draft and never carries its text; a bad origin is dropped, not echoed. */
class NoteDraftEventsTest {

    @Test
    void composerFrameNamesTheComposerAndTheWriter() {
        Map<String, Object> f = NoteDraftEvents.frame(null, "abc-123", "Growth Buddy on Pixel 8");
        assertEquals("note_draft", f.get("kind"));
        assertEquals(true, f.get("transient"));
        assertEquals("composer", f.get("note"));
        assertEquals("abc-123", f.get("origin"));
        assertEquals("Growth Buddy on Pixel 8", f.get("device"));
        assertEquals(5, f.size(), "no title or body in the frame");
    }

    @Test
    void noteFrameCarriesTheIdOnly() {
        UUID id = UUID.randomUUID();
        Map<String, Object> f = NoteDraftEvents.frame(id, null, null);
        assertEquals(id.toString(), f.get("note"));
        assertFalse(f.containsKey("origin"));
        assertFalse(f.containsKey("device"));
    }

    @Test
    void malformedOriginIsDroppedAndDeviceIsCapped() {
        Map<String, Object> f = NoteDraftEvents.frame(null, "<script>", "x".repeat(200));
        assertFalse(f.containsKey("origin"));
        assertTrue(((String) f.get("device")).length() <= 80);
        assertFalse(NoteDraftEvents.frame(null, "a", "   ").containsKey("device"));
    }
}
