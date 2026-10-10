package com.growthbuddy.note;

import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Create body. Everything is optional: the composer saves the moment you stop
 * typing, and an untitled scrap is the most common note there is.
 */
record CreateNoteRequest(
        @Size(max = 200) String title,
        String body,
        @Size(max = 16) String color,
        Boolean pinned,
        @Size(max = NoteService.MAX_COVER) String cover,
        List<String> labels) {
}

/**
 * A draft, written whole on every autosave. {@code labels} is kept only by an
 * edit draft ({@code {id}/draft}); the composer's ignores it (a new note takes
 * the active label filter at save instead).
 */
record NoteDraftRequest(
        @Size(max = 200) String title,
        String body,
        @Size(max = 16) String color,
        List<String> labels) {
}

/** {@code labels}: an edit draft's chips ([] = all removed); null = none stored, leave the note's. */
record NoteDraftResponse(String title, String body, String color, Instant updatedAt, List<String> labels) {
    static NoteDraftResponse from(NoteDraft d) {
        return new NoteDraftResponse(d.getTitle(), d.getBody(), d.getColor(), d.getUpdatedAt(), null);
    }

    static NoteDraftResponse from(NoteEditDraft d) {
        return new NoteDraftResponse(d.getTitle(), d.getBody(), d.getColor(), d.getUpdatedAt(),
                d.getLabels() == null ? null : NoteLabels.split(d.getLabels()));
    }
}

/**
 * Update body. Null fields are left unchanged; "" clears colour and cover, an
 * empty list clears the labels. {@code archived} true/false archives or brings
 * the note back. {@code baseUpdatedAt} is the version the client edited: a newer
 * one on the server is a 409, not a silent overwrite. Null skips the check.
 */
record UpdateNoteRequest(
        @Size(max = 200) String title,
        String body,
        @Size(max = 16) String color,
        Boolean pinned,
        @Size(max = NoteService.MAX_COVER) String cover,
        Instant baseUpdatedAt,
        List<String> labels,
        Boolean archived) {
}

/** How many notes sit outside the main list, for the view switcher's counts. */
record NoteCountsResponse(long archived, long trash) {
}

/**
 * One note. {@code bodyTrimmed} marks a list item whose photos were cut out of
 * the body: the client must fetch the note by id before editing it, or saving
 * would write the photo-less copy back.
 */
record NoteResponse(
        UUID id,
        String title,
        String body,
        String color,
        boolean pinned,
        Instant createdAt,
        Instant updatedAt,
        String cover,
        int photoCount,
        boolean bodyTrimmed,
        List<String> labels,
        Instant archivedAt,
        Instant deletedAt) {

    /* The body is sanitize()'s output, so a photo is always a plain <img ...>
       whose src is base64 — no '>' inside it for this to trip on. */
    private static final Pattern IMG = Pattern.compile("<img\\b[^>]*>", Pattern.CASE_INSENSITIVE);

    static NoteResponse from(Note n) {
        return of(n, n.getBody(), false);
    }

    /** For the list: the body without its photos, which the cover stands in for. */
    static NoteResponse listItem(Note n) {
        String body = n.getBody();
        if (body == null || photos(body) == 0) {
            return from(n);
        }
        return of(n, IMG.matcher(body).replaceAll(m -> altOnly(m.group())), true);
    }

    private static final Pattern ALT = Pattern.compile("\\balt=\"([^\"]*)\"");

    /** A photo's alt text stays, without its bytes, so the list can be searched by it. */
    private static String altOnly(String img) {
        Matcher a = ALT.matcher(img);
        if (!a.find() || a.group(1).isBlank()) {
            return "";
        }
        return Matcher.quoteReplacement("<img alt=\"" + a.group(1) + "\">");
    }

    private static NoteResponse of(Note n, String body, boolean trimmed) {
        return new NoteResponse(n.getId(), n.getTitle(), body, n.getColor(), n.isPinned(),
                n.getCreatedAt(), n.getUpdatedAt(), n.getCover(), photos(n.getBody()), trimmed,
                NoteLabels.split(n.getLabels()), n.getArchivedAt(), n.getDeletedAt());
    }

    private static int photos(String body) {
        if (body == null) {
            return 0;
        }
        int count = 0;
        Matcher m = IMG.matcher(body);
        while (m.find()) {
            count++;
        }
        return count;
    }
}
