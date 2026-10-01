package com.growthbuddy.money;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class MoneyEtagTest {

    /**
     * A GET's tag is "version-bodyhash" so a changed ledger is never a 304; a save
     * is still checked against the version alone. Old builds send back whatever
     * tag they last read, in either form.
     */
    @Test
    void aSaveIsCheckedAgainstTheVersionPartOfTheTag() {
        assertThat(MoneyController.versionOf("\"1a2b-ff00\"")).isEqualTo("1a2b");
        assertThat(MoneyController.versionOf("W/\"1a2b-ff00\"")).isEqualTo("1a2b");
        assertThat(MoneyController.versionOf("\"1a2b\"")).isEqualTo("1a2b"); // a PUT's tag
        assertThat(MoneyController.versionOf(null)).isNull();
        assertThat(Integer.toHexString(-5)).doesNotContain("-"); // versions never contain the separator
    }
}
