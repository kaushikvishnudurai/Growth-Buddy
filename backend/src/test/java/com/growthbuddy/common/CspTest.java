package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** SEC-05: the policy reports somewhere, and no longer allows a socket to any host. */
class CspTest {

    private static String policy(boolean enforce, String extra) throws Exception {
        SecurityHeadersFilter f = new SecurityHeadersFilter(new ClientIp(false, 1), enforce, extra);
        MockHttpServletResponse res = new MockHttpServletResponse();
        f.doFilter(new MockHttpServletRequest("GET", "/"), res, new MockFilterChain());
        String h = res.getHeader(enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");
        assertThat(h).isNotNull();
        return h;
    }

    @Test
    void reportOnlyByDefaultWithAReportUri() throws Exception {
        String p = policy(false, "");
        assertThat(p).contains("report-uri /api/csp-report").contains("connect-src 'self';");
        assertThat(p).doesNotContain("ws:").doesNotContain("wss:");
    }

    @Test
    void aConfiguredApiOriginIsAdded() throws Exception {
        assertThat(policy(true, "https://api.example.com,wss://api.example.com"))
                .contains("connect-src 'self' https://api.example.com wss://api.example.com;");
    }

    @Test
    void theReportEndpointTakesWhatBrowsersSendAndIgnoresJunk() {
        CspReportController c = new CspReportController();
        assertThatCode(() -> {
            c.report("{\"csp-report\":{\"effective-directive\":\"connect-src\",\"blocked-uri\":\"wss://evil\\n[fake]\"}}");
            c.report("not json");
            c.report("{}");
            c.report(null);
            c.report("x".repeat(20_000));
        }).doesNotThrowAnyException();
    }
}
