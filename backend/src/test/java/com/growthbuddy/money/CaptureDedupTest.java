package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * One spend reaching Money several ways must stay one row; two spends that look
 * alike must stay two. Each rule of {@link CaptureDedup} as a case.
 */
class CaptureDedupTest {

    private static final Instant T = Instant.parse("2026-10-20T08:30:00Z");
    private static final BigDecimal R250 = new BigDecimal("250.00");

    private static CaptureDedup.Seen seen(String tx, String kind, String amount, Instant at, String last4, String ref,
                                          String msg, String origin) {
        return new CaptureDedup.Seen(tx, kind, new BigDecimal(amount), at, last4, ref, msg, origin);
    }

    @Test
    void theBanksSmsAndTheAppsNotificationWithOneReferenceAreOnePayment() {
        var sms = seen("cap-1", "expense", "250.00", T, "1234", "r1", "m1", "sms");
        var notif = seen(null, "expense", "250", T.plusSeconds(400), null, "r1", "m2", "com.phonepe.app");
        assertThat(CaptureDedup.samePayment(notif, List.of(sms))).isSameAs(sms);
    }

    @Test
    void theSameMessageTwiceIsOnePaymentEvenFromTheSameOrigin() {
        // The SMS backfill meeting the live receiver, or a notification reposted.
        var first = seen("cap-1", "expense", "250.00", T, null, null, "m1", "sms");
        var again = seen(null, "expense", "250.00", T, null, null, "m1", "sms");
        assertThat(CaptureDedup.samePayment(again, List.of(first))).isSameAs(first);
    }

    @Test
    void aNotificationWithNoReferenceMatchesTheSmsMinutesApart() {
        var sms = seen("cap-1", "expense", "250.00", T, "1234", "r1", "m1", "sms");
        var gpay = seen(null, "expense", "250.00", T.plusSeconds(14 * 60), null, null, "m2", "com.google.android.apps.nbu.paisa.user");
        assertThat(CaptureDedup.samePayment(gpay, List.of(sms))).isSameAs(sms);
        var late = seen(null, "expense", "250.00", T.plusSeconds(16 * 60), null, null, "m3", "com.google.android.apps.nbu.paisa.user");
        assertThat(CaptureDedup.samePayment(late, List.of(sms))).as("past the 15-minute window").isNull();
    }

    @Test
    void twoTeasFromTheSameAppAMinuteApartStayTwo() {
        var first = seen("cap-1", "expense", "10.00", T, null, null, "m1", "com.phonepe.app");
        var second = seen(null, "expense", "10.00", T.plusSeconds(60), null, null, "m2", "com.phonepe.app");
        assertThat(CaptureDedup.samePayment(second, List.of(first))).isNull();
    }

    @Test
    void twoReferencesOrTwoAccountsAreTwoPayments() {
        var a = seen("cap-1", "expense", "250.00", T, "1234", "r1", "m1", "sms");
        assertThat(CaptureDedup.samePayment(seen(null, "expense", "250.00", T, "1234", "r2", "m2", "com.phonepe.app"), List.of(a)))
                .as("different references").isNull();
        assertThat(CaptureDedup.samePayment(seen(null, "expense", "250.00", T, "9999", null, "m3", "com.phonepe.app"), List.of(a)))
                .as("different accounts").isNull();
        assertThat(CaptureDedup.samePayment(seen(null, "income", "250.00", T, "1234", "r1", "m4", "com.phonepe.app"), List.of(a)))
                .as("money in is not money out, even with one reference").isNull();
        assertThat(CaptureDedup.samePayment(seen(null, "expense", "251.00", T, "1234", null, "m5", "com.phonepe.app"), List.of(a)))
                .as("a different amount").isNull();
    }

    @Test
    void aDebitAndACreditOfOneAmountOnTwoAccountsLookLikeAMove() {
        var out = seen("cap-1", "expense", "5000.00", T, "1234", "r1", "m1", "sms");
        var in = seen(null, "income", "5000.00", T.plusSeconds(120), "5678", "r2", "m2", "sms");
        assertThat(CaptureDedup.transferTwin(in, List.of(out))).isSameAs(out);
        var sameAccount = seen(null, "income", "5000.00", T.plusSeconds(120), "1234", "r3", "m3", "sms");
        assertThat(CaptureDedup.transferTwin(sameAccount, List.of(out))).as("a refund to the same account").isNull();
    }

    @Test
    void aTypedEntryForTheSameMoneyThatDayIsClaimedOnce() {
        LocalDate day = LocalDate.of(2026, 10, 20);
        var lunch = new CaptureDedup.Manual("u-1", "expense", R250, day, "bank");
        var rows = List.of(lunch);
        assertThat(CaptureDedup.manualMatch("expense", R250, day, rows, Set.of())).isSameAs(lunch);
        assertThat(CaptureDedup.manualMatch("expense", R250, day, rows, Set.of("u-1")))
                .as("already claimed by an earlier capture").isNull();
        assertThat(CaptureDedup.manualMatch("expense", R250, day.plusDays(1), rows, Set.of())).isNull();
        assertThat(CaptureDedup.manualMatch("income", R250, day, rows, Set.of())).isNull();
    }
}
