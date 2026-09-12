package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * The body cap has to hold on both shapes an oversized request can take: a
 * declared Content-Length, and a chunked body that declares nothing at all.
 */
class RequestSizeLimitFilterTest {

    private final RequestSizeLimitFilter filter = new RequestSizeLimitFilter();

    private static HttpServletRequest request(String method, String uri, long contentLength) {
        HttpServletRequest r = mock(HttpServletRequest.class);
        when(r.getRequestURI()).thenReturn(uri);
        when(r.getMethod()).thenReturn(method);
        when(r.getContentLengthLong()).thenReturn(contentLength);
        return r;
    }

    @Test
    void refusesABodyOverTheCap() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        filter.doFilterInternal(
                request("POST", "/api/food/photo-estimate", RequestSizeLimitFilter.MAX_BODY_BYTES + 1),
                res, chain);
        assertThat(res.getStatus()).isEqualTo(413);
        verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any());
    }

    /* The hole a Content-Length check alone leaves: declare no length and the
       comparison above can never fire. */
    @Test
    void refusesAWriteThatDeclaresNoLength() throws Exception {
        for (String method : new String[] { "POST", "PUT", "PATCH" }) {
            MockHttpServletResponse res = new MockHttpServletResponse();
            FilterChain chain = mock(FilterChain.class);
            filter.doFilterInternal(request(method, "/api/money", -1), res, chain);
            assertThat(res.getStatus()).as("%s with no Content-Length", method).isEqualTo(411);
            verify(chain, never()).doFilter(org.mockito.ArgumentMatchers.any(),
                    org.mockito.ArgumentMatchers.any());
        }
    }

    @Test
    void letsAnOrdinaryRequestThrough() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        filter.doFilterInternal(request("POST", "/api/tasks", 320), res, chain);
        verify(chain).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        assertThat(res.getStatus()).isEqualTo(200);
    }

    /* A GET has no body to bound, and neither does anything outside /api. */
    @Test
    void ignoresBodylessAndNonApiRequests() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = mock(FilterChain.class);
        filter.doFilterInternal(request("GET", "/api/tasks", -1), res, chain);
        verify(chain).doFilter(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());

        assertThat(filter.shouldNotFilter(request("POST", "/ws/info", -1))).isTrue();
        assertThat(filter.shouldNotFilter(request("POST", "/api/tasks", 10))).isFalse();
    }

    @Test
    void writesAJsonBodyOnRefusal() throws Exception {
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilterInternal(request("POST", "/api/money", 99_000_000L), res, mock(FilterChain.class));
        assertThat(res.getContentAsString()).contains("\"status\":413").contains("too large");
    }
}
