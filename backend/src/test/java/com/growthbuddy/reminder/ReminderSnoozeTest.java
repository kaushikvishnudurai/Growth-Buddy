package com.growthbuddy.reminder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.notification.Notification;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationRepository;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Snooze and "notify before": the defaults read from ui_prefs, the signed
 * ticket a push notification's button carries, the snooze itself, and the
 * window a lead puts a reminder in — including a lead that rings the evening
 * before.
 */
class ReminderSnoozeTest {

    private static final Instant NOW = Instant.parse("2026-10-10T09:00:40Z");
    private static final UUID USER = UUID.randomUUID();

    private final CalendarReminderRepository repo = mock(CalendarReminderRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final SnoozeLinks links = new SnoozeLinks("test-secret");
    private final ReminderSnoozeService service = new ReminderSnoozeService(
            repo, users, notifications, links, Clock.fixed(NOW, ZoneOffset.UTC));

    private CalendarReminder timed() {
        CalendarReminder r = new CalendarReminder();
        r.setId(UUID.randomUUID());
        r.setUserId(USER);
        r.setText("Call mom");
        r.setAnchorDate(LocalDate.of(2026, 10, 10));
        r.setTime(LocalTime.of(9, 0));
        when(repo.findByIdAndUserId(r.getId(), USER)).thenReturn(Optional.of(r));
        when(repo.save(any(CalendarReminder.class))).thenAnswer(inv -> inv.getArgument(0));
        return r;
    }

    private void prefs(Map<String, Object> p) {
        User u = new User();
        u.setId(USER);
        u.setUiPrefs(p);
        when(users.findById(USER)).thenReturn(Optional.of(u));
    }

    @Test
    void prefsFallBackToTheDefaultsAndRefuseNonsense() {
        assertThat(ReminderPrefs.leadOf(null)).isZero();
        assertThat(ReminderPrefs.snoozeOf(null)).isEqualTo(10);
        assertThat(ReminderPrefs.leadOf(Map.of("reminderLead", 15))).isEqualTo(15);
        assertThat(ReminderPrefs.leadOf(Map.of("reminderLead", "30"))).isEqualTo(30);
        assertThat(ReminderPrefs.leadOf(Map.of("reminderLead", -5))).isZero();
        assertThat(ReminderPrefs.snoozeOf(Map.of("snoozeMinutes", 0))).isEqualTo(10);
        assertThat(ReminderPrefs.snoozeOf(Map.of("snoozeMinutes", 9999))).isEqualTo(10);
        assertThat(ReminderPrefs.human(5)).isEqualTo("5 min");
        assertThat(ReminderPrefs.human(60)).isEqualTo("1 h");
        assertThat(ReminderPrefs.human(90)).isEqualTo("1 h 30 min");
        assertThat(ReminderPrefs.human(1440)).isEqualTo("1 day");
    }

    /** The reminder's own lead wins; null follows the user's default, even after it changes. */
    @Test
    void aRemindersOwnLeadWinsOverTheDefault() {
        CalendarReminder r = new CalendarReminder();
        assertThat(ReminderPrefs.leadFor(r, Map.of("reminderLead", 15))).isEqualTo(15);
        r.setNotifyBefore(0);
        assertThat(ReminderPrefs.leadFor(r, Map.of("reminderLead", 15))).isZero();
    }

    @Test
    void aSnoozeUsesTheUsersLengthAndLandsOnTheMinute() {
        CalendarReminder r = timed();
        prefs(new HashMap<>(Map.of("snoozeMinutes", 15)));
        ReminderResponse out = service.snooze(USER, r.getId(), null);
        assertThat(out.snoozedUntil()).isEqualTo(Instant.parse("2026-10-10T09:15:00Z"));
        assertThat(service.snooze(USER, r.getId(), 5).snoozedUntil())
                .as("snoozing again moves it").isEqualTo(Instant.parse("2026-10-10T09:05:00Z"));
    }

    @Test
    void onlyATimedReminderCanBeSnoozedAndOnlyForSensibleLengths() {
        CalendarReminder r = timed();
        assertThatThrownBy(() -> service.snooze(USER, r.getId(), 0)).hasMessageContaining("1 to 240");
        r.setTime(null);
        assertThatThrownBy(() -> service.snooze(USER, r.getId(), 10)).hasMessageContaining("with a time");
        assertThatThrownBy(() -> service.snooze(USER, UUID.randomUUID(), 10)).hasMessageContaining("wandered off");
    }

    /** The push button's ticket: one user, one reminder, one day — and nothing forged gets through. */
    @Test
    void aSnoozeTicketIsBoundAndExpires() {
        UUID rem = UUID.randomUUID();
        LocalDate day = LocalDate.of(2026, 10, 10);
        String token = links.sign(USER, rem, day, NOW);
        assertThat(links.verify(token, NOW)).contains(new SnoozeLinks.Ticket(USER, rem, day));
        assertThat(links.verify(token, NOW.plus(Duration.ofHours(25)))).isEmpty();
        assertThat(new SnoozeLinks("other-secret").verify(token, NOW)).isEmpty();
        String[] parts = token.split("\\.");
        String forged = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                (UUID.randomUUID() + ":" + rem + ":" + NOW.plusSeconds(3600).getEpochSecond()).getBytes())
                + "." + parts[1];
        assertThat(links.verify(forged, NOW)).isEmpty();
        assertThat(links.verify("garbage", NOW)).isEmpty();
        assertThat(links.verify(null, NOW)).isEmpty();
    }

