package com.growthbuddy.circle;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.growthbuddy.common.ApiException;
import com.growthbuddy.common.RateLimiter;
import com.growthbuddy.habit.HabitService;
import com.growthbuddy.notification.NotificationKind;
import com.growthbuddy.notification.NotificationService;
import com.growthbuddy.notification.NotifyCategory;
import com.growthbuddy.user.User;
import com.growthbuddy.user.UserClock;
import com.growthbuddy.user.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Replies ring the post's author (not yourself); a cheer rings once per pair per day, members only. */
class CircleRepliesAndCheersTest {

    private static final UUID AUTHOR = UUID.randomUUID();
    private static final UUID FAN = UUID.randomUUID();
    private static final UUID STRANGER = UUID.randomUUID();
    private static final UUID CIRCLE = UUID.randomUUID();
    private static final UUID POST = UUID.randomUUID();

    private final CircleRepository circles = mock(CircleRepository.class);
    private final CircleMemberRepository members = mock(CircleMemberRepository.class);
    private final CirclePostRepository posts = mock(CirclePostRepository.class);
    private final CirclePostCommentRepository comments = mock(CirclePostCommentRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final RateLimiter limiter = mock(RateLimiter.class);
    private final CircleService service = new CircleService(circles, members, posts,
            mock(CircleChallengeRepository.class), mock(CirclePostReactionRepository.class), comments, users,
            mock(HabitService.class), mock(ChallengeMetrics.class), mock(UserClock.class), notifications, limiter);

    @BeforeEach
    void setUp() {
        Circle c = new Circle();
        c.setId(CIRCLE);
        c.setName("Runners");
        c.setCreatedBy(AUTHOR);
        when(circles.findById(CIRCLE)).thenReturn(Optional.of(c));
        when(members.existsByCircleIdAndUserId(CIRCLE, AUTHOR)).thenReturn(true);
        when(members.existsByCircleIdAndUserId(CIRCLE, FAN)).thenReturn(true);
        CirclePost p = new CirclePost();
        p.setId(POST);
        p.setCircleId(CIRCLE);
        p.setUserId(AUTHOR);
        when(posts.findById(POST)).thenReturn(Optional.of(p));
        User fan = new User();
        fan.setDisplayName("Priya");
        when(users.findById(FAN)).thenReturn(Optional.of(fan));
        when(limiter.allow(anyString(), anyInt(), anyLong())).thenReturn(true);
        when(limiter.peek(anyString(), anyInt(), anyLong())).thenReturn(true);
    }

    @Test
    void aReplyRingsTheAuthorButNotYourself() {
        CommentResponse r = service.comment(FAN, CIRCLE, POST, new CreateCommentRequest("  Nice run!  "));
        assertEquals("Nice run!", r.body());
        verify(notifications).publish(eq(AUTHOR), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Priya replied in Runners"), eq("Nice run!"), eq(CIRCLE));
        service.comment(AUTHOR, CIRCLE, POST, new CreateCommentRequest("thanks"));
        verify(notifications, never()).publish(eq(FAN), any(), any(), anyString(), anyString(), any());
    }

    @Test
    void aStrangerCanNeitherReplyNorCheer() {
        assertThrows(ApiException.class, () -> service.comment(STRANGER, CIRCLE, POST, new CreateCommentRequest("hi")));
        assertThrows(ApiException.class, () -> service.cheer(FAN, CIRCLE, STRANGER, null));
        assertThrows(ApiException.class, () -> service.cheer(FAN, CIRCLE, FAN, null));
    }

    @Test
    void aCheerIsOncePerPairPerDayAndCountedOnlyWhenSent() {
        service.cheer(FAN, CIRCLE, AUTHOR, null);
        verify(notifications).publish(eq(AUTHOR), eq(NotificationKind.system), eq(NotifyCategory.people),
                eq("Priya is cheering you on"), eq("From your circle Runners."), eq(CIRCLE));
        verify(limiter).record(eq("circle-cheer:" + CIRCLE + ":" + FAN + ":" + AUTHOR), anyLong());

        when(limiter.peek(startsWith("circle-cheer:" + CIRCLE), anyInt(), anyLong())).thenReturn(false);
        ApiException ex = assertThrows(ApiException.class, () -> service.cheer(FAN, CIRCLE, AUTHOR, "go!"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, ex.getStatus());
    }

    @Test
    void onlyTheAuthorOrOwnerDeletesAReply() {
        CirclePostComment cm = new CirclePostComment();
        UUID id = UUID.randomUUID();
        cm.setId(id);
        cm.setPostId(POST);
        cm.setUserId(FAN);
        when(comments.findById(id)).thenReturn(Optional.of(cm));
        assertThrows(ApiException.class, () -> service.deleteComment(STRANGER, CIRCLE, POST, id));
        service.deleteComment(AUTHOR, CIRCLE, POST, id); // the owner
        verify(comments).delete(cm);
    }
}
