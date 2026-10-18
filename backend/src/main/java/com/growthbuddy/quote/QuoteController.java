package com.growthbuddy.quote;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.user.UserClock;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/quotes")
public class QuoteController {

    private final QuoteRepository repo;
    private final UserClock clock;

    public QuoteController(QuoteRepository repo, UserClock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    record QuoteResponse(UUID id, String body, String author) {
        static QuoteResponse from(Quote q) {
            return new QuoteResponse(q.getId(), q.getBody(), q.getAuthor());
        }
    }

    @GetMapping
    public List<QuoteResponse> all() {
        return sorted();
    }

    /**
     * A stable "quote of the day" — the same quote for everyone on a given date
     * (their own date: it turns over at their midnight, not the server's),
     * rotating daily. Avoids surprising the user with a new quote on every refresh.
     * The list is held in memory: only the seeder writes it, so every Home load
     * re-reading it was pure cost. An hour's TTL picks up rows added by hand.
     */
    @GetMapping("/today")
    public QuoteResponse today() {
        List<QuoteResponse> list = sorted();
        if (list.isEmpty()) {
            throw ApiException.notFound("Quote");
        }
        return list.get((int) (clock.today(CurrentUser.id()).toEpochDay() % list.size()));
    }

    private static final long TTL_MS = 60 * 60_000L;
    private volatile List<QuoteResponse> cached = List.of();
    private volatile long cachedAtMs;

    private List<QuoteResponse> sorted() {
        long now = System.currentTimeMillis();
        if (cached.isEmpty() || now - cachedAtMs > TTL_MS) {
            cached = repo.findAll(Sort.by("id")).stream().map(QuoteResponse::from).toList();
            cachedAtMs = now;
        }
        return cached;
    }
}
