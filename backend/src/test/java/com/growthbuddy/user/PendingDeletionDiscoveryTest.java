package com.growthbuddy.user;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;

/**
 * For its 7-day grace period an account scheduled for deletion is gone to
 * everyone else: no people search (Circle), no browse list, no Family search
 * finds it. Unit tests run no JPQL, so this pins the filter in the queries
 * themselves — a new discovery query without it fails here.
 */
class PendingDeletionDiscoveryTest {

    private static final List<String> DISCOVERY = List.of("search", "browseExcluding", "searchForFamily");

    @Test
    void everyPeopleSearchQueryLeavesOutAccountsScheduledForDeletion() {
        List<Method> queried = Arrays.stream(UserRepository.class.getDeclaredMethods())
                .filter(m -> DISCOVERY.contains(m.getName()) && m.isAnnotationPresent(Query.class))
                .toList();
        assertThat(queried).extracting(Method::getName).containsExactlyInAnyOrderElementsOf(DISCOVERY);
        for (Method m : queried) {
            assertThat(m.getAnnotation(Query.class).value())
                    .as(m.getName())
                    .contains("u.deletionRequestedAt is null")
                    .contains("u.emailVerified = true");
        }
    }

    @Test
    void pendingDeletionIsJustTheStamp() {
        User u = new User();
        assertThat(u.isPendingDeletion()).isFalse();
        u.setDeletionRequestedAt(Instant.now());
        assertThat(u.isPendingDeletion()).isTrue();
    }
}
