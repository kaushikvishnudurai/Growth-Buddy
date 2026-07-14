package com.growthbuddy.user;

import com.growthbuddy.common.CurrentUser;
import com.growthbuddy.mentorship.MentorshipService;
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

    public UserController(UserRepository users, MentorshipService mentorship) {
        this.users = users;
        this.mentorship = mentorship;
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
     */
    public record PublicUser(
            UUID id, String displayName, String email, int level, String relationship) {
    }

    /**
     * Find users by name/email substring. The email field is only populated
     * when the searcher is *already connected* (accepted) with that user —
     * otherwise we return a masked form like {@code k****k@gmail.com} so the
     * searcher can disambiguate without leaking every Growth Buddy email.
     */
    @GetMapping("/search")
    public List<PublicUser> search(@RequestParam("q") String q) {
        if (q == null || q.trim().length() < 2) {
            return List.of();
        }
        UUID me = CurrentUser.id();
        return users.search(q.trim(), me, PageRequest.of(0, 20)).stream()
                .map(u -> toPublic(me, u))
                .toList();
    }

    /** Default discover-people list when the Circle screen first loads. */
    @GetMapping("/browse")
    public List<PublicUser> browse() {
        UUID me = CurrentUser.id();
        return users.browseExcluding(me, PageRequest.of(0, 30)).stream()
                .map(u -> toPublic(me, u))
                .toList();
    }

    private PublicUser toPublic(UUID me, User u) {
        String relationship = mentorship.relationship(me, u.getId()).state();
        boolean connected = "mentoring".equals(relationship) || "mentee".equals(relationship);
        String email = connected ? u.getEmail() : maskEmail(u.getEmail());
        return new PublicUser(u.getId(), u.getDisplayName(), email, u.getLevel(), relationship);
    }

    /** {@code alice@example.com} → {@code a***e@example.com}. */
    private static String maskEmail(String email) {
        if (email == null) return null;
        int at = email.indexOf('@');
        if (at <= 1) return "•••" + email.substring(Math.max(at, 0));
        String local = email.substring(0, at);
        String domain = email.substring(at);
        String first = local.substring(0, 1);
        String last = local.length() > 1 ? local.substring(local.length() - 1) : "";
        return first + "•••" + last + domain;
    }
}
