package com.growthbuddy.quote;

import com.growthbuddy.common.ApiException;
import java.time.LocalDate;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/quotes")
public class QuoteController {

    private final QuoteRepository repo;

    public QuoteController(QuoteRepository repo) {
        this.repo = repo;
    }

    @GetMapping
    public List<Quote> all() {
        return repo.findAll();
    }

    /**
     * A stable "quote of the day" — the same quote for everyone on a given date,
     * rotating daily. Avoids surprising the user with a new quote on every refresh.
     */
    @GetMapping("/today")
    public Quote today() {
        List<Quote> all = repo.findAll();
        if (all.isEmpty()) {
            throw ApiException.notFound("Quote");
        }
        int index = (int) (LocalDate.now().toEpochDay() % all.size());
        return all.get(index);
    }
}
