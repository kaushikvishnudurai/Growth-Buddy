package com.growthbuddy.user;

import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.mentorship.MentorshipService;
import com.growthbuddy.mentorship.ProgressSharing;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public-ish user lookup used by Circle's "find a mentor" search. Returns only
 * the fields safe to expose to other users (no email beyond domain hint).
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository users;
    private final MentorshipService mentorship;
    private final RateLimiter limiter;

    public UserController(UserRepository users, MentorshipService mentorship, RateLimiter limiter) {
        this.users = users;
        this.mentorship = mentorship;
        this.limiter = limiter;
    }

    /**
     * Search hit. {@code relationship} tells the frontend whether to offer
     * invite buttons or just surface the existing tie:
     * <ul>
     *   <li>none — show invite buttons</li>
     *   <li>pending — show "Invite sent" pill</li>
     *   <li>mentoring — show "You mentor them" pill (tappable for status)</li>
     *   <li>mentee — show "They mentor you" pill</li>
     * </ul>
     *
     * <p>{@code relationship} collapses both directions into one word, so the UI
     * uses {@code mentorLink} / {@code menteeLink} instead — each is
     * none/pending/active for that direction on its own, which is what lets the
     * pair mentor each other at the same time.
     *
     * <p>{@code level} is null for someone who has turned progress sharing off:
     * a level is progress, and search reaches people who are no tie at all.
     */
    public record PublicUser(
            UUID id, String displayName, String email, Integer level, String relationship,
            String mentorLink, String menteeLink) {
    }

    /**
     * Find users by display-name substring (never email; see UserRepository.search). The email field is only populated
     * when the searcher is *already connected* (accepted) with that user —
     * otherwise a masked form like {@code k•••k} (no domain) so the
     * searcher can disambiguate without leaking every Growth Buddy email.
     */
    @GetMapping("/search")
    public List<PublicUser> search(@RequestParam("q") String q) {
        if (q == null || q.trim().length() < 2) {
            return List.of();
        }
        UUID me = CurrentUser.id();
        UserRepository.throttleSearch(limiter, me);
        return users.search(q.trim(), me, PageRequest.of(0, 20)).stream()
                .map(u -> toPublic(me, u))
                .toList();
    }

    /** Default discover-people list when the Circle screen first loads. */
    @GetMapping("/browse")
    public List<PublicUser> browse() {
        UUID me = CurrentUser.id();
        UserRepository.throttleSearch(limiter, me);
        return users.browseExcluding(me, PageRequest.of(0, 30)).stream()
                .map(u -> toPublic(me, u))
                .toList();
    }

    PublicUser toPublic(UUID me, User u) {
        var rel = mentorship.relationship(me, u.getId());
        boolean connected = "active".equals(rel.mentorLink()) || "active".equals(rel.menteeLink());
        String email = connected ? u.getEmail() : UserRepository.maskEmail(u.getEmail());
        Integer level = ProgressSharing.sharesProgress(u) ? u.getLevel() : null;
        return new PublicUser(u.getId(), u.getDisplayName(), email, level,
                rel.state(), rel.mentorLink(), rel.menteeLink());
    }
}
