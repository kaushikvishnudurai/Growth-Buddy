package com.growthbuddy.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class ApiEtagFilterTest {

    private final ApiEtagFilter filter = new ApiEtagFilter();

    private MockHttpServletResponse run(String method, String path, String ifNoneMatch) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest(method, path);
        if (ifNoneMatch != null) req.addHeader("If-None-Match", ifNoneMatch);
        MockHttpServletResponse res = new MockHttpServletResponse();
        filter.doFilter(req, res, new MockFilterChain(new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void service(jakarta.servlet.http.HttpServletRequest q, jakarta.servlet.http.HttpServletResponse r)
                    throws java.io.IOException {
                r.setContentType("application/json");
                r.getWriter().write("{\"tasks\":[1,2,3]}");
            }
        }));
        return res;
    }

    @Test
    void unchangedGetIsA304() throws Exception {
        MockHttpServletResponse first = run("GET", "/api/tasks", null);
        String etag = first.getHeader("ETag");
        assertNotNull(etag);
        assertEquals("private, no-cache", first.getHeader("Cache-Control"));
        assertEquals("Authorization", first.getHeader("Vary"));

        MockHttpServletResponse again = run("GET", "/api/tasks", etag);
        assertEquals(304, again.getStatus());
        assertEquals("", again.getContentAsString());
    }

    @Test
    void writesAndPrivateReadsAreLeftAlone() throws Exception {
        // a 304 needs a copy on disk: notes, health, Money, Buddy never get one
        for (String[] c : new String[][] {
                { "POST", "/api/tasks" }, { "GET", "/api/auth/export" }, { "GET", "/api/reminders/export.ics" },
                { "GET", "/api/notes" }, { "GET", "/api/health/readings" }, { "GET", "/api/money" },
                { "GET", "/api/mentor/threads" }, { "GET", "/api/auth/me" } }) {
            MockHttpServletResponse res = run(c[0], c[1], null);
            assertNull(res.getHeader("ETag"), c[1]);
            assertNull(res.getHeader("Cache-Control"), c[1]);
            assertEquals("{\"tasks\":[1,2,3]}", res.getContentAsString(), c[1]);
        }
    }
}
