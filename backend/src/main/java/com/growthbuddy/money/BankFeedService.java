package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Bank transactions into Money with no typing, through an Account Aggregator
 * consent ({@link BankFeedClient}). One row per consent in
 * {@code bank_feed_consents}; every transaction becomes a ledger row keyed on a
 * hash of its bank txnId, written with {@code INSERT IGNORE}, so a re-fetch is
 * a no-op and an entry the user re-tagged or re-noted keeps their edit.
 *
 * <p>The flow: connect -> the user approves on their AA's screen -> the consent
 * turns ACTIVE (webhook, or the next list/sync re-reads it) -> a data session
 * over [synced_to, now] -> once it is COMPLETED its transactions are imported and
 * synced_to moves to the session's end. PARTIAL imports what has arrived and
 * keeps waiting; EXPIRED/FAILED drops the session, and the same range is asked
 * for again next time (the hash ids make that safe).
 *
 * <p>Stored: the consent id, its status, the masked account numbers Setu
 * returns, and timestamps. Never a full account number, never the FI payload.
 */
@Service
public class BankFeedService {

    private static final Logger log = LoggerFactory.getLogger(BankFeedService.class);

    /** How far back the first fetch reaches. */
    static final int HISTORY_DAYS = 90;
    /** Scheduled fetch: once a day per consent. Sync now: at most once an hour. */
    static final Duration DAILY = Duration.ofHours(24);
    static final Duration MANUAL = Duration.ofHours(1);
    private static final Set<String> ACTIVE = Set.of("ACTIVE", "APPROVED");
    private static final Set<String> DEAD = Set.of("REJECTED", "REVOKED", "EXPIRED", "PAUSED", "FAILED");
    private static final Pattern MOBILE = Pattern.compile("[6-9]\\d{9}");

    private final BankFeedClient setu;
    private final MoneyLedger ledger;
    private final JdbcTemplate jdbc;
    private final UserClock clock;
    private final ObjectMapper json;

    public BankFeedService(BankFeedClient setu, MoneyLedger ledger, JdbcTemplate jdbc, UserClock clock,
                           ObjectMapper json) {
        this.setu = setu;
        this.ledger = ledger;
        this.jdbc = jdbc;
        this.clock = clock;
        this.json = json;
    }

    public boolean isConfigured() {
        return setu.isConfigured();
    }

