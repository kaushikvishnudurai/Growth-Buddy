package com.growthbuddy.circle;

import com.growthbuddy.common.CurrentUser;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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

    /** Join a PRIVATE circle with the code a member shared. */
    @PostMapping("/join-code")
    public CircleResponse joinByCode(@Valid @RequestBody JoinByCodeRequest req) {
        return service.joinByCode(CurrentUser.id(), req.code());
    }

    /** Owner only: deletes the circle with its posts and challenges. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(CurrentUser.id(), id);
    }

    @GetMapping("/{id}/members")
    public List<MemberResponse> members(@PathVariable UUID id) {
        return service.members(CurrentUser.id(), id);
    }

    /** Owner only. Answers the circle: a private one has a new join code. */
    @DeleteMapping("/{id}/members/{userId}")
    public CircleResponse removeMember(@PathVariable UUID id, @PathVariable UUID userId) {
        return service.removeMember(CurrentUser.id(), id, userId);
    }

    /** Owner only: hand the circle to another member (the caller stays as a member). */
    @PostMapping("/{id}/transfer")
    public CircleResponse transfer(@PathVariable UUID id, @Valid @RequestBody TransferRequest req) {
        return service.transfer(CurrentUser.id(), id, req.userId());
    }

    /** Newest 50; pass {@code before} (the oldest createdAt you hold) for the page before. */
    @GetMapping("/{id}/posts")
    public List<PostResponse> posts(@PathVariable UUID id,
            @RequestParam(required = false) Instant before) {
        return service.posts(CurrentUser.id(), id, before);
    }

    @PostMapping("/{id}/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public PostResponse post(@PathVariable UUID id, @Valid @RequestBody CreatePostRequest req) {
        return service.post(CurrentUser.id(), id, req);
    }

    /** Author, or the circle's owner. Takes the post's kudos with it. */
    @DeleteMapping("/{id}/posts/{postId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deletePost(@PathVariable UUID id, @PathVariable UUID postId) {
        service.deletePost(CurrentUser.id(), id, postId);
    }

    /** Toggle the caller's kudos on a post (one per member); answers the new count. */
    @PostMapping("/{id}/posts/{postId}/kudos")
    public KudosResponse kudos(@PathVariable UUID id, @PathVariable UUID postId) {
        return service.toggleKudos(CurrentUser.id(), id, postId);
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
