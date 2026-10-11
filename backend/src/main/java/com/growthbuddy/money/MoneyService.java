package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.LocalDate;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.mentor.OpenAIClient;
import com.growthbuddy.mentor.OpenAIClient.ChatTurn;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class MoneyService {

    private static final Logger log = LoggerFactory.getLogger(MoneyService.class);

    /** Guard against an unbounded blob (the doc holds a user's whole history). */
    private static final int MAX_BYTES = 512 * 1024;

    /** Warm money coach. Mirrors the Mentor's tone: encouraging, never guilt. */
    private static final String ADVISOR_PROMPT = """
            You are Buddy, a warm, honest money coach inside the Growth Buddy app.
            The user is weighing a purchase. Using their item, price, stated reason,
            and money context, give a genuine second opinion — not a reflexive no.
            Lead with a clear recommendation (e.g. "Go for it", "Maybe sleep on it",
            "Worth a short pause"), then 2-3 sentences of specific, kind reasoning
            that references their actual budget room and savings goals when relevant.
            Money is growth, never shame. Under 90 words. Plain prose, no Markdown,
            no bullet stars. Speak in second person.
            """;

    private final MoneyRepository repo;
    private final ObjectMapper json;
    private final OpenAIClient openai;
    private final MoneyLedger ledger;
    /** Tests pin it; production reads the system clock. */
    java.time.Clock clock = java.time.Clock.systemUTC();

    public MoneyService(MoneyRepository repo, ObjectMapper json, OpenAIClient openai, MoneyLedger ledger) {
        this.repo = repo;
        this.json = json;
        this.openai = openai;
        this.ledger = ledger;
    }

    /** {@link MoneyLedger#rowsFromDoc}; the zone lookup only when there are arrays to date. */
    private List<MoneyLedger.Row> legacyRows(UUID userId, ObjectNode doc) {
        return MoneyLedger.ARRAYS.keySet().stream().anyMatch(doc::has)
                ? ledger.rowsFromDoc(doc, ledger.zoneOf(userId)) : List.of();
    }

    /** Clamp free-text fields that flow into the LLM prompt (trust boundary). */
    private static String cap(String s, int max) {
        if (s == null) return "";
        s = s.strip();
        return s.length() <= max ? s : s.substring(0, max);
    }

    /**
     * AI purchase advice. Returns {@code configured=false} when no API key is
     * set or the call fails, so the frontend falls back to its local heuristic.
     */
    public AdviceResult advise(String item, int price, String reason, String context) {
        if (!openai.isConfigured() || cap(item, 100).isEmpty()) {
            return new AdviceResult(false, null);
        }
        String user = "Item: " + cap(item, 100)
                + "\nPrice: " + Math.max(0, price)
                + "\nWhy they want it: " + cap(reason, 300)
                + "\nTheir money context: " + cap(context, 800)
                + "\n\nGive your honest recommendation.";
        try {
            String advice = OpenAIClient.plainText(openai.complete(ADVISOR_PROMPT, List.of(new ChatTurn("user", user))));
            return StringUtils.hasText(advice) ? new AdviceResult(true, advice) : new AdviceResult(false, null);
        } catch (RuntimeException ex) {
            log.warn("Money advisor LLM call failed, falling back to heuristic: {}", ex.getMessage());
            return new AdviceResult(false, null);
        }
    }

    public record AdviceResult(boolean configured, String advice) {}

    private static final String RECEIPT_PROMPT = """
            You read a photo of a shop receipt or bill and list what was bought.
            Return strict JSON only: {"items":[{"name":"Milk 1L","amount":56.00,"category":"food"}],"date":"2026-10-08","merchant":"Shop name"}

            Rules:
            - One item per purchased line. amount is that line's total price as a number, no currency symbol.
            - Leave out subtotal, total, amount paid, change, card or UPI lines, and loyalty points.
            - Tax, service charge, delivery fee and tip are items of their own, so the items add up to the bill's total.
            - A discount is a negative amount on its own line.
            - name is short and readable (expand obvious abbreviations), at most 40 characters.
            - date is the bill's date as YYYY-MM-DD, or null when none is printed. merchant is null when unclear.
            - Not a receipt, or nothing legible: {"items":[],"date":null,"merchant":null}.
            - category is the key of the user's category that fits the item best, judged from the item
              and the shop (groceries and dishes are food, a cab or fuel is transport). Use "others" only
              when nothing fits. Tax, fees and tip take the category of the bill's main items.
            The user's categories, as key = label:
            """;

    /**
     * Line items read off a receipt photo. {@code configured=false} when no AI is
     * set up; {@code unavailable=true} when it is but the call failed (a rejected
     * key, a timeout). Both keep the client's type-them-in form, but they used to
     * share one answer, so a dead key read to the user as "your photo is bad".
     */
    public ReceiptScan scanReceipt(String imageDataUrl, java.util.Map<String, String> categories) {
        if (!openai.isConfigured()) {
            return new ReceiptScan(false, List.of(), null, null);
        }
        try {
            StringBuilder prompt = new StringBuilder(RECEIPT_PROMPT);
            categories.forEach((k, v) -> prompt.append("- ").append(k).append(" = ").append(v).append('\n'));
            String raw = openai.completeWithImage(prompt.toString(), "Read this receipt. Strict JSON only.", imageDataUrl);
            return parseReceipt(json.readTree(OpenAIClient.jsonOf(raw)), categories.keySet());
        } catch (Exception ex) {
            log.warn("Receipt scan failed, falling back to manual entry: {}", ex.getMessage());
            return new ReceiptScan(true, true, List.of(), null, null);
        }
    }

    /**
     * Trust boundary: the model's JSON becomes expenses, so every line is checked
     * here. Discounts are folded into the line above them, because an expense
     * can't be negative and dropping one would overstate the bill. A category the
     * user doesn't have comes back null, and the client guesses from the name.
     */
    static ReceiptScan parseReceipt(JsonNode node, java.util.Set<String> categories) {
        List<ReceiptItem> items = new java.util.ArrayList<>();
        for (JsonNode it : node.path("items")) {
            if (!it.path("amount").isNumber()) continue;
            java.math.BigDecimal amt = it.path("amount").decimalValue().setScale(2, java.math.RoundingMode.HALF_UP);
            if (amt.signum() < 0 && !items.isEmpty()) {
                ReceiptItem prev = items.remove(items.size() - 1);
                java.math.BigDecimal left = prev.amount().add(amt);
                if (left.signum() > 0) items.add(new ReceiptItem(prev.name(), left, prev.category()));
                continue;
            }
            if (amt.signum() <= 0 || amt.compareTo(MoneyLedger.EXPENSE_MAX) > 0) continue;
            String name = cap(it.path("name").asText(""), 60);
            String cat = it.path("category").asText("");
            items.add(new ReceiptItem(name.isEmpty() ? "Receipt item" : name, amt,
                    categories.contains(cat) ? cat : null));
        }
        String date = null;
        try {
            date = LocalDate.parse(node.path("date").asText("")).toString();
        } catch (java.time.format.DateTimeParseException ignored) {
            // no printed date, or not ISO: the client uses today
        }
        String merchant = cap(node.path("merchant").isTextual() ? node.path("merchant").asText() : "", 60);
        return new ReceiptScan(true, items, date, merchant.isEmpty() ? null : merchant);
    }

    public record ReceiptItem(String name, java.math.BigDecimal amount, String category) {}

    public record ReceiptScan(boolean configured, boolean unavailable, List<ReceiptItem> items, String date,
                              String merchant) {
        ReceiptScan(boolean configured, List<ReceiptItem> items, String date, String merchant) {
            this(configured, false, items, date, merchant);
        }
    }

    /** The whole document plus the version a later write must match. */
    public record Versioned(JsonNode data, String version) {}

    /**
     * A version tag for the stored document: a hash of the document itself, so it
     * changes exactly when the content does. "0" means nothing is stored yet (an
     * empty object hashes to 0 too, which is the same thing to a first write).
     *
     * <p>ponytail: content hash, not {@code updatedAt}. That column is a MySQL
     * TIMESTAMP — whole seconds — so the epoch-millis tag handed back after a
     * write never matched the truncated value read back on the next one, and
     * every conditional save 409'd with "changed somewhere else" against itself.
     * A hash needs no column, no migration, and no clock. If 32 bits ever feels
     * thin, move to a real @Version column.
     */
    private static String versionOf(MoneyState state) {
        JsonNode data = state == null ? null : state.getData();
        return data == null ? "0" : Integer.toHexString(data.hashCode());
    }

    /**
     * Buddy's view of money: this month's spend by category against any budget
     * (top 6), and bills due in the next 7 days that are not marked paid. Category
     * keys and bill names are the user's; the mentor wraps this in its data block.
     */
    /** The user's Money currency as stored (a symbol such as "₹"); "₹" when they have no Money doc yet. */
    @Transactional(readOnly = true)
    public String currencyOf(UUID userId) {
        JsonNode doc = repo.peekData(userId).orElse(null);
        return doc == null ? "₹" : doc.path("settings").path("currency").asText("₹");
    }

    @Transactional(readOnly = true)
    public String contextSummary(UUID userId, LocalDate today) {
        JsonNode doc = repo.peekData(userId).orElse(null);
        String cur = doc == null ? "₹" : doc.path("settings").path("currency").asText("₹");
        java.util.Map<String, java.math.BigDecimal> spend =
                ledger.spendByCategory(userId, today.withDayOfMonth(1), today);
        StringBuilder sb = new StringBuilder();
        if (spend.isEmpty()) {
            sb.append("Money: no expenses logged this month.\n");
        } else {
            java.math.BigDecimal total = spend.values().stream()
                    .reduce(java.math.BigDecimal.ZERO, java.math.BigDecimal::add);
            sb.append("Money this month (").append(cur).append("): spent ").append(whole(total)).append('\n');
            int n = 0;
            for (var e : spend.entrySet()) {
                if (n++ == 6) break;
                int budget = doc == null ? 0 : doc.path("budgets").path(e.getKey()).asInt(0);
                sb.append("  - ").append(clip(e.getKey(), 30)).append(": ").append(whole(e.getValue()))
                        .append(budget > 0 ? " of " + budget + " budget" : "").append('\n');
            }
        }
        List<String> due = doc == null ? List.of() : billsDue(doc.path("subscriptions"), today, 7);
        if (!due.isEmpty()) {
            sb.append("  - bills due in the next 7 days: ").append(String.join(", ", due)).append('\n');
        }
        return sb.toString();
    }

    /** Unpaid subscriptions falling due in [today, today + days]: "Netflix 199 on 2026-10-15". */
    static List<String> billsDue(JsonNode subs, LocalDate today, int days) {
        List<String> out = new java.util.ArrayList<>();
        if (subs == null || !subs.isArray()) return out;
        for (int i = 0; i <= days && out.size() < 8; i++) {
            LocalDate d = today.plusDays(i);
            String month = java.time.YearMonth.from(d).toString();
            for (JsonNode s : subs) {
                int dueDay = Math.min(Math.max(s.path("dueDay").asInt(1), 1), d.lengthOfMonth());
                if (dueDay != d.getDayOfMonth() || s.path("paidFor").asText("").compareTo(month) >= 0) continue;
                out.add(clip(s.path("name").asText("Bill"), 30) + " " + s.path("amount").asInt(0) + " on " + d);
            }
        }
        return out;
    }

    private static String whole(java.math.BigDecimal v) {
        return v.setScale(0, java.math.RoundingMode.HALF_UP).toPlainString();
    }

    private static String clip(String s, int max) {
        String one = s == null ? "" : s.replaceAll("\\s+", " ").trim();
        return one.length() <= max ? one : one.substring(0, max);
    }

    /**
     * The document as the client knows it: the stored part, plus the ledger's
     * expenses / income / transfers (last {@link MoneyLedger#WINDOW_DAYS} days) and
     * live account balances, merged back in. The version covers the stored part
     * only — ledger rows are written item by item and never conflict as a whole.
     */
    @Transactional
    public Versioned get(UUID userId) {
        // Check, then lock: every GET used to take the row lock (SELECT ... FOR
        // UPDATE) for a migration that runs once per user, serialising reads behind
        // saves. Only a document that still needs a write is locked now; the lock
        // re-reads it, so a concurrent migration is seen and skipped.
        JsonNode data = repo.peekData(userId).orElse(null);
        if (data != null && needsWrite(data)) {
            MoneyState state = repo.lockById(userId).orElse(null);
            if (state != null) {
                migrate(state);
                seedAccounts(state);
                data = state.getData();
            }
        } else if (data == null) {
            // A brand-new user has no document to remember the seeding in yet; the
            // count check inside makes a repeat a no-op.
            ledger.seedDefaults(userId);
        }
        ObjectNode out = data instanceof ObjectNode d ? d.deepCopy() : json.createObjectNode();
        // The user's day, not the server's: the window edge is a date they see (CRB-11).
        out.setAll(ledger.load(userId, LocalDate.now(ledger.zoneOf(userId))));
        out.set("accounts", ledger.accounts(userId));
        return new Versioned(out, data == null ? "0" : Integer.toHexString(data.hashCode()));
    }

    /** What {@link #migrate} or {@link #seedAccounts} would change; false = a plain read. */
    static boolean needsWrite(JsonNode data) {
        if (!(data instanceof ObjectNode d)) {
            return false;
        }
        return MoneyLedger.ARRAYS.keySet().stream().anyMatch(d::has)
                || !d.path("settings").path("accountsSeeded").asBoolean(false);
    }

    /**
     * Cash and Bank, once per user, remembered in settings. Seeding on "no accounts
     * yet" brought both back every time someone deleted their last empty account.
     */
    private void seedAccounts(MoneyState state) {
        if (!(state.getData() instanceof ObjectNode data)
                || data.path("settings").path("accountsSeeded").asBoolean(false)) {
            return;
        }
        ledger.seedDefaults(state.getUserId());
        ObjectNode settings = data.path("settings") instanceof ObjectNode so ? so : data.putObject("settings");
        settings.put("accountsSeeded", true);
        state.setData(data);
        repo.save(state);
    }

    /**
     * Moves a document's old expenses / income into the ledger, once. Lazy, per
     * user, on first read after deploy: TiDB has no JSON_TABLE, so no SQL script
     * can unpack the document. INSERT IGNORE, so a retry after a crash between
     * the insert and the document save moves nothing twice.
     */
    private void migrate(MoneyState state) {
        if (!(state.getData() instanceof ObjectNode data)) {
            return;
        }
        boolean hasArrays = MoneyLedger.ARRAYS.keySet().stream().anyMatch(data::has);
        if (!hasArrays) {
            return;
        }
        int moved = ledger.importIgnore(state.getUserId(), legacyRows(state.getUserId(), data));
        MoneyLedger.stripArrays(data);
        state.setData(data);
        repo.save(state);
        log.info("Moved {} money entries for {} into the ledger", moved, state.getUserId());
    }

    /**
     * Replace the stored part of the document, optionally only if it still looks
     * the way the caller last saw it ({@code If-Match}; stale → 409, the caller
     * merges and retries; absent → unconditional, as before).
     *
     * <p>Current clients send expenses as ledger writes and never put them here.
     * An app build from before the ledger still sends them inside the document:
     * those are upserted, so its adds and edits land. Its deletes cannot be told
     * apart from "not loaded" and are not applied — the update prompt covers that.
     */
    @Transactional
    public Versioned save(UUID userId, JsonNode body, String expectedVersion) {
        if (body == null || !body.isObject()) {
            throw ApiException.badRequest("Money data must be a JSON object.");
        }
        if (body.toString().length() > MAX_BYTES) {
            throw ApiException.badRequest("Money data is too large.");
        }
        MoneyState state = repo.lockById(userId).orElseGet(MoneyState::new);
        if (expectedVersion != null && !expectedVersion.isBlank()
                && !expectedVersion.equals(versionOf(state))) {
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,
                    "Your money data changed somewhere else.");
        }
        ObjectNode doc = ((ObjectNode) body).deepCopy();
        // An old build re-sends the whole history every 5 minutes. Adds only: letting
        // it overwrite put back amounts and deleted entries a new build had changed.
        List<MoneyLedger.Row> legacy = legacyRows(userId, doc);
        if (!legacy.isEmpty()) {
            ledger.importIgnore(userId, legacy);
        }
        MoneyLedger.stripArrays(doc);
        state.setUserId(userId);
        state.setData(doc);
        MoneyState saved = repo.save(state);
        // A first document arrives without accountsSeeded (the GET that seeded had
        // nothing to stamp it on). Stamped on the next GET, that write changed the
        // version under this writer, and its following save 409'd against itself.
        seedAccounts(saved);
        return new Versioned(saved.getData(), versionOf(saved));
    }

    /**
     * Expense / income / transfer writes from the client, then fresh balances.
     *
     * <p>An invalid entry is refused on its own, by id, and the rest are saved.
     * Failing the whole batch made one bad entry (an old expense with no date,
     * edited later) a poison pill: the client kept it queued, and every save after
     * it failed with it.
     *
     * <p>A row dated after the user's today is refused too (EXM-1): it moved the
     * balance at once while every list and total ends at today, so it could not be
     * seen, edited or deleted until its day came. Recurring rules post only on or
     * before today, so they never meet this. The water endpoint's clock slack lets a
     * device a few minutes into tomorrow still log "today".
     *
     * <p>Each refusal is {@code {id, reason}}; one for an id deleted in the last
     * 120 days also carries {@code code: "deleted"} (OFF-5).
     */
    public ObjectNode applyLedger(UUID userId, JsonNode body) {
        if (body.path("upserts").size() + body.path("deletes").size() > 2000) {
            throw ApiException.badRequest("Too many changes in one save.");
        }
        List<MoneyLedger.Row> upserts = new java.util.ArrayList<>();
        ObjectNode out = json.createObjectNode();
        ArrayNode rejected = out.putArray("rejected");
        LocalDate latest = body.path("upserts").isEmpty() ? null
                : java.time.ZonedDateTime.now(clock.withZone(ledger.zoneOf(userId)))
                        .plus(com.growthbuddy.water.WaterService.FUTURE_SLACK).toLocalDate();
        // OFF-5: an edit from a tab or phone that never saw the delete. Refused by id
        // with a code, so the client can say why and drop its copy.
        List<String> ids = new java.util.ArrayList<>();
        body.path("upserts").forEach(u -> {
            String id = u.path("id").asText("");
            if (!id.isEmpty() && !MoneyLedger.derivedId(id)) ids.add(id);
        });
        Set<String> gone = ids.isEmpty() ? Set.of() : ledger.deletedIds(userId, ids);
        for (JsonNode u : body.path("upserts")) {
            if (gone.contains(u.path("id").asText(""))) {
                rejected.addObject().put("id", u.path("id").asText()).put("code", "deleted")
                        .put("reason", "This entry was deleted on another device.");
                continue;
            }
            try {
                MoneyLedger.Row row = ledger.toRow(u.path("kind").asText(), withoutKind(u));
                // Not in toRow: a legacy document migrating through it must not lose a big expense.
                if ("expense".equals(row.kind()) && row.amount().compareTo(MoneyLedger.EXPENSE_MAX) > 0) {
                    throw ApiException.badRequest("An expense can be at most 10,000,000.");
                }
                if (row.day().isAfter(latest)) {
                    throw ApiException.badRequest("Pick a day up to today.");
                }
                // HOS-7: MoneyLedger.LEDGER_FLOOR is where the ledger stops paging,
                // so a row before it moved the balance and could never be listed
                // or deleted. Not tighter: old loans and imports are real.
                if (row.day().isBefore(MoneyLedger.LEDGER_FLOOR)) {
                    throw ApiException.badRequest("Pick a day in 1900 or later.");
                }
                upserts.add(row);
            } catch (ApiException ex) {
                rejected.addObject().put("id", u.path("id").asText()).put("reason", ex.getMessage());
            }
        }
        List<String> deletes = new java.util.ArrayList<>();
        body.path("deletes").forEach(d -> deletes.add(d.asText()));
        ledger.apply(userId, upserts, deletes);
        out.set("accounts", ledger.accounts(userId));
        return out;
    }

    private static JsonNode withoutKind(JsonNode u) {
        if (u instanceof ObjectNode o) {
            ObjectNode c = o.deepCopy();
            c.remove("kind");
            return c;
        }
        return u;
    }

    /**
     * The account a write from outside the app books to, as the app's own dialogs
     * would pick it: an expense the last "Paid from" (else the first cash account),
     * income the first bank or wallet; an archived or missing pick falls to the
     * first active account. Null when there are none: the row still saves.
     */
    public String defaultAccountId(UUID userId, String kind) {
        String last = repo.peekData(userId).map(d -> d.path("settings").path("lastAccountId").asText(null)).orElse(null);
        return pickAccount(ledger.accounts(userId), "expense".equals(kind) ? last : null, kind);
    }

    static String pickAccount(JsonNode accounts, String last, String kind) {
        List<JsonNode> active = new java.util.ArrayList<>();
        accounts.forEach(a -> {
            if (!a.path("archived").asBoolean(false)) active.add(a);
        });
        if (active.isEmpty()) return null;
        Set<String> kinds = "expense".equals(kind) ? Set.of("cash") : Set.of("bank", "wallet");
        String want = last != null ? last : active.stream().filter(a -> kinds.contains(a.path("kind").asText()))
                .map(a -> a.path("id").asText()).findFirst().orElse(null);
        return active.stream().map(a -> a.path("id").asText()).filter(id -> id.equals(want)).findFirst()
                .orElse(active.get(0).path("id").asText());
    }

    /** {@code noAmount}: the bill exists but has no amount, so nothing could be booked. */
    public record Paid(String name, boolean booked, boolean noAmount) {
        Paid(String name, boolean booked) {
            this(name, booked, false);
        }
    }

    /**
     * Marks one month of a subscription paid from outside the app (WhatsApp's
     * "Mark as paid" button): stamps {@code paidFor} and logs the matching expense.
     * Written without a version check on purpose — an open client's next save then
     * 409s, and {@code mergeMoney} keeps this server copy of the item.
     *
     * @return the subscription and whether a payment was booked ({@code booked} is
     *     false when that month, or a later one, was already paid), or null when
     *     there is nothing to mark
     */
    @Transactional
    public Paid markSubscriptionPaid(UUID userId, String subId, String month, LocalDate today) {
        MoneyState state = repo.lockById(userId).orElse(null);
        if (state == null || !(state.getData() instanceof ObjectNode data)) {
            return null;
        }
        migrate(state);
        // EXM-7: the month's payment was deleted after it was marked, so paidFor still
        // names the month with nothing behind it; let this tap book it again.
        boolean rebook = !ledger.deletedIds(userId, List.of("sub-" + subId + "-" + month)).isEmpty();
        String name = applyPaid(data, subId, month, today, rebook);
        if (name == null) {
            String unpriced = unpricedName(data, subId);
            return unpriced == null ? null : new Paid(unpriced, false, true);
        }
        // migrate() left no expenses array, so one now means applyPaid booked a payment.
        boolean booked = name != null && data.has("expenses");
        if (booked) {
            // applyPaid writes the expense into the document's shape; the ledger
            // owns expenses now, so it moves there, paid from the bill's account.
            for (JsonNode e : data.path("expenses")) {
                if (e instanceof ObjectNode eo && !eo.hasNonNull("accountId")) {
                    String acc = ledger.defaultBillAccount(userId);
                    if (acc != null) {
                        eo.put("accountId", acc);
                    }
                }
            }
            ledger.apply(userId, legacyRows(userId, data), List.of());
            MoneyLedger.stripArrays(data);
            state.setData(data);
            repo.save(state);
        }
        return name == null ? null : new Paid(name, booked);
    }

    /** The bill's name when it exists with no amount (applyPaid refuses those), else null. */
    static String unpricedName(JsonNode data, String subId) {
        for (JsonNode sub : data.path("subscriptions")) {
            if (subId.equals(sub.path("id").asText()) && sub.path("amount").asDouble(0) <= 0) {
                return sub.path("name").asText();
            }
        }
        return null;
    }

    /** Idempotent: a second tap on the same message changes nothing. */
    static String applyPaid(ObjectNode data, String subId, String month, LocalDate today) {
        return applyPaid(data, subId, month, today, false);
    }

    /** {@code rebook}: the month is marked paid but its payment was deleted; book it again. */
    static String applyPaid(ObjectNode data, String subId, String month, LocalDate today, boolean rebook) {
        if (!(data.get("subscriptions") instanceof ArrayNode subs)) {
            return null;
        }
        for (JsonNode n : subs) {
            if (n instanceof ObjectNode sub && subId.equals(sub.path("id").asText())) {
                // A bill with no amount can't be paid: stamping paidFor with no expense
                // behind it would show it settled while nothing was recorded.
                if (sub.path("amount").asDouble(0) <= 0) {
                    return null;
                }
                // Forward only: tapping last month's message after this month is paid
                // must not roll paidFor back (and re-open this month's bill).
                // "YYYY-MM" strings order the same as the months they name.
                int vs = month.compareTo(sub.path("paidFor").asText(""));
                if (vs < 0 || (vs == 0 && !rebook)) {
                    return sub.path("name").asText();
                }
                sub.put("paidFor", month);
                ArrayNode expenses = data.has("expenses") && data.get("expenses").isArray()
                        ? (ArrayNode) data.get("expenses")
                        : data.putArray("expenses");
                ObjectNode e = expenses.insertObject(0);
                // Deterministic id: the client merge unions by id, so a replayed webhook
                // can never land a second copy of the same payment.
                e.put("id", "sub-" + subId + "-" + month);
                e.put("amount", Math.round(sub.path("amount").asDouble()));
                e.put("category", sub.path("category").asText("others"));
                e.put("note", sub.path("name").asText());
                e.put("date", today.toString());
                e.put("createdAt", System.currentTimeMillis());
                if (sub.hasNonNull("accountId")) {
                    e.put("accountId", sub.get("accountId").asText());
                }
                return sub.path("name").asText();
            }
        }
        return null;
    }
}
