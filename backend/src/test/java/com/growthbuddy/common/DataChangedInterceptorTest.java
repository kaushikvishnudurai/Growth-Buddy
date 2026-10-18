package com.growthbuddy.common;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class DataChangedInterceptorTest {

    private final SimpMessagingTemplate broker = mock(SimpMessagingTemplate.class);
    private final DataChangedInterceptor it = new DataChangedInterceptor(broker, 50);
    private final UUID user = UUID.randomUUID();
    private static final String Q = "/queue/notifications";

    @AfterEach
    void clear() {
        CurrentUser.clear();
        RequestContextHolder.resetRequestAttributes();
    }

    private void run(String method, String path, int status, String origin, boolean signedIn) {
        if (signedIn) CurrentUser.set(user);
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        if (origin != null) req.addHeader("X-GB-Client", origin);
        MockHttpServletResponse res = new MockHttpServletResponse();
        it.preHandle(req, res, null);
        CurrentUser.clear(); // afterCompletion must not depend on it
        res.setStatus(status);
        it.afterCompletion(req, res, null, null);
    }

    private static Map<String, Object> frame(String origin) {
        return origin == null
                ? Map.of("kind", "data_changed", "transient", true)
                : Map.of("kind", "data_changed", "transient", true, "origin", origin);
    }

    @Test
    void aSavedWriteTellsTheUsersOtherDevicesWithItsOrigin() {
        run("POST", "/api/tasks", 201, "abc-123", true);
        verify(broker, timeout(1000)).convertAndSendToUser(user.toString(), Q, frame("abc-123"));
    }

    @Test
    void aBurstIsOneFrame() {
        for (int i = 0; i < 20; i++) run("PATCH", "/api/tasks/" + i, 200, "abc", true);
        verify(broker, after(300).times(1)).convertAndSendToUser(anyString(), eq(Q), any(Object.class));
    }

    @Test
    void writesFromTwoDevicesInOneWindowReachBoth() {
        run("POST", "/api/tasks", 201, "laptop", true);
        run("POST", "/api/water/entries", 201, "phone", true);
        verify(broker, timeout(1000)).convertAndSendToUser(user.toString(), Q, frame(null));
    }

    @Test
    void aJunkOriginIsDroppedNotEchoed() {
        run("DELETE", "/api/water/entries/1", 200, "<script>", true);
        verify(broker, timeout(1000)).convertAndSendToUser(user.toString(), Q, frame(null));
    }

    @Test
    void aTicketedLinkNamesItsUser() {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", "/api/habits/done-link");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
        MockHttpServletResponse res = new MockHttpServletResponse();
        it.preHandle(req, res, null); // anonymous
        DataChangedInterceptor.forUser(user); // what the handler does
        res.setStatus(204);
        it.afterCompletion(req, res, null, null);
        verify(broker, timeout(1000)).convertAndSendToUser(user.toString(), Q, frame(null));
    }

    @Test
    void readsRefusalsAnonymousAutosavesAndChatSendNothing() {
        run("GET", "/api/tasks", 200, null, true);
        run("POST", "/api/tasks", 400, null, true);
        run("POST", "/api/auth/signup", 200, null, false);
        run("POST", "/api/mentor/chat/messages", 200, null, true);
        run("PATCH", "/api/notifications/x/read", 200, null, true);
        // the app's own writes: announcing them made two devices reload each other forever
        run("POST", "/api/health/sync", 200, null, true);
        run("PUT", "/api/notes/draft", 200, null, true);
        run("PUT", "/api/notes/5/draft", 200, null, true);
        run("POST", "/api/wellness/snapshot", 200, null, true);
        run("POST", "/api/score/today/snapshot", 200, null, true);
        run("PUT", "/api/auth/ui-prefs", 200, null, true);
        verify(broker, after(300).never()).convertAndSendToUser(anyString(), eq(Q), any(Object.class));
    }
}