    @Test
    void aTicketSnoozesItsReminder() {
        CalendarReminder r = timed();
        prefs(new HashMap<>());
        assertThat(service.snoozeByLink(links.sign(USER, r.getId(), LocalDate.of(2026, 10, 10), NOW)))
                .contains(Instant.parse("2026-10-10T09:10:00Z"));
        assertThat(service.snoozeByLink("nope")).isEmpty();
    }

    /** Yesterday's push tapped today snoozes nothing; a lead's ring for tomorrow does. Old tickets still work. */
    @Test
    void aTicketIsForItsOwnDay() {
        CalendarReminder r = timed();
        prefs(new HashMap<>());
        assertThat(service.snoozeByLink(links.sign(USER, r.getId(), LocalDate.of(2026, 10, 9), NOW))).isEmpty();
        assertThat(service.snoozeByLink(links.sign(USER, r.getId(), LocalDate.of(2026, 10, 11), NOW))).isPresent();
        String body = USER + ":" + r.getId() + ":" + NOW.plusSeconds(3600).getEpochSecond();
        String old = signRaw(body);
        assertThat(links.verify(old, NOW)).contains(new SnoozeLinks.Ticket(USER, r.getId(), null));
        assertThat(service.snoozeByLink(old)).isPresent();
    }

    @Test
    void aTicketDoesNotSnoozeAnAccountPendingDeletion() {
        CalendarReminder r = timed();
        User u = new User();
        u.setId(USER);
        u.setDeletionRequestedAt(NOW.minusSeconds(60));
        when(users.findById(USER)).thenReturn(Optional.of(u));
        assertThat(service.snoozeByLink(links.sign(USER, r.getId(), LocalDate.of(2026, 10, 10), NOW))).isEmpty();
        assertThat(r.getSnoozedUntil()).isNull();
    }

    /** A ticket in the pre-day format, signed with the same key SnoozeLinks derives. */
    private static String signRaw(String body) {
        try {
            javax.crypto.Mac m = javax.crypto.Mac.getInstance("HmacSHA256");
            m.init(new javax.crypto.spec.SecretKeySpec("snooze-link:test-secret".getBytes(), "HmacSHA256"));
            var b64 = java.util.Base64.getUrlEncoder().withoutPadding();
            return b64.encodeToString(body.getBytes()) + "." + b64.encodeToString(m.doFinal(body.getBytes()));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    /** A typed SNOOZE means the reminder that reached them last, found through its bell card. */
    @Test
    void aTypedSnoozeFindsTheLatestReminder() {
        CalendarReminder r = timed();
        prefs(new HashMap<>());
        Notification n = new Notification();
        n.setRelatedId(r.getId());
        when(notifications.findFirstByUserIdAndKindAndCreatedAtAfterOrderByCreatedAtDesc(
                USER, NotificationKind.reminder, NOW.minus(ReminderSnoozeService.REPLY_WINDOW)))
                .thenReturn(Optional.of(n));
        User u = new User();
        u.setId(USER);
        assertThat(service.snoozeLatestFromWhatsApp(u, 20)).contains(Instant.parse("2026-10-10T09:20:00Z"));
    }

    /** A lead moves the window back; across midnight it is the evening before. */
    @Test
    void aLeadRingsAheadEvenTheEveningBefore() {
        ZoneId zone = ZoneId.of("Asia/Kolkata");
        Instant at = ReminderDeliveryScheduler.ringAt(LocalDate.of(2026, 10, 11), LocalTime.of(0, 10),
                zone, Duration.ofMinutes(30));
        assertThat(at.atZone(zone).toLocalDateTime().toString()).isEqualTo("2026-10-10T23:40");
        assertThat(ReminderDeliveryScheduler.inWindow(at, at.plusSeconds(60))).isTrue();
        assertThat(ReminderDeliveryScheduler.inWindow(at, at.minusSeconds(1))).isFalse();
        assertThat(ReminderDeliveryScheduler.inWindow(at, at.plus(Duration.ofMinutes(6)))).isFalse();
    }

    @Test
    void aSnoozeIsDueFromItsMinuteForTheGracePeriod() {
        CalendarReminder r = new CalendarReminder();
        assertThat(ReminderDeliveryScheduler.snoozeDue(r, NOW)).isFalse();
        r.setSnoozedUntil(Instant.parse("2026-10-10T09:00:00Z"));
        assertThat(ReminderDeliveryScheduler.snoozeDue(r, NOW)).isTrue();
        assertThat(ReminderDeliveryScheduler.snoozeDue(r, NOW.minusSeconds(60))).isFalse();
        assertThat(ReminderDeliveryScheduler.snoozeDue(r, NOW.plus(Duration.ofMinutes(10)))).isFalse();
    }

    /** One line: Meta refuses a template parameter with a newline in it. */
    @Test
    void theWhatsAppSnoozeLineStaysOnOneLine() {
        String s = WhatsAppService.withSnoozeHint("Call mom", 10);
        assertThat(s).isEqualTo("Call mom — reply SNOOZE to hear it again in 10 min.").doesNotContain("\n");
        String body = WhatsAppService.buildQuickReplyBody("911", "rem_snooze", "en", "Call mom", "snooze:abc", "Snooze");
        assertThat(body).contains("\"payload\":\"snooze:abc\"").contains("\"name\":\"rem_snooze\"");
        assertThat(WhatsAppService.buildQuickReplyBody("911", null, "en", "x", "snooze:abc", "Snooze"))
                .contains("\"title\":\"Snooze\"");
    }
}
