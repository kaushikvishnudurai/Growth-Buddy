package com.growthbuddy.gcal;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.time.YearMonth;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/google/calendar")
public class GoogleCalendarController {

    private final GoogleCalendarService service;

    public GoogleCalendarController(GoogleCalendarService service) {
        this.service = service;
    }

    @GetMapping("/status")
    public GoogleCalendarService.Status status() {
        return service.status(CurrentUser.id());
    }

    public record SaveConfigRequest(@NotBlank String clientId, @NotBlank String clientSecret) {}

    /** Current OAuth client setup (never includes the secret). Admin-only. */
    @GetMapping("/config")
    public GoogleCalendarService.Config config() {
        service.requireAdmin(CurrentUser.id());
        return service.config();
    }

    /** One-time app setup: save the Google OAuth client keys. Admin-only. */
    @PutMapping("/config")
    public GoogleCalendarService.Config saveConfig(@Valid @RequestBody SaveConfigRequest req) {
        service.requireAdmin(CurrentUser.id());
        return service.saveConfig(CurrentUser.id(), req.clientId(), req.clientSecret());
    }

    /** Returns the Google consent-page URL the frontend should open. */
    @PostMapping("/connect")
    public Map<String, String> connect() {
        return Map.of("url", service.connectUrl(CurrentUser.id()));
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disconnect() {
        service.disconnect(CurrentUser.id());
    }

    /** Read-only month view of the user's primary Google calendar. */
    @GetMapping("/events")
    public GoogleCalendarService.EventsResponse events(@RequestParam String month) {
        YearMonth ym;
        try {
            ym = YearMonth.parse(month);
        } catch (Exception ex) {
            throw com.growthbuddy.common.ApiException.badRequest("month must look like 2026-07");
        }
        return service.events(CurrentUser.id(), ym);
    }

    /**
     * Google redirects the user's browser here after consent. No bearer token
     * on this request — the user is identified by the short-lived state token
     * (path is in CurrentUserInterceptor.ANONYMOUS_PATHS).
     */
    @GetMapping(value = "/callback", produces = MediaType.TEXT_HTML_VALUE)
    public String callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        if (error != null || code == null) {
            return page("Connection cancelled", "You can close this tab.");
        }
        try {
            service.handleCallback(state, code);
            return page("Google Calendar connected 🎉",
                    "You can close this tab and return to Growth Buddy.");
        } catch (Exception ex) {
            return page("Connection failed", ex.getMessage());
        }
    }

    private static String page(String title, String message) {
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Growth Buddy</title></head>"
                + "<body style=\"font-family:system-ui;display:grid;place-items:center;height:90vh\">"
                + "<div style=\"text-align:center\"><h2>" + escape(title) + "</h2>"
                + "<p>" + escape(message) + "</p></div></body></html>";
    }

    private static String escape(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