    private void requireConfigured() {
        if (!setu.isConfigured()) {
            throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE,
                    "Bank connection isn't set up on this server.");
        }
    }

    /* ---- What the app calls ---- */

    /** {configured, consents: [...]}; a pending consent is re-read so an approval shows without a webhook. */
    public ObjectNode status(UUID userId) {
        ObjectNode out = json.createObjectNode().put("configured", setu.isConfigured());
        ArrayNode list = out.putArray("consents");
        if (!setu.isConfigured()) {
            return out;
        }
        for (Map<String, Object> row : rows(userId)) {
            if ("PENDING".equals(row.get("status"))) {
                try {
                    refreshConsent(row);
                    row = jdbc.queryForMap("SELECT * FROM bank_feed_consents WHERE id = ?", row.get("id"));
                } catch (RuntimeException ex) {
                    log.info("Bank consent status re-read failed: {}", ex.getMessage());
                }
            }
            list.add(view(row));
        }
        return out;
    }

    /** Starts a consent; {id, url} — the app opens url, where the user approves on their AA. */
    public ObjectNode connect(UUID userId, String mobileIn) {
        requireConfigured();
        String mobile = mobileIn == null ? "" : mobileIn.replaceAll("[\\s-]", "").replaceFirst("^(\\+?91)(?=\\d{10}$)", "");
        if (!MOBILE.matcher(mobile).matches()) {
            throw ApiException.badRequest("Enter the 10-digit mobile number your bank has.");
        }
        Integer open = jdbc.queryForObject(
                "SELECT COUNT(*) FROM bank_feed_consents WHERE user_id = ? AND status = 'PENDING'",
                Integer.class, userId.toString());
        if (open != null && open >= 3) {
            throw ApiException.badRequest("You have connections waiting for approval. Finish or remove one first.");
        }
        LocalDate today = clock.today(userId);
        LocalDate from = today.minusDays(HISTORY_DAYS);
        BankFeedClient.Consent c = setu.createConsent(mobile, from, today.plusMonths(12));
        if (c.id() == null || c.id().isBlank() || c.url() == null || c.url().isBlank()) {
            throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY, "The bank connection didn't start. Try again.");
        }
        Timestamp now = Timestamp.from(Instant.now());
        String id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO bank_feed_consents
                  (id, user_id, consent_id, status, data_from, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id, userId.toString(), c.id(), c.status().isBlank() ? "PENDING" : c.status(),
                java.sql.Date.valueOf(from), now, now);
        return json.createObjectNode().put("id", id).put("url", c.url());
    }

    /** Fetch now, for every active consent: {imported, pending}. A session asked for under an hour ago is waited on. */
    public ObjectNode syncNow(UUID userId) {
        requireConfigured();
        int imported = 0;
        int pending = 0;
        for (Map<String, Object> row : rows(userId)) {
            try {
                if ("PENDING".equals(row.get("status"))) {
                    refreshConsent(row);
                    row = jdbc.queryForMap("SELECT * FROM bank_feed_consents WHERE id = ?", row.get("id"));
                }
                if (!ACTIVE.contains(String.valueOf(row.get("status")))) {
                    continue;
                }
                if (row.get("pending_session") == null && claim(row, MANUAL)) {
                    requestSession(row);
                    row = jdbc.queryForMap("SELECT * FROM bank_feed_consents WHERE id = ?", row.get("id"));
                }
                if (row.get("pending_session") != null) {
                    int n = fetchSession(row);
                    if (n < 0) pending++;
                    else imported += n;
                }
            } catch (BankFeedClient.SetuException ex) {
                note(row, ex.getMessage());
                throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY,
                        "The bank feed didn't answer: " + ex.getMessage());
            }
        }
        return json.createObjectNode().put("imported", imported).put("pending", pending);
    }

    /** Revokes at Setu and forgets the consent. Entries already imported stay: they are the user's now. */
    public void disconnect(UUID userId, String id) {
        requireConfigured();
        List<Map<String, Object>> found = jdbc.queryForList(
                "SELECT * FROM bank_feed_consents WHERE id = ? AND user_id = ?", id, userId.toString());
        if (found.isEmpty()) {
            throw ApiException.notFound("No such bank connection.");
        }
        String consentId = String.valueOf(found.get(0).get("consent_id"));
        jdbc.update("DELETE FROM bank_feed_consents WHERE id = ?", id);
        try {
            setu.revoke(consentId);
        } catch (RuntimeException ex) {
            // Gone here either way, so nothing more is fetched; the AA app can still revoke it.
            log.warn("Bank consent revoke at Setu failed: {}", ex.getMessage());
            throw new ApiException(org.springframework.http.HttpStatus.BAD_GATEWAY,
                    "Disconnected here, but the bank side didn't confirm. Revoke it in your Account Aggregator app too.");
        }
    }

    /* ---- Setu's notifications: a hint to re-read, never trusted as data ---- */

    /**
     * Setu documents no signature on these, so the payload only says WHICH
     * consent to look at; its status and data are then read from Setu with our
     * own credentials. A forged call can at most make us re-read a consent.
     */
    public void onNotification(JsonNode body) {
        if (!setu.isConfigured()) {
            return;
        }
        String consentId = body.path("consentId").asText("");
        if (consentId.isBlank()) {
            return;
        }
        List<Map<String, Object>> found = jdbc.queryForList(
                "SELECT * FROM bank_feed_consents WHERE consent_id = ?", consentId);
        for (Map<String, Object> row : found) {
            try {
                String type = body.path("type").asText("");
                if ("CONSENT_STATUS_UPDATE".equals(type)) {
                    refreshConsent(row);
                } else if ("SESSION_STATUS_UPDATE".equals(type) && row.get("pending_session") != null
                        && row.get("pending_session").equals(body.path("dataSessionId").asText(""))) {
                    fetchSession(row);
                }
            } catch (RuntimeException ex) {
                note(row, ex.getMessage());
                log.info("Bank notification handling failed: {}", ex.getMessage());
            }
        }
    }

    /* ---- The schedule ---- */

    /**
     * Every 15 minutes: collect any session that is waiting, and ask for a new
     * one where the last was a day ago. The claim is a conditional UPDATE, so two
     * instances can't both open a session (Setu counts each against the consent's
     * frequency).
     */
    @Scheduled(fixedDelay = 15 * 60 * 1000, initialDelay = 5 * 60 * 1000)
    public void tick() {
        if (!setu.isConfigured()) {
            return;
        }
        for (Map<String, Object> row : jdbc.queryForList(
                "SELECT * FROM bank_feed_consents WHERE status IN ('ACTIVE', 'APPROVED', 'PENDING')")) {
            try {
                if ("PENDING".equals(row.get("status"))) {
                    // A consent left unapproved is re-read hourly at most, through the claim.
                    if (claim(row, MANUAL)) refreshConsent(row);
                    continue;
                }
                if (row.get("pending_session") != null) {
                    fetchSession(row);
                } else if (claim(row, DAILY)) {
                    requestSession(row);
                }
            } catch (RuntimeException ex) {
                note(row, ex.getMessage());
                log.info("Bank feed tick for one consent failed: {}", ex.getMessage());
            }
        }
    }

    /* ---- Account deletion ---- */

    /** Never throws: a missing table (migration not run yet) must not hold up an account's purge. */
    public List<String> consentIds(UUID userId) {
        try {
            return jdbc.queryForList("SELECT consent_id FROM bank_feed_consents WHERE user_id = ?", String.class,
                    userId.toString());
        } catch (RuntimeException ex) {
            log.warn("Couldn't read bank consents before a purge: {}", ex.getMessage());
            return List.of();
        }
    }

    /** After a purge: revoke each consent at Setu, best effort (the rows are already gone). */
    public void revokeQuietly(List<String> consentIds) {
        if (!setu.isConfigured()) {
            return;
        }
        for (String id : consentIds) {
            try {
                setu.revoke(id);
            } catch (RuntimeException ex) {
                log.warn("Revoking a deleted account's bank consent failed: {}", ex.getMessage());
            }
        }
    }

    /* ---- Steps ---- */

    private void refreshConsent(Map<String, Object> row) {
        BankFeedClient.Consent c = setu.consent(String.valueOf(row.get("consent_id")));
        String status = c.status().isBlank() ? String.valueOf(row.get("status")) : c.status().toUpperCase(Locale.ROOT);
        ArrayNode accounts = json.createArrayNode();
        for (String[] a : c.accounts()) {
            accounts.addObject().put("mask", tail(a[0])).put("fip", a[1]);
        }
        if (ACTIVE.contains(status) && !ACTIVE.contains(String.valueOf(row.get("status")))) {
            // Just approved: clear the claim so the first fetch is the next tick, not tomorrow's.
            jdbc.update("UPDATE bank_feed_consents SET requested_at = NULL WHERE id = ?", row.get("id"));
        }
        jdbc.update("UPDATE bank_feed_consents SET status = ?, accounts = ?, updated_at = ? WHERE id = ?",
                status, accounts.isEmpty() ? row.get("accounts") : accounts.toString(),
                Timestamp.from(Instant.now()), row.get("id"));
        if (DEAD.contains(status)) {
            jdbc.update("UPDATE bank_feed_consents SET pending_session = NULL WHERE id = ?", row.get("id"));
        }
    }

    private void requestSession(Map<String, Object> row) {
        Instant from = row.get("synced_to") != null ? instant(row.get("synced_to"))
                : ((java.sql.Date) row.get("data_from")).toLocalDate().atStartOfDay(ZoneId.of("UTC")).toInstant();
        Instant to = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        String session = setu.createSession(String.valueOf(row.get("consent_id")), from, to);
        jdbc.update("UPDATE bank_feed_consents SET pending_session = ?, session_to = ?, last_error = NULL, updated_at = ? WHERE id = ?",
                session, Timestamp.from(to), Timestamp.from(Instant.now()), row.get("id"));
    }

    /** Imports what the session holds; the count, or -1 while it is still being prepared. */
    private int fetchSession(Map<String, Object> row) {
        String session = String.valueOf(row.get("pending_session"));
        JsonNode s = setu.session(session);
        String status = s.path("status").asText("").toUpperCase(Locale.ROOT);
        UUID userId = UUID.fromString(String.valueOf(row.get("user_id")));
        Timestamp now = Timestamp.from(Instant.now());
        switch (status) {
            case "COMPLETED", "PARTIAL" -> {
                int n = ledger.importIgnore(userId, rows(s, clock.zoneOf(userId)));
                if ("COMPLETED".equals(status)) {
                    jdbc.update("""
                            UPDATE bank_feed_consents SET pending_session = NULL, synced_to = session_to,
                              last_synced_at = ?, last_error = NULL, updated_at = ? WHERE id = ?""",
                            now, now, row.get("id"));
                } else {
                    jdbc.update("UPDATE bank_feed_consents SET last_synced_at = ?, updated_at = ? WHERE id = ?",
                            now, now, row.get("id"));
                }
                return n;
            }
            case "EXPIRED", "FAILED" -> {
                jdbc.update("UPDATE bank_feed_consents SET pending_session = NULL, last_error = ?, updated_at = ? WHERE id = ?",
                        "The bank didn't send data that time; it will be asked again.", now, row.get("id"));
                return 0;
            }
            default -> {
                return -1;
            }
        }
    }

    /** True when this caller may act now: moves requested_at only if it is older than {@code gap}. */
    private boolean claim(Map<String, Object> row, Duration gap) {
        Timestamp now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE bank_feed_consents SET requested_at = ?
                WHERE id = ? AND (requested_at IS NULL OR requested_at < ?)""",
                now, row.get("id"), Timestamp.from(Instant.now().minus(gap))) == 1;
    }

    private void note(Map<String, Object> row, String error) {
        String e = error == null ? "" : error.length() > 250 ? error.substring(0, 250) : error;
        jdbc.update("UPDATE bank_feed_consents SET last_error = ? WHERE id = ?", e, row.get("id"));
    }

    private List<Map<String, Object>> rows(UUID userId) {
        return jdbc.queryForList("SELECT * FROM bank_feed_consents WHERE user_id = ? ORDER BY created_at",
                userId.toString());
    }

    private ObjectNode view(Map<String, Object> row) {
        ObjectNode v = json.createObjectNode();
        v.put("id", String.valueOf(row.get("id")));
        v.put("status", String.valueOf(row.get("status")));
        try {
            Object a = row.get("accounts");
            v.set("accounts", a == null ? json.createArrayNode() : json.readTree(a.toString()));
        } catch (Exception ex) {
            v.set("accounts", json.createArrayNode());
        }
        v.put("lastSyncedAt", row.get("last_synced_at") == null ? null : instant(row.get("last_synced_at")).toString());
        v.put("syncing", row.get("pending_session") != null);
        v.put("error", row.get("last_error") == null ? null : String.valueOf(row.get("last_error")));
        return v;
    }

    private static Instant instant(Object ts) {
        return ts instanceof Timestamp t ? t.toInstant()
                : ts instanceof java.time.LocalDateTime l ? l.atZone(ZoneId.of("UTC")).toInstant()
                : Instant.parse(ts.toString());
    }

    /** "XXXXXX4373" -> "4373": the four digits a person recognises, nothing more. */
    static String tail(String masked) {
        String digits = masked == null ? "" : masked.replaceAll("\\D", "");
        return digits.length() <= 4 ? digits : digits.substring(digits.length() - 4);
    }

    /* ---- FI data -> ledger rows (pure) ---- */

    /**
     * Every DEBIT and CREDIT in a session's FI data as a ledger row: DEBIT an
     * expense, CREDIT income. The id hashes fip + account link + txnId, so the
     * same transaction always lands on the same row. Dated by when it happened,
     * in the user's zone. The source rides in {@code extra} ("source": "bank"),
     * which the ledger hands back on every read and keeps through edits.
     *
     * <p>ponytail: no own-account transfer detection; moving money between two
     * linked accounts books an expense and an income. Match equal amounts across
     * a consent's accounts within a day if that turns out to be common.
     */
    static List<MoneyLedger.Row> rows(JsonNode session, ZoneId zone) {
        List<MoneyLedger.Row> out = new ArrayList<>();
        for (JsonNode fip : session.path("fips")) {
            String fipId = fip.path("fipID").asText(fip.path("fipId").asText(""));
            for (JsonNode acc : fip.path("accounts")) {
                String link = acc.path("linkRefNumber").asText("");
                String mask = tail(acc.path("maskedAccNumber").asText(""));
                JsonNode txns = acc.path("data").path("account").path("transactions").path("transaction");
                for (JsonNode t : txns.isArray() ? txns : json1(txns)) {
                    MoneyLedger.Row r = row(fipId, link, mask, t, zone);
                    if (r != null) out.add(r);
                }
            }
        }
        return out;
    }

    private static Iterable<JsonNode> json1(JsonNode single) {
        return single.isObject() ? List.of(single) : List.of();
    }

    static MoneyLedger.Row row(String fipId, String link, String mask, JsonNode t, ZoneId zone) {
        String type = t.path("type").asText("").toUpperCase(Locale.ROOT);
        String kind = "DEBIT".equals(type) ? "expense" : "CREDIT".equals(type) ? "income" : null;
        if (kind == null) return null;
        BigDecimal amount;
        try {
            amount = new BigDecimal(t.path("amount").asText("")).abs().setScale(2, java.math.RoundingMode.HALF_UP);
        } catch (NumberFormatException ex) {
            return null;
        }
        if (amount.signum() <= 0) return null;
        LocalDate day = day(t.path("transactionTimestamp").asText(""), zone);
        if (day == null) day = day(t.path("valueDate").asText(""), zone);
        if (day == null) return null;
        String narration = t.path("narration").asText("");
        String txnId = t.path("txnId").asText("");
        if (txnId.isBlank()) {
            // No bank id: what the bank said about it is the next most stable key.
            txnId = t.path("transactionTimestamp").asText("") + "|" + amount + "|" + narration + "|"
                    + t.path("reference").asText("");
        }
        String id = "bank-" + sha256(fipId + "|" + link + "|" + txnId).substring(0, 32);
        String note = merchant(narration);
        String category = "expense".equals(kind) ? category(narration) : income(narration);
        ObjectNode extra = new ObjectMapper().createObjectNode().put("source", "bank");
        if (!mask.isEmpty()) extra.put("bankMask", mask);
        String mode = t.path("mode").asText("");
        if (!mode.isBlank()) extra.put("mode", mode.length() > 16 ? mode.substring(0, 16) : mode);
        return new MoneyLedger.Row(id, kind, null, null, amount, category, note, day, extra.toString());
    }

    private static LocalDate day(String s, ZoneId zone) {
        if (s == null || s.isBlank()) return null;
        try {
            return OffsetDateTime.parse(s).atZoneSameInstant(zone).toLocalDate();
        } catch (Exception ex) {
            try {
                return LocalDate.parse(s.length() >= 10 ? s.substring(0, 10) : s);
            } catch (Exception ex2) {
                return null;
            }
        }
    }

    private static final Set<String> NOISE = Set.of("UPI", "DR", "CR", "P2A", "P2M", "NEFT", "IMPS", "RTGS",
            "POS", "ATM", "ACH", "NACH", "MB", "IB", "INB", "TRF", "TO", "FROM", "BY", "PAYMENT", "TRANSFER");

    /**
     * A readable label from a bank narration: "UPI/DR/457233689286/SWIGGY/YESB/..."
     * -> "Swiggy". The first part that is a word rather than a code, a reference
     * number or a bank's IFSC prefix. ponytail: a heuristic over the common UPI /
     * NEFT / POS shapes; anything odd keeps the narration itself (capped).
     */
    static String merchant(String narration) {
        String n = narration == null ? "" : narration.strip();
        for (String part : n.split("[/|:-]+")) {
            String p = part.strip();
            if (p.length() < 3 || NOISE.contains(p.toUpperCase(Locale.ROOT)) || !p.matches(".*[A-Za-z]{3,}.*")
                    || p.matches("[A-Z]{4}0?[A-Z0-9]*\\d+") || p.matches("[A-Z]{4}") || p.contains("@")) {
                continue;
            }
            String clean = p.replaceAll("\\s+", " ");
            clean = clean.length() > 60 ? clean.substring(0, 60) : clean;
            return clean.equals(clean.toUpperCase(Locale.ROOT))
                    ? clean.substring(0, 1) + clean.substring(1).toLowerCase(Locale.ROOT) : clean;
        }
        return n.length() > 120 ? n.substring(0, 120) : n;
    }

    /**
     * ponytail: a keyword table, the server-side twin of money-core.js's KEYWORDS
     * plus the merchant names that show up in Indian UPI narrations. The user's
     * own re-tag wins forever (INSERT IGNORE never overwrites it); move to the
     * client's history-aware predictor if the misses add up.
     */
    static final Map<String, List<String>> CATEGORY_WORDS = new LinkedHashMap<>();

    static {
        CATEGORY_WORDS.put("food", List.of("swiggy", "zomato", "restaurant", "cafe", "dominos", "mcdonald", "kfc",
                "starbucks", "pizza", "bakery", "bigbasket", "blinkit", "zepto", "instamart", "grocer", "dmart",
                "food", "tea", "coffee", "canteen", "dunzo", "eatfit"));
        CATEGORY_WORDS.put("transport", List.of("uber", "ola", "rapido", "irctc", "metro", "fuel", "petrol",
                "hpcl", "bpcl", "iocl", "indianoil", "fastag", "redbus", "indigo", "airindia", "makemytrip",
                "goibibo", "cab", "parking", "toll"));
        CATEGORY_WORDS.put("shopping", List.of("amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa",
                "tatacliq", "croma", "reliance", "decathlon", "ikea", "lenskart", "mall", "store", "mart"));
        CATEGORY_WORDS.put("entertainment", List.of("netflix", "spotify", "hotstar", "primevideo", "prime video",
                "bookmyshow", "pvr", "inox", "youtube", "steam", "playstation", "sonyliv", "zee5", "jiocinema"));
        CATEGORY_WORDS.put("education", List.of("udemy", "coursera", "byju", "unacademy", "school", "college",
                "university", "tuition", "fees", "academy", "books", "kindle"));
    }

    static String category(String narration) {
        String n = narration == null ? "" : narration.toLowerCase(Locale.ROOT);
        for (Map.Entry<String, List<String>> e : CATEGORY_WORDS.entrySet()) {
            for (String w : e.getValue()) {
                if (Pattern.compile("(?<![a-z])" + Pattern.quote(w) + "(?![a-z])").matcher(n).find()) {
                    return e.getKey();
                }
            }
        }
        return "others";
    }

    static String income(String narration) {
        String n = narration == null ? "" : narration.toUpperCase(Locale.ROOT);
        return n.matches(".*\\b(SAL|SALARY|PAYROLL)\\b.*") ? "salary" : "other";
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
