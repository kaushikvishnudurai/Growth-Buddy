package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** One user's edit re-reads that user only; an ownerless change or MAX_AGE reloads everything. */
class DeliveryCacheTest {

    record Row(UUID user, String name) {}

    @Test
    void refreshesOnlyChangedUsers() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        List<Row> db = new ArrayList<>(List.of(new Row(a, "a1"), new Row(b, "b1")));
        int[] full = {0};
        List<Collection<UUID>> partial = new ArrayList<>();
        Function<List<Row>, Map<UUID, String>> usersOf =
                l -> l.stream().collect(Collectors.toMap(Row::user, r -> "u", (x, y) -> x));
        DeliveryCache.Snapshot<Row, String> snap = new DeliveryCache.Snapshot<>(Row::user);
        Instant t = Instant.now();
        Runnable tick = () -> snap.refresh(t, () -> { full[0]++; return List.copyOf(db); },
                ids -> { partial.add(ids); return db.stream().filter(r -> ids.contains(r.user())).toList(); },
                usersOf);

        tick.run();
        assertThat(full[0]).isEqualTo(1);
        assertThat(snap.items()).hasSize(2);

        tick.run(); // nothing changed: no read at all
        assertThat(full[0]).isEqualTo(1);
        assertThat(partial).isEmpty();

        db.removeIf(r -> r.user().equals(a));
        db.add(new Row(a, "a2"));
        db.add(new Row(a, "a3"));
        DeliveryCache.changed(a);
        tick.run();
        assertThat(full[0]).isEqualTo(1);
        assertThat(partial).containsExactly(List.of(a).stream().collect(Collectors.toSet()));
        assertThat(snap.items()).extracting(Row::name).containsExactlyInAnyOrder("b1", "a2", "a3");

        db.removeIf(r -> r.user().equals(b));
        DeliveryCache.changed(b);
        tick.run();
        assertThat(snap.items()).extracting(Row::name).containsExactlyInAnyOrder("a2", "a3");
        assertThat(snap.users()).containsOnlyKeys(a);

        DeliveryCache.changed();
        tick.run();
        assertThat(full[0]).isEqualTo(2);

        snap.refresh(t.plus(DeliveryCache.MAX_AGE).plusSeconds(1), () -> { full[0]++; return List.copyOf(db); },
                ids -> List.of(), usersOf);
        assertThat(full[0]).isEqualTo(3);
    }
}
