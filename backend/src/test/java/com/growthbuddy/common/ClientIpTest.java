package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;

/**
 * SEC-01 / SEC-04 / SEC-13 / SEC-20: who a request is from, and which bucket it
 * is counted in. The client controls the left end of X-Forwarded-For; our proxy
 * appends on the right.
 */
class ClientIpTest {

    private static MockHttpServletRequest req(String xff) {
        MockHttpServletRequest r = new MockHttpServletRequest("POST", "/api/auth/login");
        r.setRemoteAddr("10.0.0.2"); // the proxy
        if (xff != null) r.addHeader("X-Forwarded-For", xff);
        return r;
    }

    @Test
    void untrustedIgnoresTheHeader() {
        assertThat(new ClientIp(false, 1).resolve(req("1.1.1.1"))).isEqualTo("10.0.0.2");
    }

    @Test
    void oneHopTakesTheRightmostNotTheSpoofedLeft() {
        ClientIp ip = new ClientIp(true, 1);
        assertThat(ip.resolve(req("6.6.6.6, 203.0.113.9"))).isEqualTo("203.0.113.9");
        assertThat(ip.resolve(req("203.0.113.9"))).isEqualTo("203.0.113.9");
        assertThat(ip.resolve(req(null))).as("no header: the peer").isEqualTo("10.0.0.2");
    }

    @Test
    void twoHopsSkipTheCdnEntry() {
        ClientIp ip = new ClientIp(true, 2);
        assertThat(ip.resolve(req("6.6.6.6, 203.0.113.9, 172.16.0.1"))).isEqualTo("203.0.113.9");
        assertThat(ip.resolve(req("203.0.113.9"))).as("shorter than the hop count").isEqualTo("203.0.113.9");
    }

    /** A proxy that adds its own header line: the client's spoofed first line is not the answer. */
    @Test
    void everyHeaderLineCounts() {
        MockHttpServletRequest r = req("6.6.6.6");
        r.addHeader("X-Forwarded-For", "203.0.113.9");
        assertThat(new ClientIp(true, 1).resolve(r)).isEqualTo("203.0.113.9");
        assertThat(new ClientIp(true, 2).resolve(r)).isEqualTo("6.6.6.6");
    }

    @Test
    void forwardedProtoCountsOnlyWhenTrusted() {
        MockHttpServletRequest r = req(null);
        r.addHeader("X-Forwarded-Proto", "https");
        assertThat(new ClientIp(false, 1).isHttps(r)).isFalse();
        assertThat(new ClientIp(true, 1).isHttps(r)).isTrue();
    }

    @Test
    void theBucketIsTheMatchedRouteNotTheRawUri() throws Exception {
        FakeThrottleStore store = new FakeThrottleStore();
        RateLimitInterceptor limit = new RateLimitInterceptor(new RateLimiter(store), new ClientIp(false, 1));
        AtomicInteger refused = new AtomicInteger();
        for (int i = 0; i < 11; i++) {
            MockHttpServletRequest r = new MockHttpServletRequest("GET", "/api/auth/export;x=" + i);
            r.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/api/auth/export");
            MockHttpServletResponse res = new MockHttpServletResponse();
            if (!limit.preHandle(r, res, null)) refused.incrementAndGet();
        }
        assertThat(refused.get()).as("the 11th spelling shares the bucket").isEqualTo(1);
    }

    @Test
    void ticketLinksGetTheLooserLimit() throws Exception {
        RateLimitInterceptor limit = new RateLimitInterceptor(new RateLimiter(new FakeThrottleStore()), new ClientIp(false, 1));
        int allowed = 0;
        for (int i = 0; i < 70; i++) {
            MockHttpServletRequest r = new MockHttpServletRequest("POST", "/api/reminders/done-link");
            r.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/api/reminders/done-link");
            if (limit.preHandle(r, new MockHttpServletResponse(), null)) allowed++;
        }
        assertThat(allowed).isEqualTo(60);
    }
}
