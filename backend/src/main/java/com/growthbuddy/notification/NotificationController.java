package com.growthbuddy.notification;

import com.growthbuddy.common.CurrentUser;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService service;

    public NotificationController(NotificationService service) {
        this.service = service;
    }

    @GetMapping
    public List<NotificationService.NotificationDto> list() {
        return service.list(CurrentUser.id());
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
