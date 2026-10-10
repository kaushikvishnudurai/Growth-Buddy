package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * An offline replay whose first answer was lost must be answered, not run again
 * — that was a second task, a second glass of water. Drives the filter and the
 * interceptor together, the way a request meets them, over an in-memory store.
 */
class IdempotencyTest {

    /** The table's rules, in a map: PK (user, key), status null = in progress. */
    static final class FakeStore implements IdempotencyStore {
        record Row(String method, String path, Integer status, String contentType, String body) {
        }

        final Map<String, Row> rows = new HashMap<>();

        private static String id(UUID u, String k) {
            return u + "|" + k;
        }

        @Override
        public Outcome reserve(UUID userId, String key, String method, String path, long staleMs) {
            Row r = rows.get(id(userId, key));
            if (r == null) {
                rows.put(id(userId, key), new Row(method, path, null, null, null));
                return Outcome.RESERVED;
            }
            if (!r.method().equals(method) || !r.path().equals(path)) return Outcome.MISMATCH;
            if (r.status() == null) return Outcome.IN_PROGRESS;
            return Outcome.replay(r.status(), r.contentType(), r.body());
        }

        @Override
        public void complete(UUID userId, String key, int status, String contentType, String body) {
            Row r = rows.get(id(userId, key));
            rows.put(id(userId, key), new Row(r.method(), r.path(), status, contentType, body));
        }

        @Override
        public void release(UUID userId, String key) {
            Row r = rows.get(id(userId, key));
            if (r != null && r.status() == null) rows.remove(id(userId, key));
        }
    }

    interface Handler {
        void handle(HttpServletResponse res) throws Exception;
    }

    private final FakeStore store = new FakeStore();
    private final IdempotencyFilter filter = new IdempotencyFilter(store);
    private final IdempotencyInterceptor interceptor = new IdempotencyInterceptor(store);
    private final UUID alice = UUID.randomUUID();
    private final UUID bob = UUID.randomUUID();
    private final AtomicInteger runs = new AtomicInteger();

    @AfterEach
    void clearUser() {
        CurrentUser.clear();
    }

    private Handler created(String json) {
        return res -> {
            runs.incrementAndGet();
            res.setStatus(201);
            res.setContentType("application/json");
            res.getOutputStream().write(json.getBytes(StandardCharsets.UTF_8));
        };
    }

