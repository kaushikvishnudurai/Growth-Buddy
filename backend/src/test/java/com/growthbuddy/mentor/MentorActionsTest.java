package com.growthbuddy.mentor;

import static org.assertj.core.api.Assertions.assertThat;

import com.growthbuddy.mentor.MentorActions.Action;
import com.growthbuddy.mentor.MentorActions.Parsed;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The ```actions block Buddy may end a reply with, and a thread's auto-title. */
class MentorActionsTest {

    @Test
    void theBlockIsStrippedAndReadAsActions() {
        Parsed p = MentorActions.parse("""
                Try a short walk after lunch.

                ```actions
                [{"type":"task","title":"Walk 10 minutes"},
                 {"type":"reminder","title":"Stretch","time":"9:05"}]
                ```""");
        assertThat(p.text()).isEqualTo("Try a short walk after lunch.");
        assertThat(p.actions()).containsExactly(
                new Action("task", "Walk 10 minutes", null),
                new Action("reminder", "Stretch", "09:05"));
    }

    @Test
    void noBlockLeavesTheTextAlone() {
        Parsed p = MentorActions.parse("Just breathe. ```code``` stays.");
        assertThat(p.text()).isEqualTo("Just breathe. ```code``` stays.");
        assertThat(p.actions()).isEmpty();
    }

    @Test
    void aMalformedBlockIsStillRemoved() {
        Parsed p = MentorActions.parse("You've got this.\n```actions\n[{type: task,,]\n```");
        assertThat(p.text()).isEqualTo("You've got this.");
        assertThat(p.actions()).isEmpty();
    }

    @Test
    void anUnclosedBlockCutOffByTheTokenCeilingRunsToTheEnd() {
        Parsed p = MentorActions.parse("Plan it.\n```actions\n[{\"type\":\"habit\",\"tit");
        assertThat(p.text()).isEqualTo("Plan it.");
        assertThat(p.actions()).isEmpty();
    }

    @Test
    void unknownTypesBlankTitlesAndBadTimesAreDropped() {
        Parsed p = MentorActions.parse("""
                ok
                ```actions
                [{"type":"email","title":"x"},{"type":"habit","title":"  "},
                 {"type":"HABIT","title":"Read  10 pages","time":"25:00"},
                 {"type":"habit","title":"read 10 pages"},
                 "nonsense", 7]
                ```""");
        assertThat(p.actions()).containsExactly(new Action("habit", "Read 10 pages", null));
    }

    @Test
    void atMostThreeAndASingleObjectIsAccepted() {
        String four = "[{\"type\":\"task\",\"title\":\"a\"},{\"type\":\"task\",\"title\":\"b\"},"
                + "{\"type\":\"task\",\"title\":\"c\"},{\"type\":\"task\",\"title\":\"d\"}]";
        assertThat(MentorActions.parse("x\n```actions\n" + four + "\n```").actions()).hasSize(3);
        assertThat(MentorActions.parse("x ```actions {\"type\":\"task\",\"title\":\"one\"} ```").actions())
                .containsExactly(new Action("task", "one", null));
    }

    @Test
    void aLongTitleIsClipped() {
        String longTitle = "w".repeat(300);
        Parsed p = MentorActions.parse("x\n```actions\n[{\"type\":\"task\",\"title\":\"" + longTitle + "\"}]\n```");
        assertThat(p.actions().get(0).title()).hasSize(MentorActions.MAX_TITLE);
    }

    @Test
    void theStoredColumnRoundTrips() {
        List<Action> a = List.of(new Action("reminder", "Call mum", "18:30"));
        String json = MentorActions.toJson(a);
        assertThat(MentorActions.fromJson(json)).isEqualTo(a);
        assertThat(MentorActions.toJson(List.of())).isNull();
        assertThat(MentorActions.fromJson(null)).isEmpty();
        assertThat(MentorActions.fromJson("not json")).isEmpty();
    }

    @Test
    void autoTitleIsOneLineAndAtMostForty() {
        assertThat(MentorActions.autoTitle("  Plan my\nday  ")).isEqualTo("Plan my day");
        String t = MentorActions.autoTitle("I keep procrastinating on my thesis and I don't know why");
        assertThat(t).hasSizeLessThanOrEqualTo(MentorActions.TITLE_MAX).endsWith("…");
        assertThat(t).isEqualTo("I keep procrastinating on my thesis…");
        assertThat(MentorActions.autoTitle("x".repeat(80))).hasSize(MentorActions.TITLE_MAX);
        assertThat(MentorActions.autoTitle("   ")).isNull();
        assertThat(MentorActions.autoTitle(null)).isNull();
    }
}
