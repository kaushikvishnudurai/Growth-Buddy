package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Automatic expense capture: payments read from the user's own bank SMS, UPI and
 * bank app notifications, a shared message, or the iPhone Shortcut, booked into
 * the ledger with no typing and no bank linking.
 *
 * <p>The phone reads the message ({@code scripts/bank-msg.js}) and sends only what
 * it found; the iPhone Shortcut sends the text, read here by {@link BankMessageParser}
 * and dropped. No message text is ever stored or logged. What is kept:
 * the ledger row itself (amount, day, payee as its note, the account's last 4
 * digits) and one {@code capture_refs} row per capture: kind, amount, time, last 4,
 * and salted hashes of the payment reference and of the message, which is how a
 * second copy of the same payment is recognised ({@link CaptureDedup}) and how a
 * row the user deleted stays deleted (its ref still points at the gone id).
 *
 * <p>Rows land counted, like any expense. Only a genuinely uncertain one carries
 * {@code capture.review}: {@code check} (nothing ties it to a payment),
 * {@code dup} (the same money as a cash entry typed that day), {@code transfer}
 * (looks like a move between two of the user's accounts). Money shows how many.
 */
@Service
public class CaptureService {

    /** The sources a user switches on; sharing a message is its own consent and is always on. */
    static final Set<String> SOURCES = Set.of("notif", "sms", "ios");
    static final Set<String> VIAS = Set.of("notif", "sms", "ios", "share");
    static final int MAX_ITEMS = 200;
    /** The phone's SMS backfill reaches 90 days; a capture older than this is refused. */
    static final Duration MAX_AGE = Duration.ofDays(120);
    /** capture_refs older than this are forgotten: no re-capture reaches that far back. */
    static final Duration REF_DAYS = Duration.ofDays(180);

    private static final Set<String> CHANNELS = Set.of("upi", "card", "autodebit", "neft", "imps", "rtgs");
    private static final Pattern ORIGIN = Pattern.compile("[A-Za-z0-9._:-]{1,64}");
    private static final Pattern DIGITS = Pattern.compile("[0-9]{3,4}");
    private static final Pattern REF = Pattern.compile("[0-9]{6,20}");
    private static final Pattern HEX = Pattern.compile("[0-9a-f]{16,64}");
    private static final Pattern CATEGORY = Pattern.compile("[a-z0-9_-]{1,40}");
    private static final SecureRandom RANDOM = new SecureRandom();
    static final Pattern CASH_WORD = Pattern.compile("(?i)\\bcash\\b");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final MoneyLedger ledger;
    private final MoneyService money;
    private final RateLimiter limiter;
    Clock clock = Clock.systemUTC();

    public CaptureService(JdbcTemplate jdbc, ObjectMapper json, MoneyLedger ledger, MoneyService money,
                          RateLimiter limiter) {
        this.jdbc = jdbc;
        this.json = json;
        this.ledger = ledger;
        this.money = money;
        this.limiter = limiter;
    }

    /** One payment a source found. {@code at} is when the message arrived. */
    record Item(String via, String origin, String kind, BigDecimal amount, String merchant, String last4,
                String ref, LocalDate date, Instant at, String msgHash, String confidence, String channel,
                String category) {}

    /** {@code ids}: the ledger row each item landed on (new or matched), in order; null for one skipped. */
    record Result(int added, int merged, int review, int skipped, List<String> ids) {
        ObjectNode toJson(ObjectMapper json) {
            ObjectNode o = json.createObjectNode().put("added", added).put("merged", merged).put("review", review)
                    .put("skipped", skipped);
            ids.forEach(o.putArray("ids")::add);
            return o;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Sources                                                             */
    /* ------------------------------------------------------------------ */

    public ObjectNode status(UUID userId) {
        ObjectNode out = json.createObjectNode();
        ObjectNode sources = out.putObject("sources");
        for (String s : SOURCES) {
            sources.putObject(s).put("enabled", false);
        }
        jdbc.query("SELECT source, enabled, token_hash, last_seen_at FROM capture_sources WHERE user_id = ?", rs -> {
            ObjectNode s = sources.putObject(rs.getString("source"));
            s.put("enabled", rs.getBoolean("enabled"));
            Timestamp seen = rs.getTimestamp("last_seen_at");
            s.put("lastSeenAt", seen == null ? null : seen.toInstant().toString());
            if ("ios".equals(rs.getString("source"))) {
                s.put("hasToken", rs.getString("token_hash") != null);
            }
        }, userId.toString());
        out.put("rupees", rupees(userId));
        return out;
    }

    /**
     * Switch a source on or off. Switching the iPhone Shortcut on issues its token,
     * returned once in {@code token} (only its hash is stored); off forgets it, so an
     * old Shortcut stops working at once.
     */
    @Transactional
    public ObjectNode setEnabled(UUID userId, String source, boolean enabled) {
        requireSource(source);
        if (enabled && !rupees(userId)) {
            throw ApiException.badRequest("Automatic capture reads rupee amounts. Set Money's currency to ₹ first.");
        }
        Timestamp now = Timestamp.from(clock.instant());
        jdbc.update("""
                INSERT INTO capture_sources (user_id, source, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), updated_at = VALUES(updated_at)
                """, userId.toString(), source, enabled, now, now);
        String token = null;
        if ("ios".equals(source)) {
            if (enabled) {
                List<String> had = jdbc.queryForList(
                        "SELECT token_hash FROM capture_sources WHERE user_id = ? AND source = 'ios'", String.class,
                        userId.toString());
                if (had.isEmpty() || had.get(0) == null) {
                    token = issueToken(userId);
                }
            } else {
                jdbc.update("UPDATE capture_sources SET token_hash = NULL WHERE user_id = ? AND source = 'ios'",
                        userId.toString());
            }
        }
        ObjectNode out = status(userId);
        if (token != null) {
            out.put("token", token);
        }
        return out;
    }

    /** A new iPhone Shortcut token; the old one stops working. */
    @Transactional
    public String rotateToken(UUID userId) {
        Integer on = jdbc.queryForObject(
                "SELECT COUNT(*) FROM capture_sources WHERE user_id = ? AND source = 'ios' AND enabled = 1",
                Integer.class, userId.toString());
        if (on == null || on == 0) {
            throw ApiException.badRequest("Switch on the iPhone Shortcut first.");
        }
        return issueToken(userId);
    }

    private String issueToken(UUID userId) {
        byte[] b = new byte[32];
        RANDOM.nextBytes(b);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
        jdbc.update("UPDATE capture_sources SET token_hash = ?, updated_at = ? WHERE user_id = ? AND source = 'ios'",
                sha256(token), Timestamp.from(clock.instant()), userId.toString());
        return token;
    }

    /**
     * Turning a source off keeps what it captured; this removes it: every row the
     * source created (tombstoned like any delete, so a sync can't bring it back) and
     * everything it remembered about them. Rows it only matched to an entry the
     * user typed are the user's and stay.
     */
    @Transactional
    public int deleteCaptured(UUID userId, String via) {
        if (!VIAS.contains(via)) {
            throw ApiException.badRequest("Unknown capture source.");
        }
        // The rows this source CREATED (the row's own capture.via), never one another
        // source created that this one only matched: that payment is the other's.
        List<String> live = jdbc.queryForList("""
                SELECT id FROM money_transactions
                WHERE user_id = ? AND id LIKE 'cap-%' AND JSON_UNQUOTE(JSON_EXTRACT(extra, '$.capture.via')) = ?
                """, String.class, userId.toString(), via);
        ledger.apply(userId, List.of(), live);
        jdbc.update("DELETE FROM capture_refs WHERE user_id = ? AND via = ?", userId.toString(), via);
        return live.size();
    }

    /* ------------------------------------------------------------------ */
    /* Ingest                                                              */
    /* ------------------------------------------------------------------ */

    /** The iPhone Shortcut: the message text, authenticated by its token. Unknown token = null. */
    @Transactional
    public Result ingestText(String token, String text) {
        if (token == null || token.isBlank() || token.length() > 100) {
            return null;
        }
        String hash = sha256(token.strip());
        List<String> users = jdbc.queryForList(
                "SELECT user_id FROM capture_sources WHERE token_hash = ? AND source = 'ios' AND enabled = 1",
                String.class, hash);
        if (users.isEmpty()) {
            return null;
        }
        if (!limiter.allow("capture-ios:" + hash, 120, 3_600_000L)) {
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too many messages this hour.");
        }
        UUID userId = UUID.fromString(users.get(0));
        com.growthbuddy.user.FeatureLocks.refuseIfLocked(userId, "money"); // anonymous route: the token's owner decides
        BankMessageParser.Parsed p = BankMessageParser.parse(text);
        if (p == null || !rupees(userId)) {
            return new Result(0, 0, 0, 1, List.of());
        }
        Instant now = clock.instant();
        Item it = new Item("ios", "ios", p.kind(), p.amount(), p.merchant(), p.last4(), p.ref(), p.date(), now,
                sha256(BankMessageParser.clean(text)).substring(0, 32), p.confidence(), p.channel(), null);
        return ingest(userId, List.of(it));
    }

    /** POST /api/capture: what the phone read. Validates, then {@link #ingest}. */
    @Transactional
    public Result ingestFromApp(UUID userId, JsonNode body) {
        JsonNode items = body.path("items");
        if (!items.isArray() || items.size() > MAX_ITEMS) {
            throw ApiException.badRequest("Send up to " + MAX_ITEMS + " captured payments at a time.");
        }
        if (!rupees(userId)) {
            throw ApiException.badRequest("Automatic capture reads rupee amounts. Set Money's currency to ₹ first.");
        }
        Set<String> on = enabledSources(userId);
        List<Item> list = new ArrayList<>();
        Instant now = clock.instant();
        for (JsonNode n : items) {
            String via = n.path("via").asText("");
            if (!"share".equals(via) && SOURCES.contains(via) && !on.contains(via)) {
                continue; // switched off on another device since the phone read it
            }
            // One unreadable item is that item's loss, never its batch's: the phone
            // has already handed the batch over, so a 400 would drop every good
            // payment in it with the bad one. It counts as skipped, its id null.
            try {
                if (!VIAS.contains(via) || "ios".equals(via)) {
                    throw ApiException.badRequest("Unknown capture source.");
                }
                list.add(item(n, via, now));
            } catch (ApiException | ArithmeticException ex) {
                list.add(null);
            }
        }
        return ingest(userId, list);
    }

    private Item item(JsonNode n, String via, Instant now) {
        String kind = n.path("kind").asText("");
        if (!kind.equals("debit") && !kind.equals("credit")) {
            throw ApiException.badRequest("A captured payment is a debit or a credit.");
        }
        BigDecimal amount;
        try {
            BigDecimal raw = new BigDecimal(n.path("amount").asText());
            // Shape before setScale, as MoneyLedger.amount does: "1e99999999" made setScale
            // build a hundred-million-digit number, "1e-999999999" threw ArithmeticException.
            if (raw.precision() - raw.scale() > 13 || raw.scale() > 32) {
                throw ApiException.badRequest("A captured amount is out of range.");
            }
            amount = raw.setScale(2, java.math.RoundingMode.HALF_UP);
        } catch (NumberFormatException | ArithmeticException ex) {
            throw ApiException.badRequest("A captured payment needs an amount.");
        }
        BigDecimal cap = kind.equals("debit") ? MoneyLedger.EXPENSE_MAX : new BigDecimal("1000000000");
        if (amount.signum() <= 0 || amount.compareTo(cap) > 0) {
            throw ApiException.badRequest("A captured amount is out of range.");
        }
        long ms = n.path("at").asLong(-1);
        Instant at = Instant.ofEpochMilli(Math.max(0, ms));
        if (ms <= 0 || at.isAfter(now.plus(Duration.ofMinutes(10)))
                || at.isBefore(now.minus(MAX_AGE))) {
            throw ApiException.badRequest("A captured payment needs the time it arrived, within the last 120 days.");
        }
        LocalDate date = null;
        if (n.hasNonNull("date")) {
            try {
                date = LocalDate.parse(n.get("date").asText());
            } catch (java.time.format.DateTimeParseException ex) {
                date = null;
            }
        }
        String origin = optional(n, "origin", ORIGIN);
        return new Item(via, origin == null ? via : origin, kind, amount, merchant(n.path("merchant").asText(null)),
                optional(n, "last4", DIGITS), optional(n, "ref", REF), date, at, optional(n, "msgHash", HEX),
                "low".equals(n.path("confidence").asText()) ? "low" : "high",
                CHANNELS.contains(n.path("channel").asText()) ? n.path("channel").asText() : null,
                optional(n, "category", CATEGORY));
    }

    /**
     * Each item in turn, under a lock on the user's row, so two devices (or the SMS
     * and the notification of one payment, a second apart) can't both decide the
     * payment is new. A null item is one that failed validation: skipped.
     */
    @Transactional
    Result ingest(UUID userId, List<Item> items) {
        if (items.stream().allMatch(java.util.Objects::isNull)) {
            if (!items.isEmpty()) {
                return new Result(0, 0, 0, items.size(), java.util.Collections.nCopies(items.size(), null));
            }
            return new Result(0, 0, 0, 0, List.of());
        }
        jdbc.queryForList("SELECT id FROM users WHERE id = ? FOR UPDATE", String.class, userId.toString());
        Instant now = clock.instant();
        jdbc.update("DELETE FROM capture_refs WHERE user_id = ? AND seen_at < ?", userId.toString(),
                Timestamp.from(now.minus(REF_DAYS)));
        ZoneId zone = ledger.zoneOf(userId);
        JsonNode accounts = ledger.accounts(userId);
        int added = 0;
        int merged = 0;
        int review = 0;
        int skipped = 0;
        Set<String> vias = new HashSet<>();
        List<String> landed = new ArrayList<>();
        // A backfill sends hundreds of one day's payments under the lock; the typed rows
        // a capture claimed are read once per day and kept current here.
        java.util.Map<LocalDate, Set<String>> claimedByDay = new java.util.HashMap<>();
        for (Item it : items) {
            if (it == null) {
                skipped++;
                landed.add(null);
                continue;
            }
            vias.add(it.via());
            String kind = "debit".equals(it.kind()) ? "expense" : "income";
            LocalDate atDay = it.at().atZone(zone).toLocalDate();
            // The day the text names (a credit texted the next morning), if it's recent.
            LocalDate day = it.date() != null && !it.date().isAfter(atDay) && !it.date().isBefore(atDay.minusDays(7))
                    ? it.date() : atDay;
            String refHash = it.ref() == null ? null : salted(userId, "ref", it.ref());
            String msgHash = it.msgHash() == null ? null : salted(userId, "msg", it.msgHash());
            CaptureDedup.Seen in = new CaptureDedup.Seen(null, kind, it.amount(), it.at(), it.last4(), refHash, msgHash,
                    it.origin());
            List<CaptureDedup.Seen> seen = seenNear(userId, it.amount(), it.at());

            CaptureDedup.Seen same = CaptureDedup.samePayment(in, seen);
            if (same != null) {
                remember(userId, same.txId(), in, it.via(), now);
                if (rowExists(userId, same.txId())) {
                    merged++;
                    landed.add(same.txId());
                } else {
                    skipped++; // the user deleted that payment: it stays deleted
                    landed.add(null);
                }
                continue;
            }
            Set<String> claimedToday = claimedByDay.computeIfAbsent(day, d -> claimed(userId, d));
            CaptureDedup.Manual typed = CaptureDedup.manualMatch(kind, it.amount(), day, typedOn(userId, day, kind,
                    it.amount()), claimedToday);
            if (typed != null && !"cash".equals(typed.accountKind())) {
                claimedToday.add(typed.id());
                remember(userId, typed.id(), in, it.via(), now);
                merged++;
                landed.add(typed.id());
                continue;
            }
            CaptureDedup.Seen twin = CaptureDedup.transferTwin(in, seen);
            String reason = typed != null ? "dup" : "low".equals(it.confidence()) ? "check" : twin != null ? "transfer" : null;
            // The kind is in every id: a refund quoting the payment's own UPI reference is a
            // second row (money in), not the payment's id again, which importIgnore would drop.
            String id = "cap-" + salted(userId, "id", kind + "|" + (refHash != null ? refHash
                    : msgHash != null ? msgHash + "|" + it.at().toEpochMilli()
                    : it.amount().toPlainString() + "|" + it.origin() + "|" + it.at().toEpochMilli()));
            ObjectNode row = row(id, kind, it, day, accounts, reason,
                    typed != null ? typed.id() : twin != null ? twin.txId() : null);
            int n = ledger.importIgnore(userId, List.of(ledger.toRow(kind, row)));
            remember(userId, id, in, it.via(), now);
            if (n > 0) {
                added++;
                if (reason != null) review++;
                landed.add(id);
            } else {
                skipped++; // deleted by the user before (a tombstone), or already there
                landed.add(null);
            }
        }
        for (String via : vias) {
            jdbc.update("UPDATE capture_sources SET last_seen_at = ? WHERE user_id = ? AND source = ?",
                    Timestamp.from(now), userId.toString(), via);
        }
        return new Result(added, merged, review, skipped, landed);
    }

    private ObjectNode row(String id, String kind, Item it, LocalDate day, JsonNode accounts, String reason, String other) {
        ObjectNode o = json.createObjectNode();
        o.put("id", id).put("amount", it.amount()).put("date", day.toString())
                .put("createdAt", it.at().toEpochMilli());
        String account = accountFor(accounts, kind, it.channel());
        if (account != null) o.put("accountId", account);
        if ("expense".equals(kind)) {
            o.put("category", it.category() != null ? it.category() : BankFeedService.category(it.merchant()));
            o.put("note", it.merchant() != null ? it.merchant() : defaultNote(it.channel()));
        } else {
            o.put("source", BankFeedService.income(it.merchant()));
            o.put("label", it.merchant() != null ? "From " + it.merchant() : "Money received");
        }
        ObjectNode cap = o.putObject("capture").put("via", it.via());
        if (reason != null) cap.put("review", reason);
        if (other != null) cap.put("dupOf", other);
        if (it.last4() != null) o.put("bankMask", it.last4());
        if (it.channel() != null) o.put("mode", it.channel());
        return o;
    }

    static String defaultNote(String channel) {
        if (channel == null) return "Bank payment";
        return switch (channel) {
            case "upi" -> "UPI payment";
            case "card" -> "Card payment";
            case "autodebit" -> "Auto-debit";
            default -> "Bank payment";
        };
    }

    /** A card spend books to the first card account, anything else to the first bank, then wallet. */
    static String accountFor(JsonNode accounts, String kind, String channel) {
        List<String> order = "expense".equals(kind) && "card".equals(channel)
                ? List.of("card", "bank", "wallet") : List.of("bank", "wallet");
        for (String k : order) {
            for (JsonNode a : accounts) {
                if (!a.path("archived").asBoolean(false) && k.equals(a.path("kind").asText())) {
                    return a.path("id").asText();
                }
            }
        }
        return null;
    }

    private List<CaptureDedup.Seen> seenNear(UUID userId, BigDecimal amount, Instant at) {
        return jdbc.query("""
                SELECT tx_id, kind, amount, seen_at, last4, ref_hash, msg_hash, origin FROM capture_refs
                WHERE user_id = ? AND amount = ? AND seen_at BETWEEN ? AND ?
                """, (rs, i) -> new CaptureDedup.Seen(rs.getString("tx_id"), rs.getString("kind"),
                        rs.getBigDecimal("amount"), rs.getTimestamp("seen_at").toInstant(), rs.getString("last4"),
                        rs.getString("ref_hash"), rs.getString("msg_hash"), rs.getString("origin")),
                userId.toString(), amount, Timestamp.from(at.minus(Duration.ofHours(36))),
                Timestamp.from(at.plus(Duration.ofHours(36))));
    }

    /** That day's rows of that kind and amount that no capture created, with their account's kind. */
    private List<CaptureDedup.Manual> typedOn(UUID userId, LocalDate day, String kind, BigDecimal amount) {
        return jdbc.query("""
                SELECT t.id, t.kind, t.amount, t.occurred_on, a.kind AS account_kind
                FROM money_transactions t
                LEFT JOIN money_accounts a ON a.user_id = t.user_id AND a.id = t.account_id
                WHERE t.user_id = ? AND t.occurred_on = ? AND t.kind = ? AND t.amount = ?
                  AND (t.extra IS NULL OR JSON_EXTRACT(t.extra, '$.capture') IS NULL)
                ORDER BY t.created_at
                """, (rs, i) -> new CaptureDedup.Manual(rs.getString("id"), rs.getString("kind"),
                        rs.getBigDecimal("amount"), rs.getDate("occurred_on").toLocalDate(),
                        rs.getString("account_kind")),
                userId.toString(), java.sql.Date.valueOf(day), kind, amount);
    }

    private boolean rowExists(UUID userId, String id) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM money_transactions WHERE user_id = ? AND id = ?",
                Integer.class, userId.toString(), id);
        return n != null && n > 0;
    }

    /** Typed rows of that day a capture already claimed: each stands for one payment only. */
    private Set<String> claimed(UUID userId, LocalDate day) {
        return new HashSet<>(jdbc.queryForList("""
                SELECT DISTINCT r.tx_id FROM capture_refs r
                JOIN money_transactions t ON t.user_id = r.user_id AND t.id = r.tx_id
                WHERE r.user_id = ? AND t.occurred_on = ?
                """, String.class, userId.toString(), java.sql.Date.valueOf(day)));
    }

    private void remember(UUID userId, String txId, CaptureDedup.Seen in, String via, Instant now) {
        jdbc.update("""
                INSERT INTO capture_refs (user_id, tx_id, kind, amount, seen_at, last4, ref_hash, msg_hash, via, origin, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, userId.toString(), txId, in.kind(), in.amount(), Timestamp.from(in.at()), in.last4(), in.refHash(),
                in.msgHash(), via, in.origin(), Timestamp.from(now));
    }

    /* ------------------------------------------------------------------ */
    /* Typed entries that fix a captured row                               */
    /* ------------------------------------------------------------------ */

    /**
     * A WhatsApp sentence ("200 at chai point") for a payment capture already
     * booked: the captured row takes the words as its note and leaves review,
     * instead of a second row appearing. Same kind and amount on that day, not
     * claimed by an earlier sentence. Returns the row's id, or null (book a new one).
     */
    @Transactional
    public String claimForTyped(UUID userId, String kind, BigDecimal amount, LocalDate day, String words) {
        // "200 cash auto" is a cash payment, not the card or UPI one capture read
        // (manualMatch refuses the same pairing from the other side).
        if (words != null && CASH_WORD.matcher(words).find()) {
            return null;
        }
        List<java.util.Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, extra FROM money_transactions
                WHERE user_id = ? AND occurred_on = ? AND kind = ? AND amount = ?
                  AND JSON_EXTRACT(extra, '$.capture') IS NOT NULL
                ORDER BY created_at DESC
                """, userId.toString(), java.sql.Date.valueOf(day), kind, amount.setScale(2, java.math.RoundingMode.HALF_UP));
        for (java.util.Map<String, Object> r : rows) {
            ObjectNode extra;
            try {
                extra = (ObjectNode) json.readTree(String.valueOf(r.get("extra")));
            } catch (Exception ex) {
                continue;
            }
            ObjectNode cap = (ObjectNode) extra.path("capture");
            if (cap.path("typed").asBoolean(false)) {
                continue;
            }
            cap.put("typed", true);
            cap.remove("review");
            cap.remove("dupOf");
            String note = words == null || words.isBlank() ? null : words.strip();
            if (note != null && note.length() > 255) note = note.substring(0, 255);
            jdbc.update("""
                    UPDATE money_transactions SET extra = ?, note = COALESCE(?, note), updated_at = ?
                    WHERE user_id = ? AND id = ?
                    """, extra.toString(), note, Timestamp.from(clock.instant()), userId.toString(), r.get("id"));
            return String.valueOf(r.get("id"));
        }
        return null;
    }

    /* ------------------------------------------------------------------ */

    private Set<String> enabledSources(UUID userId) {
        return new HashSet<>(jdbc.queryForList(
                "SELECT source FROM capture_sources WHERE user_id = ? AND enabled = 1", String.class, userId.toString()));
    }

    private boolean rupees(UUID userId) {
        return "₹".equals(money.currencyOf(userId));
    }

    private static void requireSource(String source) {
        if (!SOURCES.contains(source)) {
            throw ApiException.badRequest("Unknown capture source.");
        }
    }

    private static String optional(JsonNode n, String key, Pattern shape) {
        String v = n.hasNonNull(key) ? n.get(key).asText().strip() : null;
        return v != null && shape.matcher(v).matches() ? v : null;
    }

    private static String merchant(String raw) {
        if (raw == null) return null;
        String s = raw.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").strip();
        if (s.isEmpty()) return null;
        if (s.length() <= 40) return s;
        // At a word break, so a long payee reads "A very long merchant name…", not "…goes on a".
        int cut = s.lastIndexOf(' ', 39);
        return (cut >= 20 ? s.substring(0, cut) : s.substring(0, 39)).strip() + "\u2026";
    }

    /** Per-user salt: the same reference in two accounts never hashes alike. */
    static String salted(UUID userId, String what, String value) {
        return sha256(userId + "|" + what + "|" + value).substring(0, 32);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
