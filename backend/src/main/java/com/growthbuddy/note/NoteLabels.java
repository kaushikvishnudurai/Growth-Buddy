package com.growthbuddy.note;

import com.growthbuddy.common.ApiException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * A note's labels: parsed, checked and stored as one comma-joined column.
 *
 * <p>The same rules live in scripts/notes-core.js ({@code parseLabels} /
 * {@code validateLabels}) so the chip editor refuses a label while it can still
 * be fixed; this is the copy that is enforced. A comma is the separator, so it
 * can never be part of a label — each entry is split on it rather than refused.
 */
final class NoteLabels {

    static final int MAX_COUNT = 10;
    static final int MAX_LENGTH = 30;

    private NoteLabels() {
    }

    /**
     * Trimmed, inner whitespace collapsed, empties dropped, duplicates (ignoring
     * case) dropped keeping the first spelling. Throws a 400 past the limits.
     */
    static List<String> normalize(List<String> raw) {
        Map<String, String> seen = new LinkedHashMap<>();
        if (raw != null) {
            for (String entry : raw) {
                if (entry == null) {
                    continue;
                }
                for (String part : entry.split(",")) {
                    String label = part.trim().replaceAll("\\s+", " ");
                    if (label.isEmpty()) {
                        continue;
                    }
                    if (label.length() > MAX_LENGTH) {
                        throw ApiException.badRequest(
                                "A label can be at most " + MAX_LENGTH + " characters.");
                    }
                    seen.putIfAbsent(label.toLowerCase(Locale.ROOT), label);
                }
            }
        }
        if (seen.size() > MAX_COUNT) {
            throw ApiException.badRequest("A note can have at most " + MAX_COUNT + " labels.");
        }
        return new ArrayList<>(seen.values());
    }

    /** The column value: null for none, so "no labels" has one spelling. */
    static String join(List<String> labels) {
        return labels == null || labels.isEmpty() ? null : String.join(",", labels);
    }

    static List<String> split(String column) {
        List<String> out = new ArrayList<>();
        if (column == null) {
            return out;
        }
        for (String part : column.split(",")) {
            if (!part.isBlank()) {
                out.add(part.trim());
            }
        }
        return out;
    }
}
