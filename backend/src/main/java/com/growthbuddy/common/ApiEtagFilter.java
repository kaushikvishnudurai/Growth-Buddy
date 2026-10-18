package com.growthbuddy.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

/**
 * Lets the browser's own HTTP cache answer API reads. Each listed GET gets an ETag
 * (a hash of its body) and {@code private, no-cache}: the browser keeps the copy,
 * asks with If-None-Match next time, and an unchanged answer comes back as an
 * empty 304 instead of the whole JSON again. fetch() sees a normal 200 either way.
 *
 * <p>{@code no-cache} means "always ask first", so nothing stale is ever shown;
 * {@code private} keeps a CDN from storing one user's data; {@code Vary:
 * Authorization} keeps one account's copy from answering another's request.
 *
 * <p>An allowlist, because a 304 needs the browser to keep the body on disk, and
 * sign-out cannot empty the HTTP cache everywhere (logout sends Clear-Site-Data,
 * but an expired session never calls it). So only the boot reads that every
 * reload repeats: tasks, habits, the score, water, reminders, goals, quotes.
 * Notes, health, Money, Buddy, food photos, the export: never, and a new route
 * stays out until someone decides it belongs. A handler's own ETag
 * (MoneyController) wins; SSE turns the buffering off itself.
 *
 * <p>ponytail: the body is still built (and the DB still read) to hash it; this
 * saves bandwidth, not queries. Per-entity version ETags if a read gets heavy.
 */
@Component
public class ApiEtagFilter extends ShallowEtagHeaderFilter {

    private static final Pattern CACHEABLE =
            Pattern.compile("/api/(tasks|habits|score/today|water|reminders|goals|quotes/today)");

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !"GET".equals(request.getMethod()) || !CACHEABLE.matcher(request.getRequestURI()).matches();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("Cache-Control", "private, no-cache");
        response.addHeader("Vary", "Authorization");
        super.doFilterInternal(request, response, chain);
    }
}
