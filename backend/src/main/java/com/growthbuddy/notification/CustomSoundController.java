package com.growthbuddy.notification;

import com.growthbuddy.common.CurrentUser;
import java.time.Instant;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The account's own notification sound. One per user, so there is no id in any
 * of these paths — the caller is the key.
 *
 * <p>GET answers 204 when the account has none, which is the common case and
 * not an error: the client asks once per login and a 404 would put a red line
 * in everyone's console for the ordinary state of having never picked a sound.
 */
@RestController
@RequestMapping("/api/notifications/custom-sound")
public class CustomSoundController {

    private final CustomSoundService service;

    public CustomSoundController(CustomSoundService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<CustomSoundService.StoredSound> get() {
        return service.get(CurrentUser.id())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** PUT, not POST: saving twice leaves the account in the same place. */
    @PutMapping
    public Map<String, Instant> put(@RequestBody SaveRequest req) {
        return Map.of("updatedAt", service.put(CurrentUser.id(), req.dataUrl()));
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete() {
        service.delete(CurrentUser.id());
    }

    public record SaveRequest(String dataUrl) {
    }
}
