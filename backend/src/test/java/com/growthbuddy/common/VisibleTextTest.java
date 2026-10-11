package com.growthbuddy.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * HOS-9: @NotBlank only treats whitespace as empty, so a name of zero-width
 * spaces rendered as a blank card, and a U+202E display name read "ahsA" on
 * Home and reversed the text after it in member lists.
 */
class VisibleTextTest {

    @Test
    void invisibleOnlyNamesAreRefused() {
        for (String bad : new String[] {"​​", "​​​", "‮", "⁦⁩",
                "﻿", "  ", "‍‌", "ㅤ", "⠀", " ​ ‮ "}) {
            assertThatThrownBy(() -> VisibleText.require(bad, "Title"))
                    .isInstanceOf(ApiException.class)
                    .hasMessage("Title needs at least one visible character.");
        }
    }

    @Test
    void bidiOverridesAreStrippedAndTheRestKept() {
        assertThat(VisibleText.require("‮Asha Rao", "Name")).isEqualTo("Asha Rao");
        assertThat(VisibleText.require("⁧Asha⁩ Rao  ", "Name")).isEqualTo("Asha Rao");
        // Joiners inside real text stay: emoji sequences and scripts need them.
        assertThat(VisibleText.require("Plan‍week", "Title")).isEqualTo("Plan‍week");
        assertThat(VisibleText.require("  Read 20 pages ", "Title")).isEqualTo("Read 20 pages");
        assertThat(VisibleText.require("مرحبا", "Name")).isEqualTo("مرحبا");
    }
}
