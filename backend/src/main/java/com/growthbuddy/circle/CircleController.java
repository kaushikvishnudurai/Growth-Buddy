package com.growthbuddy.circle;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/circles")
public class CircleController {

    private final CircleService service;

    public CircleController(CircleService service) {
        this.service = service;
    }

    /** All circles, flagged with whether the current user has joined. */
    @GetMapping
    public List<CircleResponse> all() {
        return service.listAll(CurrentUser.id());
    }

    /** Only the circles the current user belongs to. */
    @GetMapping("/mine")
    public List<CircleResponse> mine() {
        return service.listMine(CurrentUser.id());
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CircleResponse create(@Valid @RequestBody CreateCircleRequest req) {
        return service.create(CurrentUser.id(), req);
    }

    @PostMapping("/{id}/join")
    public CircleResponse join(@PathVariable UUID id) {
        return service.join(CurrentUser.id(), id);
    }

    @PostMapping("/{id}/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(@PathVariable UUID id) {
        service.leave(CurrentUser.id(), id);
    }

    @GetMapping("/{id}/posts")
    public List<PostResponse> posts(@PathVariable UUID id) {
        return service.posts(CurrentUser.id(), id);
    }

    @PostMapping("/{id}/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public PostResponse post(@PathVariable UUID id, @Valid @RequestBody CreatePostRequest req) {
        return service.post(CurrentUser.id(), id, req);
    }

    /** Challenges for a circle, each with its current leaderboard. */
    @GetMapping("/{id}/challenges")
    public List<ChallengeResponse> challenges(@PathVariable UUID id) {
        return service.listChallenges(CurrentUser.id(), id);
    }

    @PostMapping("/{id}/challenges")
    @ResponseStatus(HttpStatus.CREATED)
    public ChallengeResponse createChallenge(@PathVariable UUID id,
            @Valid @RequestBody CreateChallengeRequest req) {
        return service.createChallenge(CurrentUser.id(), id, req);
    }
}
