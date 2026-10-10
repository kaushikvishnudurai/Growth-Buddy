package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.growthbuddy.common.ApiException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * The If-Match contract: a client that writes, keeps the version it got back,
 * and writes again must not be told its own data "changed somewhere else".
 *
 * <p>The fake repository truncates {@code updatedAt} to whole seconds on save,
 * because money_state.updated_at is a MySQL TIMESTAMP and does exactly that —
 * which is how a version tag built from epoch millis came back stale every time.
 */
@ExtendWith(MockitoExtension.class)
class MoneyVersionTest {

    private static final UUID USER = UUID.randomUUID();

    @Mock MoneyRepository repo;
    @Mock MoneyLedger ledger;

    private final ObjectMapper json = new ObjectMapper();
    private MoneyService service;
    private MoneyState stored;

    private JsonNode doc(String tag) {
        // Not "expenses": that array belongs to the ledger now and is stripped
        // from the stored document, which would make every version identical.
        // accountsSeeded: the steady state. The first load of a new document seeds
        // Cash and Bank and records it, a one-time write before any versioned save.
        ObjectNode d = json.createObjectNode().put("note", tag);
        d.putObject("settings").put("accountsSeeded", true);
        return d;
    }

    @BeforeEach
    void setUp() {
        service = new MoneyService(repo, json, null, ledger);
        org.mockito.Mockito.lenient().when(ledger.load(any(), any())).thenReturn(json.createObjectNode());
        org.mockito.Mockito.lenient().when(ledger.accounts(any())).thenReturn(json.createArrayNode());
        when(repo.lockById(USER)).thenAnswer(inv -> Optional.ofNullable(reload()));
        // get() peeks at the document unlocked and locks only when it must migrate.
        org.mockito.Mockito.lenient().when(repo.peekData(USER))
                .thenAnswer(inv -> Optional.ofNullable(stored == null ? null : stored.getData()));
        when(repo.save(any(MoneyState.class))).thenAnswer(inv -> {
            MoneyState in = inv.getArgument(0);
            in.touch(); // @PrePersist / @PreUpdate
            stored = new MoneyState();
            stored.setUserId(in.getUserId());
            stored.setData(in.getData());
            stored.setUpdatedAt(in.getUpdatedAt().truncatedTo(ChronoUnit.SECONDS)); // the DB column
            return in;
        });
    }

    /** A fresh entity per read, like a new transaction loading the row. */
    private MoneyState reload() {
        if (stored == null) return null;
        MoneyState copy = new MoneyState();
        copy.setUserId(stored.getUserId());
        copy.setData(stored.getData());
        copy.setUpdatedAt(stored.getUpdatedAt());
        return copy;
    }

    @Test
    void versionFromOneWriteStillMatchesOnTheNext() {
        String v1 = service.save(USER, doc("first"), null).version();
        assertThat(service.get(USER).version()).isEqualTo(v1);

        String v2 = service.save(USER, doc("second"), v1).version();
        assertThat(v2).isNotEqualTo(v1);
        assertThat(service.save(USER, doc("third"), v2).version()).isNotEqualTo(v2);
    }

    @Test
    void refusesAWriteBuiltOnACopySomeoneElseReplaced() {
        String mine = service.save(USER, doc("mine"), null).version();
        service.save(USER, doc("theirs"), null); // other device, unconditional

        assertThatThrownBy(() -> service.save(USER, doc("mine plus one"), mine))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("changed somewhere else");
    }

    @Test
    void aSettledDocumentIsReadWithoutTheRowLock() {
        service.save(USER, doc("plain"), null);
        org.mockito.Mockito.clearInvocations(repo);
        service.get(USER);
        org.mockito.Mockito.verify(repo, org.mockito.Mockito.never()).lockById(any());
        assertThat(MoneyService.needsWrite(json.createObjectNode().putArray("expenses"))).isFalse(); // not an object doc
        ObjectNode legacy = json.createObjectNode();
        legacy.putArray("expenses");
        legacy.putObject("settings").put("accountsSeeded", true);
        assertThat(MoneyService.needsWrite(legacy)).isTrue();
        assertThat(MoneyService.needsWrite(doc("x"))).isFalse();
    }
}
