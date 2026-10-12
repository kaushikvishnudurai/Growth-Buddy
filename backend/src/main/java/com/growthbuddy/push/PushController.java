package com.growthbuddy.push;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/push")
public class PushController {

    private final PushService push;

    public PushController(PushService push) {
        this.push = push;
    }

    /** Client fetches the VAPID public key (and whether push is available) before subscribing. */
    @GetMapping("/public-key")
    public PublicKeyResponse publicKey() {
        return new PublicKeyResponse(push.isConfigured(), push.isConfigured() ? push.publicKey() : null);
    }

    @PostMapping("/subscribe")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void subscribe(@Valid @RequestBody SubscribeRequest req) {
        push.subscribe(CurrentUser.id(), req.endpoint(), req.p256dh(), req.auth());
    }

    @PostMapping("/unsubscribe")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unsubscribe(@Valid @RequestBody EndpointRequest req) {
        push.unsubscribe(CurrentUser.id(), req.endpoint());
    }

    /** Send the current user a test notification (to confirm setup end-to-end). */
    @PostMapping("/test")
    public TestResponse test() {
        int n = push.sendToUser(CurrentUser.id(), "Growth Buddy",
                "Push notifications are on. This is a test.", "/");
        return new TestResponse(n);
    }

    record PublicKeyResponse(boolean configured, String publicKey) {}

    record SubscribeRequest(
            @NotBlank @Size(max = 2048) String endpoint,
            @NotBlank @Size(max = 255) String p256dh,
            @NotBlank @Size(max = 255) String auth) {}

    record EndpointRequest(@NotBlank @Size(max = 2048) String endpoint) {}

    record TestResponse(int delivered) {}
}
