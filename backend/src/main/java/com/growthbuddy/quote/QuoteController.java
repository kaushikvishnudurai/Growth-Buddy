package com.growthbuddy.quote;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.user.UserClock;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
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
        return repo.findAll().stream().map(QuoteResponse::from).toList();
    }

    /**
     * A stable "quote of the day" — the same quote for everyone on a given date
     * (their own date: it turns over at their midnight, not the server's),
     * rotating daily. Avoids surprising the user with a new quote on every refresh.
     * A count and one row, not the whole table, on every Home load.
     */
    @GetMapping("/today")
    public QuoteResponse today() {
        long count = repo.count();
        if (count == 0) {
            throw ApiException.notFound("Quote");
        }
        int index = (int) (clock.today(CurrentUser.id()).toEpochDay() % count);
        return repo.findAll(PageRequest.of(index, 1, Sort.by("id"))).stream().findFirst()
                .map(QuoteResponse::from)
                .orElseThrow(() -> ApiException.notFound("Quote"));
    }
}
