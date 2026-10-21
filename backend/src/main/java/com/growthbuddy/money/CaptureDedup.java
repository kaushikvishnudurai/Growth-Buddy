package com.growthbuddy.money;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Whether a captured payment is one Money already has. Pure, so every rule is a
 * unit test ({@code CaptureDedupTest}); {@link CaptureService} feeds it what the
 * database holds. One spend reaches us several ways (the bank's SMS, the UPI app's
 * notification, the bank app's, a shared copy of the SMS, a quick add), and every
 * competitor's top complaint is the second row that leaves. So the order is:
 *
 * <ol>
 *   <li>the very same message again (the SMS backfill meeting the live receiver, a
 *       retried upload): same message hash within {@link #WINDOW}, or at any distance
 *       when one side is a share (a shared SMS arrives whenever it is shared). Two
 *       real payments that read alike hours apart ("₹10 paid to Chai Point") stay
 *       two; the phone hashes a notification with its own event time, so even two in
 *       the same minute differ;</li>
 *   <li>the same payment reference (UPI's RRN is in both the bank's SMS and the
 *       app's notification): same ref hash, whatever else differs;</li>
 *   <li>else the same kind and amount from a DIFFERENT origin within
 *       {@link #WINDOW}, the last 4 digits agreeing where both say them and the refs
 *       not contradicting. Two ₹10 teas from the same app a minute apart stay two:
 *       one app never announces one payment twice (its reposts are caught by 1).</li>
 * </ol>
 *
 * <p>Then, for a capture that is new, {@link #manualMatch}: a row the user typed
 * (quick add, WhatsApp, the form, a CSV) with the same kind and amount on the same
 * day that no capture has claimed yet is that spend.
 */
final class CaptureDedup {

    static final Duration WINDOW = Duration.ofMinutes(15);
    /** A debit and a credit of the same amount this close, on two different accounts: a move between them. */
    static final Duration TRANSFER_WINDOW = Duration.ofMinutes(30);

    /** One capture, incoming or already seen. {@code txId} is null on an incoming one. */
    record Seen(String txId, String kind, BigDecimal amount, Instant at, String last4, String refHash,
                String msgHash, String origin) {}

    /** A ledger row on the capture's day that no capture created. */
    record Manual(String id, String kind, BigDecimal amount, LocalDate day, String accountKind) {}

    private CaptureDedup() {
    }

    /** The capture in {@code seen} that is the same payment as {@code in}, or null. */
    static Seen samePayment(Seen in, List<Seen> seen) {
        for (Seen s : seen) {
            if (in.msgHash() != null && in.msgHash().equals(s.msgHash())
                    && ("share".equals(in.origin()) || "share".equals(s.origin())
                        || Duration.between(s.at(), in.at()).abs().compareTo(WINDOW) <= 0)) {
                return s;
            }
        }
        for (Seen s : seen) {
            if (sameMoney(in, s) && in.refHash() != null && in.refHash().equals(s.refHash())) {
                return s;
            }
        }
        for (Seen s : seen) {
            if (!sameMoney(in, s) || Objects.equals(in.origin(), s.origin())) {
                continue;
            }
            if (in.refHash() != null && s.refHash() != null) {
                continue; // two different references are two payments
            }
            if (in.last4() != null && s.last4() != null && !in.last4().equals(s.last4())) {
                continue;
            }
            if (Duration.between(s.at(), in.at()).abs().compareTo(WINDOW) <= 0) {
                return s;
            }
        }
        return null;
    }

    /**
     * The other half of a move between the user's own accounts: the opposite kind,
     * the same amount, close in time, and two different known accounts. Not merged
     * (it may be a real payment); the new row goes to review saying so.
     */
    static Seen transferTwin(Seen in, List<Seen> seen) {
        for (Seen s : seen) {
            if (!in.kind().equals(s.kind()) && in.amount().compareTo(s.amount()) == 0
                    && in.last4() != null && s.last4() != null && !in.last4().equals(s.last4())
                    && Duration.between(s.at(), in.at()).abs().compareTo(TRANSFER_WINDOW) <= 0) {
                return s;
            }
        }
        return null;
    }

    /** A typed row on that day for the same money that no capture has claimed, or null. */
    static Manual manualMatch(String kind, BigDecimal amount, LocalDate day, List<Manual> rows, Set<String> claimed) {
        for (Manual m : rows) {
            if (m.kind().equals(kind) && m.amount().compareTo(amount) == 0 && m.day().equals(day)
                    && !claimed.contains(m.id())) {
                return m;
            }
        }
        return null;
    }

    private static boolean sameMoney(Seen a, Seen b) {
        return a.kind().equals(b.kind()) && a.amount().compareTo(b.amount()) == 0;
    }
}