    private MockHttpServletResponse send(UUID user, String method, String path, String key, Handler handler)
            throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        if (key != null) req.addHeader(IdempotencyFilter.HEADER, key);
        MockHttpServletResponse res = new MockHttpServletResponse();
        // What DispatcherServlet does between the filter and the handler:
        // CurrentUserInterceptor sets the user, then this interceptor runs.
        FilterChain chain = (rq, rs) -> {
            CurrentUser.set(user);
            try {
                if (interceptor.preHandle((HttpServletRequest) rq, (HttpServletResponse) rs, null)) {
                    handler.handle((HttpServletResponse) rs);
                }
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new RuntimeException(e);
            } finally {
                CurrentUser.clear();
            }
        };
        filter.doFilter(req, res, chain);
        return res;
    }

    @Test
    void aRepeatedKeyReplaysTheFirstAnswerWithoutRunningAgain() throws Exception {
        MockHttpServletResponse first = send(alice, "POST", "/api/tasks", "k-1", created("{\"id\":\"t1\"}"));
        MockHttpServletResponse again = send(alice, "POST", "/api/tasks", "k-1", created("{\"id\":\"t2\"}"));

        assertThat(runs.get()).isEqualTo(1);
        assertThat(first.getStatus()).isEqualTo(201);
        assertThat(first.getContentAsString()).isEqualTo("{\"id\":\"t1\"}");
        assertThat(first.getHeader(IdempotencyFilter.REPLAY_HEADER)).isNull();
        assertThat(again.getStatus()).isEqualTo(201);
        assertThat(again.getContentAsString()).isEqualTo("{\"id\":\"t1\"}");
        assertThat(again.getHeader(IdempotencyFilter.REPLAY_HEADER)).isEqualTo("true");
        assertThat(again.getContentType()).startsWith("application/json");
    }

    @Test
    void aRefusalIsReplayedTooButARateLimitIsNot() throws Exception {
        Handler refuse = res -> {
            runs.incrementAndGet();
            res.setStatus(400);
        };
        send(alice, "POST", "/api/tasks", "k-400", refuse);
        assertThat(send(alice, "POST", "/api/tasks", "k-400", refuse).getStatus()).isEqualTo(400);
        assertThat(runs.get()).isEqualTo(1);

        Handler limited = res -> {
            runs.incrementAndGet();
            res.setStatus(429);
        };
        send(alice, "POST", "/api/quick-add", "k-429", limited);
        send(alice, "POST", "/api/quick-add", "k-429", limited);
        assertThat(runs.get()).isEqualTo(3); // "later" is not the final word
    }

    @Test
    void aKeyStillRunningIs409() throws Exception {
        MockHttpServletResponse[] inner = new MockHttpServletResponse[1];
        // The retry arrives while the first request is still inside its handler.
        Handler slow = res -> {
            inner[0] = send(alice, "POST", "/api/tasks", "k-slow", created("{}"));
            created("{\"id\":\"t1\"}").handle(res);
        };
        MockHttpServletResponse first = send(alice, "POST", "/api/tasks", "k-slow", slow);

        assertThat(inner[0].getStatus()).isEqualTo(409);
        assertThat(inner[0].getContentAsString()).contains("idempotency_in_progress");
        assertThat(first.getStatus()).isEqualTo(201);
        assertThat(runs.get()).isEqualTo(1);
    }

    @Test
    void theSameKeyOnAnotherRequestIs422() throws Exception {
        send(alice, "POST", "/api/tasks", "k-x", created("{}"));
        MockHttpServletResponse otherPath = send(alice, "POST", "/api/notes", "k-x", created("{}"));
        MockHttpServletResponse otherMethod = send(alice, "DELETE", "/api/tasks", "k-x", created("{}"));

        assertThat(otherPath.getStatus()).isEqualTo(422);
        assertThat(otherMethod.getStatus()).isEqualTo(422);
        assertThat(otherPath.getContentAsString()).contains("idempotency_key_reused");
        assertThat(runs.get()).isEqualTo(1);
    }

    @Test
    void aServerErrorReleasesTheKeySoTheRetryRuns() throws Exception {
        Handler broken = res -> {
            runs.incrementAndGet();
            res.setStatus(503);
        };
        send(alice, "POST", "/api/water/entries", "k-5xx", broken);
        assertThat(store.rows).isEmpty();
        MockHttpServletResponse retry = send(alice, "POST", "/api/water/entries", "k-5xx", created("{}"));
        assertThat(retry.getStatus()).isEqualTo(201);
        assertThat(retry.getHeader(IdempotencyFilter.REPLAY_HEADER)).isNull();
        assertThat(runs.get()).isEqualTo(2);
    }

    @Test
    void aThrowingHandlerReleasesTheKeyToo() throws Exception {
        Handler boom = res -> {
            throw new IllegalStateException("db down");
        };
        assertThatThrownBy(() -> send(alice, "POST", "/api/tasks", "k-throw", boom))
                .isInstanceOf(IllegalStateException.class);
        assertThat(store.rows).isEmpty();
    }

    @Test
    void keysArePerUser() throws Exception {
        send(alice, "POST", "/api/tasks", "same", created("{\"id\":\"alice\"}"));
        MockHttpServletResponse b = send(bob, "POST", "/api/tasks", "same", created("{\"id\":\"bob\"}"));

        assertThat(runs.get()).isEqualTo(2);
        assertThat(b.getHeader(IdempotencyFilter.REPLAY_HEADER)).isNull();
        assertThat(b.getContentAsString()).isEqualTo("{\"id\":\"bob\"}");
    }

    @Test
    void noKeyAReadOrAnAuthRouteIsLeftAlone() throws Exception {
        send(alice, "POST", "/api/tasks", null, created("{}"));
        send(alice, "POST", "/api/tasks", null, created("{}"));
        send(alice, "GET", "/api/tasks", "k-get", created("{}"));
        send(alice, "GET", "/api/tasks", "k-get", created("{}"));
        send(alice, "POST", "/api/auth/2fa/setup", "k-auth", created("{}"));
        send(alice, "POST", "/api/auth/2fa/setup", "k-auth", created("{}"));
        send(alice, "POST", "/api/mentor/chat/messages/stream", "k-sse", created("{}"));
        send(alice, "POST", "/api/mentor/chat/messages/stream", "k-sse", created("{}"));
        assertThat(runs.get()).isEqualTo(8);
        assertThat(store.rows).isEmpty();
    }

    @Test
    void aMalformedKeyIs400() throws Exception {
        assertThat(send(alice, "POST", "/api/tasks", "has spaces", created("{}")).getStatus()).isEqualTo(400);
        assertThat(send(alice, "POST", "/api/tasks", "x".repeat(65), created("{}")).getStatus()).isEqualTo(400);
        assertThat(runs.get()).isZero();
    }
}
