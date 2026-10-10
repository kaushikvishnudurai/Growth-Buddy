package com.growthbuddy.quickadd;

import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.user.UserClock;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Natural-language quick-add. The client sends the raw text plus the user's
 * habit names (so the parser can match them), and gets back structured intents
 * to apply locally. Stateless — no persistence here.
 */
@RestController
@RequestMapping("/api/quick-add")
public class QuickAddController {

    private final QuickAddService service;
    private final UserClock clock;

    public QuickAddController(QuickAddService service, UserClock clock) {
        this.service = service;
        this.clock = clock;
    }

    /**
     * {@code today} is the device's own date, which is what "tomorrow" means to the
     * person speaking; the stored timezone is the fallback (it can be stale on a
     * trip). Only within a day of the server's idea of today, so a bad clock can't
     * file a reminder a year out.
     */
    @PostMapping
    public QuickAddService.QuickAddResult parse(@Valid @RequestBody QuickAddRequest req) {
        LocalDate stored = clock.today(CurrentUser.id());
        LocalDate today = req.today() != null && !req.today().isBefore(stored.minusDays(1))
                && !req.today().isAfter(stored.plusDays(1)) ? req.today() : stored;
        return service.parse(req.text(), req.habits(), today);
    }

    record QuickAddRequest(
            @NotBlank @Size(max = 400) String text,
            @Size(max = 100) List<String> habits,
            LocalDate today) {
    }
}
