package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * SEC-3: the Report-Only CSP named no collector, so nobody could ever watch it.
 * main's CspReportController won the merge (report-uri only; the report-to batch
 * shape was ours and was dropped), so this pins what both sides agree on.
 */
class CspReportTest {

    @Test
    void thePolicyNamesTheCollectorAndStaysReportOnly() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/");
        MockHttpServletResponse res = new MockHttpServletResponse();
        new SecurityHeadersFilter(new ClientIp(false, 1), false, "").doFilter(req, res, new MockFilterChain());
        assertThat(res.getHeader("Content-Security-Policy")).isNull();
        assertThat(res.getHeader("Content-Security-Policy-Report-Only")).contains("report-uri /api/csp-report");
    }

    @Test
    void aForgedNewlineInAReportDoesNotThrow() {
        assertThatCode(() -> new CspReportController().report("""
                {"csp-report":{"document-uri":"https://x/","effective-directive":"script-src",
                 "blocked-uri":"https://evil.example/a.js\\nforged","line-number":3}}"""))
                .doesNotThrowAnyException();
    }
}
