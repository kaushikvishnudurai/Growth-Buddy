package com.growthbuddy.common;

import java.util.regex.Pattern;

/**
 * User-chosen names and titles (HOS-9). @NotBlank only treats whitespace as
 * empty, so zero-width spaces made a blank circle card, and a bidi override in
 * a display name rendered it reversed and flipped the text after it.
 */
public final class VisibleText {

    /** Embeddings, overrides and isolates: U+202A-202E, U+2066-2069. */
    private static final Pattern BIDI = Pattern.compile("[‪-‮⁦-⁩]");

    private VisibleText() {
    }

    /** Bidi controls stripped, Unicode-trimmed; 400 when nothing visible is left. */
    public static String require(String raw, String label) {
        String s = raw == null ? "" : BIDI.matcher(raw).replaceAll("").strip();
        if (!hasVisible(s)) {
            throw ApiException.badRequest(label + " needs at least one visible character.");
        }
        return s;
    }

    /**
     * Something besides format (Cf), space and control characters. ponytail: the
     * fillers that are letters or symbols but draw nothing (Hangul filler, braille
     * blank) are listed by hand; add one here if another turns up.
     */
    static boolean hasVisible(String s) {
        return s.codePoints().anyMatch(cp -> {
            int t = Character.getType(cp);
            return t != Character.FORMAT && t != Character.SPACE_SEPARATOR && t != Character.CONTROL
                    && t != Character.LINE_SEPARATOR && t != Character.PARAGRAPH_SEPARATOR
                    && !Character.isWhitespace(cp)
                    && cp != 0x115F && cp != 0x1160 && cp != 0x3164 && cp != 0xFFA0 && cp != 0x2800;
        });
    }
}
