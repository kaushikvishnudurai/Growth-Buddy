package com.growthbuddy.common;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * In-memory sliding-window rate limiter. No external dependencies.
 * Thread-safe: each bucket is synchronized individually so unrelated
 * keys don't block each other.
 *
 * <p>A periodic sweep drops idle buckets so the map can't grow without bound —
 * one entry per client IP would otherwise be a slow memory leak (and a
 * spoofed-IP memory-DoS vector).
 */
@Component
public class RateLimiter {

    /** Buckets with no timestamp newer than this are evicted by the sweep. */
    private static final long IDLE_EVICT_MS = 10 * 60_000L;

    private final ConcurrentHashMap<String, Deque<Long>> buckets = new ConcurrentHashMap<>();

    /**
     * Returns {@code true} when the request is within the allowed rate;
     * {@code false} when it should be rejected.
     *
     * @param key      discriminator — typically "IP:path"
     * @param limit    maximum calls allowed inside the window
     * @param windowMs sliding window width in milliseconds
     */
    public boolean allow(String key, int limit, long windowMs) {
        long now = System.currentTimeMillis();
        Deque<Long> bucket = buckets.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (bucket) {
            while (!bucket.isEmpty() && now - bucket.peekFirst() > windowMs) {
                bucket.pollFirst();
            }
            if (bucket.size() >= limit) {
                return false;
            }
            bucket.addLast(now);
            return true;
        }
    }

    /** Evict buckets whose newest entry is older than the idle threshold. */
    @Scheduled(fixedDelay = IDLE_EVICT_MS)
    void sweep() {
        long cutoff = System.currentTimeMillis() - IDLE_EVICT_MS;
        for (Iterator<Map.Entry<String, Deque<Long>>> it = buckets.entrySet().iterator(); it.hasNext();) {
            Deque<Long> bucket = it.next().getValue();
            synchronized (bucket) {
                Long last = bucket.peekLast();
                if (last == null || last < cutoff) {
                    it.remove();
                }
            }
        }
    }
}
