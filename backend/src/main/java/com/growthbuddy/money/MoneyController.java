package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.growthbuddy.common.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/money")
public class MoneyController {

    private final MoneyService service;

    public MoneyController(MoneyService service) {
        this.service = service;
    }

    @GetMapping
    public JsonNode get() {
        return service.get(CurrentUser.id());
    }

    @PutMapping
    public JsonNode save(@RequestBody JsonNode body) {
        return service.save(CurrentUser.id(), body);
    }

    /**
     * AI second opinion on a purchase. The frontend already computes the hard
     * facts (budget fit, goal impact) and passes them as {@code context}; this
     * adds tailored natural-language judgement. Returns {@code configured:false}
     * when no LLM is available so the client renders its local heuristic.
     */
    @PostMapping("/advice")
    public MoneyService.AdviceResult advise(@RequestBody AdviceRequest req) {
        int price = req.price() == null ? 0 : req.price();
        return service.advise(req.item(), price, req.reason(), req.context());
    }

    public record AdviceRequest(String item, Integer price, String reason, String context) {}
}
