package com.growthbuddy.quickadd;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.money.MoneyService;
import com.growthbuddy.user.UserClock;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.springframework.http.HttpStatus;
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

    /**
     * Requests, not AI calls: quick add sits outside AiRateLimitInterceptor so a
     * spent AI budget degrades to the plain patterns instead of a 429 (OpenAIClient
     * still caps the model calls). This only stops a script hammering the parser.
     */
    private static final int  REQUEST_LIMIT = 300;
    private static final long REQUEST_WINDOW_MS = 60 * 60_000L;

    private final QuickAddService service;
    private final UserClock clock;
    private final MoneyService money;
    private final RateLimiter limiter;

    public QuickAddController(QuickAddService service, UserClock clock, MoneyService money, RateLimiter limiter) {
        this.service = service;
        this.clock = clock;
        this.money = money;
        this.limiter = limiter;
    }

    /**
     * {@code today} is the device's own date, which is what "tomorrow" means to the
     * person speaking; the stored timezone is the fallback (it can be stale on a
     * trip). Only within a day of the server's idea of today, so a bad clock can't
     * file a reminder a year out.
     */
    @PostMapping
    public QuickAddService.QuickAddResult parse(@Valid @RequestBody QuickAddRequest req) {
        if (!limiter.allow("quickadd:u:" + CurrentUser.id(), REQUEST_LIMIT, REQUEST_WINDOW_MS)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS,
                    "That's a lot of quick adds in an hour. Give it a few minutes and try again.");
        }
        LocalDate stored = clock.today(CurrentUser.id());
        boolean deviceDay = req.today() != null && !req.today().isBefore(stored.minusDays(1))
                && !req.today().isAfter(stored.plusDays(1));
        LocalDate today = deviceDay ? req.today() : stored;
        // "in 20 minutes" counts from the device's clock when its day was taken, else the stored zone's.
        LocalTime now = deviceDay && req.now() != null ? req.now() : LocalTime.now(clock.zoneOf(CurrentUser.id()));
        return service.parse(req.text(), req.habits(), today, now, money.currencyOf(CurrentUser.id()));
    }

    record QuickAddRequest(
            @NotBlank @Size(max = 400) String text,
            @Size(max = 100) List<String> habits,
            LocalDate today,
            LocalTime now) {
    }
}
