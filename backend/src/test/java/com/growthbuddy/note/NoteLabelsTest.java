package com.growthbuddy.note;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The enforced copy of the label rules; scripts/notes-core.test.mjs pins the client's. */
class NoteLabelsTest {

    @Test
    void trimsCollapsesSplitsOnCommasAndDedupesIgnoringCase() {
        assertThat(NoteLabels.normalize(Arrays.asList("  Big   ideas ", "work,WORK", "", null, "big ideas")))
                .containsExactly("Big ideas", "work");
    }

    @Test
    void nullOrEmptyIsNoLabelsAndJoinsToNull() {
        assertThat(NoteLabels.normalize(null)).isEmpty();
        assertThat(NoteLabels.join(List.of())).isNull();
        assertThat(NoteLabels.split(null)).isEmpty();
    }

    @Test
    void joinAndSplitRoundTrip() {
        List<String> labels = List.of("a b", "c");
        assertThat(NoteLabels.split(NoteLabels.join(labels))).isEqualTo(labels);
    }

    @Test
    void thirtyCharactersFitAndThirtyOneDoNot() {
        assertThat(NoteLabels.normalize(List.of("x".repeat(30)))).hasSize(1);
        assertThatThrownBy(() -> NoteLabels.normalize(List.of("x".repeat(31))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("30 characters");
    }

    @Test
    void tenLabelsFitAndElevenDoNot() {
        List<String> ten = java.util.stream.IntStream.range(0, 10).mapToObj(i -> "l" + i).toList();
        assertThat(NoteLabels.normalize(ten)).hasSize(10);
        // Duplicates don't count toward the limit.
        assertThat(NoteLabels.normalize(List.of(String.join(",", ten), "L0"))).hasSize(10);
        assertThatThrownBy(() -> NoteLabels.normalize(List.of(String.join(",", ten) + ",l10")))
                .isInstanceOf(ApiException.class);
        // The most the column can ever hold fits VARCHAR(500).
        String widest = NoteLabels.join(java.util.stream.IntStream.range(0, 10)
                .mapToObj(i -> i + "x".repeat(29)).toList());
        assertThat(widest.length()).isLessThanOrEqualTo(500);
    }
}
