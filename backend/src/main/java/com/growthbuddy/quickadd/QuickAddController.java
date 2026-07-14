package com.growthbuddy.quickadd;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Natural-language quick-add. The client sends the raw text plus the user's
 * habit names (so the parser can match them), and gets back structured intents
 * to apply locally. Stateless — no persistence here.
 */
@RestController
@RequestMapping("/api/quick-add")
public class QuickAddController {

    private final QuickAddService service;

    public QuickAddController(QuickAddService service) {
        this.service = service;
    }

    @PostMapping
    public QuickAddService.QuickAddResult parse(@Valid @RequestBody QuickAddRequest req) {
        return service.parse(req.text(), req.habits());
    }

    record QuickAddRequest(
            @NotBlank @Size(max = 400) String text,
            @Size(max = 100) List<String> habits) {
    }
}
