package com.growthbuddy.money;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * Accounts (cash, bank, card, wallet) and every expense, income and transfer, as
 * rows. These used to be arrays inside the money_state document; everything else
 * Money keeps (budgets, goals, subscriptions…) is small and stays there.
 *
 * <p>The client still thinks in the document's shapes — an expense is
 * {@code {id, amount, category, note, date, …}} — so this class is the one place
 * that translates. Fields it has no column for ride in {@code extra} JSON, so a
 * round trip loses nothing a newer client adds.
 *
 * <p>JdbcTemplate, not JPA: writes are batched upserts keyed on the client's id,
 * which is what makes a retried save land once.
 */
@Service
public class MoneyLedger {

    /** The document arrays this class owns, and the row kind each maps to. */
    static final Map<String, String> ARRAYS =
            Map.of("expenses", "expense", "income", "income", "transfers", "transfer");

    static final Set<String> KINDS = Set.of("cash", "bank", "card", "wallet");

    /**
     * How far back a load reaches. Every month-scoped insight reads at most the
     * last ~13 months, and a load of all history is what stopped scaling.
     * ponytail: fixed window; page further back on demand if a screen ever needs it.
     */
    static final int WINDOW_DAYS = 400;

    private static final BigDecimal MAX_AMOUNT = new BigDecimal("1000000000");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public MoneyLedger(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    /* ------------------------------------------------------------------ */
    /* Accounts                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * The user's accounts with live balances.
     */
    /**
     * Cash and Bank, for someone with no accounts yet. MoneyService calls it once
     * per user (remembered in settings). The count check matters for users who
     * already have accounts: a renamed "Bank" would otherwise get a second one.
     */
    public void seedDefaults(UUID userId) {
        Integer n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM money_accounts WHERE user_id = ?", Integer.class, userId.toString());
        if (n != null && n == 0) {
            insertAccountIgnore(userId, "Cash", "cash", 0);
            insertAccountIgnore(userId, "Bank", "bank", 1);
        }
    }

    public ArrayNode accounts(UUID userId) {
        ArrayNode out = json.createArrayNode();
        // balance = opening + income − expenses − transfers out + transfers in. Each
        // subquery is a range scan on (user_id, account_id) — no running total
        // column that a crashed write could leave wrong.
        jdbc.query("""
                SELECT a.id, a.name, a.kind, a.opening_balance, a.archived,
                  a.opening_balance
                  + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
                              FROM money_transactions t
                              WHERE t.user_id = a.user_id AND t.account_id = a.id), 0)
                  + COALESCE((SELECT SUM(t.amount) FROM money_transactions t
                              WHERE t.user_id = a.user_id AND t.to_account_id = a.id
                                AND t.kind = 'transfer'), 0) AS balance
                FROM money_accounts a
                WHERE a.user_id = ?
                ORDER BY a.position, a.created_at
                """, rs -> {
            ObjectNode a = out.addObject();
            a.put("id", rs.getString("id"));
            a.put("name", rs.getString("name"));
            a.put("kind", rs.getString("kind"));
            a.put("openingBalance", rs.getBigDecimal("opening_balance"));
            a.put("balance", rs.getBigDecimal("balance"));
            a.put("archived", rs.getBoolean("archived"));
        }, userId.toString());
        return out;
    }

    private void insertAccountIgnore(UUID userId, String name, String kind, int position) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT IGNORE INTO money_accounts
                  (id, user_id, name, kind, opening_balance, position, archived, created_at, updated_at)
                VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)
                """, UUID.randomUUID().toString(), userId.toString(), name, kind, position, now, now);
    }

    @Transactional
    public ArrayNode createAccount(UUID userId, String name, String kind, BigDecimal balanceNow) {
        String n = accountName(name);
        String k = accountKind(kind);
        Integer pos = jdbc.queryForObject(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM money_accounts WHERE user_id = ?",
                Integer.class, userId.toString());
        Timestamp now = Timestamp.from(Instant.now());
        try {
            jdbc.update("""
                    INSERT INTO money_accounts
                      (id, user_id, name, kind, opening_balance, position, archived, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """, UUID.randomUUID().toString(), userId.toString(), n, k,
                    amount(balanceNow == null ? BigDecimal.ZERO : balanceNow, true), pos, now, now);
        } catch (org.springframework.dao.DuplicateKeyException ex) {
            // Removing an account with history archives it, and its name stays taken.
            // Adding it again means "bring it back", not "you already have one".
            int revived = jdbc.update("""
                    UPDATE money_accounts SET archived = 0, updated_at = ?
                    WHERE user_id = ? AND name = ? AND archived = 1
                    """, now, userId.toString(), n);
            if (revived == 0) {
                throw ApiException.badRequest("You already have an account called " + n + ".");
            }
        }
        return accounts(userId);
    }

    /**
     * Rename, re-kind, archive, or say what the balance really is right now.
     * "It's actually 1,850" moves the opening balance by the difference, so the
     * history stays as logged and the balance matches the purse.
     */
    @Transactional
    public ArrayNode updateAccount(UUID userId, String accountId, JsonNode body) {
        requireAccount(userId, accountId);
        Timestamp now = Timestamp.from(Instant.now());
        try {
            if (body.hasNonNull("name")) {
                jdbc.update("UPDATE money_accounts SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                        accountName(body.get("name").asText()), now, accountId, userId.toString());
            }
        } catch (org.springframework.dao.DuplicateKeyException ex) {
            throw ApiException.badRequest("You already have an account with that name.");
        }
        if (body.hasNonNull("kind")) {
            jdbc.update("UPDATE money_accounts SET kind = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                    accountKind(body.get("kind").asText()), now, accountId, userId.toString());
        }
        if (body.hasNonNull("archived")) {
            jdbc.update("UPDATE money_accounts SET archived = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                    body.get("archived").asBoolean(), now, accountId, userId.toString());
        }
        if (body.hasNonNull("balance")) {
            BigDecimal target;
            try {
                target = amount(new BigDecimal(body.get("balance").asText()), true);
            } catch (NumberFormatException ex) {
                throw ApiException.badRequest("Enter the balance as a number.");
            }
            BigDecimal current = balanceOf(userId, accountId);
            jdbc.update("""
                    UPDATE money_accounts SET opening_balance = opening_balance + ?, updated_at = ?
                    WHERE id = ? AND user_id = ?
                    """, target.subtract(current), now, accountId, userId.toString());
        }
        return accounts(userId);
    }

    /**
     * An account with history is archived, not deleted: its expenses would lose
     * the "paid from" they were logged with. An empty one simply goes.
     */
    @Transactional
    public ArrayNode deleteAccount(UUID userId, String accountId) {
        requireAccount(userId, accountId);
        Integer used = jdbc.queryForObject("""
                SELECT COUNT(*) FROM money_transactions
                WHERE user_id = ? AND (account_id = ? OR to_account_id = ?)
                """, Integer.class, userId.toString(), accountId, accountId);
        if (used != null && used > 0) {
            jdbc.update("UPDATE money_accounts SET archived = 1, updated_at = ? WHERE id = ? AND user_id = ?",
                    Timestamp.from(Instant.now()), accountId, userId.toString());
        } else {
            jdbc.update("DELETE FROM money_accounts WHERE id = ? AND user_id = ?", accountId, userId.toString());
        }
        return accounts(userId);
    }

    private BigDecimal balanceOf(UUID userId, String accountId) {
        for (JsonNode a : accounts(userId)) {
            if (accountId.equals(a.path("id").asText())) {
                return a.path("balance").decimalValue();
            }
        }
        throw ApiException.notFound("Account not found");
    }

    private void requireAccount(UUID userId, String accountId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM money_accounts WHERE id = ? AND user_id = ?",
                Integer.class, accountId, userId.toString());
        if (n == null || n == 0) {
            throw ApiException.notFound("Account not found");
        }
    }

    /** The account a bill is most likely paid from: the first bank or card one. */
    public String defaultBillAccount(UUID userId) {
        List<String> ids = jdbc.queryForList("""
                SELECT id FROM money_accounts
                WHERE user_id = ? AND archived = 0 AND kind IN ('bank', 'card')
                ORDER BY position LIMIT 1
                """, String.class, userId.toString());
        return ids.isEmpty() ? null : ids.get(0);
    }

    private Set<String> accountIds(UUID userId) {
        return new HashSet<>(jdbc.queryForList(
                "SELECT id FROM money_accounts WHERE user_id = ?", String.class, userId.toString()));
    }

    static String accountName(String raw) {
        String n = raw == null ? "" : raw.strip();
        if (n.isEmpty() || n.length() > 40) {
            throw ApiException.badRequest("Give the account a name of up to 40 characters.");
        }
        return n;
    }

    static String accountKind(String raw) {
        if (raw == null || !KINDS.contains(raw)) {
            throw ApiException.badRequest("Account type must be cash, bank, card or wallet.");
        }
        return raw;
    }

    /* ------------------------------------------------------------------ */
    /* Transactions                                                        */
    /* ------------------------------------------------------------------ */

    /** The document arrays, rebuilt from rows, for the last {@link #WINDOW_DAYS} days. */
    public ObjectNode load(UUID userId, LocalDate today) {
        ObjectNode out = json.createObjectNode();
        for (String arr : ARRAYS.keySet()) {
            out.putArray(arr);
        }
        jdbc.query("""
                SELECT id, kind, account_id, to_account_id, amount, category, note, occurred_on, extra
                FROM money_transactions
                WHERE user_id = ? AND occurred_on >= ?
                ORDER BY occurred_on DESC, created_at DESC
                """, rs -> {
            ObjectNode item = toItem(rs.getString("kind"), rs.getString("id"), rs.getString("account_id"),
                    rs.getString("to_account_id"), rs.getBigDecimal("amount"), rs.getString("category"),
                    rs.getString("note"), rs.getDate("occurred_on").toLocalDate(), rs.getString("extra"));
            String arr = arrayOf(rs.getString("kind"));
            if (arr != null) {
                ((ArrayNode) out.get(arr)).add(item);
            }
        }, userId.toString(), Date.valueOf(today.minusDays(WINDOW_DAYS)));
        return out;
    }

    /** One day's expenses, for the day summary. */
    public List<ObjectNode> expensesOn(UUID userId, LocalDate day) {
        List<ObjectNode> out = new ArrayList<>();
        jdbc.query("""
                SELECT id, kind, account_id, to_account_id, amount, category, note, occurred_on, extra
                FROM money_transactions
                WHERE user_id = ? AND occurred_on = ? AND kind = 'expense'
                ORDER BY amount DESC
                """, rs -> {
            out.add(toItem(rs.getString("kind"), rs.getString("id"), rs.getString("account_id"),
                    rs.getString("to_account_id"), rs.getBigDecimal("amount"), rs.getString("category"),
                    rs.getString("note"), rs.getDate("occurred_on").toLocalDate(), rs.getString("extra")));
        }, userId.toString(), Date.valueOf(day));
        return out;
    }

    /** A validated row, ready to write. */
    record Row(String id, String kind, String accountId, String toAccountId, BigDecimal amount,
               String category, String note, LocalDate day, String extra) {}

    /**
     * Upserts and deletes in one transaction, then drops the cached summary of
     * every day they touched — including the day an edited expense moved away from.
     * An account id the user does not own is cleared rather than trusted.
     */
    @Transactional
    public void apply(UUID userId, List<Row> upserts, Collection<String> deletes) {
        if (upserts.isEmpty() && deletes.isEmpty()) {
            return;
        }
        Set<String> owned = accountIds(userId);
        Set<LocalDate> days = new HashSet<>();
        List<String> touched = new ArrayList<>(deletes);
        upserts.forEach(r -> touched.add(r.id()));
        days.addAll(existingDays(userId, touched));

        Timestamp now = Timestamp.from(Instant.now());
        List<Object[]> batch = new ArrayList<>();
        for (Row r : upserts) {
            days.add(r.day());
            batch.add(new Object[] {
                userId.toString(), r.id(), r.kind(),
                owned.contains(r.accountId()) ? r.accountId() : null,
                owned.contains(r.toAccountId()) ? r.toAccountId() : null,
                r.amount(), r.category(), r.note(), Date.valueOf(r.day()), r.extra(), now, now,
            });
        }
        if (!batch.isEmpty()) {
            jdbc.batchUpdate("""
                    INSERT INTO money_transactions
                      (user_id, id, kind, account_id, to_account_id, amount, category, note,
                       occurred_on, extra, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                      kind = VALUES(kind), account_id = VALUES(account_id),
                      to_account_id = VALUES(to_account_id), amount = VALUES(amount),
                      category = VALUES(category), note = VALUES(note),
                      occurred_on = VALUES(occurred_on), extra = VALUES(extra),
                      updated_at = VALUES(updated_at)
                    """, batch);
        }
        for (List<String> chunk : chunks(new ArrayList<>(deletes))) {
            jdbc.update("DELETE FROM money_transactions WHERE user_id = ? AND id IN ("
                    + placeholders(chunk.size()) + ")", prepend(userId.toString(), chunk));
        }
        forgetSummaries(userId, days);
    }

    /** Old document entries moved in once: an id already in the table is left alone. */
    @Transactional
    public int importIgnore(UUID userId, List<Row> rows) {
        if (rows.isEmpty()) {
            return 0;
        }
        Set<String> owned = accountIds(userId);
        Timestamp now = Timestamp.from(Instant.now());
        List<Object[]> batch = new ArrayList<>();
        Set<LocalDate> days = new HashSet<>();
        for (Row r : rows) {
            days.add(r.day());
            batch.add(new Object[] {
                userId.toString(), r.id(), r.kind(),
                owned.contains(r.accountId()) ? r.accountId() : null,
                owned.contains(r.toAccountId()) ? r.toAccountId() : null,
                r.amount(), r.category(), r.note(), Date.valueOf(r.day()), r.extra(), now, now,
            });
        }
        int[][] done = jdbc.batchUpdate("""
                INSERT IGNORE INTO money_transactions
                  (user_id, id, kind, account_id, to_account_id, amount, category, note,
                   occurred_on, extra, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch, 500, (ps, row) -> {
                    for (int i = 0; i < row.length; i++) {
                        ps.setObject(i + 1, row[i]);
                    }
                });
        forgetSummaries(userId, days);
        int n = 0;
        for (int[] c : done) {
            for (int x : c) {
                n += Math.max(0, x);
            }
        }
        return n;
    }

    private Set<LocalDate> existingDays(UUID userId, List<String> ids) {
        Set<LocalDate> out = new HashSet<>();
        for (List<String> chunk : chunks(ids)) {
            jdbc.query("SELECT occurred_on FROM money_transactions WHERE user_id = ? AND id IN ("
                    + placeholders(chunk.size()) + ")",
                    rs -> {
                        out.add(rs.getDate(1).toLocalDate());
                    }, prepend(userId.toString(), chunk));
        }
        return out;
    }

    private void forgetSummaries(UUID userId, Set<LocalDate> days) {
        if (days.isEmpty()) {
            return;
        }
        List<Object> args = new ArrayList<>();
        args.add(userId.toString());
        days.forEach(d -> args.add(Date.valueOf(d)));
        jdbc.update("DELETE FROM money_day_summaries WHERE user_id = ? AND day IN ("
                + placeholders(days.size()) + ")", args.toArray());
    }

    /* ------------------------------------------------------------------ */
    /* Document ↔ row                                                      */
    /* ------------------------------------------------------------------ */

    static String arrayOf(String kind) {
        for (Map.Entry<String, String> e : ARRAYS.entrySet()) {
            if (e.getValue().equals(kind)) {
                return e.getKey();
            }
        }
        return null;
    }

    /**
     * A client item → a row. Strict: a save the client thinks landed must land
     * whole, so a bad field is a 400 naming it rather than a silently dropped row.
     */
    Row toRow(String kind, JsonNode item) {
        if (!(item instanceof ObjectNode o)) {
            throw ApiException.badRequest("Each entry must be an object.");
        }
        ObjectNode rest = o.deepCopy();
        String id = text(rest.remove("id"));
        if (!StringUtils.hasText(id) || id.length() > 64) {
            throw ApiException.badRequest("Each entry needs an id of up to 64 characters.");
        }
        BigDecimal amt;
        try {
            amt = amount(new BigDecimal(text(rest.remove("amount"))), false);
        } catch (NumberFormatException | NullPointerException ex) {
            throw ApiException.badRequest("Entry " + id + " has no valid amount.");
        }
        LocalDate day;
        try {
            day = LocalDate.parse(text(rest.remove("date")));
        } catch (DateTimeParseException | NullPointerException ex) {
            throw ApiException.badRequest("Entry " + id + " has no valid date.");
        }
        String account;
        String toAccount = null;
        String category;
        String note;
        switch (kind) {
            case "expense" -> {
                account = text(rest.remove("accountId"));
                category = text(rest.remove("category"));
                note = text(rest.remove("note"));
            }
            case "income" -> {
                account = text(rest.remove("accountId"));
                category = text(rest.remove("source"));
                note = text(rest.remove("label"));
            }
            case "transfer" -> {
                account = text(rest.remove("from"));
                toAccount = text(rest.remove("to"));
                category = null;
                note = text(rest.remove("note"));
                if (account == null || toAccount == null || account.equals(toAccount)) {
                    throw ApiException.badRequest("A transfer moves money between two different accounts.");
                }
            }
            default -> throw ApiException.badRequest("Unknown entry kind " + kind + ".");
        }
        return new Row(id, kind, account, toAccount, amt, cut(category, 40), cut(note, 255), day,
                rest.isEmpty() ? null : rest.toString());
    }

    /**
     * Legacy document entries: the same mapping, repaired first, because whatever
     * is not turned into a row here is gone once the arrays are stripped. A missing
     * date comes from createdAt (else today); a missing id becomes a stable one
     * derived from the entry. Only an entry with no usable amount is dropped.
     */
    List<Row> rowsFromDoc(ObjectNode doc) {
        List<Row> out = new ArrayList<>();
        for (Map.Entry<String, String> e : ARRAYS.entrySet()) {
            JsonNode arr = doc.get(e.getKey());
            if (arr == null || !arr.isArray()) {
                continue;
            }
            for (JsonNode raw : arr) {
                if (!(raw instanceof ObjectNode rawObj)) {
                    continue;
                }
                ObjectNode item = rawObj.deepCopy();
                if (!item.hasNonNull("date") || item.path("date").asText().isBlank()) {
                    long ms = item.path("createdAt").asLong(0);
                    item.put("date", (ms > 0
                            ? java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                            : LocalDate.now()).toString());
                }
                if (!item.hasNonNull("id") || item.path("id").asText().isBlank()
                        || item.path("id").asText().length() > 64) {
                    item.put("id", "legacy-" + UUID.nameUUIDFromBytes(
                            rawObj.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }
                try {
                    out.add(toRow(e.getValue(), item));
                } catch (ApiException ex) {
                    // An entry the old document let through (no date, text amount) is
                    // not worth failing everyone's migration over.
                }
            }
        }
        return out;
    }

    ObjectNode toItem(String kind, String id, String accountId, String toAccountId, BigDecimal amount,
                      String category, String note, LocalDate day, String extra) {
        ObjectNode o = json.createObjectNode();
        if (extra != null) {
            try {
                JsonNode x = json.readTree(extra);
                if (x instanceof ObjectNode xo) {
                    o.setAll(xo);
                }
            } catch (Exception ignored) {
                // A corrupt extra loses its extras, not the entry.
            }
        }
        o.put("id", id);
        // Whole rupees stay integers on the wire, so the client's === comparisons
        // and its diff against the last load see the same value it saved.
        BigDecimal a = amount.stripTrailingZeros();
        if (a.scale() <= 0) {
            o.put("amount", a.longValueExact());
        } else {
            o.put("amount", a);
        }
        o.put("date", day.toString());
        switch (kind) {
            case "expense" -> {
                putIf(o, "category", category);
                putIf(o, "note", note);
                putIf(o, "accountId", accountId);
            }
            case "income" -> {
                putIf(o, "source", category);
                putIf(o, "label", note);
                putIf(o, "accountId", accountId);
            }
            case "transfer" -> {
                putIf(o, "from", accountId);
                putIf(o, "to", toAccountId);
                putIf(o, "note", note);
            }
            default -> { }
        }
        return o;
    }

    /** Strips the ledger's arrays out of a document; true if there were any to move. */
    static boolean stripArrays(ObjectNode doc) {
        boolean had = false;
        for (Iterator<String> it = ARRAYS.keySet().iterator(); it.hasNext(); ) {
            String k = it.next();
            JsonNode v = doc.remove(k);
            had |= v != null && v.isArray() && !v.isEmpty();
        }
        doc.remove("accounts"); // live balances, injected on read — never stored
        return had;
    }

    private static BigDecimal amount(BigDecimal v, boolean allowZeroOrNegative) {
        if (v.abs().compareTo(MAX_AMOUNT) > 0 || (!allowZeroOrNegative && v.signum() <= 0)) {
            throw ApiException.badRequest("Amount is out of range.");
        }
        return v.setScale(2, java.math.RoundingMode.HALF_UP);
    }

    private static String text(JsonNode n) {
        return n == null || n.isNull() ? null : n.asText();
    }

    private static String cut(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    private static void putIf(ObjectNode o, String k, String v) {
        if (v != null) {
            o.put(k, v);
        }
    }

    private static List<List<String>> chunks(List<String> ids) {
        List<List<String>> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i += 500) {
            out.add(ids.subList(i, Math.min(ids.size(), i + 500)));
        }
        return out;
    }

    private static String placeholders(int n) {
        return String.join(", ", java.util.Collections.nCopies(n, "?"));
    }

    private static Object[] prepend(Object first, List<?> rest) {
        Object[] a = new Object[rest.size() + 1];
        a[0] = first;
        for (int i = 0; i < rest.size(); i++) {
            a[i + 1] = rest.get(i);
        }
        return a;
    }
}
