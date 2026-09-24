package com.growthbuddy.notification;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.growthbuddy.common.ApiException;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/**
 * The upload boundary. A client-side size check is a courtesy the server can't
 * rely on, so these are the rules that actually hold — and they have to refuse
 * with a 400, not fall through to the catch-all and reach the user as a 500
 * reading "Something went wrong".
 */
class CustomSoundValidationTest {

    private static String dataUrl(String mime, int bytes) {
        return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(new byte[bytes]);
    }

    @Test
    void acceptsAnAudioDataUrlUnderTheCeiling() {
        assertThatCode(() -> CustomSoundService.validate(dataUrl("audio/mpeg", 1024)))
                .doesNotThrowAnyException();
        assertThatCode(() -> CustomSoundService.validate(dataUrl("audio/wav", CustomSoundService.MAX_BYTES)))
                .as("exactly at the ceiling is still fine")
                .doesNotThrowAnyException();
    }

    @Test
    void refusesAnythingThatIsNotAudio() {
        // The one that matters: an image or an HTML document smuggled in under a
        // data: URL the client never produced.
        for (String bad : new String[] {
            dataUrl("image/png", 32),
            dataUrl("text/html", 32),
            "data:audio/mpeg,notbase64at.all",
            "https://example.com/tune.mp3",
            "audio/mpeg;base64,AAAA",
        }) {
            assertThatThrownBy(() -> CustomSoundService.validate(bad))
                    .as("should refuse: " + bad)
                    .isInstanceOf(ApiException.class)
                    .extracting(e -> ((ApiException) e).getStatus())
                    .isEqualTo(HttpStatus.BAD_REQUEST);
        }
    }

    @Test
    void refusesAnythingOverTheCeiling() {
        assertThatThrownBy(() -> CustomSoundService.validate(dataUrl("audio/wav", CustomSoundService.MAX_BYTES + 1)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("300 KB");
    }

    @Test
    void refusesNothingAtAll() {
        for (String empty : new String[] {null, "", "   "}) {
            assertThatThrownBy(() -> CustomSoundService.validate(empty))
                    .isInstanceOf(ApiException.class);
        }
    }

    @Test
    void refusesBase64ThatDoesNotDecode() {
        assertThatThrownBy(() -> CustomSoundService.validate("data:audio/wav;base64,!!!!not base64!!!!"))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).getStatus())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
