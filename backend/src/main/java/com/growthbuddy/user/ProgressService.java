package com.growthbuddy.user;

import com.growthbuddy.common.ApiException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProgressService {

    /** One level per this much XP. The client reads level progress from the user DTO
     *  ({@code xpIntoLevel} / {@code xpForNextLevel}) so it never keeps its own copy. */
    public static final int XP_PER_LEVEL = 100;
    private static final int TASK_COMPLETE_XP = 15;
    private static final int HABIT_CHECKIN_XP = 10;

    private final UserRepository users;

    public ProgressService(UserRepository users) {
        this.users = users;
    }

    /**
     * Take the user row's write lock first in a tick's transaction. The check-in or
     * history insert holds a shared lock on users through its foreign key, and the
     * XP update then wants it exclusive: two ticks at once deadlocked (one 503).
     * Locking up front queues a user's ticks behind each other instead.
     *
     * <p>A caller that decides on plain reads after this lock must run at
     * READ_COMMITTED. On TiDB (prod), REPEATABLE_READ serves a plain read from
     * the snapshot taken when the transaction began, before it waited here, so
     * the second of two queued freezes still saw the token the first had spent.
     * MySQL takes its snapshot at the first plain read and hides this locally.
     */
    @Transactional
    public void lockUser(UUID userId) {
        users.findForUpdate(userId);
    }

    @Transactional
    public void awardTaskCompletion(UUID userId) {
        addXp(userId, TASK_COMPLETE_XP);
    }

    @Transactional
    public void awardHabitCheckin(UUID userId) {
        addXp(userId, HABIT_CHECKIN_XP);
    }

    /** An un-ticked day hands back what its tick paid (EXS-9); never below zero. */
    @Transactional
    public void revokeHabitCheckin(UUID userId) {
        applyXp(userId, -HABIT_CHECKIN_XP);
    }

    /** A "break a habit" habit's clean days, each paid like one check-in (HabitService credits each once). */
    @Transactional
    public void awardHabitCleanDays(UUID userId, int days) {
        if (days > 0) {
            addXp(userId, HABIT_CHECKIN_XP * days);
        }
    }

    private void addXp(UUID userId, int delta) {
        if (delta <= 0) {
            return;
        }
        applyXp(userId, delta);
    }

    /**
     * xp_total and level only, in one statement. A save() of the User read at
     * transaction start rewrote the whole row: a concurrent award was lost, and a
     * timezone or ui_prefs change written meanwhile was reverted.
     */
    private void applyXp(UUID userId, int delta) {
        if (users.addXp(userId.toString(), delta, XP_PER_LEVEL) == 0) {
            throw ApiException.notFound("User not found");
        }
    }

    static int levelForXp(int xp) {
        return Math.max(1, 1 + (Math.max(0, xp) / XP_PER_LEVEL));
    }

    /** XP earned since the current level began. */
    public static int xpIntoLevel(int xp) {
        return Math.max(0, xp) % XP_PER_LEVEL;
    }

    /** XP still needed to reach the next level. */
    public static int xpForNextLevel(int xp) {
        return XP_PER_LEVEL - xpIntoLevel(xp);
    }
}
