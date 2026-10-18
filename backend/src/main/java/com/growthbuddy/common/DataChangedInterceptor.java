package com.growthbuddy.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * "Your data changed on another device, reload." After a successful write, the
 * writer's open sessions get a transient {@code data_changed} frame on the
 * existing notifications queue (the same channel as {@code FamilyEvents}), so a
 * task added on the laptop shows on the phone while it is open. The client
 * reloads in place (app.js {@code syncFromElsewhere}).
 *
 * <p>{@code origin} echoes the writer's {@code X-GB-Client} id (one per page
 * load) so the device that made the change doesn't reload itself.
 *
 * <p>Folded per user: the first write arms a {@link #FOLD_MS} timer and later
 * ones ride on it, so an outbox flush of 200 ticks is one frame. When writes from
 * two devices land in one window the frame carries no origin and both reload.
 *
 * <p>{@code afterCompletion} runs after the handler returned, so its transaction
 * has committed and the reload can't read the old rows. The user is read in
 * preHandle; an anonymous ticketed write (a notification's Done / Snooze button)
 * names its user with {@link #forUser}. Best effort: a missed frame is caught up
 * by the next resume or pull to refresh.
 */
@Component
public class DataChangedInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(DataChangedInterceptor.class);
    static final String KIND = "data_changed";
    static final long FOLD_MS = 500;
    private static final String USER_ATTR = DataChangedInterceptor.class.getName() + ".user";
    private static final Pattern CLIENT_ID = Pattern.compile("[A-Za-z0-9-]{1,64}");
    /** Origin stand-in while writes from more than one device are folded together. */
    private static final String MIXED = "";

    private final SimpMessagingTemplate broker;
    private final long foldMs;
    /** User to the origin of the writes waiting on that user's timer. */
    private final Map<UUID, String> pending = new ConcurrentHashMap<>();
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "data-changed");
        t.setDaemon(true);
        return t;
    });

    @Autowired
    public DataChangedInterceptor(SimpMessagingTemplate broker) {
        this(broker, FOLD_MS);
    }

    DataChangedInterceptor(SimpMessagingTemplate broker, long foldMs) {
        this.broker = broker;
        this.foldMs = foldMs;
    }

    /** For a write with no session (a signed notification link): whose data it changed. */
    public static void forUser(UUID userId) {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (attrs != null && userId != null) {
            attrs.setAttribute(USER_ATTR, userId, RequestAttributes.SCOPE_REQUEST);
        }
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (isWrite(request)) {
            try {
                request.setAttribute(USER_ATTR, CurrentUser.id());
            } catch (ApiException anonymous) {
                // signup, webhooks, crash reports: nobody to tell (ticketed links call forUser)
            }
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        if (!(request.getAttribute(USER_ATTR) instanceof UUID user) || !isWrite(request)) return;
        int status = response.getStatus();
        if (ex != null || status < 200 || status >= 300) return;
        String header = request.getHeader("X-GB-Client");
        String origin = header != null && CLIENT_ID.matcher(header).matches() ? header : MIXED;
        boolean[] first = { false };
        pending.compute(user, (k, was) -> {
            if (was == null) {
                first[0] = true;
                return origin;
            }
            return was.equals(origin) ? was : MIXED;
        });
        if (first[0]) {
            timer.schedule(() -> send(user), foldMs, TimeUnit.MILLISECONDS);
        }
    }

    private void send(UUID user) {
        String origin = pending.remove(user);
        if (origin == null) return;
        Map<String, Object> frame = origin.isEmpty()
                ? Map.of("kind", KIND, "transient", true)
                : Map.of("kind", KIND, "transient", true, "origin", origin);
        try {
            broker.convertAndSendToUser(user.toString(), "/queue/notifications", frame);
        } catch (RuntimeException e) {
            log.debug("data_changed push to {} failed", user, e);
        }
    }

    /**
     * A write another device should reload for. Not Buddy chat (its own screen and
     * a streamed reply), the bell or push wiring (the bell has its own pushes), and
     * not the writes the app makes on its own: note-draft autosave, the wellness
     * and score snapshots, ui-prefs baselines, and the phone's health sync, which
     * runs on every reload. Announcing those made two open devices reload each
     * other forever (each reload wrote, each write reloaded the other).
     */
    static boolean isWrite(HttpServletRequest request) {
        String m = request.getMethod();
        if ("GET".equals(m) || "HEAD".equals(m) || "OPTIONS".equals(m)) return false;
        String path = request.getRequestURI();
        return !(path.startsWith("/api/mentor/")
                || path.startsWith("/api/notifications")
                || path.startsWith("/api/push/")
                || path.startsWith("/api/client-")
                || path.equals("/api/csp-report")
                || path.endsWith("/draft")
                || path.endsWith("/snapshot")
                || path.equals("/api/auth/ui-prefs")
                || path.equals("/api/health/sync"));
    }
}
