package com.growthbuddy.mentor;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** EXM-5, FRC-13: model prose shown as text loses its Markdown and emoji, keeps its words. */
class PlainTextTest {

    @Test
    void markdownAndEmojiGoWordsStay() {
        assertEquals("Worth a short pause. Earbuds at 2,999 eat into your fun budget.",
                OpenAIClient.plainText("**Worth a short pause.** Earbuds at 2,999 eat into *your* fun budget."));
        assertEquals("Logged 500ml of water (2 glasses)", OpenAIClient.plainText("Logged 500ml of water (2 glasses) 💧"));
        assertEquals("Go for it\nIt fits", OpenAIClient.plainText("## Go for it\n- It fits"));
        assertEquals("2 * 3 = 6, snake_case kept", OpenAIClient.plainText("2 * 3 = 6, snake_case kept"));
    }
}
