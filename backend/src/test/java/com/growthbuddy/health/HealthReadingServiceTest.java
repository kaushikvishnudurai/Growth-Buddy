package com.growthbuddy.health;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.user.UserClock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Limits, days, manual-only edits, and the phone's one-row-per-day upsert, over an in-memory repository. */
class HealthReadingServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID OTHER = UUID.randomUUID();

    private final HealthReadingRepository repo = mock(HealthReadingRepository.class);
    private final UserClock clock = mock(UserClock.class);
    private final com.growthbuddy.user.UserRepository users = mock(com.growthbuddy.user.UserRepository.class);
    private final List<HealthReading> rows = new ArrayList<>();
    private HealthReadingService service;
    private final LocalDate today = LocalDate.of(2026, 10, 11);

    @BeforeEach
    void setUp() {
        when(clock.today(any())).thenReturn(today);
        when(repo.save(any())).thenAnswer(i -> {
            HealthReading r = i.getArgument(0);
            r.prePersist();
            if (!rows.contains(r)) rows.add(r);
            return r;
        });
        org.mockito.Mockito.doAnswer(i -> rows.remove((HealthReading) i.getArgument(0))).when(repo).delete(any());
        when(repo.findByIdAndUserId(any(), any())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getId().equals(i.getArgument(0)) && r.getUserId().equals(i.getArgument(1)))
                .findFirst());
        when(repo.findByUserIdAndDayBetween(any(), any(), any())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getUserId().equals(i.getArgument(0)) && between(r, i.getArgument(1), i.getArgument(2)))
                .toList());
        when(repo.findByUserIdAndSourceAndDayBetween(any(), anyString(), any(), any())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getUserId().equals(i.getArgument(0)) && r.getSource().equals(i.getArgument(1))
                        && between(r, i.getArgument(2), i.getArgument(3)))
                .toList());
        service = new HealthReadingService(repo, clock, users);
    }

    private static boolean between(HealthReading r, LocalDate a, LocalDate b) {
        return !r.getDay().isBefore(a) && !r.getDay().isAfter(b);
    }

    private HealthReadingResponse add(String type, double value, Double value2, LocalDate day) {
        return service.create(USER, new CreateHealthReadingRequest(type, value, value2, day, null, null));
    }

    private static void bad(Runnable r) {
        assertThatThrownBy(r::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_REQUEST);
    }

    private static void notFound(Runnable r) {
        assertThatThrownBy(r::run).isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private static SyncItem item(String type, LocalDate day, double value) {
        return new SyncItem(type, day, value, null, null, null);
    }

    @Test
    void createDefaultsToTodayAndListsNewestFirst() {
        HealthReadingResponse a = service.create(USER, new CreateHealthReadingRequest(
                "weight", 70.5, 99.0, null, null, "  after run  "));
        assertThat(a.day()).isEqualTo(today);
        assertThat(a.source()).isEqualTo("manual");
        assertThat(a.note()).isEqualTo("after run");
        assertThat(a.value2()).as("value2 is bloodPressure-only").isNull();
        assertThat(a.createdAt()).isNotNull();

        add("steps", 5000, null, today.minusDays(3));
        service.create(USER, new CreateHealthReadingRequest("restingHeartRate", 60.0, null, today,
                Instant.parse("2026-10-11T08:00:00Z"), null));
        add("steps", 9000, null, today.minusDays(200));

        assertThat(service.list(USER, 90)).extracting(HealthReadingResponse::type)
                .containsExactly("restingHeartRate", "weight", "steps");
        assertThat(service.list(USER, 1000)).hasSize(4);
        assertThat(service.list(USER, 0)).hasSize(2);
        assertThat(service.list(OTHER, 90)).isEmpty();
    }

    @Test
    void limitsAreInclusiveAndUnknownTypesRefused() {
        add("steps", 1, null, null);
        add("steps", 100000, null, null);
        add("distance", 0.1, null, null);
        bad(() -> add("steps", 0, null, null));
        bad(() -> add("steps", 100001, null, null));
        bad(() -> add("distance", 0.05, null, null));
        bad(() -> add("oxygenSaturation", 100.5, null, null));
        bad(() -> add("height", Double.NaN, null, null));
        bad(() -> add("sleep", 7, null, null));
        bad(() -> add(null, 7, null, null));
        assertThat(HealthReadingService.LIMITS).hasSize(13);
    }

    @Test
    void bloodPressureNeedsADiastolicBelowSystolic() {
        assertThat(add("bloodPressure", 120, 80.0, null).value2()).isEqualTo(80.0);
        bad(() -> add("bloodPressure", 120, null, null));
        bad(() -> add("bloodPressure", 120, 19.0, null));
        bad(() -> add("bloodPressure", 250, 201.0, null));
        bad(() -> add("bloodPressure", 120, 120.0, null));
        bad(() -> add("bloodPressure", 39, 30.0, null));
    }

    @Test
    void aFutureOrTooOldDayIsRefused() {
        bad(() -> add("steps", 100, null, today.plusDays(1)));
        bad(() -> add("steps", 100, null, today.minusDays(401)));
        add("steps", 100, null, today.minusDays(400));
        bad(() -> service.create(USER, new CreateHealthReadingRequest("steps", 1.0, null, null, null, "x".repeat(281))));
    }

    @Test
    void aManualReadingCanBeEditedAndDeleted() {
        HealthReadingResponse r = service.create(USER, new CreateHealthReadingRequest(
                "bloodPressure", 130.0, 85.0, today, null, "cuff"));
        HealthReadingResponse e = service.update(USER, r.id(), new UpdateHealthReadingRequest(
                125.0, null, today.minusDays(1), null, null));
        assertThat(e.value()).isEqualTo(125.0);
        assertThat(e.value2()).isEqualTo(85.0);
        assertThat(e.day()).isEqualTo(today.minusDays(1));
        assertThat(e.note()).isEqualTo("cuff");
        assertThat(rows.get(0).getUpdatedAt()).isNotNull();

        assertThat(service.update(USER, r.id(), new UpdateHealthReadingRequest(null, null, null, null, "")).note())
                .isNull();
        bad(() -> service.update(USER, r.id(), new UpdateHealthReadingRequest(80.0, null, null, null, null)));
        bad(() -> service.update(USER, r.id(), new UpdateHealthReadingRequest(null, null, today.plusDays(1), null, null)));

        service.delete(USER, r.id());
        assertThat(rows).isEmpty();
    }

    @Test
    void someoneElsesOrAMissingReadingIs404() {
        HealthReadingResponse r = add("steps", 100, null, null);
        notFound(() -> service.update(OTHER, r.id(), new UpdateHealthReadingRequest(5.0, null, null, null, null)));
        notFound(() -> service.delete(OTHER, r.id()));
        notFound(() -> service.delete(USER, UUID.randomUUID()));
        assertThat(rows).hasSize(1);
    }

    /** Two syncs at once both inserted a day's row: sync queues on the user lock before it reads. */
    @Test
    void syncTakesTheUserLockBeforeReading() {
        service.sync(USER, new SyncRequest(List.of(item("steps", today, 4000))));
        var order = org.mockito.Mockito.inOrder(users, repo);
        order.verify(users).findForUpdate(USER);
        order.verify(repo).findByUserIdAndSourceAndDayBetween(any(), anyString(), any(), any());
    }

    @Test
    void aPhoneReadingCannotBeEditedOrDeletedByHand() {
        service.sync(USER, new SyncRequest(List.of(item("steps", today, 4000))));
        UUID id = rows.get(0).getId();
        Consumer<Runnable> phoneLocked = r -> assertThatThrownBy(r::run).isInstanceOf(ApiException.class)
                .hasMessage("Phone readings update from the phone");
        phoneLocked.accept(() -> service.update(USER, id, new UpdateHealthReadingRequest(5.0, null, null, null, null)));
        phoneLocked.accept(() -> service.delete(USER, id));
        assertThat(rows).hasSize(1);
    }

    @Test
    void syncUpsertsOneRowPerTypeAndDayAndLeavesManualRowsAlone() {
        HealthReadingResponse manual = add("steps", 1234, null, today);
        SyncResponse first = service.sync(USER, new SyncRequest(List.of(
                item("steps", today, 4000), item("steps", today.minusDays(1), 8000),
                new SyncItem("bloodPressure", today, 118.0, 76.0, Instant.parse("2026-10-11T07:00:00Z"), null))));
        assertThat(first).isEqualTo(new SyncResponse(3, 0));
        assertThat(rows.stream().filter(r -> r.getSource().equals("phone"))).hasSize(3)
                .allSatisfy(r -> assertThat(r.getUpdatedAt()).isNull());

        SyncResponse second = service.sync(USER, new SyncRequest(List.of(item("steps", today, 6500))));
        assertThat(second).isEqualTo(new SyncResponse(1, 0));
        List<HealthReading> phoneToday = rows.stream()
                .filter(r -> r.getSource().equals("phone") && r.getType().equals("steps") && r.getDay().equals(today))
                .toList();
        assertThat(phoneToday).hasSize(1);
        assertThat(phoneToday.get(0).getValue()).isEqualTo(6500);
        assertThat(phoneToday.get(0).getUpdatedAt()).isNotNull();
        assertThat(rows).hasSize(4);
        HealthReading m = rows.stream().filter(r -> r.getId().equals(manual.id())).findFirst().orElseThrow();
        assertThat(m.getValue()).isEqualTo(1234);
        assertThat(m.getSource()).isEqualTo("manual");
    }

    @Test
    void syncSkipsInvalidItemsAndCapsTheBatch() {
        service.sync(USER, new SyncRequest(List.of(item("weight", today, 70))));
        SyncResponse r = service.sync(USER, new SyncRequest(List.of(
                item("steps", today, 500),
                item("steps", today.plusDays(1), 500),           // phone a day ahead: fine
                item("steps", today.plusDays(2), 500),           // too far ahead
                item("steps", today.minusDays(13), 500),         // 14th day back: fine
                item("steps", today.minusDays(14), 500),         // too old
                item("weight", today, 900),                       // out of range: existing row untouched
                item("nope", today, 1),
                new SyncItem("bloodPressure", today, 120.0, null, null, null),
                new SyncItem("steps", null, 1.0, null, null, null))));
        assertThat(r).isEqualTo(new SyncResponse(3, 6));
        assertThat(rows.stream().filter(x -> x.getType().equals("weight")).findFirst().orElseThrow().getValue())
                .isEqualTo(70);

        assertThat(service.sync(USER, new SyncRequest(Collections.nCopies(200, item("steps", today, 1)))))
                .isEqualTo(new SyncResponse(200, 0));
        bad(() -> service.sync(USER, new SyncRequest(Collections.nCopies(201, item("steps", today, 1)))));
        assertThat(service.sync(USER, new SyncRequest(null))).isEqualTo(new SyncResponse(0, 0));
    }
}
