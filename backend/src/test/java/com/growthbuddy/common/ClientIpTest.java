package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** CRB-9 / SEC-6: the left-most X-Forwarded-For entry is whatever the client typed. */
class ClientIpTest {

    private static MockHttpServletRequest req(String xff) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr("10.0.0.1");
        if (xff != null) r.addHeader("X-Forwarded-For", xff);
        return r;
    }

    @Test
    void behindAProxyTheRightMostEntryCounts() {
        assertThat(ClientIp.resolve(req("6.6.6.6, 203.0.113.7"), true)).isEqualTo("203.0.113.7");
        assertThat(ClientIp.resolve(req("203.0.113.7"), true)).isEqualTo("203.0.113.7");
    }

    @Test
    void withoutTrustTheHeaderIsIgnored() {
        assertThat(ClientIp.resolve(req("6.6.6.6"), false)).isEqualTo("10.0.0.1");
        assertThat(ClientIp.resolve(req("6.6.6.6, "), true)).isEqualTo("10.0.0.1");
        assertThat(ClientIp.resolve(req(null), true)).isEqualTo("10.0.0.1");
    }
}
