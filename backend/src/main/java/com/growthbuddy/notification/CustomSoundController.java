package com.growthbuddy.notification;

import com.growthbuddy.common.CurrentUser;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The account's own notification sounds, up to {@link CustomSoundService#MAX_PER_USER}.
 *
 * <p>{@code /custom-sounds} is the library: the list carries no bytes, and a
 * device fetches {@code /{id}} only for a sound it doesn't hold yet. The id is
 * the client's, so PUT is an upsert and a retry is harmless. PATCH renames.
 *
 * <p>{@code /custom-sound} is the one-sound API from before, kept because builds
 * cached on phones still call it at every login. It means the oldest sound.
 * GET answers 204 when the account has none, which is the common case and
 * not an error: a 404 would put a red line in everyone's console for the
 * ordinary state of having never picked a sound.
 */
@RestController
@RequestMapping("/api/notifications")
public class CustomSoundController {

    private final CustomSoundService service;

    public CustomSoundController(CustomSoundService service) {
        this.service = service;
    }

    @GetMapping("/custom-sounds")
    public List<CustomSoundService.SoundInfo> list() {
        return service.list(CurrentUser.id());
    }

    @GetMapping("/custom-sounds/{id}")
    public CustomSoundService.StoredSound getOne(@PathVariable UUID id) {
        return service.get(CurrentUser.id(), id);
    }

    @PutMapping("/custom-sounds/{id}")
    public Map<String, Instant> putOne(@PathVariable UUID id, @RequestBody SaveRequest req) {
        return Map.of("updatedAt", service.put(CurrentUser.id(), id, req.name(), req.source(), req.dataUrl()));
    }

    /** Rename only — no bytes in the body, and the sound's updatedAt is left alone. */
    @PatchMapping("/custom-sounds/{id}")
    public CustomSoundService.SoundInfo rename(@PathVariable UUID id, @RequestBody RenameRequest req) {
        return service.rename(CurrentUser.id(), id, req.name());
    }

    @DeleteMapping("/custom-sounds/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOne(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }

    @GetMapping("/custom-sound")
    public ResponseEntity<CustomSoundService.StoredSound> get() {
        return service.getFirst(CurrentUser.id())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    @PutMapping("/custom-sound")
    public Map<String, Instant> put(@RequestBody SaveRequest req) {
        return Map.of("updatedAt", service.putFirst(CurrentUser.id(), req.dataUrl()));
    }

    @DeleteMapping("/custom-sound")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete() {
        service.deleteFirst(CurrentUser.id());
    }

    public record SaveRequest(String name, String source, String dataUrl) {
    }

    public record RenameRequest(String name) {
    }
}
