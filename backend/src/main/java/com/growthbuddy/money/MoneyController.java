package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.growthbuddy.common.CurrentUser;
import java.math.BigDecimal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
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
    private final MoneyLedger ledger;
    private final MoneyDaySummary daySummary;

    public MoneyController(MoneyService service, MoneyLedger ledger, MoneyDaySummary daySummary) {
        this.service = service;
        this.ledger = ledger;
        this.daySummary = daySummary;
    }

    /**
     * The version rides in ETag / If-Match rather than inside the document,
     * because the document is the user's data and this is bookkeeping about it.
     */
    /**
     * The tag is "<document version>-<hash of this whole response>". The version
     * alone is what a save is checked against, but the response also carries the
     * ledger rows: tagged with the version alone, a new expense (ledger changed,
     * document not) kept the same tag, Spring answered the browser's If-None-Match
     * with 304, and every device went on showing its stale copy.
     */
    @GetMapping
    public ResponseEntity<JsonNode> get() {
        MoneyService.Versioned v = service.get(CurrentUser.id());
        return ResponseEntity.ok()
                .eTag("\"" + v.version() + "-" + Integer.toHexString(v.data().hashCode()) + "\"")
                .body(v.data());
    }

    @PutMapping
    public ResponseEntity<JsonNode> save(@RequestBody JsonNode body,
                                         @RequestHeader(value = "If-Match", required = false)
                                         String ifMatch) {
        MoneyService.Versioned v = service.save(CurrentUser.id(), body, versionOf(ifMatch));
        return ResponseEntity.ok().eTag("\"" + v.version() + "\"").body(v.data());
    }

    /** The document version inside an If-Match: the part before a GET's "-hash". */
    static String versionOf(String etag) {
        String t = unquote(etag);
        if (t == null) {
            return null;
        }
        int dash = t.indexOf('-');
        return dash < 0 ? t : t.substring(0, dash);
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

    /** Expense / income / transfer writes: {upserts:[{kind, …item}], deletes:[id]} → balances. */
    @PostMapping("/tx")
    public JsonNode applyLedger(@RequestBody JsonNode body) {
        return service.applyLedger(CurrentUser.id(), body);
    }

    /** Cash / bank / card / wallet. Each write answers with every account's balance. */
    @PostMapping("/accounts")
    public JsonNode createAccount(@RequestBody JsonNode body) {
        BigDecimal balance = null;
        if (body.hasNonNull("balance")) {
            // asText, not decimalValue: a balance sent as "1850" read as 0 before.
            try {
                balance = new BigDecimal(body.get("balance").asText());
            } catch (NumberFormatException ex) {
                throw com.growthbuddy.common.ApiException.badRequest("Enter the balance as a number.");
            }
        }
        return ledger.createAccount(CurrentUser.id(), body.path("name").asText(null),
                body.path("kind").asText(null), balance);
    }

    @PutMapping("/accounts/{id}")
    public JsonNode updateAccount(@PathVariable String id, @RequestBody JsonNode body) {
        return ledger.updateAccount(CurrentUser.id(), id, body);
    }

    @DeleteMapping("/accounts/{id}")
    public JsonNode deleteAccount(@PathVariable String id) {
        return ledger.deleteAccount(CurrentUser.id(), id);
    }

    /** The tapped bar on Last 7 days. */
    @GetMapping("/day-summary")
    public JsonNode daySummary(@RequestParam String date) {
        return daySummary.summarise(CurrentUser.id(), date);
    }
}
