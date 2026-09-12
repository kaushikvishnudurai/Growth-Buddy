package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.growthbuddy.common.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/money")
public class MoneyController {

    private final MoneyService service;

    public MoneyController(MoneyService service) {
        this.service = service;
    }

    /**
     * The version rides in ETag / If-Match rather than inside the document,
     * because the document is the user's data and this is bookkeeping about it.
     */
    @GetMapping
    public ResponseEntity<JsonNode> get() {
        MoneyService.Versioned v = service.get(CurrentUser.id());
        return ResponseEntity.ok().eTag("\"" + v.version() + "\"").body(v.data());
    }

    @PutMapping
    public ResponseEntity<JsonNode> save(@RequestBody JsonNode body,
                                         @RequestHeader(value = "If-Match", required = false)
                                         String ifMatch) {
        MoneyService.Versioned v = service.save(CurrentUser.id(), body, unquote(ifMatch));
        return ResponseEntity.ok().eTag("\"" + v.version() + "\"").body(v.data());
    }

    /** ETags travel quoted; the version we compare is the bare value. */
    private static String unquote(String etag) {
        if (etag == null) {
            return null;
        }
        String t = etag.trim();
        if (t.startsWith("W/")) {
            t = t.substring(2);
        }
        return t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")
                ? t.substring(1, t.length() - 1)
                : t;
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
