package com.growthbuddy.user;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** The session list is only useful if you can tell your own devices apart. */
class DeviceLabelTest {

    @Test
    void namesTheAppRatherThanTheBrowserItRunsIn() {
        assertEquals(
                "Growth Buddy on SM-S918B",
                AuthController.shortenAgent(
                        "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv)"
                                + " AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0"
                                + " Chrome/120.0.0.0 Mobile Safari/537.36 GrowthBuddyApp"));
    }

    @Test
    void readsTheModelOutOfTheNativeHttpClientsAgent() {
        // CapacitorHttp bypasses the WebView, so API calls arrive with this instead.
        assertEquals(
                "Growth Buddy on Pixel 8",
                AuthController.shortenAgent(
                        "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/UQ1A.240105.004)"));
    }

    @Test
    void doesNotPassOffChromesRedactedPlaceholderAsAModel() {
        assertEquals(
                "Chrome on Android",
                AuthController.shortenAgent(
                        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)"
                                + " Chrome/120.0.0.0 Mobile Safari/537.36"));
    }

    @Test
    void stillHandlesDesktopAndMissingAgents() {
        assertEquals(
                "Chrome on macOS",
                AuthController.shortenAgent(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                                + " (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"));
        assertEquals("Unknown device", AuthController.shortenAgent(null));
        assertEquals("Unknown device", AuthController.shortenAgent("   "));
    }
}
