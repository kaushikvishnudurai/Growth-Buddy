package com.growthbuddy.notification;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService service;

    public NotificationController(NotificationService service) {
        this.service = service;
    }

    /**
     * No parameters: every row, as shipped clients expect. With {@code limit}
     * (or {@code before} / {@code category}): one page, newest first, at or
     * before {@code before} (ISO instant) — the bell's "Load older".
     * {@code category} is a {@link NotifyCategory}; anything else means all.
     */
    @GetMapping
    public List<NotificationService.NotificationDto> list(
            @RequestParam(required = false) String before,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) String category) {
        if (before == null && limit == null && category == null) {
            return service.list(CurrentUser.id());
        }
        Instant at = null;
        if (before != null && !before.isBlank()) {
            try {
                at = Instant.parse(before.trim());
            } catch (DateTimeParseException e) {
                throw ApiException.badRequest("before must be an ISO-8601 instant");
            }
        }
        return service.page(CurrentUser.id(), at, limit == null ? 30 : limit, NotifyCategory.parse(category));
    }

    /** Stamp every unread card of the caller's read; nothing is deleted. */
    @PostMapping("/mark-all-read")
    public Map<String, Integer> markAllRead() {
        return Map.of("updated", service.markAllRead(CurrentUser.id()));
    }

    /** Delete the caller's read cards; unread ones stay. */
    @DeleteMapping("/read")
    public Map<String, Integer> clearRead() {
        return Map.of("deleted", service.clearRead(CurrentUser.id()));
    }

    @GetMapping("/unread-count")
    public Map<String, Long> unread() {
        return Map.of("count", service.unreadCount(CurrentUser.id()));
    }

    @PatchMapping("/{id}/read")
    public NotificationService.NotificationDto read(@PathVariable UUID id) {
        return service.markRead(CurrentUser.id(), id);
    }

    /**
     * Clear the list. Still PATCH /read-all because that is what shipped
     * clients call; a phone running last week's bundle must not start leaving
     * notifications behind because the server renamed a route.
     */
    @PatchMapping("/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void readAll() {
        service.clearAll(CurrentUser.id());
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }
}
