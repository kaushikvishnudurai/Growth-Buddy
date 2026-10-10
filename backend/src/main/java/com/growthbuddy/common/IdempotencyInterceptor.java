package com.growthbuddy.common;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Reserves an {@code Idempotency-Key}, or answers for it. See
 * {@link IdempotencyFilter} for which requests qualify and how the answer is
 * captured; this half runs after {@link CurrentUserInterceptor} (WebConfig
 * registers it second), because keys are per user — the same key from two
 * accounts is two unrelated requests.
 *
 * <ul>
 *   <li>first use → reserved, the handler runs;</li>
 *   <li>finished → the stored status + body again, with {@code Idempotent-Replay: true};</li>
 *   <li>still running → 409, {@code code: idempotency_in_progress} (the client retries later);</li>
 *   <li>first used for another method or path → 422, {@code code: idempotency_key_reused}.</li>
 * </ul>
 *
 * Registered before {@link AiRateLimitInterceptor}, so a replay is not charged
 * as a second AI call; a 429 from it releases the key (see {@code storable}).
 */
@Component
public class IdempotencyInterceptor implements HandlerInterceptor {

    /** Longer than any handler runs; past it an in-progress row is a dead instance's. */
    static final long STALE_MS = 5 * 60_000L;
    private static final int MAX_PATH = 255;

    private final IdempotencyStore store;

    public IdempotencyInterceptor(IdempotencyStore store) {
        this.store = store;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        // An async re-dispatch runs preHandle again on the same request; it would
        // find its own reservation "in progress". (Streams are skipped anyway.)
        if (request.getDispatcherType() != DispatcherType.REQUEST) return true;
        if (!(request.getAttribute(IdempotencyFilter.KEY_ATTR) instanceof String key)) return true;
        UUID userId;
        try {
            userId = CurrentUser.id();
        } catch (ApiException anonymous) {
            return true; // an ANONYMOUS_PATHS request: nobody to key it to
        }
        String method = request.getMethod().toUpperCase();
        String path = request.getRequestURI();
        if (path.length() > MAX_PATH) path = path.substring(0, MAX_PATH);

        IdempotencyStore.Outcome o = store.reserve(userId, key, method, path, STALE_MS);
        switch (o.kind()) {
            case RESERVED -> {
                request.setAttribute(IdempotencyFilter.RESERVED_ATTR,
                        new IdempotencyFilter.Reservation(userId, key));
                return true;
            }
            case REPLAY -> {
                response.setStatus(o.status());
                response.setHeader(IdempotencyFilter.REPLAY_HEADER, "true");
                if (o.contentType() != null) response.setContentType(o.contentType());
                if (o.body() != null && !o.body().isEmpty()) {
                    response.getOutputStream().write(o.body().getBytes(StandardCharsets.UTF_8));
                }
                return false;
            }
            case IN_PROGRESS -> {
                IdempotencyFilter.writeJson(response, 409,
                        "This change is still being saved. Try again in a moment.", "idempotency_in_progress");
                return false;
            }
            default -> {
                IdempotencyFilter.writeJson(response, 422,
                        "This Idempotency-Key was already used for a different request.", "idempotency_key_reused");
                return false;
            }
        }
    }
}
