package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** SEC-3: the Report-Only CSP named no collector, so nobody could ever watch it. */
class CspReportTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void thePolicyNamesTheCollectorAndStaysReportOnly() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/");
        MockHttpServletResponse res = new MockHttpServletResponse();
        new SecurityHeadersFilter(false, false).doFilter(req, res, new MockFilterChain());
        assertThat(res.getHeader("Content-Security-Policy")).isNull();
        assertThat(res.getHeader("Content-Security-Policy-Report-Only"))
                .contains("report-uri /api/csp-report").contains("report-to csp");
        assertThat(res.getHeader("Reporting-Endpoints")).isEqualTo("csp=\"/api/csp-report\"");
    }

    @Test
    void bothReportShapesBecomeOneClippedLineEach() throws Exception {
        var legacy = CspReportController.summarize(json.readTree("""
                {"csp-report":{"document-uri":"https://x/","violated-directive":"script-src",
                 "blocked-uri":"https://evil.example/a.js\\nforged","line-number":3}}"""));
        assertThat(legacy).singleElement().asString()
                .contains("directive=script-src").contains("evil.example").doesNotContain("\n");

        var batch = CspReportController.summarize(json.readTree("""
                [{"type":"csp-violation","body":{"effectiveDirective":"img-src","blockedURL":"data"}},
                 {"type":"csp-violation","body":"not an object"}]"""));
        assertThat(batch).singleElement().asString().contains("directive=img-src");
    }
}
